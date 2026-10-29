import AppKit
import SwiftUI
import PomodoroCore

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var snapshot = ActivitySnapshot()
    @Published private(set) var configuration = ScheduleConfiguration.example
    @Published private(set) var now = Date()
    @Published private(set) var isReady = false
    @Published var errorMessage: String?
    @Published private(set) var blockingError: String?
    @Published private(set) var reminderMessage: String?
    @Published var showsMenuBarTimer = UserDefaults.standard.object(forKey: "showsMenuBarTimer") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(showsMenuBarTimer, forKey: "showsMenuBarTimer")
            onChange?()
        }
    }

    let directory: URL
    var openCalendar: (@MainActor () -> Void)?
    var openActivity: (@MainActor () -> Void)?
    var openSettings: (@MainActor () -> Void)?
    var onReminder: (@MainActor (String) -> Void)?
    var onChange: (@MainActor () -> Void)?
    private var session: ActivitySession?
    private var timer: Timer?

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PomodoroTimerNative", isDirectory: true)
        load()
        timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        if let timer { RunLoop.main.add(timer, forMode: .common) }
    }

    var active: ActiveActivity? { snapshot.runtime.active }
    var isBlocked: Bool { !isReady || blockingError != nil || snapshot.runtime.clockBlockedUntil != nil || snapshot.runtime.suspended }
    var phaseTitle: String {
        if isBlocked { return "Paused" }
        return active?.kind.title ?? "Idle"
    }
    var tint: Color {
        if isBlocked { return .orange }
        return active?.kind == .rest ? PomodoroTheme.rest : PomodoroTheme.work
    }
    var readout: TimerReadout {
        TimerReadout(runtime: snapshot.runtime, workMinutes: configuration.workMinutes,
                     now: observedNow, restDeadline: session?.engine.restDeadline)
    }
    var timerCaption: String {
        if isBlocked { return "Paused · Show details" }
        if isReminderDue { return "Break due · still tracking" }
        if active?.kind == .work { return "Focus · \(Self.duration(elapsed)) elapsed" }
        if active?.kind == .rest { return "Break · restart when ready" }
        return "Ready when you are"
    }
    var isReminderDue: Bool { active?.kind == .work && snapshot.runtime.reminderDelivered }
    var observedNow: Date {
        isBlocked ? (snapshot.runtime.lastObservedAt ?? now) : now
    }
    var elapsed: TimeInterval { active.map { max(0, observedNow.timeIntervalSince($0.start)) } ?? 0 }
    var restRemaining: TimeInterval { max(0, (session?.engine.restDeadline ?? observedNow).timeIntervalSince(observedNow)) }
    var selectedTemplate: String {
        ScheduleResolver().templateID(on: now, configuration: configuration, selection: snapshot.selection)
    }
    var detail: String {
        if let blockingError { return blockingError }
        if let until = snapshot.runtime.clockBlockedUntil {
            return "The system clock moved backward. Tracking is paused until \(Self.dateTime(until, includeSeconds: true)). Check your clock settings."
        }
        if isReminderDue { return "Time for a break. Wrap up when you are ready." }
        if active?.kind == .work, let reminder = snapshot.runtime.reminderAt {
            if let end = snapshot.runtime.fixedEnd, end <= reminder { return "This work block ends at \(Self.time(end))." }
            return "Break reminder at \(Self.time(reminder))."
        }
        if active?.kind == .rest { return "When the break ends, start work again when you are ready." }
        if let message = reminderMessage { return message }
        if let next = ScheduleResolver().nextBlock(after: now, configuration: configuration, selection: snapshot.selection) {
            return "Next work block: \(AppModel.dateTime(next.start))"
        }
        return "Start a work session when you are ready."
    }

    func load() {
        do {
            let store = try JSONActivityStore(directory: directory)
            session = try ActivitySession(store: store)
            isReady = true
            blockingError = nil
            errorMessage = nil
            refresh()
        } catch {
            session = nil
            isReady = false
            blockingError = UserFacingError.message(error)
        }
        onChange?()
    }

    func startWork(minutes: Int? = nil) {
        action { try $0.startWork(at: $1, minutes: minutes) }
    }
    func startRest(minutes: Int? = nil) {
        action { try $0.startRest(at: $1, minutes: minutes) }
    }
    func deferReminder(minutes: Int = 60) { action { try $0.deferReminder(at: $1, minutes: minutes) } }
    func stop() { action { try $0.stop(at: $1) } }
    func selectTemplate(_ name: String?) { action { try $0.selectTemplate(name, at: $1) } }
    func suspend() { action { try $0.suspend(at: $1) } }
    func wake() { action { try $0.activate(at: $1) } }

    func timeZoneChanged() {
        action { engine, now in
            _ = try engine.suspend(at: now)
            engine.resolver.calendar = .current
            return try engine.activate(at: now)
        }
    }

    @discardableResult func save(_ record: ActivityRecord) -> Bool {
        action { try $0.upsertRecord(record, at: $1) }
    }
    @discardableResult func delete(_ record: ActivityRecord) -> Bool {
        action { try $0.deleteRecord(id: record.id, at: $1) }
    }
    func reloadConfiguration() {
        guard let session else { load(); return }
        do {
            let events = try session.reloadConfiguration()
            errorMessage = nil
            refresh(events: events)
        } catch { report(error) }
    }
    func openJSON() {
        let url = directory.appendingPathComponent("schedule.json")
        if !NSWorkspace.shared.open(url) { errorMessage = "Unable to open the JSON file: \(url.path)" }
    }
    func showDataFolder() { NSWorkspace.shared.open(directory) }

    func prepareToQuit() -> Bool {
        guard session != nil else { return true }
        return action { try $0.suspend(at: $1) }
    }

    func summary(for date: Date) -> DailySummary {
        DailySummary(date: date, records: snapshot.records, active: active, now: observedNow, calendar: .current)
    }

    private func tick() {
        now = Date()
        guard let session, blockingError == nil else { return }
        do { refresh(events: try session.tick()) }
        catch { report(error) }
    }

    @discardableResult private func action(_ operation: (inout ActivityEngine, Date) throws -> [TimerEvent]) -> Bool {
        guard let session else { return false }
        do {
            let events = try session.perform(operation)
            reminderMessage = nil
            errorMessage = nil
            refresh(events: events)
            return true
        } catch { report(error); return false }
    }

    private func refresh(events: [TimerEvent] = []) {
        guard let session else { return }
        snapshot = session.engine.snapshot
        configuration = session.engine.configuration
        now = Date()
        handle(events)
        onChange?()
    }
    private func report(_ error: Error) {
        if let failure = session?.persistenceFailure { blockingError = failure }
        else { errorMessage = UserFacingError.message(error) }
        refresh()
    }
    private func handle(_ events: [TimerEvent]) {
        for event in events {
            let text: String
            switch event {
            case .workReminder: text = "Break due. Take it when ready."
            case .restFinished: text = "Break finished. Start when ready."
            case .scheduledWorkStarted: text = "Scheduled work started."
            case .scheduledBlockEnded: text = "Work block finished."
            case .clockMovedBackward: text = "Clock changed. Tracking paused."
            }
            reminderMessage = text
            onReminder?(text)
        }
    }

    static func time(_ date: Date) -> String { EnglishFormat.time(date) }
    static func dateTime(_ date: Date, includeSeconds: Bool = false) -> String {
        EnglishFormat.dateTime(date, includeSeconds: includeSeconds)
    }
    static func duration(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        if total >= 3600 { return String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60) }
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
    static func minutes(_ seconds: TimeInterval) -> String {
        let minutes = max(0, Int(seconds / 60))
        return minutes >= 60 ? "\(minutes / 60) hr \(minutes % 60) min" : "\(minutes) min"
    }
}
