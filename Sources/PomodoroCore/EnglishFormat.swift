import Foundation

/// Presentation uses English without changing the schedule's calendar or time zone.
public enum EnglishFormat {
    public static let locale = Locale(identifier: "en_GB")

    public static func time(_ date: Date, includeSeconds: Bool = false,
                            calendar: Calendar = .current, timeZone: TimeZone = .current) -> String {
        let style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: timeZone)
            .hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)
        return date.formatted(includeSeconds ? style.second(.twoDigits) : style)
    }

    public static func shortDate(_ date: Date, calendar: Calendar = .current,
                                 timeZone: TimeZone = .current) -> String {
        date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale,
                                       calendar: calendar, timeZone: timeZone))
    }

    public static func dateTime(_ date: Date, includeSeconds: Bool = false,
                                calendar: Calendar = .current, timeZone: TimeZone = .current) -> String {
        "\(shortDate(date, calendar: calendar, timeZone: timeZone)) at \(time(date, includeSeconds: includeSeconds, calendar: calendar, timeZone: timeZone))"
    }
}
