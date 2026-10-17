import Foundation

/// Mentions: "@" plus the name of a bot, a bot's job or a skill in a chat message, saying the message
/// is about it (CONTEXT.md: Mention). Reference only: nothing is sent, run, loaded or granted.
///   - bot: its name without spaces, each word capitalised: @FleetDoctor (the Chief is @ChiefOfStaff)
///   - job: bot then job: @FleetDoctor/MorningCheck
///   - skill: its name as is: @weekly-report
/// Matching ignores case; a bot wins over a skill of the same name; "@" inside a word (an email) isn't
/// one; anything that matches nothing stays plain text. The same rules as the botdot server's
/// lib/mentions.js, checked against the shared table test/fixtures/mentions.json.
public struct Mentions: Sendable {
    /// Suggestion rows shown at once.
    public static let maxRows = 6

    public struct Target: Sendable, Hashable {
        public var id: String
        public var name: String
        public var color: String?
        /// false: skills are switched off for it.
        public var useSkills: Bool?
        /// Its picked library skills.
        public var skills: [String]?
        public var jobs: [JobName]

        public init(id: String, name: String, color: String? = nil, useSkills: Bool? = nil, skills: [String]? = nil, jobs: [JobName] = []) {
            self.id = id
            self.name = name
            self.color = color
            self.useSkills = useSkills
            self.skills = skills
            self.jobs = jobs
        }

        public init(_ bot: Bot) {
            self.init(id: bot.id, name: bot.name, color: bot.color, useSkills: bot.useSkills, skills: bot.skills,
                      jobs: (bot.jobs ?? []).map { JobName(id: $0.id, name: $0.name) })
        }

        /// The Chief of Staff (`Who.chief`), which can be mentioned as @ChiefOfStaff.
        public static let chief = Target(id: Who.chief.id ?? "", name: Who.chief.name ?? "", color: Who.chief.color)
    }

    public struct JobName: Sendable, Hashable {
        public var id: String
        public var name: String
        public init(id: String, name: String) { self.id = id; self.name = name }
    }

    public enum Kind: String, Sendable { case bot, job, skill }

    /// A mention found in a text.
    public struct Match: Sendable, Hashable {
        public var kind: Kind
        /// The part of the text that is the mention.
        public var text: String
        public var range: Range<String.Index>
        public var bot: Target?
        public var job: JobName?
        public var skill: String?
    }

    /// A suggestion row; picking it puts `text` plus a space in place of the "@…" being typed.
    public struct Suggestion: Sendable, Hashable, Identifiable {
        public var kind: Kind
        public var text: String
        /// "Fleet Doctor", "Fleet Doctor · Morning check" or "weekly-report".
        public var label: String
        public var bot: Target?
        public var skill: String?
        public var id: String { text }
    }

    /// The Chief's id (`Who.chief`) or the id of the bot whose chat it is.
    public var chat: String
    /// The bots, the Chief included.
    public var bots: [Target]
    /// The names of the skills in the library.
    public var library: [String]

    public init(chat: String, bots: [Target], library: [String]) {
        self.chat = chat
        self.bots = bots
        self.library = library
    }

    /// For a chat: the Chief first, then the bots.
    public init(chat: String, bots: [Bot], library: [String]) {
        self.init(chat: chat, bots: [.chief] + bots.map(Target.init), library: library)
    }

    /// "Fleet Doctor" → "FleetDoctor", "Chief of Staff" → "ChiefOfStaff", "Morning check" → "MorningCheck".
    public static func shortName(_ name: String) -> String {
        name.split(whereSeparator: { $0.isWhitespace })
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined()
            .replacingOccurrences(of: "[^\\p{L}\\p{N}_-]", with: "", options: .regularExpression)
    }

    /// Skills in scope: the whole library in the Chief chat; the bot's picked skills in its own chat.
    public var skillsInScope: [String] {
        if chat == Target.chief.id { return library }
        guard let bot = bots.first(where: { $0.id == chat }), bot.useSkills != false else { return [] }
        let picked = Set(bot.skills ?? [])
        return library.filter { picked.contains($0) }
    }

    private static let name = "[\\p{L}\\p{N}_-]"
    private static let token = try! NSRegularExpression(pattern: "(?<![\\p{L}\\p{N}_])@(\(name)+)(?:/(\(name)+))?")
    private static let typing = try! NSRegularExpression(pattern: "(?<![\\p{L}\\p{N}_])@(\(name)*)(?:/(\(name)*))?$")
    /// The rest of a mention's word after the cursor.
    private static let wordRest = try! NSRegularExpression(pattern: "^[\\p{L}\\p{N}_/-]*")

    private static func same(_ a: String, _ b: String) -> Bool { a.lowercased() == b.lowercased() }

    private func bot(named a: String) -> Target? {
        bots.first { Self.same(Self.shortName($0.name), a) }
    }

    /// The mentions in a text, in order.
    public func find(in text: String) -> [Match] {
        let skills = skillsInScope
        var out: [Match] = []
        let ns = text as NSString
        for m in Self.token.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let a = ns.substring(with: m.range(at: 1))
            let b = m.range(at: 2).location == NSNotFound ? nil : ns.substring(with: m.range(at: 2))
            // What it is, and how much of "@a/b" that covers: all of it for a job, "@a" for a bot or a skill.
            let bot = bot(named: a)
            let job = bot.flatMap { bot in b.flatMap { b in bot.jobs.first { Self.same(Self.shortName($0.name), b) } } }
            let skill = bot == nil ? skills.first { Self.same($0, a) } : nil
            guard bot != nil || skill != nil else { continue }
            let length = job != nil ? m.range.length : a.utf16.count + 1
            guard let r = Range(NSRange(location: m.range.location, length: length), in: text) else { continue }
            out.append(Match(kind: job != nil ? .job : bot != nil ? .bot : .skill, text: String(text[r]), range: r, bot: bot, job: job, skill: skill))
        }
        return out
    }

    /// The suggestion rows for text typed up to the cursor, when it ends in a word starting with "@":
    /// bots, then jobs, then skills, at most `maxRows`. After "@Bot/" only that bot's jobs.
    public func suggest(_ typed: String) -> [Suggestion] {
        let ns = typed as NSString
        guard let m = Self.typing.firstMatch(in: typed, range: NSRange(location: 0, length: ns.length)) else { return [] }
        let q = ns.substring(with: m.range(at: 1))
        let job = m.range(at: 2).location == NSNotFound ? nil : ns.substring(with: m.range(at: 2))
        let bots = bots.filter { !Self.shortName($0.name).isEmpty } // a name of only emoji can't be mentioned
        func has(_ name: String, _ q: String) -> Bool { q.isEmpty || name.lowercased().contains(q.lowercased()) }
        func jobRow(_ bot: Target, _ j: JobName) -> Suggestion {
            Suggestion(kind: .job, text: "@\(Self.shortName(bot.name))/\(Self.shortName(j.name))", label: "\(bot.name) · \(j.name)", bot: bot)
        }
        var rows: [Suggestion]
        if let job {
            guard let bot = bots.first(where: { Self.same(Self.shortName($0.name), q) }) else { return [] }
            rows = bot.jobs.filter { has(Self.shortName($0.name), job) }.map { jobRow(bot, $0) }
        } else {
            let botNames = Set(bots.map { Self.shortName($0.name).lowercased() })
            rows = bots.filter { has(Self.shortName($0.name), q) }
                .map { Suggestion(kind: .bot, text: "@\(Self.shortName($0.name))", label: $0.name, bot: $0) }
            rows += bots.flatMap { b in b.jobs.filter { has(Self.shortName($0.name), q) }.map { jobRow(b, $0) } }
            rows += skillsInScope.filter { has($0, q) && !botNames.contains($0.lowercased()) }
                .map { Suggestion(kind: .skill, text: "@\($0)", label: $0, skill: $0) }
        }
        return Array(rows.prefix(Self.maxRows))
    }

    /// A picked suggestion: the new text and where the cursor goes in it. `jobsNext`: a bot was picked
    /// and its space is new, so a "/" typed next goes in place of the space and lists the bot's jobs.
    public struct Picked: Sendable, Equatable {
        public var text: String
        public var cursor: String.Index
        public var jobsNext: Bool
    }

    /// Picking `row` while typing: the "@…" before `cursor` (and the rest of that word) becomes the row's
    /// text and a space (unless a space follows already), and the cursor goes after the space. `text` is
    /// the whole message. Nil when no "@…" is being typed.
    public static func pick(_ row: Suggestion, in text: String, at cursor: String.Index) -> Picked? {
        let ns = text as NSString
        let at = NSRange(cursor..<cursor, in: text).location
        guard let m = typing.firstMatch(in: text, range: NSRange(location: 0, length: at)) else { return nil }
        let end = at + (wordRest.firstMatch(in: text, options: .anchored, range: NSRange(location: at, length: ns.length - at))?.range.length ?? 0)
        let spaced = end < ns.length && ns.character(at: end) == 0x20
        let out = ns.substring(to: m.range.location) + row.text + (spaced ? "" : " ") + ns.substring(from: end)
        let caret = String.Index(utf16Offset: m.range.location + row.text.utf16.count + 1, in: out)
        return Picked(text: out, cursor: caret, jobsNext: row.kind == .bot && !spaced)
    }
}
