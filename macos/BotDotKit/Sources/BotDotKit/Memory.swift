import Foundation

/// Memory has no screen (Milestone 9): what a bot holds is asked, corrected, forgotten and brought back
/// by chat. Two things about it are drawn: the chip under a reply, and the card of a change that waits
/// for the owner (docs/api.md, "The contract" and "What a run learned"). Both read the server's words
/// and the app has none of its own for them: a server that does not announce `memory-chips` shows no
/// chip about memory, and one that does not announce `memory-cards` no card. Reading any of it never
/// fails: an item or a change of a kind this app does not know is drawn from what the server wrote.

/// Something a bot learned or changed in itself during a run: a chip under its reply.
public struct Learned: Decodable, Hashable, Sendable {
    public var kind: String?
    public var text: String?
    /// The whole line as the server wrote it (`memory-chips`): "Remembered for all bots: …", "Forgot 1 note".
    public var chip: String?

    public init(kind: String? = nil, text: String? = nil, chip: String? = nil) {
        self.kind = kind
        self.text = text
        self.chip = chip
    }

    enum CodingKeys: String, CodingKey { case kind, text, chip }
    /// Never fails: an entry that is no item, or a field that is no text, is nothing to draw.
    public init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        func said(_ key: CodingKeys) -> String? { (c.flatMap { try? $0.decodeIfPresent(String.self, forKey: key) })?.words }
        kind = said(.kind)
        text = said(.text)
        chip = said(.chip)
    }

    /// What a click on its chip opens.
    public enum Opens: Hashable, Sendable { case jobs, settings }

    /// A job opens the bot's jobs; a change to its main assignment, its rules, a skill or a connected
    /// app its settings. A chip about a note, and one of a kind this app does not know, opens nothing.
    public var opens: Opens? {
        let kind = kind ?? ""
        if kind == "job" { return .jobs }
        return kind == "instructions" || kind == "connector" || kind.hasPrefix("skill") ? .settings : nil
    }

    /// It is about a note: kept, changed, removed, brought back, forgotten, or waiting for the owner.
    public var aboutMemory: Bool { (kind ?? "").hasPrefix("memory") || kind == "forgot" }

    static let icons = ["memory-pending": "⏳", "skill-pending": "⏳", "forgot": "🧹", "instructions": "✏️", "skill": "✦", "skill-updated": "✦", "job": "⏰", "connector": "🔌"]
    static let before = ["memory": "Remembered: ", "memory-shared": "Remembered for all bots: ", "forgot": "Forgot: "]

    /// What its chip reads, or nil for nothing. `chips`: the server writes the line (`memory-chips`),
    /// which is printed whole, with no word of the app's. An item without one (a job, a connected app, a
    /// note in a run from before the chips) is drawn from its kind and `text`, cut short as before. From a
    /// server that writes no lines, a chip about memory is not drawn.
    public func line(chips: Bool) -> String? {
        let icon = Self.icons[kind ?? ""] ?? "🧠"
        if chips, let chip { return "\(icon) \(chip)" }
        guard let text, chips || !aboutMemory else { return nil }
        let words = (Self.before[kind ?? ""] ?? "") + text
        return "\(icon) \(words.count > 90 ? String(words.prefix(90)) : words)\(text.count > 80 ? "…" : "")"
    }
}

/// A chip as it is drawn: its line, and what a click on it opens (nil: nothing).
public struct LearnedChip: Hashable, Sendable {
    public let text: String
    public let opens: Learned.Opens?
}

/// A memory change that waits for the owner's OK (`GET /api/memory/pending`): one to the shared memory
/// from a run that read outside content, or a guarded one (a change to what the owner said, and a
/// forget that waits). `title`, `meta`, `yes` and `no` are its card's words, the server's.
public struct MemoryChange: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    /// "add", "edit", "remove" or "erase" (a forget that waits).
    public var action: String
    public var botId: String?
    public var bot: Who?
    /// The note that comes; for a forget, the notes it would erase and how many chats it would leave out.
    public var text: String?
    public var reason: String?
    public var at: String?
    public var current: Current?
    public var title: String?
    public var meta: String?
    public var yes: String?
    public var no: String?
    /// A card of its own, never part of "Approve all".
    public var guarded: Bool
    /// The group it was asked in, for a change a member asked for in its turn (see `group`, Groups.swift).
    public var groupId: String?
    public var groupName: String?
    public struct Current: Decodable, Hashable, Sendable { public var text: String? }

    enum CodingKeys: String, CodingKey { case id, action, botId, bot, text, reason, at, current, title, meta, yes, no, guarded, groupId, groupName }
    /// Never fails: a field that is no text is left out, and an entry without an id is no change (`id` is "").
    public init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        func said(_ key: CodingKeys) -> String? { (c.flatMap { try? $0.decodeIfPresent(String.self, forKey: key) })?.words }
        id = said(.id) ?? ""
        action = said(.action) ?? ""
        botId = said(.botId)
        bot = c.flatMap { try? $0.decodeIfPresent(Who.self, forKey: .bot) }
        text = said(.text)
        reason = said(.reason)
        at = said(.at)
        current = c.flatMap { try? $0.decodeIfPresent(Current.self, forKey: .current) }
        title = said(.title)
        meta = said(.meta)
        yes = said(.yes)
        no = said(.no)
        guarded = c.flatMap { try? $0.decodeIfPresent(Bool.self, forKey: .guarded) } == true
        groupId = said(.groupId)
        groupName = said(.groupName)
    }

    /// "Approve all" answers it: a change to the shared memory, which its card shows in words. Never a
    /// guarded one, and never one of a kind this app does not know.
    public var withApproveAll: Bool { !guarded && ["add", "edit", "remove"].contains(action) }
}

enum Memory {
    /// The list of waiting changes this app asks for: with the guarded ones from a server that writes
    /// their cards, each of which is a card of its own here.
    static func waiting(cards: Bool) -> String { cards ? "memory/pending?guarded=1" : "memory/pending" }
}

extension Store {
    /// The chips under a run's reply, in the server's order.
    public func chips(of run: RunSummary) -> [LearnedChip] {
        let chips = has(.memoryChips)
        return (run.learned ?? []).compactMap { x in x.line(chips: chips).map { LearnedChip(text: $0, opens: x.opens) } }
    }

    /// The cards of the memory changes that wait, oldest first, from a server that writes them
    /// (`memory-cards`). The title, why it waits and both buttons are the server's words, the same in
    /// every app; the body is the note: for a change what goes above what comes, for a removal the note
    /// that goes, for a forget what it would erase. A change without those words is no card, and a
    /// forget is one only from a server that has the verb (`memory-forget`).
    var memoryCards: [NeedItem] {
        guard has(.memoryCards) else { return [] }
        let forgets = has(.memoryForget)
        return memoryPending.compactMap { p in
            guard !p.id.isEmpty, let title = p.title, let yes = p.yes, let no = p.no, forgets || p.action != "erase" else { return nil }
            let was = p.current?.text?.words
            let body = p.action == "edit" ? [was == p.text ? nil : was, p.text] : [p.action == "remove" ? was : p.text]
            let meta = [Format.shortTime(p.at), p.meta ?? "", p.reason ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
            let chief = p.botId == nil && p.bot?.id == Who.chief.id
            return NeedItem(key: "mem:\(p.id)", kind: .memory, who: p.bot, title: title, meta: meta, body: body.compactMap { $0 }, no: no, yes: yes,
                            chat: chief ? .chief : p.botId.map(ChatScope.bot), memory: p)
        }
    }

    /// The notification of a memory card: the bot's name over the card's title, the note and why it
    /// waits, all the server's. Approve and Decline where those are the words of its two buttons; any
    /// other change (a guarded one, a forget among them) has no button, and a click opens its card.
    func memoryNotice(_ item: NeedItem) -> NeedNotice {
        let p = item.memory
        let body = [item.title, p?.action == "remove" ? "" : p?.text ?? "", p?.meta ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        let buttons = p?.guarded == false && item.yes == "Approve" && item.no == "Decline"
        return NeedNotice(key: item.key, title: item.asker() ?? "A bot", body: body, actions: buttons ? .approve : .none)
    }
}
