import Foundation

public enum ActivityKind: String, Codable, CaseIterable, Hashable, Sendable {
    case work, rest
    public var title: String { self == .work ? "工作" : "休息" }
}

public enum RecordOrigin: String, Codable, Sendable { case timer, manual }

public struct ActivityRecord: Identifiable, Codable, Equatable, Sendable {
    public let id: UUID
    public var kind: ActivityKind
    public var start: Date
    public var end: Date
    public var origin: RecordOrigin

    public init(id: UUID = UUID(), kind: ActivityKind, start: Date, end: Date, origin: RecordOrigin = .manual) {
        self.id = id; self.kind = kind; self.start = start; self.end = end; self.origin = origin
    }
    public var duration: TimeInterval { max(0, end.timeIntervalSince(start)) }
}

public struct ActiveActivity: Codable, Equatable, Sendable {
    public let id: UUID
    public let kind: ActivityKind
    public let start: Date
    public init(id: UUID = UUID(), kind: ActivityKind, start: Date) {
        self.id = id; self.kind = kind; self.start = start
    }
}

public struct RuntimeState: Codable, Equatable, Sendable {
    public var active: ActiveActivity?
    public var reminderAt: Date?
    public var reminderDelivered = false
    public var restEndsAt: Date?
    public var fixedEnd: Date?
    public var lastObservedAt: Date?
    public var suspended = false
    public var clockBlockedUntil: Date?
    public init() {}
}

public struct ActivitySnapshot: Codable, Equatable, Sendable {
    public var formatVersion = 1
    public var records: [ActivityRecord] = []
    public var runtime = RuntimeState()
    public var selection: DayTemplateSelection?
    public init() {}

    public func validated() throws -> Self {
        guard formatVersion == 1 else { throw ValidationError("无法识别活动数据格式；原文件未改动。") }
        try RecordValidation.validate(records)
        let runtime = runtime
        let dates = [runtime.reminderAt, runtime.restEndsAt, runtime.fixedEnd,
                     runtime.lastObservedAt, runtime.clockBlockedUntil].compactMap { $0 }
        guard dates.allSatisfy({ $0.timeIntervalSince1970.isFinite }) else {
            throw ValidationError("运行检查点包含无效时间。")
        }
        if let active = runtime.active {
            guard active.start.timeIntervalSince1970.isFinite,
                  let observed = runtime.lastObservedAt, observed >= active.start,
                  !records.contains(where: { $0.id == active.id || $0.end > active.start }),
                  !runtime.suspended, runtime.clockBlockedUntil == nil else {
                throw ValidationError("运行检查点与历史记录冲突；未覆盖原文件。")
            }
            guard (active.kind == .work && runtime.reminderAt != nil && runtime.restEndsAt == nil) ||
                  (active.kind == .rest && runtime.restEndsAt != nil && runtime.reminderAt == nil),
                  runtime.fixedEnd.map({ $0 > active.start }) ?? true,
                  runtime.restEndsAt.map({ $0 > active.start }) ?? true,
                  runtime.reminderAt.map({ $0 >= active.start }) ?? true else {
                throw ValidationError("活动检查点缺少正确的提醒或结束时间。")
            }
        } else if runtime.reminderAt != nil || runtime.restEndsAt != nil || runtime.fixedEnd != nil || runtime.reminderDelivered {
            throw ValidationError("等待状态不能含有活动截止时间。")
        }
        return self
    }
}

public enum RecordValidation {
    public static func validate(_ records: [ActivityRecord], now: Date? = nil, active: ActiveActivity? = nil) throws {
        var ids = Set<UUID>()
        var previousEnd: Date?
        for record in records.sorted(by: { $0.start < $1.start }) {
            guard record.start.timeIntervalSince1970.isFinite, record.end.timeIntervalSince1970.isFinite,
                  record.start < record.end else { throw ValidationError("记录的开始时间必须早于结束时间。") }
            guard ids.insert(record.id).inserted else { throw ValidationError("记录 ID 重复。") }
            if let now, record.end > now { throw ValidationError("只能记录已经发生的工作或休息，不能添加未来记录。") }
            if let previousEnd, record.start < previousEnd { throw ValidationError("实际记录不能互相重叠；相邻记录可以共用边界。") }
            if let active, record.id == active.id || record.end > active.start {
                throw ValidationError("记录与正在进行的活动冲突，请先结束当前活动。")
            }
            previousEnd = record.end
        }
    }
}

public struct DailySummary: Equatable {
    public var work: TimeInterval = 0
    public var rest: TimeInterval = 0
    public init(date: Date, records: [ActivityRecord], active: ActiveActivity?, now: Date, calendar: Calendar) {
        guard let day = calendar.dateInterval(of: .day, for: date) else { return }
        var intervals = records
        if let active, now > active.start {
            intervals.append(ActivityRecord(id: active.id, kind: active.kind, start: active.start, end: now, origin: .timer))
        }
        for record in intervals {
            let duration = max(0, min(day.end, record.end).timeIntervalSince(max(day.start, record.start)))
            if record.kind == .work { work += duration } else { rest += duration }
        }
    }
}
