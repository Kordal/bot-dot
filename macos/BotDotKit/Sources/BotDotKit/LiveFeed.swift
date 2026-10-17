import Foundation

extension Store {
    /// Follows the live feed (`GET /api/events`) for as long as this botdot server is connected. After
    /// a drop it reconnects with the last event's id, so nothing is missed; `reset` (botdot restarted,
    /// or it was away too long) reloads everything.
    func startFeed() {
        feed?.cancel()
        guard let api else { return }
        // As the web page does, everything is read again every minute too, for what has no event.
        refresher?.cancel()
        refresher = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                await self?.reloadAll()
            }
        }
        feed = Task { [weak self] in
            var lastEventId: String?
            while !Task.isCancelled {
                do {
                    for try await ev in api.events("events", lastEventId: lastEventId) {
                        guard let self else { return }
                        if let id = ev.id { lastEventId = id }
                        if self.away { self.away = false } // botdot answers again
                        await self.handle(ev)
                    }
                } catch {}
                if Task.isCancelled { return }
                // The feed ended or never opened: "Can't reach botdot" stands until it speaks again.
                if let self, !self.away { self.away = true }
                try? await Task.sleep(for: .seconds(5)) // the feed's own `retry: 5000`
                if lastEventId == nil { await self?.reloadAll() } // never got far: start over
            }
        }
    }

    func stopFeed() {
        feed?.cancel()
        feed = nil
        refresher?.cancel()
        refresher = nil
    }

    struct FeedData: Decodable {
        var botId: String?
        var chatId: String?
        /// "bot:<id>" or "chief:<chatId>" (`unread`).
        var chat: String?
        var chiefBusy: Bool?
        var update: Available?
        struct Available: Decodable { var available: Bool? }
    }

    func handle(_ ev: ServerSentEvent) async {
        if let name = ev.event { onEvent?(name, Data(ev.data.utf8)) }
        let data = (try? JSON.decoder.decode(FeedData.self, from: Data(ev.data.utf8))) ?? FeedData()
        if let name = ev.event { turns { $0.handle(name, Data(ev.data.utf8), follows: has(.workingLine)) } }
        if let name = ev.event { heardCards(name, id: ev.id, Data(ev.data.utf8)) } // the group a waiting job or tile was asked in
        if let name = ev.event { // whether Claude is signed out
            var now = claude
            now.heard(name, id: ev.id, Data(ev.data.utf8), features: features)
            if now != claude { claude = now }
        }
        switch ev.event {
        case "hello":
            // Where things stand now: anything may have changed before the feed was open.
            heardAsks(Data(ev.data.utf8), hello: true)
            chiefBusy = data.chiefBusy ?? chiefBusy
            updateAvailable = data.update?.available ?? updateAvailable
            await loadFigure() // botdot may have been updated while the feed was closed
            await reloadAll()
        case "login_request", "login_request_closed", "bitwarden", "asks", "approvals":
            // What a tool's notification says comes with the event, before its card is read.
            // The event of the same name about one bot's open question: its row says so at once.
            if ev.event == "asks" { heardAsks(Data(ev.data.utf8)); heardBotAsks(Data(ev.data.utf8)) }
            await loadNeeds()
            if ev.event == "approvals" { try? await loadBots() } // jobs waiting live in the bots
        case "dashboard":
            // One tile's new value, or tiles added, changed or removed.
            struct Changed: Decodable { let tile: Tile?; let changed: Bool? }
            if let c = try? JSON.decoder.decode(Changed.self, from: Data(ev.data.utf8)), let t = c.tile, dashboard.tiles.contains(where: { $0.id == t.id }) {
                replace(t.id) { $0 = t }
            } else {
                await loadDashboard(quiet: true)
            }
        case "bots":
            // Chief edits take effect during its turn, before any run or reply event.
            try? await loadBots()
        case "bot_message":
            if let id = botChat.botId { await loadNotes(id) }
        case "plan_closed", "chief_suggestion":
            try? await loadChiefChats()
        case "unread":
            // A chat's new replies changed: its dots follow, in every app.
            if let chat = data.chat, let now = UnreadNow(event: Data(ev.data.utf8)) { await setUnread(chat, now) }
        case "update_available":
            updateAvailable = true
        case "rating":
            // 👍 or 👎 under an unasked Chief message, from any app.
            ratingChanged(Data(ev.data.utf8))
        case "checkup":
            // The checkup's switches, changed in another app or by the Chief in a chat.
            checkupChanged(Data(ev.data.utf8))
        case "queued":
            // What waits in a chat changed: its list as it is now, in every app.
            waitingChanged(Data(ev.data.utf8))
        case "opening_line", "working_line":
            // A working bot said what it is about to do, or what it is doing now: under its chat and as its preview, at once.
            lineSaid(ev.event ?? "", Data(ev.data.utf8))
        case "run_waits":
            // A run waits for the owner's OK, or no longer does: its line says so at once.
            runWaits(Data(ev.data.utf8))
        case "reset":
            lines { $0.clear() } // the reload reads them again
            await reloadAll()
        case "run_started", "run_finished", "waiting":
            if ev.event == "run_started", let id = data.botId, let i = bots.firstIndex(where: { $0.id == id }) {
                bots[i].running = true
                bots[i].state = "working"
            }
            // Its run ended: the line goes, before the reload that shows the reply.
            if ev.event == "run_finished" { openingLineRunEnded(Data(ev.data.utf8)) }
            try? await loadBots()
            if let id = data.botId, id == botChat.botId { await loadBotRuns(id) }
            reportAgainIfStale()
        case "chief_started", "chief_reply":
            if ev.event == "chief_started" { chiefBusy = true }
            if ev.event == "chief_reply" { openingLineChiefReplied(Data(ev.data.utf8)) }
            try? await loadChiefChats()
            // A reply that came in from elsewhere (a bot's report, another device): show it.
            if let id = data.chatId, id == chief.chatId, chiefFollow == nil || chiefFollow?.isCancelled == true {
                await loadChief(id)
            }
            reportAgainIfStale()
        default:
            if let name = ev.event { await groupHeard(name, Data(ev.data.utf8)) } // a group's (see Groups.swift)
        }
    }

    /// Reads everything again (⌘R, and every minute).
    public func reloadAll() async {
        if figureAsked == nil { await loadFigure() } // it didn't arrive yet
        try? await loadBots()
        try? await loadChiefChats()
        await loadGroups()
        await loadNeeds()
        await loadDashboard(quiet: true)
        await loadCheckup()
        if let id = chief.chatId { await loadChief(id) }
        if let id = botChat.botId { await loadBotRuns(id) }
        if let id = groupChat.groupId { await loadGroupChat(id) }
        reportAgainIfStale()
    }
}

extension Store {
    /// Tells botdot this app is in use, and which chat is on screen ("bot:<id>" or "chief:<chatId>"),
    /// so your phone isn't notified about what you already see here.
    public func present(chat: String?) async {
        guard let api else { return }
        struct Presence: Encodable { let chat: String? }
        try? await api.send("presence", body: Presence(chat: chat))
    }
}

// MARK: notifications

/// A notification about a reply, tagged with its chat ("bot:<id>" or "chief:<chatId>").
public struct ReplyNotification: Equatable, Sendable {
    public let chat: String
    /// A run has its own; a Chief chat has one, which its next reply takes the place of.
    public let id: String
    public let title: String
    public let body: String
}

/// What a live-feed event means for the notifications about replies.
public enum NotificationStep: Equatable, Sendable {
    case post(ReplyNotification)
    /// The chat was read: its notifications go.
    case remove(chat: String)
    /// The feed started (again): the notifications are brought in line with the server's new replies
    /// (`Store.notificationCatchUp`). Those of chats read meanwhile go. With `rebuild` (the feed could
    /// not replay what was missed) a chat with new replies and no notification gets one again.
    case catchUp(rebuild: Bool)
}

/// What a catch-up changes: the chats whose notifications go, and the notifications to post again,
/// quietly, each showing its chat's first new reply.
public struct NotificationCatchUp: Equatable, Sendable {
    public var remove: [String] = []
    public var post: [ReplyNotification] = []
}

public enum ReplyNotifications {
    /// Which replies notify, and when a chat's notifications go (ADR 005, docs/api.md "New replies").
    ///
    /// A botdot server that keeps new replies (`followsUnread`) decides: a reply it marks `new` notifies,
    /// and `unread` with nothing left removes. What it does not count (a quiet run, a bot-to-bot
    /// exchange, an opening line) and what was read at once (its chat is on screen in some app) comes
    /// without `new`. `chat_seen` and `webActive` are for apps from before and are not looked at.
    ///
    /// A server from before: as the app always did. A finished run or a Chief reply notifies, except
    /// for the chat this app shows while active (`watching`), a quiet or passed-on run, and while the
    /// web page is in use and this app is not (`usedLately`); `chat_seen` removes.
    ///
    /// When the feed starts (again), on either: `catchUp`, which changes nothing on a server from before.
    /// `reset` says nothing was replayed, so the notifications of new replies are owed again; the
    /// `hello` that follows a replay owes none.
    ///
    /// `asksYou`: the server says which reply asks the owner something (`asks-you`): that reply's
    /// notification is titled and worded as the server says (`asking`, in Asks.swift).
    public static func step(event: String, data: Data, followsUnread: Bool, watching: String? = nil, usedLately: Bool = false, asksYou: Bool = false, groupName: (String) -> String? = { _ in nil }) -> NotificationStep? {
        guard let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        func str(_ k: String) -> String? { d[k] as? String }
        func flag(_ k: String) -> Bool { d[k] as? Bool == true }
        let old = !followsUnread
        let silenced = old && flag("webActive") && !usedLately
        switch event {
        case "run_finished":
            guard let bot = str("botId"), !bot.isEmpty else { return nil }
            let chat = "bot:\(bot)"
            if old ? (watching == chat || flag("quiet") || flag("passedOn") || silenced) : !flag("new") { return nil }
            let reply = run(chat: chat, id: str("id"), botName: str("botName"), jobName: str("jobName"), status: str("status"), result: str("result"), problem: str("problem"), error: str("error"))
            return .post(asksYou ? asking(reply, asks: flag("asks"), title: str("title"), question: str("question"), botName: str("botName"), result: str("result")) : reply)
        case "chief_reply":
            guard let id = str("chatId"), !id.isEmpty else { return nil }
            let chat = "chief:\(id)"
            if old ? (watching == chat || silenced) : !flag("new") { return nil }
            let from = (d["from"] as? [String: Any])?["name"] as? String
            return .post(chief(chat: chat, from: from, text: str("text"), error: str("error")))
        case "unread":
            guard followsUnread, let chat = str("chat"), d["unread"] as? Int == 0 else { return nil }
            return .remove(chat: chat) // read, in any app
        case "chat_seen":
            guard old, let chat = str("chat") else { return nil }
            return .remove(chat: chat) // opened somewhere else
        case "hello", "reset":
            // Whether this server keeps new replies is asked again there: it may have been updated.
            return .catchUp(rebuild: event == "reset")
        default:
            return group(event, d, watching: watching, name: groupName) // a group's (see Groups.swift)
        }
    }
}

extension ReplyNotifications {
    /// The notification of a finished run: its reply, or why it didn't finish, under the bot's name
    /// and its job's.
    static func run(chat: String, id: String?, botName: String?, jobName: String?, status: String?, result: String?, problem: String?, error: String?) -> ReplyNotification {
        let body = status == "success" ? (result ?? "Done.") : (problem ?? "Didn't finish: \(error ?? status ?? "")")
        return ReplyNotification(chat: chat, id: "run:\(id ?? UUID().uuidString)", title: (botName ?? "A bot") + (jobName.map { " · \($0)" } ?? ""), body: body)
    }

    /// The notification of a reply in a Chief chat: the Chief's, or a bot's posted there (`from`).
    static func chief(chat: String, from: String?, text: String?, error: String?) -> ReplyNotification {
        ReplyNotification(chat: chat, id: chat, title: from ?? "Chief of Staff", body: text ?? error ?? "Replied.")
    }

    /// The chats that are owed a notification when the feed replayed nothing (`reset`) or the app
    /// started: those with new replies (`unread`) that have none (`showing`: the tags of the delivered
    /// ones). Not the chat being `watching`: the server is about to hear that it is read.
    public static func owed(showing: Set<String>, unread: Set<String>, watching: String? = nil) -> Set<String> {
        unread.subtracting(showing).subtracting(watching.map { [$0] } ?? [])
    }
}

extension Store {
    /// What this event means for notifications, on the botdot server this app is connected to.
    /// `watching`: the chat this app shows while it is active; `usedLately`: this app was used in the
    /// last minutes. Both matter only to a server from before new replies.
    public func notificationStep(_ event: String, _ data: Data, watching: String? = nil, usedLately: Bool = false) -> NotificationStep? {
        ReplyNotifications.step(event: event, data: data, followsUnread: followsUnread, watching: watching, usedLately: usedLately, asksYou: has(.asksYou), groupName: { id in group(id)?.name })
    }

    /// Brings the notifications about replies in line with the server's new replies, asked now.
    /// `showing`: the tags of the delivered notifications. `remove`: the chats among them that have
    /// nothing new or no longer exist, read while this app wasn't listening. With `rebuild` (the app
    /// started, or the feed said `reset`), `post`: one notification for each chat with new replies
    /// that has none, showing its first new reply (`firstUnread`); not for the chat being `watching`.
    /// nil when the server can't be asked: the catch-up is still owed. Nothing on a server that doesn't
    /// keep new replies.
    public func notificationCatchUp(showing: [String], rebuild: Bool, watching: String? = nil) async -> NotificationCatchUp? {
        guard let api else { return nil }
        do {
            // It may have been updated since this app last asked what it can do.
            let version: Version = try await api.get("version")
            await follows(unread: version.features?.contains("unread") == true)
            try await loadBots()
            try await loadChiefChats()
        } catch { return nil }
        var plan = NotificationCatchUp(remove: readNow(among: showing))
        guard rebuild, followsUnread else { return plan }
        let unread = bots.filter { ($0.unread ?? 0) > 0 }.map { "bot:\($0.id)" } + chiefChats.filter { ($0.unread ?? 0) > 0 }.map { "chief:\($0.id)" }
        let owed = ReplyNotifications.owed(showing: Set(showing), unread: Set(unread), watching: watching)
        for chat in unread where owed.contains(chat) { // in the list's order
            if let n = await firstNewReply(chat) { plan.post.append(n) }
        }
        return plan
    }

    /// The notification of a chat's first new reply, read from the server. nil when it has none (it was
    /// read meanwhile) or can't be read.
    private func firstNewReply(_ chat: String) async -> ReplyNotification? {
        guard let api, let (kind, id) = Unread.parts(chat) else { return nil }
        if kind == "bot" {
            guard let bot = bots.first(where: { $0.id == id }), let first = bot.firstUnread,
                  let run: RunSummary = try? await api.get("runs/\(first)") else { return nil }
            let reply = ReplyNotifications.run(chat: chat, id: run.id, botName: bot.name, jobName: run.jobName, status: run.status, result: run.result, problem: run.problem, error: run.error)
            guard has(.asksYou) else { return reply }
            return ReplyNotifications.asking(reply, asks: run.asks?.value == true, title: run.title?.text, question: run.question?.text, botName: bot.name, result: run.result)
        }
        // Only what the notification says. `error` is words in the Chief's own message, and `true` in a
        // bot's reply that didn't finish, whose text says why.
        struct Part: Decodable {
            struct Message: Decodable {
                let role: String?
                let text: String?
                let from: Who?
                let error: String?
                enum Keys: String, CodingKey { case role, text, from, error }
                init(from decoder: Decoder) throws {
                    let c = try decoder.container(keyedBy: Keys.self)
                    role = try? c.decode(String.self, forKey: .role)
                    text = try? c.decode(String.self, forKey: .text)
                    from = try? c.decode(Who.self, forKey: .from)
                    error = try? c.decode(String.self, forKey: .error)
                }
            }
            let messages: [Message]
        }
        guard let first = chiefChats.first(where: { $0.id == id })?.firstUnread,
              let part: Part = try? await api.get("chief/chats/\(id)?offset=\(first)&limit=1"), let m = part.messages.first else { return nil }
        let text = m.text.flatMap { $0.isEmpty ? nil : $0 }
        return ReplyNotifications.chief(chat: chat, from: m.role == "report" ? m.from?.name : nil, text: text, error: m.error.flatMap { $0.isEmpty ? nil : $0 })
    }

    /// The same, from what the app knows now.
    func readNow(among chats: [String]) -> [String] {
        guard followsUnread else { return [] }
        return chats.filter { chat in
            guard let (kind, _) = Unread.parts(chat), kind == "bot" || kind == "chief" else { return false } // "need:<key>"
            guard let now = unreadKnown(chat) else { return true } // the bot or the chat is gone
            return now.unread == 0
        }
    }
}
