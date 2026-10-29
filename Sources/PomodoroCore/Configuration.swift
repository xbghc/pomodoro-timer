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
        defaultTemplate: "Regular day",
        weekdays: Dictionary(uniqueKeysWithValues: (0...6).map { (String($0), "Regular day") }),
        templates: [
            "Regular day": [WorkBlock(start: "10:00", end: "12:10"),
                            WorkBlock(start: "13:30", end: "18:10"),
                            WorkBlock(start: "19:30", end: "22:30")],
            "No fixed hours": []
        ]
    )

    /// Translate earlier built-in names for display only; saved identifiers stay intact.
    public func displayName(for templateID: String) -> String {
        let title: String
        // Escaped legacy Chinese identifiers preserve existing files without non-English source text.
        switch templateID {
        case "\u{5E38}\u{89C4}\u{65E5}": title = "Regular day"
        case "\u{65E0}\u{56FA}\u{5B9A}\u{65F6}\u{6BB5}": title = "No fixed hours"
        default: return templateID
        }
        var candidate = title
        var suffix = 1
        while templates[candidate] != nil {
            candidate = "\(title) (\(suffix))"
            suffix += 1
        }
        return candidate
    }

    public func validated() throws -> Self {
        guard (1...480).contains(workMinutes) else { throw ValidationError("workMinutes must be an integer between 1 and 480.") }
        guard (1...240).contains(breakMinutes) else { throw ValidationError("breakMinutes must be an integer between 1 and 240.") }
        guard !templates.isEmpty, templates[defaultTemplate] != nil else {
            throw ValidationError("defaultTemplate must refer to an existing template.")
        }
        for (day, template) in weekdays {
            guard ["0", "1", "2", "3", "4", "5", "6"].contains(day), templates[template] != nil else {
                throw ValidationError("weekdays.\(day) must use a day from 0 to 6 and refer to an existing template.")
            }
        }
        for (name, blocks) in templates {
            guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ValidationError("Template names cannot be empty.")
            }
            var lastEnd = -1
            for (index, block) in blocks.enumerated() {
                guard let start = WorkBlock.minutes(block.start), let end = WorkBlock.minutes(block.end), start < end else {
                    throw ValidationError("Block \(index + 1) in template '\(name)' must use same-day HH:mm times, with the start before the end.")
                }
                guard start >= lastEnd else {
                    throw ValidationError("Blocks in template '\(name)' must be sorted by time and must not overlap.")
                }
                lastEnd = end
            }
        }
        return self
    }

    public static func decode(_ data: Data) throws -> Self {
        // Fail on misspellings instead of silently ignoring an intended schedule change.
        let object = try JSONSerialization.jsonObject(with: data)
        guard let root = object as? [String: Any] else { throw ValidationError("The schedule JSON must contain an object at the top level.") }
        let allowed: Set<String> = ["workMinutes", "breakMinutes", "defaultTemplate", "weekdays", "templates"]
        if let unknown = Set(root.keys).subtracting(allowed).sorted().first {
            throw ValidationError("Unknown configuration field: \(unknown).")
        }
        if let templates = root["templates"] as? [String: Any] {
            for (name, value) in templates {
                if let blocks = value as? [[String: Any]] {
                    for block in blocks where !Set(block.keys).isSubset(of: ["start", "end"]) {
                        throw ValidationError("Blocks in template '\(name)' only accept start and end.")
                    }
                }
            }
        }
        do { return try JSONDecoder().decode(Self.self, from: data).validated() }
        catch let error as ValidationError { throw error }
        catch { throw ValidationError("A schedule JSON field is missing or has the wrong type. \(UserFacingError.message(error))") }
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
                // Resolve missing local minutes explicitly. Foundation's .nextTime can skip
                // the entire day for a non-hour DST gap (e.g. Lord Howe's 02:00–02:30).
                // Exact matches and repeated times take the first occurrence on this day.
                for candidate in minute..<1440 {
                    if let result = calendar.nextDate(after: day.addingTimeInterval(-1),
                                                      matching: DateComponents(hour: candidate / 60, minute: candidate % 60, second: 0),
                                                      matchingPolicy: .strict, repeatedTimePolicy: .first),
                       calendar.isDate(result, inSameDayAs: date) { return result }
                }
                return nil
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
