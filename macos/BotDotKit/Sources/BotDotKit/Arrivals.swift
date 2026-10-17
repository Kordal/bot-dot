import Foundation

/// Which replies of one open chat are new on screen, and so arrive: they fade in and rise into their
/// place, once, as on the web page (`.arrives` in public/style.css) and in the Android app
/// (Arrivals.kt). A chat's screen tells it what it draws (`draw`) every time it draws; a reply's part
/// of the screen asks when it came (`since`).
///
/// A reply is told by its id: the run's in a bot's chat, the message's place in a Chief chat. It is
/// new when its id was not drawn before in this open chat and it stands after every reply that was.
/// In a chat that was open with no reply at all, the first ones are new. So nothing is new when the
/// chat opens, when its lists are read again, when older messages are loaded above, or when the chat
/// is read from scratch.
///
/// The owner's own messages are no replies and are not among the ids. The one on its way
/// (`SentMessage`) arrives when it is first drawn, on Send; the server's version that takes its place
/// stands where it stood and does not.
@MainActor
public final class Arrivals {
    /// How long a reply's arrival lasts, in seconds.
    public static let seconds = 0.26
    /// How far below its place an arriving reply starts.
    public static let rise = 10.0

    private let now: () -> Date
    private var chat: String?
    /// nil until the chat was drawn once with what it holds.
    private var seen: Set<String>?
    /// The key of the message on its way, as drawn last.
    private var sent: String?
    private var came: [String: Date] = [:]

    public init(now: @escaping () -> Date = { Date() }) { self.now = now }

    /// What the chat draws now; the ids that are new with it (among them `sent`'s, as `Arrivals.sent`).
    /// `chat`: which chat, where one screen shows several (the Chief's); nil for a new chat without an
    /// id yet. `loaded`: the chat's messages were read. `replies`: the ids of the replies drawn, oldest
    /// first. `sent`: the key of the owner's message on its way, or nil.
    @discardableResult
    public func draw(_ chat: String?, loaded: Bool, replies: [String], sent: String? = nil) -> Set<String> {
        if chat != self.chat {
            // A new chat that got its id by the message on its way is the same chat. Any other is another one.
            if !(self.chat == nil && self.sent != nil) { seen = nil; self.sent = nil; came = [:] }
            self.chat = chat
        }
        guard loaded else { return [] }
        guard let had = seen else { // the chat opens: what is there stands still
            seen = Set(replies)
            self.sent = sent
            return []
        }
        var new = Set(Self.newReplies(seen: had, replies: replies))
        seen = had.union(replies)
        if let sent, sent != self.sent { new.insert(Self.sent(sent)) }
        self.sent = sent
        let at = now()
        for id in new { came[id] = at }
        return new
    }

    /// When the reply `id` arrived, or nil for one that was there or is no reply.
    public func since(_ id: String?) -> Date? { id.flatMap { came[$0] } }

    /// The id of the owner's message on its way, by its key.
    public static func sent(_ key: String) -> String { "sent:\(key)" }

    /// The replies that are new among `replies` (ids, oldest first), in a chat that drew `seen` before:
    /// those after the last one it drew. In a chat that drew none, all of them. None when it drew some
    /// and none of those is left: the chat was read from scratch.
    static func newReplies(seen: Set<String>, replies: [String]) -> [String] {
        if seen.isEmpty { return replies }
        guard let last = replies.lastIndex(where: seen.contains) else { return [] }
        return Array(replies[(last + 1)...])
    }

    /// Whether a reply that came at `since` is moving at `now`. `still`: the owner asked for reduced
    /// motion, and nothing moves.
    public static func moves(since: Date?, now: Date, still: Bool) -> Bool {
        guard !still, let since else { return false }
        return now.timeIntervalSince(since) < seconds
    }

    /// The replies of a bot's chat, oldest first, from its runs as the chat holds them: a run that
    /// ended. One at work has its working line.
    public static func replyIds(_ runs: [RunSummary]) -> [String] {
        runs.filter { !$0.isRunning && !$0.isQueued }.map(\.id)
    }

    /// The replies of a Chief chat, oldest first, each by its place in the whole chat: every message
    /// but the owner's own and a reply still being written. `offset`: the place of the first of `messages`.
    public static func replyIds(_ messages: [ChiefMessage], offset: Int) -> [String] {
        messages.enumerated().compactMap { i, m in m.role == "user" || m.pending == true ? nil : "\(offset + i)" }
    }
}
