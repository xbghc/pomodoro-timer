import XCTest
@testable import PomodoroCore

final class EnglishPresentationTests: XCTestCase {
    // Keep multilingual fixture values to verify compatibility and language-independent errors.
    private let legacyRegularDay = "\u{5E38}\u{89C4}\u{65E5}"
    private let legacyNoFixedHours = "\u{65E0}\u{56FA}\u{5B9A}\u{65F6}\u{6BB5}"
    private let customTemplateName = "\u{6DF1}\u{5EA6}\u{5DE5}\u{4F5C}"

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
        let config = ScheduleConfiguration(defaultTemplate: legacyRegularDay, weekdays: ["3": legacyRegularDay], templates: [
            legacyRegularDay: [WorkBlock(start: "10:00", end: "12:10")], legacyNoFixedHours: []
        ])
        let data = try JSONActivityStore.encoder().encode(config)
        try data.write(to: store.configurationURL)
        let loaded = try store.loadConfiguration()
        XCTAssertEqual(loaded, config)
        XCTAssertEqual(loaded.displayName(for: legacyRegularDay), "Regular day")
        XCTAssertEqual(loaded.displayName(for: legacyNoFixedHours), "No fixed hours")
        let selection = DayTemplateSelection(day: "2026-10-21", templateID: legacyNoFixedHours)
        XCTAssertTrue(ScheduleResolver(calendar: utc).blocks(on: time("10:00"), configuration: loaded, selection: selection).isEmpty)
        XCTAssertEqual(try Data(contentsOf: store.configurationURL), data)
    }

    func testLegacyDisplayNamesStayDistinctFromUserDefinedNames() {
        let config = ScheduleConfiguration(defaultTemplate: legacyRegularDay, templates: [
            legacyRegularDay: [], "Regular day": [], "Regular day (1)": [], customTemplateName: []
        ])
        XCTAssertEqual(config.displayName(for: legacyRegularDay), "Regular day (2)")
        XCTAssertEqual(config.displayName(for: "Regular day"), "Regular day")
        XCTAssertEqual(config.displayName(for: customTemplateName), customTemplateName)
    }

    func testSystemErrorCopyDoesNotUseTheSystemLanguage() {
        let error = NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError,
                            userInfo: [NSLocalizedDescriptionKey: "\u{78C1}\u{76D8}\u{7A7A}\u{95F4}\u{4E0D}\u{8DB3}"])
        let message = UserFacingError.message(error)
        XCTAssertTrue(message.contains("not enough disk space"))
        XCTAssertTrue(message.contains("code \(NSFileWriteOutOfSpaceError)"))
        XCTAssertFalse(message.contains("\u{78C1}\u{76D8}"))
        let unknown = NSError(domain: "TestDomain", code: 42,
                              userInfo: [NSLocalizedDescriptionKey: "\u{53D1}\u{751F}\u{9519}\u{8BEF}"])
        XCTAssertEqual(UserFacingError.message(unknown), "The operation could not be completed. (TestDomain, code 42)")
    }

    func testInvalidJSONTypeReportsTheFieldInEnglish() {
        let json = #"{"workMinutes":"30","breakMinutes":5,"defaultTemplate":"day","weekdays":{},"templates":{"day":[]}}"#
        XCTAssertThrowsError(try ScheduleConfiguration.decode(Data(json.utf8))) { error in
            XCTAssertTrue(UserFacingError.message(error).contains("Incorrect value type at workMinutes."))
        }
    }
}
