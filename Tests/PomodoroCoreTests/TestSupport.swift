import Foundation
import XCTest
@testable import PomodoroCore

func instant(_ text: String) -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text)!
}

func time(_ text: String, day: String = "2026-10-21") -> Date { instant("\(day)T\(text):00Z") }
var utc: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    return calendar
}
var unscheduled: ScheduleConfiguration { ScheduleConfiguration(defaultTemplate: "off", templates: ["off": []]) }

func running(at date: Date = time("10:00"), config: ScheduleConfiguration = .example) throws -> ActivityEngine {
    var engine = try ActivityEngine(configuration: config, calendar: utc)
    try engine.activate(at: date)
    return engine
}

final class ManualClock {
    var now: Date
    init(_ now: Date) { self.now = now }
}

final class MemoryStore: ActivityStore {
    var configuration = ScheduleConfiguration.example
    var snapshot = ActivitySnapshot()
    var failure = false
    var saves = 0
    func loadConfiguration() throws -> ScheduleConfiguration { configuration }
    func loadSnapshot() throws -> ActivitySnapshot { snapshot }
    func saveSnapshot(_ snapshot: ActivitySnapshot) throws {
        if failure { throw ValidationError("test disk full") }
        self.snapshot = try snapshot.validated()
        saves += 1
    }
}
