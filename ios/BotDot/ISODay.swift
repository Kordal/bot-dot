import Foundation

/// A day as botdot writes it, "2026-11-16", in the phone's own time zone. Read and written in the POSIX locale on the
/// Gregorian calendar, so a phone set to a Buddhist, Japanese or Hijri calendar reads the same day.
enum ISODay {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func date(_ day: String) -> Date? { formatter.date(from: day) }
    static func string(_ date: Date) -> String { formatter.string(from: date) }
}
