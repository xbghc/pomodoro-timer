import Foundation

/// A display projection only: reaching zero never changes or splits an activity.
public struct TimerReadout: Equatable, Sendable {
    public let seconds: TimeInterval
    public let progress: Double
    public let isOvertime: Bool

    public init(runtime: RuntimeState, workMinutes: Int, now: Date, restDeadline: Date? = nil) {
        guard let active = runtime.active else {
            seconds = TimeInterval(workMinutes * 60)
            progress = 0
            isOvertime = false
            return
        }

        let deadline: Date
        if active.kind == .rest {
            deadline = restDeadline ?? runtime.restDeadline ?? now
        } else {
            let reminder = runtime.reminderAt ?? now
            deadline = min(reminder, runtime.fixedEnd ?? reminder)
        }
        let total = max(1, deadline.timeIntervalSince(active.start))
        progress = min(1, max(0, now.timeIntervalSince(active.start) / total))
        isOvertime = active.kind == .work && runtime.reminderDelivered && now >= deadline
        seconds = isOvertime ? max(0, now.timeIntervalSince(deadline)) : max(0, deadline.timeIntervalSince(now))
    }

    public var text: String {
        // A countdown must not show 00:00 while a fraction of a second remains.
        let value = Int(isOvertime ? floor(seconds) : ceil(seconds))
        let time = value >= 3600
            ? String(format: "%d:%02d:%02d", value / 3600, value / 60 % 60, value % 60)
            : String(format: "%02d:%02d", value / 60, value % 60)
        return isOvertime ? "+\(time)" : time
    }
}
