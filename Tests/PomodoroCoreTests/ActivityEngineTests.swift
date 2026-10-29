import XCTest
@testable import PomodoroCore

final class ActivityEngineTests: XCTestCase {
    func testDefaultIsThirtyFiveAndConfirmedFixedEnds() throws {
        let config = ScheduleConfiguration.example
        XCTAssertEqual(config.workMinutes, 30)
        XCTAssertEqual(config.breakMinutes, 5)
        XCTAssertEqual(config.templates["Regular day"]?.map(\.end), ["12:10", "18:10", "22:30"])
    }

    func testReminderKeepsOneContinuousActivityAndEmitsOnlyOnce() throws {
        var engine = try running()
        let id = engine.active?.id
        XCTAssertEqual(try engine.tick(at: time("10:30")), [.workReminder])
        XCTAssertEqual(try engine.tick(at: time("10:40")), [])
        XCTAssertTrue(engine.isReminderDue)
        XCTAssertEqual(engine.active?.id, id)
        XCTAssertEqual(engine.active?.start, time("10:00"))
        XCTAssertTrue(engine.snapshot.records.isEmpty)
        try engine.startRest(at: time("10:45"))
        XCTAssertEqual(engine.snapshot.records.first?.duration, 45 * 60)
        XCTAssertEqual(engine.snapshot.records.first?.id, id)
    }

    func testExtendFromClickProducesEightyMinuteRecord() throws {
        var engine = try running()
        let id = engine.active?.id
        try engine.deferReminder(at: time("10:20"))
        XCTAssertEqual(engine.snapshot.runtime.reminderAt, time("11:20"))
        XCTAssertEqual(engine.active?.id, id)
        XCTAssertEqual(try engine.tick(at: time("11:19")), [])
        XCTAssertEqual(try engine.tick(at: time("11:20")), [.workReminder])
        try engine.startRest(at: time("11:20"))
        XCTAssertEqual(engine.snapshot.records.count, 1)
        XCTAssertEqual(engine.snapshot.records[0].duration, 80 * 60)
    }

    func testDeferringAlreadyDueReminderClearsOnlyReminder() throws {
        var engine = try running()
        try engine.tick(at: time("10:30"))
        let id = engine.active?.id
        try engine.deferReminder(at: time("10:35"), minutes: 60)
        XCTAssertFalse(engine.isReminderDue)
        XCTAssertEqual(engine.active?.id, id)
        XCTAssertEqual(engine.snapshot.runtime.reminderAt, time("11:35"))
    }

    func testEarlyRestAndManualResumeGetFullThirtyMinutes() throws {
        var engine = try running()
        XCTAssertEqual(try engine.startRest(at: time("10:10")), [])
        XCTAssertEqual(engine.active?.kind, .rest)
        XCTAssertEqual(engine.restDeadline, time("10:15"))
        XCTAssertEqual(try engine.tick(at: time("10:15")), [.restFinished])
        XCTAssertTrue(engine.isWaiting)
        XCTAssertNil(engine.restDeadline)
        let completed = engine.snapshot.records
        XCTAssertEqual(try engine.tick(at: time("10:16")), [])
        XCTAssertEqual(try engine.tick(at: time("10:45")), [])
        XCTAssertTrue(engine.isWaiting)
        XCTAssertEqual(engine.snapshot.records, completed)
        XCTAssertEqual(engine.snapshot.records.map(\.kind), [.work, .rest])
        XCTAssertEqual(engine.snapshot.records.map(\.duration), [600, 300])
        let summary = DailySummary(date: time("10:45"), records: completed, active: engine.active, now: time("10:45"), calendar: utc)
        XCTAssertEqual(summary.work, 600)
        XCTAssertEqual(summary.rest, 300)
        XCTAssertEqual(try engine.startWork(at: time("10:45")), [])
        XCTAssertEqual(engine.active?.kind, .work)
        XCTAssertEqual(engine.active?.start, time("10:45"))
        XCTAssertEqual(engine.snapshot.runtime.reminderAt, time("11:15"))
    }

    func testRestNeverStartsWorkByItselfOutsideSchedule() throws {
        var engine = try running(config: unscheduled)
        try engine.startRest(at: time("10:00"), minutes: 12)
        try engine.tick(at: time("11:00"))
        XCTAssertTrue(engine.isWaiting)
        XCTAssertEqual(engine.snapshot.records[0].end, time("10:12"))
    }

    func testStartingRestOrStoppingAtReminderTimeDoesNotDeliverStaleReminder() throws {
        var resting = try running()
        XCTAssertEqual(try resting.startRest(at: time("10:30")), [])
        XCTAssertEqual(resting.active?.kind, .rest)
        var stopped = try running()
        XCTAssertEqual(try stopped.stop(at: time("10:30")), [])
        XCTAssertTrue(stopped.isWaiting)
        var switched = try running()
        XCTAssertEqual(try switched.selectTemplate("No fixed hours", at: time("10:30")), [.scheduledBlockEnded])
        var suspended = try running()
        XCTAssertEqual(try suspended.suspend(at: time("10:30")), [])
    }

    func testRestCountdownUsesEarlierFixedDeadline() throws {
        var engine = try running(at: time("12:00"))
        try engine.startRest(at: time("12:08"), minutes: 5)
        XCTAssertEqual(engine.snapshot.runtime.restEndsAt, time("12:13"))
        XCTAssertEqual(engine.snapshot.runtime.restDeadline, time("12:10"))
        try engine.tick(at: time("12:10"))
        XCTAssertNil(engine.snapshot.runtime.restDeadline)
    }

    func testRestCountdownIncludesUpcomingFixedStartTakeover() throws {
        var engine = try running(at: time("09:55"))
        try engine.startRest(at: time("09:55"), minutes: 15)
        XCTAssertEqual(engine.snapshot.runtime.restEndsAt, time("10:10"))
        XCTAssertEqual(engine.restDeadline, time("10:00"))
        try engine.tick(at: time("10:00"))
        XCTAssertEqual(engine.active?.kind, .work)
        XCTAssertNil(engine.restDeadline)
    }

    func testCrashDuringRestDoesNotFillRestUntilItsDeadline() throws {
        var engine = try running()
        try engine.startRest(at: time("10:10"))
        try engine.tick(at: time("10:12"))
        var restarted = try ActivityEngine(configuration: .example, snapshot: engine.snapshot, calendar: utc)
        try restarted.activate(at: time("11:00"))
        XCTAssertEqual(restarted.snapshot.records.map(\.duration), [600, 120])
        XCTAssertEqual(restarted.snapshot.records.last?.end, time("10:12"))
        XCTAssertEqual(restarted.active?.start, time("11:00"))
    }

    func testTodayOverrideUsesLocalMidnightRatherThanUTC() throws {
        var calendar = utc
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        var engine = try ActivityEngine(configuration: .example, calendar: calendar)
        try engine.activate(at: time("15:50"))
        try engine.selectTemplate("No fixed hours", at: time("15:51"))
        XCTAssertEqual(engine.snapshot.selection?.day, "2026-10-21")
        try engine.tick(at: time("16:00"))
        XCTAssertNil(engine.snapshot.selection)
        XCTAssertTrue(engine.isWaiting)
        try engine.tick(at: time("02:00", day: "2026-10-22"))
        XCTAssertEqual(engine.active?.start, time("02:00", day: "2026-10-22"))
        XCTAssertEqual(engine.snapshot.runtime.fixedEnd, time("04:10", day: "2026-10-22"))
    }

    func testFixedStopWinsOverExtensionAndSimultaneousReminder() throws {
        for (start, end) in [("11:40", "12:10"), ("17:40", "18:10"), ("22:00", "22:30")] {
            var engine = try running(at: time(start))
            XCTAssertEqual(try engine.tick(at: time(end)), [.scheduledBlockEnded])
            XCTAssertTrue(engine.isWaiting)
            XCTAssertEqual(engine.snapshot.records[0].end, time(end))
        }
        var engine = try running(at: time("11:50"))
        try engine.deferReminder(at: time("12:00"), minutes: 60)
        try engine.tick(at: time("12:20"))
        XCTAssertTrue(engine.isWaiting)
        XCTAssertEqual(engine.snapshot.records[0].end, time("12:10"))
    }

    func testFixedStopAlsoEndsRest() throws {
        var engine = try running(at: time("12:00"))
        try engine.startRest(at: time("12:08"), minutes: 5)
        XCTAssertEqual(try engine.tick(at: time("12:15")), [.scheduledBlockEnded])
        XCTAssertEqual(engine.snapshot.records.last?.end, time("12:10"))
        XCTAssertTrue(engine.isWaiting)
    }

    func testStartupMidBlockDoesNotBackfill() throws {
        let engine = try running(at: time("10:23"))
        XCTAssertEqual(engine.active?.start, time("10:23"))
        XCTAssertTrue(engine.snapshot.records.isEmpty)
    }

    func testStoppedActivityDoesNotRestartUntilNextFixedStart() throws {
        var engine = try running()
        try engine.stop(at: time("10:05"))
        try engine.tick(at: time("11:00"))
        XCTAssertTrue(engine.isWaiting)
        XCTAssertEqual(try engine.tick(at: time("13:30")), [.scheduledWorkStarted])
        XCTAssertEqual(engine.active?.start, time("13:30"))
    }

    func testFixedStartTakesOverRestAndManualWorkStaysContinuous() throws {
        var resting = try running(at: time("09:55"))
        try resting.startRest(at: time("09:55"), minutes: 15)
        XCTAssertEqual(try resting.tick(at: time("10:00")), [.scheduledWorkStarted])
        XCTAssertEqual(resting.snapshot.records[0].end, time("10:00"))
        XCTAssertEqual(resting.active?.kind, .work)
        var working = try running(at: time("09:55"))
        try working.startWork(at: time("09:55"))
        let id = working.active?.id
        try working.tick(at: time("10:00"))
        XCTAssertEqual(working.active?.id, id)
        XCTAssertEqual(working.snapshot.runtime.fixedEnd, time("12:10"))
    }

    func testMissedBlocksNeverCreatePhantomActivities() throws {
        var engine = try running(at: time("09:00"))
        try engine.tick(at: time("18:30"))
        XCTAssertTrue(engine.isWaiting)
        XCTAssertTrue(engine.snapshot.records.isEmpty)
        try engine.tick(at: time("20:00"))
        XCTAssertEqual(engine.active?.start, time("20:00"))
    }

    func testManualWorkStillHonorsFirstMissedFixedStop() throws {
        var engine = try running(at: time("09:00"))
        try engine.startWork(at: time("09:00"))
        try engine.tick(at: time("18:30"))
        XCTAssertEqual(engine.snapshot.records[0].end, time("12:10"))
        XCTAssertTrue(engine.isWaiting)
    }

    func testTodayTemplateChangesCutoffWithoutSplittingWork() throws {
        var config = ScheduleConfiguration.example
        config.templates["short"] = [WorkBlock(start: "10:00", end: "11:00")]
        var engine = try running(config: config)
        let id = engine.active?.id
        try engine.selectTemplate("short", at: time("10:20"))
        XCTAssertEqual(engine.active?.id, id)
        XCTAssertEqual(engine.snapshot.runtime.fixedEnd, time("11:00"))
        XCTAssertEqual(engine.snapshot.runtime.reminderAt, time("10:30"))
        try engine.tick(at: time("11:00"))
        XCTAssertEqual(engine.snapshot.records[0].duration, 3600)
    }

    func testTodaySelectionExpiresNextDayAndUsesWeekdayMapping() throws {
        var config = ScheduleConfiguration.example
        config.weekdays["4"] = "No fixed hours"
        var engine = try running(config: config)
        try engine.selectTemplate("No fixed hours", at: time("10:20"))
        XCTAssertTrue(engine.isWaiting)
        try engine.tick(at: time("10:00", day: "2026-10-22"))
        XCTAssertNil(engine.snapshot.selection)
        XCTAssertTrue(engine.isWaiting)
        try engine.tick(at: time("10:00", day: "2026-10-23"))
        XCTAssertEqual(engine.active?.start, time("10:00", day: "2026-10-23"))
    }

    func testChangingPlanDoesNotRewriteHistoryOrResumeWaitingInSameBlock() throws {
        var engine = try running()
        try engine.startRest(at: time("10:10"))
        try engine.tick(at: time("10:15"))
        let records = engine.snapshot.records
        var changed = engine.configuration
        changed.templates["Regular day"] = [WorkBlock(start: "09:00", end: "11:00")]
        try engine.replaceConfiguration(changed, at: time("10:20"))
        XCTAssertTrue(engine.isWaiting)
        XCTAssertEqual(engine.snapshot.records, records)
    }

    func testManualWorkCanSpanMidnight() throws {
        var engine = try running(at: time("23:50"), config: unscheduled)
        try engine.startWork(at: time("23:50"))
        let id = engine.active?.id
        try engine.tick(at: time("00:10", day: "2026-10-22"))
        XCTAssertEqual(engine.active?.id, id)
        try engine.stop(at: time("00:20", day: "2026-10-22"))
        XCTAssertEqual(engine.snapshot.records[0].duration, 1800)
    }

    func testSleepAndWakeDoNotCountSleeping() throws {
        var engine = try running()
        try engine.suspend(at: time("10:12"))
        try engine.tick(at: time("11:00"))
        XCTAssertTrue(engine.isWaiting)
        XCTAssertEqual(engine.snapshot.records[0].end, time("10:12"))
        try engine.activate(at: time("11:15"))
        XCTAssertEqual(engine.active?.start, time("11:15"))
    }

    func testCrashRecoveryClosesAtLastObservationAndNeverDuplicates() throws {
        var engine = try running()
        try engine.tick(at: time("10:12"))
        let id = engine.active?.id
        var restarted = try ActivityEngine(configuration: .example, snapshot: engine.snapshot, calendar: utc)
        try restarted.activate(at: time("11:00"))
        XCTAssertEqual(restarted.snapshot.records.count, 1)
        XCTAssertEqual(restarted.snapshot.records[0].id, id)
        XCTAssertEqual(restarted.snapshot.records[0].end, time("10:12"))
        XCTAssertEqual(restarted.active?.start, time("11:00"))
        var second = try ActivityEngine(configuration: .example, snapshot: restarted.snapshot, calendar: utc)
        try second.activate(at: time("11:00"))
        XCTAssertEqual(second.snapshot.records.count, 1)
    }

    func testClockRollbackSafelyStopsAndWaitsForTimeToCatchUp() throws {
        var engine = try running()
        try engine.tick(at: time("10:20"))
        XCTAssertEqual(try engine.tick(at: time("10:05")), [.clockMovedBackward])
        XCTAssertTrue(engine.isWaiting)
        XCTAssertEqual(engine.snapshot.records[0].end, time("10:20"))
        XCTAssertThrowsError(try engine.startWork(at: time("10:10")))
        XCTAssertEqual(try engine.tick(at: time("10:10")), [])
        try engine.tick(at: time("10:20"))
        XCTAssertNil(engine.snapshot.runtime.clockBlockedUntil)
        XCTAssertEqual(engine.active?.start, time("10:20"))
    }

    func testDurationsAndInvalidActionsAreRejected() throws {
        var engine = try running(config: unscheduled)
        XCTAssertThrowsError(try engine.deferReminder(at: time("10:00")))
        XCTAssertThrowsError(try engine.startWork(at: time("10:00"), minutes: 0))
        XCTAssertThrowsError(try engine.startRest(at: time("10:00"), minutes: 241))
        XCTAssertThrowsError(try engine.selectTemplate("missing", at: time("10:00")))
    }

    func testAdjacentFixedBlocksStopThenStartAtSharedBoundary() throws {
        let config = ScheduleConfiguration(defaultTemplate: "a", templates: ["a": [
            WorkBlock(start: "10:00", end: "11:00"), WorkBlock(start: "11:00", end: "12:00")
        ]])
        var engine = try running(config: config)
        let firstID = engine.active?.id
        XCTAssertEqual(try engine.tick(at: time("11:00")), [.scheduledBlockEnded, .scheduledWorkStarted])
        XCTAssertEqual(engine.snapshot.records.first?.end, time("11:00"))
        XCTAssertNotEqual(engine.active?.id, firstID)
        XCTAssertEqual(engine.active?.start, time("11:00"))
        XCTAssertEqual(engine.snapshot.runtime.fixedEnd, time("12:00"))
    }

    func testInvalidReloadDoesNotMutateConfiguration() throws {
        var engine = try running()
        let snapshot = engine.snapshot
        var invalid = engine.configuration
        invalid.defaultTemplate = "missing"
        XCTAssertThrowsError(try engine.replaceConfiguration(invalid, at: time("10:05")))
        XCTAssertEqual(engine.snapshot, snapshot)
        XCTAssertEqual(engine.configuration, .example)
    }

    func testWeekLongDeterministicMixedActionsPreserveLedgerInvariants() throws {
        let begin = time("00:00")
        var engine = try running(at: begin)
        var seed: UInt64 = 0xADDED
        for step in 1...672 {
            let now = begin.addingTimeInterval(Double(step) * 900)
            try engine.tick(at: now)
            seed = seed &* 6364136223846793005 &+ 1
            switch seed % 8 {
            case 0: try engine.startWork(at: now)
            case 1 where engine.active?.kind != .rest: try engine.startRest(at: now, minutes: 20)
            case 2 where engine.active?.kind == .work: try engine.deferReminder(at: now)
            case 3: try engine.stop(at: now)
            case 4: try engine.selectTemplate("No fixed hours", at: now)
            case 5: try engine.selectTemplate(nil, at: now)
            case 6:
                try engine.suspend(at: now)
                try engine.activate(at: now)
            default: break
            }
            XCTAssertNoThrow(try engine.snapshot.validated(), "step \(step)")
            XCTAssertNoThrow(try RecordValidation.validate(engine.snapshot.records, now: now, active: engine.active), "step \(step)")
            XCTAssertLessThanOrEqual(engine.snapshot.records.reduce(0) { $0 + $1.duration }, now.timeIntervalSince(begin))
        }
    }
}
