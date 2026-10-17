import Foundation

/// A scheduled job of a bot (`jobs` in `GET /api/bots`).
public struct Job: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var cron: String
    /// An ISO date for a job that runs once.
    public var at: String?
    /// "ai" or "script".
    public var kind: String?
    public var prompt: String?
    public var script: String?
    public var enabled: Bool?
    public var approved: Bool?
    public var alwaysApprove: Bool?
    /// A change that waits beside the approved job, and what the buttons of a job that waits read, in
    /// the server's words (docs/api.md "A change that waits" and "Decline"). See Changes.swift.
    public var change: JobChange?
    public var no: CardText?
    public var yes: CardText?
    /// Who changed it last: "you", "chief" or "bot"; who made it.
    public var changedBy: String?
    public var createdBy: String?
    /// Why it does or doesn't need AI.
    public var assessment: String?
    public var aiWhen: String?
    public var timeoutSeconds: Int?
    public var notify: String?
    public var nextRunAt: String?
    /// Its schedule in the server's words (docs/api.md); a server older than that sends none.
    public var when: String?
    /// How its last run went.
    public var last: LastRun?
    /// Who carries on after the yes on a job that waits (docs/api.md "What follows a yes").
    public var then: Then?

    public struct LastRun: Codable, Hashable, Sendable {
        public var status: String?
        public var at: String?
        /// The whole line for under the job, in the server's words, from a server with `job-line`
        /// ("Did not run at 08:00: botdot was off."); `status` may then be "missed".
        public var text: String?
        /// How many failed runs in a row the job has, while the last one failed.
        public var failures: Int?
    }

    /// How the line under a job is coloured: its last run failed (also again and again), its time
    /// passed without a run, or neither.
    public enum Tone: Sendable { case failed, missed, fine }

    public var lineTone: Tone {
        if last?.status == "error" || (last?.failures ?? 0) > 0 { return .failed }
        return last?.status == "missed" ? .missed : .fine
    }

    /// Its schedule as every place shows it: the server's words, or the app's own for a server that sends none.
    public var schedule: String {
        if let when, !when.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return when }
        return Cron.describe(cron)
    }

    /// The line under a job. The server's own (`last.text`) as it is, from a server that writes it
    /// (`said`: it has `job-line`, see `Store.lastText`); from any other, and where it sends none, the
    /// app's line as before: "Last run 2 hours ago: done.".
    public func lastText(said: Bool) -> String {
        guard let l = last else { return "Not run yet." }
        if said, let text = l.text?.words { return text }
        let what = ["held": "held till morning", "quiet": "nothing to report", "success": "done", "error": "failed", "stopped": "stopped", "interrupted": "cut off"][l.status ?? ""] ?? (l.status ?? "")
        let when = Format.date(l.at).map { RelativeDateTimeFormatter().localizedString(for: $0, relativeTo: .now) } ?? ""
        return "Last run \(when): \(what)."
    }
}

/// What a script job does with the AI afterwards.
public enum AIWhen: String, CaseIterable, Sendable {
    case output, failed, always, never
    public var label: String {
        switch self {
        case .output: "Only when it prints something"
        case .failed: "Only when it fails"
        case .always: "Every time it runs"
        case .never: "Never, just show its output"
        }
    }
}

/// The app's own words for a schedule, for a server that sends no `when`, and the times offered in a list.
public enum Cron {
    /// The times offered in a list.
    public static let presets: [(label: String, cron: String)] = [
        ("Every 30 min", "*/30 * * * *"),
        ("Hourly", "0 * * * *"),
        ("Daily at 09:00", "0 9 * * *"),
        ("Weekdays at 09:00", "0 9 * * 1-5"),
        ("Weekdays at 18:00", "0 18 * * 1-5"),
        ("Nightly at 02:00", "0 2 * * *"),
        ("Mondays at 10:00", "0 10 * * 1"),
    ]

    public static let custom = "Custom schedule"
    public static let invalid = "Invalid schedule"
    public static let never = "Never runs"

    /// "0 9 * * *" -> "Daily at 09:00". It knows the common shapes and says each as the server does
    /// (test/fixtures/cron-words.json, which JobsTests holds it to). Any other schedule is "Custom schedule",
    /// and text that is not five fields "Invalid schedule": never the expression.
    public static func describe(_ expr: String) -> String {
        let f = expr.unicodeScalars.split(whereSeparator: isSpace).map { String(String.UnicodeScalarView($0)) }
        guard f.count == 5 else { return invalid }
        let (min, hour, dom, mon, dow) = (f[0], f[1], f[2], f[3], f[4])
        let everyDay = dom == "*" && mon == "*" && dow == "*"
        if everyDay, hour == "*", let n = step(min, of: 60) { return "Every \(n) min" }
        guard let m = number(min, 0...59) else { return custom }
        let atMinute = m == 0 ? "" : ", at minute \(m)"
        if everyDay, hour == "*" { return "Hourly\(atMinute)" }
        if everyDay, let n = step(hour, of: 24) { return "Every \(n) hours\(atMinute)" }
        guard let h = number(hour, 0...23) else { return custom }
        let at = "at \(two(h)):\(two(m))"
        if everyDay { return h == 2 && m == 0 ? "Nightly at 02:00" : "Daily \(at)" }
        if dom == "*", mon == "*" {
            if dow == "1-5" { return "Weekdays \(at)" }
            if dow == "0,6" { return "Weekends \(at)" }
            if let weekday = number(dow, 0...7) { return "\(days[weekday % 7]) \(at)" } // 0 and 7 are Sunday
            return custom
        }
        guard dow == "*", let day = number(dom, 1...31) else { return custom }
        if mon == "*" { return "Monthly on day \(day) \(at)" }
        // One day of the year: how a one-time job is kept ("28 Sep at 07:00"). A day no year has never comes.
        guard let month = number(mon, 1...12) else { return custom }
        return day > monthDays[month - 1] ? never : "\(day) \(months[month - 1]) \(at)"
    }

    /// The words beside a job's name while a listed time is picked: the job's own for its own schedule,
    /// else the label of the listed time. A typed schedule asks the server (`Store.cronPreview`).
    public static func listed(_ expr: String, of job: Job) -> String {
        if expr == job.cron { return job.schedule }
        return presets.first { $0.cron == expr }?.label ?? describe(expr)
    }

    private static let days = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"]
    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    private static let monthDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // February in a leap year

    /// What parts the fields on the server: JavaScript's white space, which is not Swift's `isWhitespace`.
    private static func isSpace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }

    /// A field that is one number of `range`, "07" too: nil for anything else.
    private static func number(_ field: some StringProtocol, _ range: ClosedRange<Int>) -> Int? {
        guard !field.isEmpty, field.unicodeScalars.allSatisfy({ ("0"..."9").contains($0) }), let n = Int(field), range.contains(n) else { return nil }
        return n
    }

    /// The step of a field that is every step-th value ("*/15"), when the steps divide `whole` evenly: nil otherwise.
    private static func step(_ field: String, of whole: Int) -> Int? {
        guard field.hasPrefix("*/"), let n = number(field.dropFirst(2), 2...whole / 2), whole % n == 0 else { return nil }
        return n
    }

    private static func two(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
}

/// What the server says about a schedule being typed (`POST /api/cron/preview`).
public struct CronPreview: Sendable, Equatable {
    /// The schedule in words: the server's, or the app's own for a server that sends none. Nil when the
    /// server could not be asked: what is shown stays, as on the web page.
    public let words: String?
    /// Its next runs: none for a schedule that never runs, or has no run in the year ahead.
    public let next: [Date]
    /// Why it isn't a schedule, or why the server could not be asked.
    public let error: String?

    /// The server's answer about `expr`: `error` is why it refuses it. A server that sends no words:
    /// what it refuses is no schedule, the rest is said here.
    public init(_ expr: String, when: String? = nil, next: [Date] = [], error: String? = nil) {
        let said = when.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        words = said ?? (error != nil ? Cron.invalid : Cron.describe(expr))
        self.next = next
        self.error = error
    }

    /// The server could not be asked, and why.
    public init(unasked why: String) {
        words = nil; next = []; error = why
    }

    /// The line under the Schedule field, as on the web page: "Daily at 09:00. Next: …", the words alone
    /// without a next run, or the error.
    public func line(_ time: (Date) -> String) -> String {
        if let error { return error }
        guard let words else { return "" }
        return next.isEmpty ? words : "\(words). Next: \(next.map(time).joined(separator: " · "))"
    }
}

extension Store {
    /// The line under a job: the server's from a server with `job-line`, else the app's own.
    public func lastText(of job: Job) -> String { job.lastText(said: has(.jobLine)) }

    /// Adds a job to a bot (you add it, so it needs no OK); it comes back with its id.
    public func addJob(_ botId: String, _ fields: [String: Any]) async throws -> Job {
        guard let api else { throw ConnectError(message: "Not connected.") }
        let body = try JSONSerialization.data(withJSONObject: fields)
        let job = try JSON.decoder.decode(Job.self, from: try await api.sendJSON("bots/\(botId)/jobs", body: body))
        try await loadBots()
        return job
    }

    public func removeJob(_ botId: String, _ jobId: String) async throws {
        guard let api else { return }
        try await api.send("bots/\(botId)/jobs/\(jobId)", method: "DELETE")
        try await loadBots()
    }

    /// Runs a job now. The answer in words: started, a script started, waiting for the bot, or, from a
    /// server with `job-line`, skipped, in the server's sentence ("Its last run is still going.").
    public func runJob(_ botId: String, _ jobId: String) async throws -> String {
        guard let api else { return "" }
        struct Started: Decodable { let started: String?; let queued: Bool?; let skipped: String? }
        let r: Started = try await api.send("bots/\(botId)/jobs/\(jobId)/run")
        if has(.jobLine), let why = r.skipped?.words { return why }
        return r.queued == true ? "It will run as soon as the bot is free" : r.started == "script" ? "Script started. Nothing to report means nothing shows in the chat." : "Started"
    }

    /// A schedule being typed: its words and its next runs, or why it isn't one.
    public func cronPreview(_ expr: String) async -> CronPreview {
        guard let api else { return CronPreview(unasked: "Not connected.") }
        struct Answer: Decodable { let when: String?; let next: [String]?; let error: String? }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["expr": expr])
            let a = try JSON.decoder.decode(Answer.self, from: try await api.sendJSON("cron/preview", body: body))
            return CronPreview(expr, when: a.when, next: (a.next ?? []).compactMap(Format.date), error: a.error)
        } catch {
            return CronPreview(unasked: error.localizedDescription)
        }
    }

    /// Changes a job (the fields as the API names them); the bot is read again.
    public func updateJob(_ botId: String, _ jobId: String, _ changes: [String: Any]) async throws {
        guard let api else { return }
        let body = try JSONSerialization.data(withJSONObject: changes)
        _ = try await api.sendJSON("bots/\(botId)/jobs/\(jobId)", method: "PUT", body: body)
        try await loadBots()
    }
}
