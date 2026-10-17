import Foundation
import Observation

/// A message's key (docs/api.md, "A message sent twice"). An app cannot tell a request that never
/// arrived from one whose answer was lost, so every message the owner sends has a key, and a botdot
/// server with `message-key` takes a key once (`Store.takesOnce`).
public enum MessageKey {
    /// A key for a message the owner sends: new for each message, and sent again with it when its send failed.
    public static func new() -> String { UUID().uuidString }
}

/// The owner's message as the app keeps it when its send failed: its text and its files.
public struct KeptMessage: Hashable, Sendable {
    public var text: String
    public var attachments: [FileRef]

    public init(text: String, attachments: [FileRef] = []) {
        self.text = text
        self.attachments = attachments
    }
}

/// The keys of what a reply's quick answers and its card of questions send: the same while the text
/// is the same, so an answer tapped again after a failed send is the same message.
public struct AnswerKeys: Sendable {
    private var keys: [String: String] = [:]

    public init() {}

    public mutating func of(_ text: String) -> String {
        if let key = keys[text] { return key }
        let key = MessageKey.new()
        keys[text] = key
        return key
    }
}

/// A failure before the message itself was sent (its chat could not be made): it did not leave.
struct NotSent: Error { let cause: Error }

/// What a chat's message box is told about its sends, as the Android app's: a message that failed
/// waits in `back` for the box, with one line saying why. One message at a time: while one is under
/// way, another sends nothing.
///
/// Every message goes with a key (`MessageKey`). A message from the box that failed keeps its key
/// until it went or the owner changes it: sent again as it is, botdot takes it once.
@MainActor
@Observable
public final class Outbox {
    /// A send is under way.
    public private(set) var sending = false
    /// The line above the box: why the last send failed. It stays until the owner sends or edits.
    public private(set) var note: String?
    /// A failed message the box has not taken back yet.
    public private(set) var back: KeptMessage?
    /// The message from the box that failed last, as it was sent, with its key.
    @ObservationIgnored private var failed: (message: KeptMessage, key: String)?
    /// What the box held when it took a failed message back: showing that is no edit.
    @ObservationIgnored private var inBox: String?
    /// The message that is on its way, as its chat draws it from Send until botdot answered
    /// (`SentMessage`). It goes with the answer: the chat has botdot's own version by then, or the
    /// message is back in the box.
    public private(set) var sent: SentMessage?

    public init() {}

    /// Sends with `request`, which gets the message's key; true once botdot took the message. When it
    /// failed, the line says why, and a message from the message box (`box`) waits in `back`, in front
    /// of one that already waits there. A quick answer or a card of questions (`box` false) keeps what
    /// was tapped or typed by staying on screen, and gives its own `key`, the same for every send of
    /// it. A message from the box has the key it failed with when its text and files are those that
    /// failed, else a new one. `once`: this botdot server takes a key once (see `note(for:once:)`).
    ///
    /// From here until `request` ends the message stands in `sent`, for its chat to draw: `chat` is the
    /// chat it was sent in, where one outbox serves several, and `known` the ids of the owner's
    /// messages that chat had already (`SentMessage`). `request` puts botdot's answer in the chat
    /// before it returns, so the two change places in one step. `draw` false: these are no words of
    /// the owner's (a bot's main assignment), and nothing is drawn.
    @discardableResult
    public func send(_ text: String, attachments: [FileRef] = [], box: Bool, key: String? = nil, once: Bool, chat: String? = nil, known: Set<String> = [], draw: Bool = true, request: (String) async throws -> Void) async -> Bool {
        let message = KeptMessage(text: text, attachments: attachments)
        if sending {
            if box { giveBack(message) } // the box emptied for it: nothing typed is lost
            return false
        }
        let key = key ?? (box && failed?.message == message ? failed?.key : nil) ?? MessageKey.new()
        sending = true
        note = nil
        sent = draw ? SentMessage(key: key, text: text, attachments: attachments, chat: chat, known: known) : nil
        defer { sending = false; sent = nil }
        do {
            try await request(key)
        } catch where !Self.delivered(error) {
            if box {
                giveBack(message)
                failed = (message, key)
            }
            note = Self.note(for: error, once: once)
            return false
        } catch {}
        if box { failed = nil }
        return true
    }

    private func giveBack(_ message: KeptMessage) {
        back = KeptMessage(text: Self.withFailed(message.text, back?.text ?? ""), attachments: message.attachments + (back?.attachments ?? []))
    }

    /// A message that waited was taken back (see Busy.swift): it waits for the box, and the line goes.
    func tookBack(_ message: KeptMessage) {
        giveBack(message)
        note = nil
        failed = nil
    }

    /// The line says `why`: something else than a send failed.
    func say(_ why: String) { note = why }

    /// The message on its way belongs to `chat` now: a first message, whose Chief chat was just made.
    func sentIn(_ chat: String) { sent?.chat = chat }

    /// The box takes the failed message back, in front of what was typed since; nil when none waits.
    public func take(typedSince: String) -> KeptMessage? {
        guard var message = back else { return nil }
        back = nil
        message.text = Self.withFailed(message.text, typedSince)
        inBox = message.text
        return message
    }

    /// The box holds `text` now. Once the owner changed it the line goes: it is another message.
    /// Not while a failed message still waits for the box: what it holds then is from before.
    public func edited(_ text: String) {
        guard back == nil, text != inBox else { return }
        inBox = nil
        note = nil
    }

    /// A failed message back in the box, in front of what was typed since.
    static func withFailed(_ failed: String, _ typedSince: String) -> String {
        if failed.isEmpty { return typedSince }
        return typedSince.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? failed : "\(failed)\n\(typedSince)"
    }

    /// Whether a send that threw was taken by botdot all the same: it answered with a success, and
    /// only reading that answer failed. Such a message is in the chat, and is not put back in the box.
    static func delivered(_ error: Error) -> Bool { error is DecodingError }

    static let stillHere = "Your message is still here."

    /// The line above the message box after a send that failed, in the Android app's words: why, and
    /// that nothing is lost. botdot's own sentence for a refusal. "Can't reach botdot" when no answer
    /// came, or a gateway answered in botdot's place that it is not there (502, 503). "It may have
    /// been sent" when nobody can tell: the request had gone out, a gateway gave up waiting (504), or
    /// another answer of the 500s without botdot's sentence.
    ///
    /// `once`: botdot takes a message's key once, so sending again is safe also where the request had
    /// gone out before the connection dropped. Against a botdot server from before `message-key`,
    /// that case still reads "It may have been sent".
    static func note(for error: Error, once: Bool) -> String {
        let cantReach = "Not sent: can't reach botdot. \(stillHere)"
        let maybeSent = "It may have been sent: check the chat. \(stillHere)"
        let left = !(error is NotSent)
        let cause = (error as? NotSent)?.cause ?? error
        if let answer = cause as? API.Failure {
            let said = answer.message.trimmingCharacters(in: .whitespacesAndNewlines)
            if answer.said, !said.isEmpty { return notSent(said) }
            if answer.status == 502 || answer.status == 503 || answer.status < 400 { return cantReach }
            if answer.status >= 500, left { return maybeSent }
            return notSent("botdot couldn't do that (\(answer.status)).") // an answer without a sentence
        }
        if let lost = cause as? URLError { return !left || once || neverLeft.contains(lost.code) ? cantReach : maybeSent }
        return left ? maybeSent : cantReach
    }

    /// A connection that failed before the request went out: botdot never saw it.
    private static let neverLeft: Set<URLError.Code> = [
        .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .notConnectedToInternet, .secureConnectionFailed,
        .internationalRoamingOff, .dataNotAllowed, .badURL, .unsupportedURL, .appTransportSecurityRequiresSecureConnection,
    ]

    private static func notSent(_ said: String) -> String {
        "Not sent: \(said)\(said.last.map { ".!?…".contains($0) } == true ? "" : ".") \(stillHere)"
    }
}

extension Store {
    /// The outbox of a chat: "bot:<id>", or "chief" for all the Chief's chats. Kept for as long as
    /// this botdot server is followed: a send goes on after its chat was left, and a message that then
    /// fails is back in the box when the chat is opened again.
    public func outbox(_ chat: String) -> Outbox {
        if let outbox = outboxes[chat] { return outbox }
        let outbox = Outbox()
        outboxes[chat] = outbox
        return outbox
    }

    /// Sends the owner's message from the open bot's chat (`text` nil: its main assignment) through that
    /// chat's outbox; true once botdot took it. `box`, `key`: see `Outbox.send`.
    @discardableResult
    public func deliverToBot(_ text: String?, attachments: [FileRef] = [], box: Bool = true, key: String? = nil) async -> Bool {
        guard let botId = botChat.botId else { return false }
        let known = Set(SentMessage.ownWords(runs: botChat.runs, queued: waiting(in: "bot:\(botId)")).map(\.id))
        return await outbox("bot:\(botId)").send(text ?? "", attachments: attachments, box: box, key: key, once: takesOnce, known: known, draw: text != nil || !attachments.isEmpty) { key in
            try await sendToBot(text, attachments: attachments, key: key)
        }
    }

    /// As `deliverToBot`, to the Chief in the open chat.
    @discardableResult
    public func deliverToChief(_ text: String, attachments: [FileRef] = [], box: Bool = true, key: String? = nil) async -> Bool {
        await outbox("chief").send(text, attachments: attachments, box: box, key: key, once: takesOnce, chat: chief.chatId, known: Set(ownWordsToChief.map(\.id))) { key in
            try await sendToChief(text, attachments: attachments, key: key)
        }
    }
}

/// The owner's message as its chat draws it from Send until the botdot server answered, as the
/// Android app's: their own words and files, in the look of a message that waits. It is the one
/// thing the app draws before the server spoke, and it decides nothing. `key` is the message's key
/// (`MessageKey`): the answer to the request that carried it is the server's version of this message,
/// and takes its place. `chat`: the Chief chat it was sent in (nil: a new one, not made yet), since
/// the Chief's chats share one outbox. `known`: the ids of the owner's messages the chat held on Send.
public struct SentMessage: Hashable, Sendable {
    public let key: String
    public var text: String
    public var attachments: [FileRef]
    public var chat: String?
    public var known: Set<String>

    public init(key: String, text: String, attachments: [FileRef] = [], chat: String? = nil, known: Set<String> = []) {
        self.key = key
        self.text = text
        self.attachments = attachments
        self.chat = chat
        self.known = known
    }

    /// This message, or nil once the server's own version of it is among `theirs`, the owner's
    /// messages the chat holds now. The feed can bring it before the request answers, or when its
    /// answer was lost: it is then one the chat did not hold on Send, with these words and these
    /// files. Never drawn twice.
    public func unlessIn(_ theirs: [Queued]) -> SentMessage? {
        func words(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
        let there = theirs.contains { !known.contains($0.id) && words($0.text) == words(text) && $0.attachments.map(\.file) == attachments.map(\.file) }
        return there ? nil : self
    }

    /// The owner's own messages among a bot's `runs` and those that wait for it: what `unlessIn` looks through.
    static func ownWords(runs: [RunSummary], queued: [Queued]) -> [Queued] {
        runs.filter(\.startedByOwnMessage).map { Queued(id: $0.id, text: $0.prompt ?? "", attachments: $0.attachments ?? []) } + queued
    }

    /// As above, of a Chief chat: a message there has no id, and is named by its place in the whole chat.
    static func ownWords(messages: [ChiefMessage], offset: Int, queued: [Queued]) -> [Queued] {
        messages.enumerated().compactMap { i, m in
            m.role == "user" ? Queued(id: "at:\(offset + i)", text: m.text ?? "", attachments: m.attachments ?? []) : nil
        } + queued
    }
}

extension OpeningLine {
    /// A chat's working line, without the ellipsis: the line it has, or "Working" while a message of
    /// the owner's is on its way (`sent`), until the server has words of its own.
    public static func withSent(_ line: String?, _ sent: SentMessage?) -> String? {
        line ?? (sent != nil ? "Working" : nil)
    }
}

extension Store {
    /// The owner's message on its way to this bot, drawn in its chat until the server's version of it
    /// is there (`SentMessage`); nil when none is, and for a chat that is not the open one.
    public func sent(toBot botId: String) -> SentMessage? {
        guard botChat.botId == botId else { return nil }
        return outbox("bot:\(botId)").sent?.unlessIn(SentMessage.ownWords(runs: botChat.runs, queued: waiting(in: "bot:\(botId)")))
    }

    /// As `sent(toBot:)`, in the open Chief chat: only a message that was sent in it.
    public var sentToChief: SentMessage? {
        guard let sent = outbox("chief").sent, sent.chat == chief.chatId else { return nil }
        return sent.unlessIn(ownWordsToChief)
    }

    /// The owner's own messages the open Chief chat holds, and those that wait in it.
    var ownWordsToChief: [Queued] {
        SentMessage.ownWords(messages: chief.messages, offset: chief.offset, queued: chief.chatId.map { waiting(in: "chief:\($0)") } ?? [])
    }
}
