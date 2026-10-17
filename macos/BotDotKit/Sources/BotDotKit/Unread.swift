import Foundation

/// New replies (ADR 005, docs/api.md "New replies"). The botdot server says what is new: a bot and a
/// Chief chat carry `unread` (how many) and `firstUnread` (where they begin). The app only draws that
/// and reports the chat on screen; it counts nothing. Against a server without the feature everything
/// here is zero: no dots, no line, no report.
public enum Unread {
    /// The list shows one dot per new reply, up to this many. No number.
    public static let maxDots = 3

    /// How many dots a row shows for the server's count.
    public static func dots(_ unread: Int?) -> Int { min(maxDots, max(0, unread ?? 0)) }

    /// How often a report is repeated, until the server names its own `repeatMs`.
    static let repeatMs = 10_000

    /// An id this app makes up for itself at each start, so the server can tell two apps on one chat apart.
    static func appId() -> String {
        "mac-" + String((0..<12).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
    }

    /// "bot:<id>" or "chief:<chatId>", apart.
    static func parts(_ chat: String) -> (kind: String, id: String)? {
        guard let colon = chat.firstIndex(of: ":") else { return nil }
        return (String(chat[..<colon]), String(chat[chat.index(after: colon)...]))
    }
}

/// The "New" line of the chat that is open: above the first new reply the server named when the chat
/// came on screen. It stays there until the owner leaves the chat.
public struct NewLine: Equatable, Sendable {
    /// Where the new replies begin: a run of a bot's chat, or a message's place in a Chief chat.
    public enum First: Equatable, Sendable {
        case run(String)
        case message(Int)

        public var run: String? { if case .run(let id) = self { return id }; return nil }
        public var message: Int? { if case .message(let place) = self { return place }; return nil }
    }

    /// "bot:<id>" or "chief:<chatId>".
    public let chat: String
    public let first: First
}

/// The body of `POST /api/read`.
struct ReadReport: Encodable {
    let app: String
    let chat: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(app, forKey: .app)
        try c.encode(chat, forKey: .chat) // "none" is said as null, not left out
    }

    enum CodingKeys: String, CodingKey { case app, chat }
}

/// What the server says about a chat's new replies.
struct UnreadNow: Equatable {
    var unread = 0
    var first: NewLine.First?

    init(unread: Int?, first: NewLine.First?) {
        self.unread = max(0, unread ?? 0)
        self.first = self.unread > 0 ? first : nil
    }

    /// The live feed's `unread` event: `{ chat, unread, firstUnread }`, a run id or a message's place.
    init?(event data: Data) {
        guard let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let first: NewLine.First? = (d["firstUnread"] as? String).map(NewLine.First.run) ?? (d["firstUnread"] as? Int).map(NewLine.First.message)
        self.init(unread: d["unread"] as? Int, first: first)
    }
}

extension RunSummary {
    /// What started a run, as its chat shows it above the reply (public/app.js botThreadHTML).
    public enum Asked: Equatable, Sendable {
        /// A script job's run: a chip with the job's name.
        case script
        /// Its teammates' answers: nothing is shown.
        case replies
        /// A message from another bot or the Chief: one folded line.
        case message(Who)
        /// A job's run: a chip with the job's name.
        case job(String)
        /// A scheduled run without a job's name.
        case schedule
        /// A new bot's first message, right after it was made (#511): nobody asked, nothing is shown.
        case firstMessage
        /// It carries on after the owner's OK: nothing is shown, the request stands once, above the
        /// reply of the run that stopped for it.
        case carriedOn
        /// Its usual task, run by the owner.
        case usualTask
        /// The owner's own message.
        case ownMessage
    }

    public var asked: Asked {
        if kind == "script" { return .script }
        if trigger == "replies" { return .replies }
        if let sender { return .message(sender) }
        if let jobName { return .job(jobName) }
        if trigger == "schedule" { return .schedule }
        if trigger == "hello" { return .firstMessage }
        if continues != nil { return .carriedOn }
        return customPrompt == false ? .usualTask : .ownMessage
    }

    /// A job's name as its run is shown: "Motion", and "Motion, called" when a device on the owner's tailnet
    /// called it (`trigger: "call"`). nil for a run of no job.
    public var jobWords: String? { jobName.map { trigger == "call" ? "\($0), called" : $0 } }

    /// How a run's details say what started it, as public/app.js runHeader: "⏰ Motion, scheduled",
    /// "⏰ Motion, called", "⏰ Motion, started", "⏰ Scheduled" or "Started".
    public var startedWords: String {
        if let jobName { return "⏰ \(jobName), \(trigger == "schedule" ? "scheduled" : trigger == "call" ? "called" : "started")" }
        return trigger == "schedule" ? "⏰ Scheduled" : "Started"
    }

    /// The owner's own message started this run. That message isn't new, so the "New" line goes below
    /// it; it goes above everything else that starts a run (a schedule's chip, a script's run, a folded
    /// message), as on the web page.
    public var startedByOwnMessage: Bool { asked == .ownMessage }
}

extension Store {
    /// The Chief's one row shows the new replies of all its chats, so it opens the chat that has them
    /// (the newest such chat). nil when nothing is new: the row then shows the chat it showed before.
    public var chiefChatWithNewReplies: String? {
        chiefChats.first { ($0.unread ?? 0) > 0 }?.id
    }

    /// Says which chat the window shows ("bot:<id>" or "chief:<chatId>", nil for none) and whether the
    /// window is in front (the key window of the active app). Call it whenever either changes.
    ///
    /// A chat that comes on screen in front gets its "New" line from what the server says is new at
    /// that moment, and is then reported as being read: again every `repeatMs`, and "none" the moment
    /// it is no longer in front. The line stays while the chat stays open, in front or not.
    public func show(chat: String?, inFront: Bool) async {
        windowInFront = inFront
        if chat != openChat {
            openChat = chat
            newLine = nil // the chat was left: its line goes
        }
        // A server from before: nothing is new, nothing to report.
        let front = inFront && followsUnread ? chat : nil
        guard front != readChat else { return }
        readChat = front
        repeater?.cancel()
        repeater = nil
        guard let front else {
            if reported != nil { await say(nil) }
            return
        }
        placeNewLine(front, unreadKnown(front))
        let now = await unreadNow(front)
        guard readChat == front else { return }
        if let now { placeNewLine(front, now) }
        await say(front)
        guard readChat == front, repeater == nil else { return }
        repeater = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(self?.repeatMs ?? Unread.repeatMs))
                guard !Task.isCancelled, let self, self.readChat == front else { return }
                await self.say(front)
            }
        }
    }

    /// Puts the line above the first new reply. It moves only when the chat comes on screen again with
    /// other new replies.
    private func placeNewLine(_ chat: String, _ now: UnreadNow?) {
        guard let first = now?.first, newLine != NewLine(chat: chat, first: first) else { return }
        newLine = NewLine(chat: chat, first: first)
        reachNewLine() // a reply further back than the chat's runs
        reachGroupNewLine()
    }

    /// What the app knows about a chat's new replies.
    func unreadKnown(_ chat: String) -> UnreadNow? {
        guard let (kind, id) = Unread.parts(chat) else { return nil }
        if kind == "group" { return groupUnreadKnown(id) }
        if kind == "bot" { return bots.first { $0.id == id }.map { UnreadNow(unread: $0.unread, first: $0.firstUnread.map(NewLine.First.run)) } }
        return chiefChats.first { $0.id == id }.map { UnreadNow(unread: $0.unread, first: $0.firstUnread.map(NewLine.First.message)) }
    }

    /// What the server says about them right now.
    private func unreadNow(_ chat: String) async -> UnreadNow? {
        guard let api, let (kind, id) = Unread.parts(chat) else { return nil }
        if kind == "group" { return await groupUnreadNow(id) }
        if kind == "bot" {
            guard let bot: Bot = try? await api.get("bots/\(id)") else { return nil }
            return UnreadNow(unread: bot.unread, first: bot.firstUnread.map(NewLine.First.run))
        }
        struct Chat: Decodable { let unread: Int?; let firstUnread: Int? }
        guard let c: Chat = try? await api.get("chief/chats/\(id)?limit=1") else { return nil }
        return UnreadNow(unread: c.unread, first: c.firstUnread.map(NewLine.First.message))
    }

    /// `POST /api/read`: the chat this app shows now, in front, or none. It takes the place of the last
    /// report. Offline, the next repeat tries again, and a report that got lost runs out by itself.
    private func say(_ chat: String?) async {
        guard let api else { return }
        struct Answer: Decodable { let ok: Bool?; let repeatMs: Int? }
        reported = chat
        guard let answer: Answer = try? await api.send("read", body: ReadReport(app: appId, chat: chat)) else { return }
        if let ms = answer.repeatMs, ms > 0 { repeatMs = ms }
        // The server took it as read: its dots go here too, also while the live feed is down.
        if let chat, answer.ok == true, readChat == chat { await setUnread(chat, UnreadNow(unread: 0, first: nil)) }
    }

    /// A chat's new replies changed (the live feed's `unread`, or this app's own report).
    func setUnread(_ chat: String, _ now: UnreadNow) async {
        guard let (kind, id) = Unread.parts(chat) else { return }
        if kind == "bot", let i = bots.firstIndex(where: { $0.id == id }) {
            bots[i].unread = now.unread
            bots[i].firstUnread = now.first?.run
        } else if kind == "chief" {
            // The Chief's one row shows the server's sum over its chats.
            if chiefChats.first(where: { $0.id == id }).map({ max(0, $0.unread ?? 0) }) != now.unread { try? await loadChiefChats() }
        } else if kind == "group" {
            let set = Groups.setUnread(groups, id, now.unread, now.first?.run)
            if set != groups { groups = set }
        }
    }

    /// After the counts were read again: when they still show new replies for the chat this app reports
    /// (they were read before the report arrived), say it once more at once.
    func reportAgainIfStale() {
        guard let chat = readChat, reported == chat, (unreadKnown(chat)?.unread ?? 0) > 0 else { return }
        // Only if it is still in front by then: a window that left meanwhile has said "none".
        Task { if readChat == chat { await say(chat) } }
    }

    /// The app quits or its window closes: no chat is on screen any more.
    public func leave() async {
        await show(chat: nil, inFront: false)
    }

    /// The server's `features` were read (again): does it keep new replies? One that was updated to do
    /// so while a chat is open is told about that chat now.
    func follows(unread: Bool) async {
        guard unread != followsUnread else { return }
        followsUnread = unread
        await show(chat: openChat, inFront: windowInFront)
    }

    /// This botdot server is left: tell it so, and forget what was shown.
    func stopReporting() {
        if let api, reported != nil {
            let none = ReadReport(app: appId, chat: nil)
            Task { try? await api.send("read", body: none) }
        }
        repeater?.cancel()
        repeater = nil
        openChat = nil
        windowInFront = false
        readChat = nil
        reported = nil
        newLine = nil
        followsUnread = false
        chiefUnread = 0
    }
}
