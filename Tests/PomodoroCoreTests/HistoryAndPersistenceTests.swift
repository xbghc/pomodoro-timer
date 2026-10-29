import XCTest
@testable import PomodoroCore

final class HistoryAndPersistenceTests: XCTestCase {
    func testHistoryCRUDIncludesAutomaticRecordsAndRecomputesTotals() throws {
        var engine = try running()
        try engine.stop(at: time("10:30"))
        var automatic = engine.snapshot.records[0]
        automatic.kind = .rest
        automatic.start = time("10:10")
        try engine.upsertRecord(automatic, at: time("11:00"))
        let manual = ActivityRecord(kind: .work, start: time("09:00"), end: time("10:00"))
        try engine.upsertRecord(manual, at: time("11:00"))
        let summary = DailySummary(date: time("11:00"), records: engine.snapshot.records, active: nil, now: time("11:00"), calendar: utc)
        XCTAssertEqual(summary.work, 3600)
        XCTAssertEqual(summary.rest, 1200)
        try engine.deleteRecord(id: automatic.id, at: time("11:00"))
        XCTAssertEqual(engine.snapshot.records, [manual])
        XCTAssertThrowsError(try engine.deleteRecord(id: automatic.id, at: time("11:00")))
    }

    func testHistoryEditsAndDeletionDoNotConsumeCoincidentReminders() throws {
        for deleting in [false, true] {
            let clock = ManualClock(time("10:00"))
            let store = MemoryStore()
            let record = ActivityRecord(kind: .work, start: time("08:00"), end: time("09:00"))
            store.snapshot.records = [record]
            let session = try ActivitySession(store: store, calendar: utc, clock: { clock.now })
            clock.now = time("10:30")
            let events = try session.perform { engine, now in
                if deleting { return try engine.deleteRecord(id: record.id, at: now) }
                var edited = record
                edited.kind = .rest
                return try engine.upsertRecord(edited, at: now)
            }
            XCTAssertEqual(events, [.workReminder])
            XCTAssertTrue(store.snapshot.runtime.reminderDelivered)
            XCTAssertEqual(try session.tick(), [])
        }
    }

    func testHistoryCommandReturnsRestCompletionEvent() throws {
        var engine = try running()
        try engine.startRest(at: time("10:05"))
        let record = ActivityRecord(kind: .work, start: time("08:00"), end: time("09:00"))
        XCTAssertEqual(try engine.upsertRecord(record, at: time("10:10")), [.restFinished])
        XCTAssertTrue(engine.isWaiting)
    }

    func testRollbackBlocksConfigurationAndHistoryWritesThroughSession() throws {
        let clock = ManualClock(time("10:00"))
        let store = MemoryStore()
        let session = try ActivitySession(store: store, calendar: utc, clock: { clock.now })
        clock.now = time("10:10")
        try session.tick()
        clock.now = time("10:05")
        XCTAssertEqual(try session.tick(), [.clockMovedBackward])
        let saved = store.snapshot
        let writes = store.saves
        XCTAssertThrowsError(try session.reloadConfiguration())
        XCTAssertThrowsError(try session.perform { try $0.selectTemplate("No fixed hours", at: $1) })
        let record = ActivityRecord(kind: .work, start: time("08:00"), end: time("09:00"))
        XCTAssertThrowsError(try session.perform { try $0.upsertRecord(record, at: $1) })
        XCTAssertEqual(store.snapshot, saved)
        XCTAssertEqual(store.saves, writes)
        clock.now = time("10:10")
        try session.tick()
        XCTAssertNil(session.engine.snapshot.runtime.clockBlockedUntil)
    }

    func testCorruptHugeOrNonFiniteDatesAreRejectedBeforeCalendarConversion() throws {
        for date in [Date(timeIntervalSince1970: 1e100), Date(timeIntervalSince1970: .infinity), Date(timeIntervalSince1970: .nan)] {
            var snapshot = ActivitySnapshot()
            snapshot.runtime.lastObservedAt = date
            XCTAssertThrowsError(try snapshot.validated())
            var engine = try running()
            XCTAssertThrowsError(try engine.activate(at: date))
        }
        let record = ActivityRecord(kind: .work, start: Date(timeIntervalSince1970: 1e20), end: Date(timeIntervalSince1970: 2e20))
        XCTAssertThrowsError(try RecordValidation.validate([record]))
    }

    func testCorruptCheckpointCannotKeepExpiredActivityOrInconsistentReminder() throws {
        var state = try running().snapshot
        state.runtime.lastObservedAt = time("12:15")
        XCTAssertThrowsError(try state.validated())
        state = try running().snapshot
        state.runtime.reminderDelivered = true
        XCTAssertThrowsError(try state.validated())
        state = try running().snapshot
        state.runtime.lastObservedAt = time("10:40")
        XCTAssertThrowsError(try state.validated())
        var resting = try running()
        try resting.startRest(at: time("10:01"))
        state = resting.snapshot
        state.runtime.reminderDelivered = true
        XCTAssertThrowsError(try state.validated())
    }

    func testHistoryRejectsFutureOverlapReversedAndActiveOverlap() throws {
        var engine = try running()
        for record in [ActivityRecord(kind: .work, start: time("09:00"), end: time("11:01")),
                       ActivityRecord(kind: .work, start: time("09:00"), end: time("08:00")),
                       ActivityRecord(kind: .work, start: time("09:00"), end: time("10:01"))] {
            XCTAssertThrowsError(try engine.upsertRecord(record, at: time("11:00")))
        }
        let first = ActivityRecord(kind: .rest, start: time("08:00"), end: time("09:00"))
        try engine.upsertRecord(first, at: time("11:00"))
        XCTAssertThrowsError(try engine.upsertRecord(ActivityRecord(kind: .work, start: time("08:30"), end: time("09:30")), at: time("11:00")))
        XCTAssertNoThrow(try engine.upsertRecord(ActivityRecord(kind: .work, start: time("09:00"), end: time("10:00")), at: time("11:00")))
    }

    func testDayTotalsClipCrossMidnightAndIgnoreWaitingAndPlan() throws {
        let record = ActivityRecord(kind: .work, start: time("23:50"), end: time("00:20", day: "2026-10-22"))
        let first = DailySummary(date: time("12:00"), records: [record], active: nil, now: time("12:00", day: "2026-10-22"), calendar: utc)
        let second = DailySummary(date: time("12:00", day: "2026-10-22"), records: [record], active: nil, now: time("12:00", day: "2026-10-22"), calendar: utc)
        XCTAssertEqual(first.work, 600)
        XCTAssertEqual(second.work, 1200)
        XCTAssertEqual(first.rest, 0)
        var engine = try running()
        try engine.stop(at: time("10:10"))
        let waiting = DailySummary(date: time("11:00"), records: engine.snapshot.records, active: engine.active, now: time("11:00"), calendar: utc)
        XCTAssertEqual(waiting.work, 600)
    }

    func testHalfHourDSTDayKeepsItsFullActualDuration() throws {
        var calendar = utc
        calendar.timeZone = TimeZone(identifier: "Australia/Lord_Howe")!
        let date = instant("2026-10-04T12:00:00Z")
        let day = try XCTUnwrap(calendar.dateInterval(of: .day, for: date))
        XCTAssertEqual(day.duration, 23.5 * 3600)
        let record = ActivityRecord(kind: .work, start: day.start, end: day.end)
        let summary = DailySummary(date: date, records: [record], active: nil, now: day.end, calendar: calendar)
        XCTAssertEqual(summary.work, 23.5 * 3600)
        let config = ScheduleConfiguration(defaultTemplate: "dst", templates: ["dst": [WorkBlock(start: "02:10", end: "03:00")]])
        let block = try XCTUnwrap(ScheduleResolver(calendar: calendar).blocks(on: date, configuration: config, selection: nil).first)
        XCTAssertEqual(block.end.timeIntervalSince(block.start), 30 * 60)
    }

    func testCurrentActivityTotalsIncludeOnlyObservedTime() throws {
        let engine = try running()
        let summary = DailySummary(date: time("10:10"), records: [], active: engine.active, now: time("10:10"), calendar: utc)
        XCTAssertEqual(summary.work, 600)
        XCTAssertEqual(summary.rest, 0)
    }

    func testMillisecondPrecisionAndStableIDSurviveDiskRoundTrip() throws {
        try withDisk { store in
            var state = ActivitySnapshot()
            let record = ActivityRecord(kind: .work, start: instant("2026-10-21T08:00:00.123Z"), end: instant("2026-10-21T09:00:00.456Z"))
            state.records = [record]
            try store.saveSnapshot(state)
            let restored = try store.loadSnapshot()
            XCTAssertEqual(restored.records[0].id, record.id)
            XCTAssertEqual(restored.records[0].start.timeIntervalSince1970, record.start.timeIntervalSince1970, accuracy: 0.000001)
            XCTAssertEqual(restored.records[0].end.timeIntervalSince1970, record.end.timeIntervalSince1970, accuracy: 0.000001)
        }
    }

    func testMalformedUserFilesAreNotOverwrittenAndLegacyFilesUntouched() throws {
        try withDisk { store in
            let broken = Data("{broken".utf8)
            try broken.write(to: store.configurationURL)
            try broken.write(to: store.snapshotURL)
            let legacy = store.directory.appendingPathComponent("history.json")
            try broken.write(to: legacy)
            XCTAssertThrowsError(try store.loadConfiguration())
            XCTAssertThrowsError(try store.loadSnapshot())
            XCTAssertEqual(try Data(contentsOf: store.configurationURL), broken)
            XCTAssertEqual(try Data(contentsOf: store.snapshotURL), broken)
            XCTAssertEqual(try Data(contentsOf: legacy), broken)
        }
    }

    func testInvalidReloadPreservesLastValidConfigurationAndState() throws {
        let clock = ManualClock(time("10:00"))
        let store = MemoryStore()
        let session = try ActivitySession(store: store, calendar: utc, clock: { clock.now })
        let before = session.engine.snapshot
        store.configuration.workMinutes = 0
        XCTAssertThrowsError(try session.reloadConfiguration())
        XCTAssertEqual(session.engine.configuration.workMinutes, 30)
        XCTAssertEqual(session.engine.snapshot, before)
        XCTAssertNil(session.persistenceFailure)
    }

    func testCheckpointsEveryFiveSecondsAndTransactionsAreImmediate() throws {
        let clock = ManualClock(time("10:00"))
        let store = MemoryStore()
        let session = try ActivitySession(store: store, calendar: utc, clock: { clock.now })
        XCTAssertEqual(store.saves, 1)
        for seconds in 1...4 { clock.now = time("10:00").addingTimeInterval(Double(seconds)); try session.tick() }
        XCTAssertEqual(store.saves, 1)
        clock.now = time("10:00").addingTimeInterval(5)
        try session.tick()
        XCTAssertEqual(store.saves, 2)
        try session.perform { try $0.deferReminder(at: $1) }
        XCTAssertEqual(store.saves, 3)
    }

    func testFailedSaveBlocksFurtherMutationsAndRecoveryUsesOnlySavedCheckpoint() throws {
        let clock = ManualClock(time("10:00"))
        let store = MemoryStore()
        let session = try ActivitySession(store: store, calendar: utc, clock: { clock.now })
        clock.now = time("10:10")
        try session.tick()
        store.failure = true
        clock.now = time("10:11")
        XCTAssertThrowsError(try session.perform { try $0.startRest(at: $1) })
        XCTAssertNotNil(session.persistenceFailure)
        XCTAssertEqual(session.engine.active?.kind, .work)
        XCTAssertThrowsError(try session.perform { try $0.stop(at: $1) })
        store.failure = false
        clock.now = time("11:00")
        let recovered = try ActivitySession(store: store, calendar: utc, clock: { clock.now })
        XCTAssertEqual(recovered.engine.snapshot.records[0].end, time("10:10"))
        XCTAssertEqual(recovered.engine.active?.start, time("11:00"))
    }

    func testNormalExitClosesActivityAndRestartDoesNotCountOfflineTime() throws {
        let clock = ManualClock(time("10:00"))
        let store = MemoryStore()
        let session = try ActivitySession(store: store, calendar: utc, clock: { clock.now })
        clock.now = time("10:15")
        try session.perform { try $0.suspend(at: $1) }
        clock.now = time("11:00")
        let restored = try ActivitySession(store: store, calendar: utc, clock: { clock.now })
        XCTAssertEqual(restored.engine.snapshot.records.count, 1)
        XCTAssertEqual(restored.engine.snapshot.records[0].duration, 900)
        XCTAssertEqual(restored.engine.active?.start, time("11:00"))
    }

    func testCorruptCheckpointWithOverlappingActiveIDIsRejected() throws {
        var engine = try running()
        try engine.tick(at: time("10:10"))
        var state = engine.snapshot
        state.records.append(ActivityRecord(id: state.runtime.active!.id, kind: .work, start: time("09:00"), end: time("10:00")))
        XCTAssertThrowsError(try state.validated())
    }

    private func withDisk(_ body: (JSONActivityStore) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pomodoro-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(JSONActivityStore(directory: directory))
    }
}
