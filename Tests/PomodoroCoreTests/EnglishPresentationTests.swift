import XCTest
@testable import PomodoroCore

final class EnglishPresentationTests: XCTestCase {
    func testEnglishDatesKeepTheRequestedTimeZoneAndCalendar() {
        var calendar = utc
        calendar.locale = Locale(identifier: "zh_CN")
        let zone = TimeZone(identifier: "Asia/Shanghai")!
        calendar.timeZone = zone
        let date = time("10:05").addingTimeInterval(12)
        XCTAssertEqual(EnglishFormat.time(date, calendar: calendar, timeZone: zone), "18:05")
        XCTAssertEqual(EnglishFormat.time(date, includeSeconds: true, calendar: calendar, timeZone: zone), "18:05:12")
        XCTAssertEqual(EnglishFormat.shortDate(date, calendar: calendar, timeZone: zone), "21 Oct 2026")
        XCTAssertEqual(EnglishFormat.dateTime(date, calendar: calendar, timeZone: zone), "21 Oct 2026 at 18:05")
        XCTAssertEqual(EnglishFormat.time(date, calendar: utc, timeZone: utc.timeZone), "10:05")
    }

    func testLegacyTemplateNamesDoNotRewriteStoredConfigurationOrSelection() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try JSONActivityStore(directory: directory)
        let config = ScheduleConfiguration(defaultTemplate: "常规日", weekdays: ["3": "常规日"], templates: [
            "常规日": [WorkBlock(start: "10:00", end: "12:10")], "无固定时段": []
        ])
        let data = try JSONActivityStore.encoder().encode(config)
        try data.write(to: store.configurationURL)
        let loaded = try store.loadConfiguration()
        XCTAssertEqual(loaded, config)
        XCTAssertEqual(loaded.displayName(for: "常规日"), "Regular day")
        XCTAssertEqual(loaded.displayName(for: "无固定时段"), "No fixed hours")
        let selection = DayTemplateSelection(day: "2026-10-21", templateID: "无固定时段")
        XCTAssertTrue(ScheduleResolver(calendar: utc).blocks(on: time("10:00"), configuration: loaded, selection: selection).isEmpty)
        XCTAssertEqual(try Data(contentsOf: store.configurationURL), data)
    }

    func testLegacyDisplayNamesStayDistinctFromUserDefinedNames() {
        let config = ScheduleConfiguration(defaultTemplate: "常规日", templates: [
            "常规日": [], "Regular day": [], "Regular day (1)": [], "深度工作": []
        ])
        XCTAssertEqual(config.displayName(for: "常规日"), "Regular day (2)")
        XCTAssertEqual(config.displayName(for: "Regular day"), "Regular day")
        XCTAssertEqual(config.displayName(for: "深度工作"), "深度工作")
    }

    func testSystemErrorCopyDoesNotUseTheSystemLanguage() {
        let error = NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError,
                            userInfo: [NSLocalizedDescriptionKey: "磁盘空间不足"])
        let message = UserFacingError.message(error)
        XCTAssertTrue(message.contains("not enough disk space"))
        XCTAssertTrue(message.contains("code \(NSFileWriteOutOfSpaceError)"))
        XCTAssertFalse(message.contains("磁盘"))
        let unknown = NSError(domain: "TestDomain", code: 42,
                              userInfo: [NSLocalizedDescriptionKey: "发生错误"])
        XCTAssertEqual(UserFacingError.message(unknown), "The operation could not be completed. (TestDomain, code 42)")
    }

    func testInvalidJSONTypeReportsTheFieldInEnglish() {
        let json = #"{"workMinutes":"30","breakMinutes":5,"defaultTemplate":"day","weekdays":{},"templates":{"day":[]}}"#
        XCTAssertThrowsError(try ScheduleConfiguration.decode(Data(json.utf8))) { error in
            XCTAssertTrue(UserFacingError.message(error).contains("Incorrect value type at workMinutes."))
        }
    }
}
