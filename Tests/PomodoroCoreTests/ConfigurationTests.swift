import XCTest
@testable import PomodoroCore

final class ConfigurationTests: XCTestCase {
    func testExampleRoundTrip() throws {
        let data = try JSONActivityStore.encoder().encode(ScheduleConfiguration.example)
        XCTAssertEqual(try ScheduleConfiguration.decode(data), .example)
    }

    func testCheckedInExampleMatchesShippedDefaults() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("Resources/schedule.example.json"))
        XCTAssertEqual(try ScheduleConfiguration.decode(data), .example)
    }

    func testStrictClockFormatAndRange() {
        XCTAssertEqual(WorkBlock.minutes("00:00"), 0)
        XCTAssertEqual(WorkBlock.minutes("23:59"), 1439)
        for invalid in ["9:00", "24:00", "12:60", " 10:00", "10:00 ", "aa:bb", "１２:00", ""] {
            XCTAssertNil(WorkBlock.minutes(invalid), invalid)
        }
    }

    func testRejectsOverlapsUnsortedAndCrossDayBlocks() throws {
        for blocks in [
            [WorkBlock(start: "10:00", end: "12:00"), WorkBlock(start: "11:00", end: "13:00")],
            [WorkBlock(start: "13:00", end: "14:00"), WorkBlock(start: "10:00", end: "11:00")],
            [WorkBlock(start: "22:00", end: "02:00")],
            [WorkBlock(start: "10:00", end: "10:00")]
        ] {
            var config = unscheduled
            config.templates["off"] = blocks
            XCTAssertThrowsError(try config.validated())
        }
    }

    func testRejectsMissingTemplateInvalidWeekdayAndTiming() throws {
        var config = unscheduled
        config.defaultTemplate = "missing"
        XCTAssertThrowsError(try config.validated())
        config = unscheduled
        config.weekdays["7"] = "off"
        XCTAssertThrowsError(try config.validated())
        config = unscheduled
        config.weekdays["1"] = "missing"
        XCTAssertThrowsError(try config.validated())
        config = unscheduled
        config.workMinutes = 0
        XCTAssertThrowsError(try config.validated())
    }

    func testInvalidJSONAndUnknownKeysFailWithoutFallback() throws {
        for json in ["{", "[]", "{}", "{\"workMinute\":30}",
                     "{\"workMinutes\":true,\"breakMinutes\":5,\"defaultTemplate\":\"a\",\"weekdays\":{},\"templates\":{\"a\":[]}}"] {
            XCTAssertThrowsError(try ScheduleConfiguration.decode(Data(json.utf8)))
        }
    }

    func testHalfOpenBoundariesAndAdjacentBlocks() throws {
        let resolver = ScheduleResolver(calendar: utc)
        XCTAssertNotNil(resolver.currentBlock(at: time("10:00"), configuration: .example, selection: nil))
        XCTAssertNil(resolver.currentBlock(at: time("12:10"), configuration: .example, selection: nil))
        var config = unscheduled
        config.templates["off"] = [WorkBlock(start: "10:00", end: "11:00"), WorkBlock(start: "11:00", end: "12:00")]
        XCTAssertNoThrow(try config.validated())
        XCTAssertEqual(resolver.currentBlock(at: time("11:00"), configuration: config, selection: nil)?.end, time("12:00"))
    }

    func testDSTUsesCalendarDaysAndDefinesMissingTimePolicy() throws {
        var calendar = utc
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        let date = instant("2026-03-08T12:00:00Z")
        XCTAssertEqual(calendar.dateInterval(of: .day, for: date)?.duration, 23 * 3600)
        var config = unscheduled
        config.templates["off"] = [WorkBlock(start: "02:30", end: "04:00")]
        let block = ScheduleResolver(calendar: calendar).blocks(on: date, configuration: config, selection: nil).first!
        XCTAssertEqual(block.start, instant("2026-03-08T07:00:00Z"))
        XCTAssertEqual(block.end, instant("2026-03-08T08:00:00Z"))
    }

    func testDSTRepeatedTimesUseFirstOccurrence() {
        var calendar = utc
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        var config = unscheduled
        config.templates["off"] = [WorkBlock(start: "01:00", end: "02:00")]
        let block = ScheduleResolver(calendar: calendar).blocks(on: instant("2026-11-01T12:00:00Z"), configuration: config, selection: nil).first!
        XCTAssertEqual(block.start, instant("2026-11-01T05:00:00Z"))
        XCTAssertEqual(block.end, instant("2026-11-01T07:00:00Z"))
    }
}
