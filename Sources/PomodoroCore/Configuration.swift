import Foundation

public struct ValidationError: Error, LocalizedError, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public struct WorkBlock: Codable, Equatable, Sendable {
    public let start: String
    public let end: String

    public init(start: String, end: String) {
        self.start = start
        self.end = end
    }

    public static func minutes(_ text: String) -> Int? {
        let bytes = Array(text.utf8)
        guard bytes.count == 5, bytes[2] == 58,
              [0, 1, 3, 4].allSatisfy({ (48...57).contains(bytes[$0]) }) else { return nil }
        let hour = Int(bytes[0] - 48) * 10 + Int(bytes[1] - 48)
        let minute = Int(bytes[3] - 48) * 10 + Int(bytes[4] - 48)
        return hour < 24 && minute < 60 ? hour * 60 + minute : nil
    }
}

public struct ScheduleConfiguration: Codable, Equatable, Sendable {
    public var workMinutes: Int
    public var breakMinutes: Int
    public var defaultTemplate: String
    /// 0 = Sunday ... 6 = Saturday. Unspecified weekdays use defaultTemplate.
    public var weekdays: [String: String]
    public var templates: [String: [WorkBlock]]

    public init(workMinutes: Int = 30, breakMinutes: Int = 5,
                defaultTemplate: String, weekdays: [String: String] = [:],
                templates: [String: [WorkBlock]]) {
        self.workMinutes = workMinutes
        self.breakMinutes = breakMinutes
        self.defaultTemplate = defaultTemplate
        self.weekdays = weekdays
        self.templates = templates
    }

    /// An editable example, not an assertion about the user's weekday/weekend preferences.
    public static let example = ScheduleConfiguration(
        defaultTemplate: "常规日",
        weekdays: Dictionary(uniqueKeysWithValues: (0...6).map { (String($0), "常规日") }),
        templates: [
            "常规日": [WorkBlock(start: "10:00", end: "12:10"),
                      WorkBlock(start: "13:30", end: "18:10"),
                      WorkBlock(start: "19:30", end: "22:30")],
            "无固定时段": []
        ]
    )

    public func validated() throws -> Self {
        guard (1...480).contains(workMinutes) else { throw ValidationError("workMinutes 必须为 1–480 的整数。") }
        guard (1...240).contains(breakMinutes) else { throw ValidationError("breakMinutes 必须为 1–240 的整数。") }
        guard !templates.isEmpty, templates[defaultTemplate] != nil else {
            throw ValidationError("defaultTemplate 必须引用已定义的模板。")
        }
        for (day, template) in weekdays {
            guard ["0", "1", "2", "3", "4", "5", "6"].contains(day), templates[template] != nil else {
                throw ValidationError("weekdays.\(day) 必须是 0–6 的星期并引用已定义的模板。")
            }
        }
        for (name, blocks) in templates {
            guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ValidationError("模板名称不能为空。")
            }
            var lastEnd = -1
            for (index, block) in blocks.enumerated() {
                guard let start = WorkBlock.minutes(block.start), let end = WorkBlock.minutes(block.end), start < end else {
                    throw ValidationError("模板「\(name)」第 \(index + 1) 段需要同一天的 HH:mm，且开始早于结束。")
                }
                guard start >= lastEnd else {
                    throw ValidationError("模板「\(name)」的时段必须按时间排序且不能重叠。")
                }
                lastEnd = end
            }
        }
        return self
    }

    public static func decode(_ data: Data) throws -> Self {
        // Fail on misspellings instead of silently ignoring an intended schedule change.
        let object = try JSONSerialization.jsonObject(with: data)
        guard let root = object as? [String: Any] else { throw ValidationError("日程 JSON 顶层必须是对象。") }
        let allowed: Set<String> = ["workMinutes", "breakMinutes", "defaultTemplate", "weekdays", "templates"]
        if let unknown = Set(root.keys).subtracting(allowed).sorted().first {
            throw ValidationError("未知配置项：\(unknown)。")
        }
        if let templates = root["templates"] as? [String: Any] {
            for (name, value) in templates {
                if let blocks = value as? [[String: Any]] {
                    for block in blocks where !Set(block.keys).isSubset(of: ["start", "end"]) {
                        throw ValidationError("模板「\(name)」的时段只接受 start 和 end。")
                    }
                }
            }
        }
        do { return try JSONDecoder().decode(Self.self, from: data).validated() }
        catch let error as ValidationError { throw error }
        catch { throw ValidationError("日程 JSON 字段缺失或类型错误：\(error.localizedDescription)") }
    }
}

public struct DayTemplateSelection: Codable, Equatable, Sendable {
    public let day: String
    public let templateID: String
    public init(day: String, templateID: String) { self.day = day; self.templateID = templateID }
}

public struct PlannedBlock: Identifiable, Equatable, Sendable {
    public let id: String
    public let templateID: String
    public let start: Date
    public let end: Date
    public func contains(_ date: Date) -> Bool { start <= date && date < end }
}

public struct ScheduleResolver {
    public var calendar: Calendar
    public init(calendar: Calendar = .current) { self.calendar = calendar }

    public func dayKey(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    public func templateID(on date: Date, configuration: ScheduleConfiguration,
                           selection: DayTemplateSelection?) -> String {
        if let selection, selection.day == dayKey(date), configuration.templates[selection.templateID] != nil {
            return selection.templateID
        }
        return configuration.weekdays[String(calendar.component(.weekday, from: date) - 1)] ?? configuration.defaultTemplate
    }

    public func blocks(on date: Date, configuration: ScheduleConfiguration,
                       selection: DayTemplateSelection?) -> [PlannedBlock] {
        let name = templateID(on: date, configuration: configuration, selection: selection)
        let day = calendar.startOfDay(for: date)
        return (configuration.templates[name] ?? []).enumerated().compactMap { index, block in
            guard let startMinute = WorkBlock.minutes(block.start), let endMinute = WorkBlock.minutes(block.end) else { return nil }
            func localTime(_ minute: Int) -> Date? {
                // DST: nonexistent times advance to the first valid time; repeated times use the first occurrence.
                calendar.nextDate(after: day.addingTimeInterval(-1),
                                  matching: DateComponents(hour: minute / 60, minute: minute % 60, second: 0),
                                  matchingPolicy: .nextTime, repeatedTimePolicy: .first)
            }
            guard let start = localTime(startMinute), let end = localTime(endMinute),
                  calendar.isDate(start, inSameDayAs: date), calendar.isDate(end, inSameDayAs: date), start < end else { return nil }
            return PlannedBlock(id: "\(dayKey(date))/\(name)/\(index)", templateID: name, start: start, end: end)
        }
    }

    public func currentBlock(at date: Date, configuration: ScheduleConfiguration,
                             selection: DayTemplateSelection?) -> PlannedBlock? {
        blocks(on: date, configuration: configuration, selection: selection).first { $0.contains(date) }
    }

    public func nextBlock(after date: Date, configuration: ScheduleConfiguration,
                          selection: DayTemplateSelection?) -> PlannedBlock? {
        // Weekly mapping repeats within seven days; an override can suppress today only.
        for offset in 0...8 {
            guard let day = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: date)) else { continue }
            if let block = blocks(on: day, configuration: configuration, selection: selection).first(where: { $0.start > date }) {
                return block
            }
        }
        return nil
    }
}
