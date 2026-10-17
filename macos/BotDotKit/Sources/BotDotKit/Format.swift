import Foundation

extension String {
    /// Text that says something: the text without the blanks around it, or nil when nothing is left.
    var words: String? {
        let said = trimmingCharacters(in: .whitespacesAndNewlines)
        return said.isEmpty ? nil : said
    }

    var isBlank: Bool { words == nil }
}

/// Times the way the web page shows them (shared by the apps).
public enum Format {
    nonisolated(unsafe) private static let isoFull: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    nonisolated(unsafe) private static let iso = ISO8601DateFormatter() // ISO8601DateFormatter is safe to share for reading

    public static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return isoFull.date(from: s) ?? iso.date(from: s)
    }

    /// For lists: "18:32" today, "Tue" within six days before or ahead (a job's next run), "21 Sep" beyond.
    public static func shortTime(_ s: String?) -> String {
        guard let d = date(s) else { return "" }
        if Calendar.current.isDateInToday(d) { return d.formatted(date: .omitted, time: .shortened) }
        if abs(Date().timeIntervalSince(d)) < 6 * 86400 { return d.formatted(.dateTime.weekday(.abbreviated)) }
        return d.formatted(.dateTime.day().month(.abbreviated))
    }

    /// When a message was sent: "18:32" today, "21 Sep, 18:32" before.
    public static func messageTime(_ s: String?) -> String {
        guard let d = date(s) else { return "" }
        let time = d.formatted(date: .omitted, time: .shortened)
        return Calendar.current.isDateInToday(d) ? time : "\(d.formatted(.dateTime.day().month(.abbreviated))), \(time)"
    }

    /// The day a message of a chat stands on: a chat names each day above its first message.
    public static func day(_ s: String?) -> DateComponents? {
        date(s).map { Calendar.current.dateComponents([.year, .month, .day], from: $0) }
    }

    /// That day's name in a chat: "Thursday, Oct 8".
    public static func dayTitle(_ s: String?) -> String {
        date(s)?.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()) ?? ""
    }

    /// How long something took: "42s", "3m 5s".
    public static func duration(_ ms: Double) -> String {
        ms < 60000 ? "\(Int((ms / 1000).rounded()))s" : "\(Int(ms / 60000))m \(Int((ms.truncatingRemainder(dividingBy: 60000) / 1000).rounded()))s"
    }

    /// How long ago: "just now", "5m ago", "3h ago", "2d ago", then the date.
    public static func ago(_ d: Date, now: Date = Date()) -> String {
        let s = now.timeIntervalSince(d)
        return s < 60 ? "just now" : s < 3600 ? "\(Int(s / 60))m ago" : s < 86400 ? "\(Int(s / 3600))h ago" : s < 86400 * 30 ? "\(Int(s / 86400))d ago" : d.formatted(date: .numeric, time: .omitted)
    }

    /// Markdown flattened to one line, for previews.
    public static func plain(_ s: String?) -> String {
        let stripped = (s ?? "").replacingOccurrences(of: #"[#*_`>|\[\]()-]+"#, with: " ", options: .regularExpression)
        return stripped.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }
}
