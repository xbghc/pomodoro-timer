import Foundation

public enum TimerEvent: Equatable {
    case workReminder
    case restFinished
    case scheduledWorkStarted
    case scheduledBlockEnded
    case clockMovedBackward
}

/// Pure state machine: all time enters explicitly. A reminder never closes a work record.
public struct ActivityEngine {
    public private(set) var configuration: ScheduleConfiguration
    public private(set) var snapshot: ActivitySnapshot
    public var resolver: ScheduleResolver

    public init(configuration: ScheduleConfiguration, snapshot: ActivitySnapshot = ActivitySnapshot(),
                calendar: Calendar = .current) throws {
        self.configuration = try configuration.validated()
        self.snapshot = try snapshot.validated()
        self.resolver = ScheduleResolver(calendar: calendar)
    }

    public var active: ActiveActivity? { snapshot.runtime.active }
    public var isWaiting: Bool { active == nil }
    public var isReminderDue: Bool { active?.kind == .work && snapshot.runtime.reminderDelivered }

    /// Startup / wake never replay elapsed blocks. A crash closes only the last saved observation.
    @discardableResult public mutating func activate(at now: Date) throws -> [TimerEvent] {
        try validateTime(now)
        if let observed = snapshot.runtime.lastObservedAt, active != nil {
            close(at: earliest(observed, snapshot.runtime.fixedEnd, snapshot.runtime.restEndsAt))
        }
        snapshot.runtime.suspended = false
        if protectClock(at: now) { return [.clockMovedBackward] }
        snapshot.runtime.lastObservedAt = now
        snapshot.runtime.clockBlockedUntil = nil
        expireSelection(at: now)
        if let block = currentBlock(at: now) {
            begin(.work, at: now, minutes: configuration.workMinutes, fixedEnd: block.end)
            return [.scheduledWorkStarted]
        }
        return []
    }

    @discardableResult public mutating func tick(at now: Date) throws -> [TimerEvent] {
        try validateTime(now)
        guard !snapshot.runtime.suspended else { return [] }
        if let blocked = snapshot.runtime.clockBlockedUntil {
            guard now >= blocked else { return [] }
            snapshot.runtime.clockBlockedUntil = nil
            snapshot.runtime.lastObservedAt = now
            expireSelection(at: now)
            if let block = currentBlock(at: now) {
                begin(.work, at: now, minutes: configuration.workMinutes, fixedEnd: block.end)
                return [.scheduledWorkStarted]
            }
            return []
        }
        if protectClock(at: now) { return [.clockMovedBackward] }
        let previous = snapshot.runtime.lastObservedAt ?? now
        let incoming = resolver.nextBlock(after: previous, configuration: configuration, selection: snapshot.selection)
        let crossed = incoming.flatMap { $0.start <= now ? $0 : nil }
        var events: [TimerEvent] = []

        // A manual activity entering a fixed block inherits its hard stop, without splitting work.
        if active?.kind == .work, snapshot.runtime.fixedEnd == nil, let crossed {
            snapshot.runtime.fixedEnd = crossed.end
        }
        if let current = active {
            var boundary = earliestOptional(snapshot.runtime.fixedEnd, snapshot.runtime.restEndsAt)
            if current.kind == .rest, let crossed {
                boundary = earliestOptional(boundary, crossed.start)
            }
            if let boundary, boundary <= now {
                let fixedEnded = snapshot.runtime.fixedEnd == boundary
                let restFinished = snapshot.runtime.restEndsAt == boundary
                close(at: boundary)
                if fixedEnded { events.append(.scheduledBlockEnded) }
                else if restFinished { events.append(.restFinished) }
            }
        }

        expireSelection(at: now)
        // Do not invent activity in fully missed blocks. The current block begins at observation time.
        if let block = currentBlock(at: now), block.start > previous, block.start <= now {
            if active?.kind == .rest { close(at: block.start) }
            if active == nil {
                begin(.work, at: now, minutes: configuration.workMinutes, fixedEnd: block.end)
                events.append(.scheduledWorkStarted)
            } else {
                snapshot.runtime.fixedEnd = block.end
            }
        }
        if active?.kind == .work, let reminder = snapshot.runtime.reminderAt,
           now >= reminder, !snapshot.runtime.reminderDelivered {
            snapshot.runtime.reminderDelivered = true
            events.append(.workReminder)
        }
        snapshot.runtime.lastObservedAt = now
        return events
    }

    @discardableResult public mutating func startWork(at now: Date, minutes: Int? = nil) throws -> [TimerEvent] {
        let duration = minutes ?? configuration.workMinutes
        try validateDuration(duration, maximum: 480)
        let events = try tick(at: now)
        try requireAvailable()
        guard active?.kind != .work else { return events }
        close(at: now)
        begin(.work, at: now, minutes: duration, fixedEnd: currentBlock(at: now)?.end)
        return events
    }

    @discardableResult public mutating func startRest(at now: Date, minutes: Int? = nil) throws -> [TimerEvent] {
        let duration = minutes ?? configuration.breakMinutes
        try validateDuration(duration, maximum: 240)
        let events = try tick(at: now)
        try requireAvailable()
        guard active?.kind != .rest else { throw ValidationError("已经在休息。") }
        close(at: now)
        begin(.rest, at: now, minutes: duration, fixedEnd: currentBlock(at: now)?.end)
        return events
    }

    @discardableResult public mutating func deferReminder(at now: Date, minutes: Int = 60) throws -> [TimerEvent] {
        try validateDuration(minutes, maximum: 480)
        let events = try tick(at: now)
        try requireAvailable()
        guard active?.kind == .work else { throw ValidationError("只有工作中才能调整下一次休息提醒。") }
        snapshot.runtime.reminderAt = now.addingTimeInterval(TimeInterval(minutes * 60))
        snapshot.runtime.reminderDelivered = false
        return events.filter { $0 != .workReminder }
    }

    @discardableResult public mutating func stop(at now: Date) throws -> [TimerEvent] {
        let events = try tick(at: now)
        try requireAvailable()
        close(at: now)
        return events
    }

    /// Sleep and normal exit both close actual activity; no offline interval is counted.
    @discardableResult public mutating func suspend(at now: Date) throws -> [TimerEvent] {
        let events = try tick(at: now)
        if snapshot.runtime.clockBlockedUntil == nil { close(at: now) }
        snapshot.runtime.suspended = true
        return events
    }

    @discardableResult public mutating func selectTemplate(_ name: String?, at now: Date) throws -> [TimerEvent] {
        if let name, configuration.templates[name] == nil { throw ValidationError("没有找到模板「\(name)」。") }
        var events = try tick(at: now)
        try requireAvailable()
        let before = currentBlock(at: now)
        snapshot.selection = name.map { DayTemplateSelection(day: resolver.dayKey(now), templateID: $0) }
        events += reconcileSchedule(previous: before, at: now)
        return events
    }

    @discardableResult public mutating func replaceConfiguration(_ configuration: ScheduleConfiguration,
                                                                at now: Date) throws -> [TimerEvent] {
        let validated = try configuration.validated()
        var events = try tick(at: now)
        try requireAvailable()
        let before = currentBlock(at: now)
        self.configuration = validated
        if let selection = snapshot.selection, configuration.templates[selection.templateID] == nil {
            snapshot.selection = nil
        }
        events += reconcileSchedule(previous: before, at: now)
        return events
    }

    public mutating func upsertRecord(_ record: ActivityRecord, at now: Date) throws {
        _ = try tick(at: now)
        try requireAvailable()
        var records = snapshot.records.filter { $0.id != record.id }
        records.append(record)
        try RecordValidation.validate(records, now: now, active: active)
        snapshot.records = records.sorted { $0.start < $1.start }
    }

    public mutating func deleteRecord(id: UUID, at now: Date) throws {
        _ = try tick(at: now)
        try requireAvailable()
        guard snapshot.records.contains(where: { $0.id == id }) else { throw ValidationError("记录不存在。") }
        snapshot.records.removeAll { $0.id == id }
    }

    public func currentBlock(at now: Date) -> PlannedBlock? {
        resolver.currentBlock(at: now, configuration: configuration, selection: snapshot.selection)
    }

    private mutating func reconcileSchedule(previous: PlannedBlock?, at now: Date) -> [TimerEvent] {
        let current = currentBlock(at: now)
        if let current {
            if active != nil {
                snapshot.runtime.fixedEnd = current.end
            } else if previous == nil {
                begin(.work, at: now, minutes: configuration.workMinutes, fixedEnd: current.end)
                return [.scheduledWorkStarted]
            }
        } else if previous != nil, active != nil {
            close(at: now)
            return [.scheduledBlockEnded]
        }
        return []
    }

    private mutating func begin(_ kind: ActivityKind, at now: Date, minutes: Int, fixedEnd: Date?) {
        snapshot.runtime.active = ActiveActivity(kind: kind, start: now)
        snapshot.runtime.reminderAt = kind == .work ? now.addingTimeInterval(TimeInterval(minutes * 60)) : nil
        snapshot.runtime.restEndsAt = kind == .rest ? now.addingTimeInterval(TimeInterval(minutes * 60)) : nil
        snapshot.runtime.reminderDelivered = false
        snapshot.runtime.fixedEnd = fixedEnd
        snapshot.runtime.lastObservedAt = now
    }

    private mutating func close(at end: Date) {
        if let active, end > active.start, !snapshot.records.contains(where: { $0.id == active.id }) {
            snapshot.records.append(ActivityRecord(id: active.id, kind: active.kind, start: active.start, end: end, origin: .timer))
            snapshot.records.sort { $0.start < $1.start }
        }
        snapshot.runtime.active = nil
        snapshot.runtime.reminderAt = nil
        snapshot.runtime.restEndsAt = nil
        snapshot.runtime.fixedEnd = nil
        snapshot.runtime.reminderDelivered = false
    }

    private mutating func protectClock(at now: Date) -> Bool {
        let floor = [snapshot.runtime.lastObservedAt, snapshot.records.map(\.end).max(),
                     snapshot.runtime.clockBlockedUntil].compactMap { $0 }.max()
        guard let floor, now < floor else { return false }
        if let observed = snapshot.runtime.lastObservedAt {
            close(at: earliest(observed, snapshot.runtime.fixedEnd, snapshot.runtime.restEndsAt))
        }
        snapshot.runtime.clockBlockedUntil = floor
        return true
    }

    private mutating func expireSelection(at now: Date) {
        if let selection = snapshot.selection, selection.day != resolver.dayKey(now) { snapshot.selection = nil }
    }

    private func requireAvailable() throws {
        guard !snapshot.runtime.suspended else { throw ValidationError("系统已暂停记录，请唤醒后再操作。") }
        guard snapshot.runtime.clockBlockedUntil == nil else { throw ValidationError("系统时间早于已记录时间，已安全暂停。请校正系统时间。") }
    }
    private func validateTime(_ date: Date) throws {
        guard date.timeIntervalSince1970.isFinite else { throw ValidationError("时钟返回了无效时间。") }
    }
    private func validateDuration(_ minutes: Int, maximum: Int) throws {
        guard (1...maximum).contains(minutes) else { throw ValidationError("时长必须是 1–\(maximum) 分钟。") }
    }
    private func earliest(_ date: Date, _ others: Date?...) -> Date { ([date] + others.compactMap { $0 }).min()! }
    private func earliestOptional(_ dates: Date?...) -> Date? { dates.compactMap { $0 }.min() }
}
