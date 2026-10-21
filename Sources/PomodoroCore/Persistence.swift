import Foundation

public protocol ActivityStore {
    func loadConfiguration() throws -> ScheduleConfiguration
    func loadSnapshot() throws -> ActivitySnapshot
    func saveSnapshot(_ snapshot: ActivitySnapshot) throws
}

/// One atomic document contains both committed history and its checkpoint. No split-file commit.
public final class JSONActivityStore: ActivityStore {
    public let directory: URL
    public var configurationURL: URL { directory.appendingPathComponent("schedule.json") }
    public var snapshotURL: URL { directory.appendingPathComponent("activities.json") }

    public init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        // Milliseconds are preserved when an unchanged historical record is saved again.
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return encoder
    }

    public func loadConfiguration() throws -> ScheduleConfiguration {
        if !FileManager.default.fileExists(atPath: configurationURL.path) {
            try Self.encoder().encode(ScheduleConfiguration.example).write(to: configurationURL, options: .atomic)
        }
        return try ScheduleConfiguration.decode(Data(contentsOf: configurationURL))
    }

    public func loadSnapshot() throws -> ActivitySnapshot {
        guard FileManager.default.fileExists(atPath: snapshotURL.path) else { return ActivitySnapshot() }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        do { return try decoder.decode(ActivitySnapshot.self, from: Data(contentsOf: snapshotURL)).validated() }
        catch { throw ValidationError("无法读取 activities.json：\(error.localizedDescription) 原文件已保留。") }
    }

    public func saveSnapshot(_ snapshot: ActivitySnapshot) throws {
        _ = try snapshot.validated()
        try Self.encoder().encode(snapshot).write(to: snapshotURL, options: .atomic)
    }
}

/// Serial application service. Injected clock and store let tests exercise the actual transaction path.
public final class ActivitySession {
    public private(set) var engine: ActivityEngine
    public private(set) var persistenceFailure: String?
    private let store: ActivityStore
    private let clock: () -> Date
    private var persistedAt: Date

    public init(store: ActivityStore, calendar: Calendar = .current, clock: @escaping () -> Date = Date.init) throws {
        self.store = store
        self.clock = clock
        let now = clock()
        var engine = try ActivityEngine(configuration: store.loadConfiguration(), snapshot: store.loadSnapshot(), calendar: calendar)
        _ = try engine.activate(at: now)
        try store.saveSnapshot(engine.snapshot)
        self.engine = engine
        self.persistedAt = now
    }

    @discardableResult public func tick() throws -> [TimerEvent] {
        try requireHealthy()
        let now = clock()
        var candidate = engine
        let events = try candidate.tick(at: now)
        var before = engine.snapshot
        var after = candidate.snapshot
        before.runtime.lastObservedAt = nil
        after.runtime.lastObservedAt = nil
        if before != after || abs(now.timeIntervalSince(persistedAt)) >= 5 {
            try persist(candidate, at: now)
        } else { engine = candidate }
        return events
    }

    @discardableResult public func perform(_ action: (inout ActivityEngine, Date) throws -> [TimerEvent]) throws -> [TimerEvent] {
        try requireHealthy()
        let now = clock()
        var candidate = engine
        let events = try action(&candidate, now)
        try persist(candidate, at: now)
        return events
    }

    @discardableResult public func reloadConfiguration() throws -> [TimerEvent] {
        try requireHealthy()
        let configuration = try store.loadConfiguration()
        return try perform { try $0.replaceConfiguration(configuration, at: $1) }
    }

    private func persist(_ candidate: ActivityEngine, at now: Date) throws {
        do { try store.saveSnapshot(candidate.snapshot) }
        catch {
            persistenceFailure = "保存失败，已暂停记录，避免丢失或重复数据：\(error.localizedDescription)"
            throw ValidationError(persistenceFailure!)
        }
        engine = candidate
        persistedAt = now
    }

    private func requireHealthy() throws {
        if let persistenceFailure { throw ValidationError(persistenceFailure) }
    }
}
