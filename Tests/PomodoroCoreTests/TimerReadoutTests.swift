import XCTest
@testable import PomodoroCore

final class TimerReadoutTests: XCTestCase {
    private func readout(_ engine: ActivityEngine, at now: Date) -> TimerReadout {
        TimerReadout(runtime: engine.snapshot.runtime, workMinutes: engine.configuration.workMinutes,
                     now: now, restDeadline: engine.restDeadline)
    }

    func testWaitingShowsConfiguredDurationWithoutStartingAnActivity() throws {
        let engine = try running(config: unscheduled)
        let display = readout(engine, at: time("10:00"))
        XCTAssertEqual(display.text, "30:00")
        XCTAssertEqual(display.progress, 0)
        XCTAssertFalse(display.isOvertime)
        XCTAssertNil(engine.active)
    }

    func testWorkCountsDownToReminderAndExtensionKeepsContinuousRecord() throws {
        var engine = try running()
        let id = engine.active?.id
        try engine.tick(at: time("10:20"))
        XCTAssertEqual(readout(engine, at: time("10:20")).text, "10:00")
        XCTAssertEqual(readout(engine, at: time("10:20")).progress, 2.0 / 3, accuracy: 0.0001)
        try engine.deferReminder(at: time("10:20"))
        XCTAssertEqual(readout(engine, at: time("10:20")).text, "1:00:00")
        XCTAssertEqual(readout(engine, at: time("10:20")).progress, 0.25, accuracy: 0.0001)
        XCTAssertEqual(engine.active?.id, id)
        XCTAssertEqual(engine.active?.start, time("10:00"))
        XCTAssertTrue(engine.snapshot.records.isEmpty)
    }

    func testDueWorkShowsOvertimeAndContinuesRecording() throws {
        var engine = try running()
        let now = time("10:35").addingTimeInterval(4.8)
        try engine.tick(at: now)
        let before = engine.snapshot
        let display = readout(engine, at: now)
        XCTAssertEqual(display.text, "+05:04")
        XCTAssertEqual(display.progress, 1)
        XCTAssertTrue(display.isOvertime)
        XCTAssertEqual(engine.snapshot, before)
        XCTAssertEqual(engine.active?.kind, .work)
    }

    func testCountdownRoundsUpUntilItsDeadline() throws {
        let engine = try running()
        XCTAssertEqual(readout(engine, at: time("10:30").addingTimeInterval(-0.1)).text, "00:01")
        XCTAssertEqual(readout(engine, at: time("10:30")).text, "00:00")
    }

    func testWorkDisplaysEarlierFixedEnd() throws {
        let engine = try running(at: time("12:05"))
        let display = readout(engine, at: time("12:06"))
        XCTAssertEqual(display.text, "04:00")
        XCTAssertEqual(display.progress, 0.2, accuracy: 0.0001)
    }

    func testRestDisplaysFixedDeadlineAndResetsWhenWaiting() throws {
        var engine = try running(at: time("12:09"))
        try engine.startRest(at: time("12:09"), minutes: 20)
        let now = time("12:09").addingTimeInterval(15)
        try engine.tick(at: now)
        XCTAssertEqual(readout(engine, at: now).text, "00:45")
        XCTAssertEqual(readout(engine, at: now).progress, 0.25, accuracy: 0.0001)
        try engine.tick(at: time("12:10"))
        XCTAssertEqual(readout(engine, at: time("12:10")).text, "30:00")
        XCTAssertEqual(readout(engine, at: time("12:10")).progress, 0)
        XCTAssertNil(engine.active)
    }

    func testRestDisplaysIncomingScheduleTakeover() throws {
        var engine = try running(at: time("13:29"))
        try engine.startRest(at: time("13:29"), minutes: 10)
        let now = time("13:29").addingTimeInterval(15)
        try engine.tick(at: now)
        XCTAssertEqual(readout(engine, at: now).text, "00:45")
        XCTAssertEqual(readout(engine, at: now).progress, 0.25, accuracy: 0.0001)
    }
}
