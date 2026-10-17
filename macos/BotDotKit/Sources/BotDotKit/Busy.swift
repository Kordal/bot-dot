import Foundation

/// A message of the owner that waits its turn (`queued` on a bot and on a Chief chat, docs/api.md
/// "A message that waits"): its text as the owner wrote it, its files, and when it was sent. `id` is
/// what "Take back" names.
public struct Queued: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public var text: String
    public var attachments: [FileRef]
    public var at: String?

    public init(id: String, text: String = "", attachments: [FileRef] = [], at: String? = nil) {
        self.id = id
        self.text = text
        self.attachments = attachments
        self.at = at
    }

    enum CodingKeys: String, CodingKey { case id, text, attachments, at }

    /// One without an id cannot be taken back, and is no entry; the rest is read as far as it can be.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        guard !id.isEmpty else { throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "A waiting message has an id.") }
        text = (try? c.decode(String.self, forKey: .text)) ?? ""
        attachments = (try? c.decode([FileRef].self, forKey: .attachments)) ?? []
        at = try? c.decode(String.self, forKey: .at)
    }
}

/// The list of what waits as the server sent it, each entry read by itself: one this app cannot read
/// is left out, and the bots or the chat it came with stay readable.
public struct QueuedList: Decodable, Hashable, Sendable {
    public var items: [Queued] = []

    public init(from decoder: Decoder) throws {
        /// Whatever is there, to step over it.
        struct Anything: Decodable { init(from decoder: Decoder) throws {} }
        guard var list = try? decoder.unkeyedContainer() else { return }
        while !list.isAtEnd {
            if let q = try? list.decode(Queued.self) { items.append(q) } else { _ = try? list.decode(Anything.self) }
        }
    }
}

/// The owner's message to a working bot or a replying Chief waits its turn on the botdot server
/// (ADR 011), on a server with `message-waits` (`Store.sendStays`): the message box then keeps Send
/// while something works, and Stop is the word at the end of the working line. Against a server from
/// before (and while its `features` are not known yet) the box is as it was. The words are the
/// Android app's.
public enum MessageWaits {
    /// Whether the message box shows Stop in Send's place: something works, and this botdot server
    /// would not take a message meanwhile.
    public static func boxStops(busy: Bool, sendStays: Bool) -> Bool { busy && !sendStays }

    /// Under a message that waits: what it waits for. `who`: the bot's name, or "the Chief".
    public static func waitsUntil(_ who: String) -> String { "Waits until \(who) is free" }

    /// The box's line when "Take back" came too late: the message's run or turn has begun (the server's 409).
    static let alreadyStarted = "It has already started."

    /// The line above the message box after a "Take back" that failed. 409: it has already started.
    /// Else botdot's own sentence; a 404 without one: it no longer waits; no answer, or a gateway's
    /// that botdot is not there (502, 503): botdot was not reached; any other answer with its status.
    /// The message is where it was.
    static func takeBackNote(for error: Error) -> String {
        guard let answer = error as? API.Failure else { return "Not taken back: can't reach botdot." }
        let said = answer.message.trimmingCharacters(in: .whitespacesAndNewlines)
        if answer.status == 409 { return alreadyStarted }
        if answer.said, !said.isEmpty { return said }
        if answer.status == 404 { return "It is no longer waiting." }
        if answer.status == 0 || answer.status == 502 || answer.status == 503 { return "Not taken back: can't reach botdot." }
        return "Not taken back: botdot couldn't do that (\(answer.status))."
    }
}

extension KeptMessage {
    /// What "Take back" answers (`{ text, attachments }`), for the message box. What cannot be read is
    /// left empty: the message is gone from the server either way.
    init(takenBack data: Data) {
        struct Answer: Decodable { let text: String?; let attachments: [FileRef]? }
        let a = try? JSON.decoder.decode(Answer.self, from: data)
        self.init(text: a?.text ?? "", attachments: a?.attachments ?? [])
    }
}

/// What the bubble of a run that did not finish says: the app's own muted "Stopped.", or a problem in
/// the problem bubble.
public enum Ended: Hashable, Sendable {
    case stopped(String)
    case problem(String)

    public var text: String { switch self { case .stopped(let t), .problem(let t): t } }
    public var isProblem: Bool { if case .problem = self { true } else { false } }
}

extension RunSummary {
    /// How a run that did not finish is drawn. A botdot server with `ended-by` (`saysWho`, ADR 012) keeps who
    /// ended a run (the owner, the Chief, a sign-out, the time limit) and says it in the run's
    /// `problem`: that sentence is drawn, as every problem is, and the app's own "Stopped." stands only
    /// for a stopped run without one. Against a server from before, a run reads as it did (`problemText`).
    public func ended(saysWho: Bool) -> Ended {
        guard saysWho, status == "stopped" else { return .problem(problemText) }
        let said = (problem ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return said.isEmpty ? .stopped("Stopped.") : .problem(said)
    }
}

extension OpeningLine {
    /// The working line of the Chief's chat while it replies (`busy`), where Stop is the word at its
    /// end (`message-waits`), without the ellipsis: what it is doing in the server's words (`doing`,
    /// `chiefActivity`), which is the whole line as it reads now: its opening line first, then the steps
    /// that follow ("Reading nytimes.com", "Waiting for Web Surfer", "Thinking"). `line`: its opening
    /// line, which is still sent apart: it stands where the activity has no words (none came yet, or a
    /// server from before). With neither, "Thinking". nil when it rests.
    public static func chiefLine(_ line: String?, doing: String?, busy: Bool) -> String? {
        guard busy else { return nil }
        let doing = text(doing), line = text(line)
        let said = !doing.isEmpty && doing != noWords ? doing : (line.isEmpty ? doing : line)
        return said.isEmpty ? "Thinking" : said
    }

    /// What stands for an activity of the Chief that has no words: a server from before it had words
    /// for every tool names the tool alone.
    static let noWords = "Working"

    /// What the Chief is doing in a reply it is still writing, in words: the `text` of its activity as
    /// the server says it (in the chat's pending reply and on its stream). The words are the server's,
    /// the same as a bot's line for the same step: the app has none of its own for a tool here.
    static func chiefActivity(_ said: String?) -> String {
        let t = text(said)
        return t.isEmpty ? noWords : t
    }
}

extension Outbox {
    /// "Take back" on a message that waits, with `request`, which answers its text and files; true
    /// once it is back. It then waits in `back` for the message box, as a failed send does, in front
    /// of what waits there, and the line goes: what is in the box is another message now. When it
    /// could not be taken back the line says why (`MessageWaits.takeBackNote`), and nothing comes
    /// back: the message is where it was.
    @discardableResult
    public func takeBack(request: () async throws -> KeptMessage) async -> Bool {
        do {
            tookBack(try await request())
            return true
        } catch {
            say(MessageWaits.takeBackNote(for: error))
            return false
        }
    }
}

extension Store {
    /// The owner's messages that wait in a chat ("bot:<id>" or "chief:<chatId>"), oldest first: the
    /// server's list. None on a server without `message-waits`.
    public func waiting(in chat: String) -> [Queued] { queued[chat] ?? [] }

    /// The list of a chat as it stands now.
    func setWaiting(_ chat: String, _ list: [Queued]) {
        if waiting(in: chat) != list { queued[chat] = list.isEmpty ? nil : list }
    }

    /// The bots were read: what waits for each is what its `queued` says.
    func waitingForBots() {
        var now = queued.filter { !$0.key.hasPrefix("bot:") }
        for bot in bots { if let list = bot.queued?.items, !list.isEmpty { now["bot:\(bot.id)"] = list } }
        if now != queued { queued = now }
    }

    /// The feed's `queued`: the whole list of a chat, whenever it changes (a message is taken, starts,
    /// or is taken back, here or in another app).
    func waitingChanged(_ data: Data) {
        struct Changed: Decodable { let chat: String?; let queued: QueuedList? }
        guard let c = try? JSON.decoder.decode(Changed.self, from: data), let chat = c.chat, !chat.isEmpty, let list = c.queued else { return }
        setWaiting(chat, list.items)
    }

    /// botdot answered a send with a message that waits: it is in the chat's list at once, last, as
    /// the newest. One that is there already is not added.
    func waits(_ message: Queued, in chat: String) {
        let had = waiting(in: chat)
        if !had.contains(where: { $0.id == message.id }) { setWaiting(chat, had + [message]) }
    }

    /// "Take back" on a message that waits in a chat ("bot:<id>" or "chief:<chatId>"): it leaves the
    /// server, and its text and files wait for that chat's message box, as after a failed send; true
    /// once it is back. When it has started meanwhile, the box's line says so and the chat shows its
    /// run or its turn.
    @discardableResult
    public func takeBack(_ message: Queued, from chat: String) async -> Bool {
        guard let api, let (kind, id) = Unread.parts(chat), kind == "bot" || kind == "chief", taking.insert(message.id).inserted else { return false }
        defer { taking.remove(message.id) }
        let path = kind == "bot" ? "bots/\(id)/queued/\(message.id)" : "chief/chats/\(id)/queued/\(message.id)"
        let back = await outbox(kind == "bot" ? chat : "chief").takeBack {
            KeptMessage(takenBack: try await api.data(path, method: "DELETE"))
        }
        // Gone from the list the app keeps, before the server's list says so.
        if back { setWaiting(chat, waiting(in: chat).filter { $0.id != message.id }) }
        if kind == "bot" {
            try? await loadBots()
            if botChat.botId == id { await loadBotRuns(id) }
        } else if chief.chatId == id {
            await loadChief(id)
        }
        return back
    }
}
