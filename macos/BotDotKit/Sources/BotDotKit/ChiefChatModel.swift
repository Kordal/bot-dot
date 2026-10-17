import Foundation

/// The Chief of Staff chat on screen: its messages, and while the Chief works, what it's doing.
public struct ChiefChatState: Sendable {
    /// nil: a new chat, not started yet.
    public var chatId: String?
    public var title: String?
    public var messages: [ChiefMessage] = []
    /// The place of `messages[0]` in the whole chat, as the server counts (the `index` of a rating).
    public var offset = 0
    public var busy = false
    /// What the Chief is doing now, in words ("Creating a bot…"), while it works.
    public var activity: String?
    /// The same in the server's own words, the whole working line as it reads now; nil when it sent
    /// none (see `OpeningLine.chiefLine`).
    public var doing: String?
    /// Its messages have been read. A new chat (`chatId` nil) has none to read (see `isLoaded`).
    public var loaded = false

    /// What the chat holds is what there is: a new chat, or one whose messages were read.
    public var isLoaded: Bool { chatId == nil || loaded }
}

/// 👍 and 👎 under an unasked Chief message (docs/api.md "The Chief writes first"), as the web page's
/// public/ratings.js: the botdot server stores the rating and announces it on the live feed (`rating`).
public enum Ratings {
    public static let values = ["up", "down"]
    /// What each says, to VoiceOver and as its help tag.
    public static let label = ["up": "More like this", "down": "Less like this"]

    /// A rating as the server has it: "up", "down", or nil for anything else.
    public static func value(_ r: String?) -> String? { r.flatMap { values.contains($0) ? $0 : nil } }

    /// What a click on `tapped` makes of the `current` rating: the filled one clears, the other moves it.
    public static func next(_ current: String?, _ tapped: String) -> String? {
        guard let tapped = value(tapped) else { return value(current) }
        return value(current) == tapped ? nil : tapped
    }

    /// Whether a message gets the thumbs: an unasked, finished Chief message, from a server that rates.
    /// A checkup's message never does, whatever else it says.
    public static func shows(_ m: ChiefMessage, rates: Bool) -> Bool {
        rates && m.role == "chief" && m.unasked == true && m.checkup != true && m.pending != true
    }
}

/// What a Chief reply's bubble shows: its text, the problem of a reply that failed or was stopped
/// (each nil when there is none), and the files of the bot's result it is about (none for any other reply).
public struct ChiefReply: Hashable, Sendable {
    public let text: String?
    public let problem: String?
    public var files: [FileRef] = []
    /// Nothing to show: no bubble, and no words of the app's own.
    public var isEmpty: Bool { text == nil && problem == nil && files.isEmpty }
    /// A bubble that holds only files: no time stands under it, as on the web page.
    public var filesAlone: Bool { text == nil && problem == nil && !files.isEmpty }
}

extension ChiefMessage {
    /// How a Chief reply is drawn, as the Android app's `chiefReply` (docs/api.md: `error` also comes
    /// beside `text`). Both: the text, and the problem in its own block under it. The problem alone:
    /// the problem bubble. Neither: nothing, and the app writes no "Done.". Its `files` (docs/api.md,
    /// "A late result") are drawn in the bubble as under a bot's own message: under the text and above
    /// the problem, and alone in a bubble when the reply has no words. A reply still being written shows none.
    public var reply: ChiefReply {
        func words(_ s: String?) -> String? { s.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } }
        return ChiefReply(text: words(text), problem: words(error), files: pending == true ? [] : files ?? [])
    }
}

/// What the Chief is doing, by tool, as the web page words it.
enum ChiefActivity {
    static let words: [String: String] = [
        "list_bots": "Checking your bots",
        "get_bot": "Looking at a bot",
        "create_bot": "Creating a bot",
        "update_bot": "Updating a bot",
        "delete_bot": "Removing a bot",
        "run_bot": "Starting a bot",
        "wait_for_run": "Waiting for the bot to finish",
        "get_run": "Checking results",
        "list_runs": "Checking recent runs",
        "stop_run": "Stopping a run",
        "list_vault": "Checking your saved logins",
        "list_skills": "Checking the skills",
        "create_skill": "Writing a skill",
        "update_skill": "Updating a skill",
        "request_login": "Waiting for you to add the login",
        "ToolSearch": "Getting ready",
        "Read": "Reading files",
        "Grep": "Looking through files",
        "Glob": "Looking through files",
    ]

    static func text(for tool: String?, text: String? = nil) -> String {
        if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "\(text)…" }
        let bare = tool?.split(separator: "__").last.map(String.init) ?? ""
        return "\(words[tool ?? ""] ?? words[bare] ?? "Working on it")…"
    }
}

/// A line of the Chief's stream (`GET /api/chief/chats/:id/stream`).
struct ChiefStreamEvent: Decodable {
    let type: String
    let tool: String?
    let text: String?
    let action: ChiefAction?
    let message: ChiefMessage?
}

extension Store {
    /// Shows the Chief chat `chatId`, or a new, empty one (nil).
    public func openChief(chatId: String?) {
        chiefFollow?.cancel()
        chief = ChiefChatState(chatId: chatId)
        guard let chatId else { return }
        Task { await loadChief(chatId) }
    }

    func loadChief(_ chatId: String) async {
        guard let api else { return }
        do {
            let chat: ChiefChat = try await api.get("chief/chats/\(chatId)")
            guard chief.chatId == chatId else { return }
            show(chat)
            if chief.busy { followChief(chatId) }
        } catch {
            problem = error.localizedDescription
        }
    }

    /// The open chat as the server has it now: its messages, what waits in it, and what the Chief is doing.
    private func show(_ chat: ChiefChat) {
        let chatId = chat.id
        chief.title = chat.title
        chief.messages = chat.messages
        chief.loaded = true
        chief.offset = max(0, chat.offset ?? 0)
        chief.busy = chat.busy ?? false
        setWaiting("chief:\(chatId)", chat.queued?.items ?? [])
        lines { chief.busy ? $0.say("chief:\(chatId)", chat.openingLine) : $0.end("chief:\(chatId)") }
        let activity = chat.messages.last(where: { $0.pending == true })?.activity
        chief.activity = chief.busy ? activity.map { ChiefActivity.text(for: $0.tool, text: $0.text) } : nil
        chief.doing = chief.busy ? activity.map { OpeningLine.chiefActivity($0.text) } : nil
    }

    /// Sends `text` to the Chief in the open chat, starting a new chat if there's none yet. The
    /// reply shows as pending until the Chief is done. `key`: the message's key, which goes with it
    /// to a server that takes a key once (see Outbox.swift); a message that server had taken already
    /// is in the chat, which is read again. With no botdot server followed it throws: the message
    /// did not leave.
    public func sendToChief(_ text: String, attachments: [FileRef] = [], key: String? = nil) async throws {
        guard let api else { throw NotSent(cause: ConnectError(message: "Not connected.")) }
        var chatId = chief.chatId
        if chatId == nil {
            struct Created: Decodable { let id: String }
            // Without its chat the message did not leave.
            let created: Created
            do { created = try await api.send("chief/chats") } catch { throw NotSent(cause: error) }
            chatId = created.id
            chief.chatId = created.id
            outbox("chief").sentIn(created.id) // the message on its way is in this chat
        }
        guard let chatId else { return }
        struct Message: Encodable { let text: String; let attachments: [FileRef]; let key: String? }
        struct Took: Decodable { let again: Bool? }
        let answer = try await api.data("chief/chats/\(chatId)/messages", method: "POST", body: Message(text: text, attachments: attachments, key: takesOnce ? key : nil))
        let took = try JSON.decoder.decode(Took.self, from: answer)
        if took.again == true {
            guard chief.chatId == chatId else { return }
            await loadChief(chatId)
            Task { try? await loadChiefChats() }
            return
        }
        // A server that lets a message wait answers with the chat: the message is in it at once, or
        // among those that wait while the Chief replies. A reply that is going is followed already.
        if sendStays, let chat = try? JSON.decoder.decode(ChiefChat.self, from: answer), chat.id == chatId {
            guard chief.chatId == chatId else { return }
            show(chat)
            if chief.busy, chiefFollow == nil || chiefFollow?.isCancelled == true { followChief(chatId) }
            Task { try? await loadChiefChats() }
            return
        }
        chief.messages.removeAll { $0.pending == true }
        chief.messages.append(ChiefMessage(role: "user", text: text.isEmpty && !attachments.isEmpty ? "Have a look at the attached files." : text, at: ISO8601DateFormatter().string(from: .now), attachments: attachments.isEmpty ? nil : attachments))
        chief.messages.append(ChiefMessage(role: "chief", pending: true))
        chief.loaded = true
        chief.busy = true
        chief.activity = "Thinking…"
        followChief(chatId)
        Task { try? await loadChiefChats() }
    }

    /// Stops the Chief's reply in the open chat.
    public func stopChief() async {
        guard let api, let chatId = chief.chatId else { return }
        try? await api.send("chief/chats/\(chatId)/stop")
    }

    /// A click on 👍 (`"up"`) or 👎 (`"down"`) under the message at `i` of the open chat: it shows at
    /// once and is sent; when the server refuses or can't be reached it goes back to what it was and
    /// the app says so. Every app hears the rating on the live feed (`ratingChanged`).
    public func rate(_ i: Int, _ tapped: String) async {
        guard let api, let chatId = chief.chatId, chief.messages.indices.contains(i) else { return }
        let before = chief.messages[i].rating
        let rating = Ratings.next(before, tapped)
        chief.messages[i].rating = rating
        struct Body: Encodable {
            let rating: String?
            enum CodingKeys: CodingKey { case rating }
            // null clears it: the key is sent either way.
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(rating, forKey: .rating)
            }
        }
        do {
            try await api.send("chief/chats/\(chatId)/messages/\(chief.offset + i)/rating", method: "PUT", body: Body(rating: rating))
        } catch {
            // Unless a later click or the feed changed it since.
            if chief.chatId == chatId, chief.messages.indices.contains(i), chief.messages[i].rating == rating {
                chief.messages[i].rating = before
            }
            problem = "Couldn't save your rating."
        }
    }

    /// The feed's `rating`: a message of a Chief chat was rated, here or in another app.
    func ratingChanged(_ data: Data) {
        struct Rated: Decodable { let chatId: String; let index: Int; let rating: String? }
        guard let r = try? JSON.decoder.decode(Rated.self, from: data), r.chatId == chief.chatId else { return }
        let i = r.index - chief.offset
        guard chief.messages.indices.contains(i) else { return }
        chief.messages[i].rating = Ratings.value(r.rating)
    }

    func followChief(_ chatId: String) {
        guard let api else { return }
        chiefFollow?.cancel()
        chiefFollow = Task { [weak self] in
            do {
                for try await ev in api.events("chief/chats/\(chatId)/stream") {
                    guard let self, self.chief.chatId == chatId else { return }
                    guard let e = try? JSON.decoder.decode(ChiefStreamEvent.self, from: Data(ev.data.utf8)) else { continue }
                    switch e.type {
                    case "activity":
                        self.chief.activity = ChiefActivity.text(for: e.tool, text: e.text)
                        self.chief.doing = OpeningLine.chiefActivity(e.text)
                    case "opening_line":
                        self.lines { $0.say("chief:\(chatId)", e.text) }
                    case "action":
                        if let action = e.action, let i = self.chief.messages.lastIndex(where: { $0.pending == true }) {
                            self.chief.messages[i].actions = (self.chief.messages[i].actions ?? []) + [action]
                        }
                    case "file":
                        // A bot's file, while the Chief still waits for it: shown before the reply.
                        if let m = e.message, let i = self.chief.messages.lastIndex(where: { $0.pending == true }) {
                            self.chief.messages.insert(m, at: i)
                        }
                    case "done":
                        break
                    default:
                        continue
                    }
                    if e.type == "done" { break }
                }
            } catch {}
            guard let self, self.chief.chatId == chatId, !Task.isCancelled else { return }
            // The reply, as saved: read the chat again.
            self.chiefFollow = nil
            self.chief.activity = nil
            self.chief.doing = nil
            self.lines { $0.end("chief:\(chatId)") } // the reply is here, or it couldn't finish
            await self.loadChief(chatId)
            try? await self.loadChiefChats()
        }
    }

    public func loadChiefChats() async throws {
        guard let api else { return }
        struct Chief: Decodable { let chats: [ChiefChatSummary]; let busy: Bool?; let unread: Int? }
        let c: Chief = try await api.get("chief")
        chiefChats = c.chats
        // Opening lines: while the Chief replies, each chat's line as the server has it; else none.
        lines { $0.sync(c.busy == true ? c.chats.map { .init(chat: "chief:\($0.id)", run: nil, text: $0.openingLine) } : [], scope: "chief:") }
        chiefUnread = max(0, c.unread ?? 0)
        chiefBusy = c.busy ?? false
    }
}
