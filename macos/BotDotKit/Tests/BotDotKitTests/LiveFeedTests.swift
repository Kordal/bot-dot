import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct LiveFeed {
    @Test func aBotThatStartsWorkingShowsAsWorkingThenIdleAgain() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        try server.hold()
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        #expect(store.bots.first?.running != true)

        try await server.api("bots/\(id)/run", method: "POST", body: ["prompt": "any news?"])
        try await eventually("the bot to show as working") { store.bots.first?.running == true }

        try server.unhold()
        try await eventually("the bot to be idle again") { store.bots.first?.running != true }
    }

    @Test func chiefBotChangesReachTheSidebarBeforeItsTurnFinishes() async throws {
        let server = try TestServer()
        let original = try await server.makeBot("News")
        try server.hold()
        defer { try? server.unhold() }
        let store = Store()
        defer { store.disconnect() }
        var connected = false
        var started = false
        store.onEvent = { name, _ in
            if name == "hello" { connected = true }
            if name == "chief_started" { started = true }
        }
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the live feed") { connected }
        // Start a held Chief turn through HTTP. Seeing chief_started proves the feed has
        // finished its initial hello/reload, so that reload cannot conceal a missing event.
        let chat = try await server.api("chief/chats", method: "POST") as? [String: Any]
        let chatId = try #require(chat?["id"] as? String)
        try await server.api("chief/chats/\(chatId)/messages", method: "POST", body: ["text": "Update my team"])
        try await eventually("the Chief's held turn") { started && store.chiefBusy }

        let deleted = try await server.api("bots/\(original)", method: "DELETE", asChief: true) as? [String: Any]
        #expect(deleted?["ok"] as? Bool == true)
        try await eventually("the deleted bot to leave the sidebar", seconds: 3) { store.bots.isEmpty }
        #expect(store.chiefBusy)

        let created = try await server.api("bots", method: "POST", body: ["name": "Mail Assistant", "prompt": "Sort mail"], asChief: true) as? [String: Any]
        let id = try #require(created?["id"] as? String)
        try await eventually("the new bot in the sidebar", seconds: 3) { store.bots.map(\.id) == [id] }
        try await server.api("bots/\(id)", method: "PUT", body: ["name": "Mail Steward"], asChief: true)
        try await eventually("the updated sidebar name", seconds: 3) { store.bots.first?.name == "Mail Steward" }
        #expect(store.chiefBusy)
    }
}

@MainActor
@Suite struct Presence {
    @Test func sayingWhichChatIsOnScreenReachesTheOtherApps() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = Store()
        var seen: [String] = []
        var connected = false
        store.onEvent = { name, data in
            if name == "hello" { connected = true }
            if name == "chat_seen", let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { seen.append(d["chat"] as? String ?? "") }
        }
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the live feed") { connected }
        await store.present(chat: "bot:\(id)")
        try await eventually("the chat_seen event") { seen == ["bot:\(id)"] }
    }
}

/// Which replies notify, and when a chat's notifications go (ADR 005), without the system's
/// notification centre: what the app would do for each event of a real botdot test server's feed.
@MainActor
@Suite struct Notifications {
    /// What an app's notifier was told, in order.
    @MainActor final class Heard {
        var events: [String] = []
        var steps: [NotificationStep] = []
        /// Each `run_finished` as it came.
        var finished: [[String: Any]] = []
        var posts: [ReplyNotification] { steps.compactMap { if case .post(let n) = $0 { n } else { nil } } }
        var removed: [String] { steps.compactMap { if case .remove(let chat) = $0 { chat } else { nil } } }
    }

    @MainActor final class Watching { var chat: String? }

    /// A connected app whose live feed is open, and what its notifier hears from now on.
    func app(_ server: TestServer, watching: String? = nil, usedLately: Bool = false) async throws -> (Store, Heard) {
        let store = Store()
        let heard = Heard()
        store.onEvent = { [weak store] name, data in
            heard.events.append(name)
            if name == "run_finished", let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { heard.finished.append(d) }
            if let step = store?.notificationStep(name, data, watching: watching, usedLately: usedLately) { heard.steps.append(step) }
        }
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the live feed") { heard.events.contains("hello") }
        return (store, heard)
    }

    func json(_ object: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: object) }

    @Test func aNewReplyNotifiesOnceForItsChat() async throws {
        let server = try TestServer()
        try server.reply("Found 3 articles.")
        let id = try await server.makeBot("News")
        let (store, heard) = try await app(server)
        defer { store.disconnect() }
        #expect(heard.steps == [.catchUp(rebuild: false)]) // the feed started: what was read meanwhile goes

        let run = try await server.runToEnd(id, "any news?")
        try await eventually("the notification") { !heard.posts.isEmpty }
        #expect(heard.posts == [ReplyNotification(chat: "bot:\(id)", id: "run:\(run)", title: "News", body: "Found 3 articles.")])

        // A run that didn't finish is new too, and says why.
        try server.fail("boom")
        try await server.runToEnd(id, "again?")
        try await eventually("the failed run's notification") { heard.posts.count == 2 }
        #expect(heard.posts.last?.chat == "bot:\(id)")
        #expect(heard.posts.last?.body.isEmpty == false)
        #expect(heard.removed.isEmpty)
    }

    @Test func theChiefsReplyNotifiesForItsChat() async throws {
        let server = try TestServer()
        try server.reply("Here's the plan.")
        let (store, heard) = try await app(server)
        defer { store.disconnect() }
        let made = try await server.api("chief/chats", method: "POST") as? [String: Any]
        let chat = try #require(made?["id"] as? String)
        try await server.api("chief/chats/\(chat)/messages", method: "POST", body: ["text": "Make me a news bot"])
        try await eventually("the notification") { !heard.posts.isEmpty }
        #expect(heard.posts == [ReplyNotification(chat: "chief:\(chat)", id: "chief:\(chat)", title: "Chief of Staff", body: "Here's the plan.")])
    }

    @Test func aBotToBotExchangeARunTheChiefStartedAndAnOpeningLineNeverNotify() async throws {
        let server = try TestServer()
        let surfer = try await server.makeBot("Web Surfer")
        let news = try await server.makeBot("News")
        let (store, heard) = try await app(server)
        defer { store.disconnect() }

        // The owner asks Web Surfer, which says what it is about to do and messages News.
        try server.hold()
        let known = try server.runs()
        let asked = try await server.api("bots/\(surfer)/run", method: "POST", body: ["prompt": "ask News"]) as? [String: Any]
        let own = try #require(asked?["id"] as? String)
        let n = try await server.newRun(since: known)
        try server.play([TestServer.says("Asking News what is new."), TestServer.uses()], into: n)
        try await eventually("the opening line") { heard.events.contains("opening_line") }
        try await server.selfTool("message", ["to": news, "message": "What's new in games?", "priority": true])
        try server.unhold()
        try server.releaseAll()
        try await eventually("News to have answered its teammate", seconds: 15) {
            store.recentRuns.contains { $0.botId == news && $0.trigger == "bot" && $0.status == "success" }
        }
        // The Chief hands News a task: its reply is the Chief's to relay.
        let handed = try await server.api("bots/\(news)/run", method: "POST", body: ["prompt": "Summarise the week"], asChief: true) as? [String: Any]
        let theirs = try #require(handed?["id"] as? String)
        try await eventuallyAsync("that run to end") { (try await server.api("runs/\(theirs)") as? [String: Any])?["status"] as? String == "success" }
        // The owner's own run ended last of what must be heard: wait for a later owner run as a marker.
        let marker = try await server.runToEnd(surfer, "thanks")
        try await eventually("the marker's notification") { heard.posts.contains { $0.id == "run:\(marker)" } }

        // Nothing for News and nothing for the line. What the owner asked Web Surfer notified, with the
        // run in which it carries on once News answered (a hand-off comes back, Milestone 5); the run
        // the Chief started is told by the Chief in its chat (a late result is its turn, Milestone 7).
        #expect(!heard.posts.contains { $0.chat == "bot:\(news)" })
        #expect(!heard.posts.contains { $0.id == "run:\(theirs)" })
        #expect(heard.posts.allSatisfy { $0.chat == "bot:\(surfer)" || $0.chat.hasPrefix("chief:") })
        #expect(heard.posts.contains { $0.id == "run:\(own)" })
        #expect(heard.events.filter { $0 == "run_finished" }.count >= 4)
        #expect((try await server.api("bots/\(news)") as? [String: Any])?["unread"] as? Int == 0)
    }

    /// It waits for a real schedule: up to a minute.
    @Test func aQuietRunNeverNotifies() async throws {
        let server = try TestServer()
        try server.reply("") // nothing to say
        let id = try await server.makeBot("Parcels")
        let (store, heard) = try await app(server)
        defer { store.disconnect() }
        let job = try await server.api("bots/\(id)/jobs", method: "POST", body: ["name": "Parcels", "cron": "* * * * *", "prompt": "Check parcels"]) as? [String: Any]
        let jobId = try #require(job?["id"] as? String)
        try await eventually("the scheduled run to end", seconds: 80) { !heard.finished.isEmpty }
        try await server.api("bots/\(id)/jobs/\(jobId)", method: "PUT", body: ["enabled": false])

        let run = try #require(heard.finished.first)
        #expect(run["trigger"] as? String == "schedule")
        #expect(run["quiet"] as? Bool == true)
        #expect(heard.posts.isEmpty)
        #expect((try await server.api("bots/\(id)") as? [String: Any])?["unread"] as? Int == 0)
    }

    @Test func onlyAReplyTheServerCallsNewNotifies() {
        // A scheduled run with nothing to say, as the feed sends it: without `new`.
        let quiet = json(["id": "r1", "botId": "b1", "botName": "News", "status": "success", "result": "", "trigger": "schedule", "quiet": true])
        #expect(ReplyNotifications.step(event: "run_finished", data: quiet, followsUnread: true) == nil)
        #expect(ReplyNotifications.step(event: "run_finished", data: quiet, followsUnread: false) == nil)
        // No other event notifies, whatever it carries.
        let new = json(["id": "r1", "botId": "b1", "chatId": "c1", "chat": "bot:b1", "text": "Checking the weather", "new": true])
        for event in ["run_started", "opening_line", "chief_started", "chief_suggestion", "waiting", "bots", "approvals"] {
            #expect(ReplyNotifications.step(event: event, data: new, followsUnread: true) == nil)
        }
        #expect(ReplyNotifications.step(event: "run_finished", data: Data("not json".utf8), followsUnread: true) == nil)
    }

    @Test func aReplyToTheChatAnAppIsLookingAtDoesNotNotifyAnywhere() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let (here, heardHere) = try await app(server)
        let (other, heardOther) = try await app(server)
        defer { here.disconnect(); other.disconnect() }

        // The other app (the web page, the phone) shows the chat in front: read at once, for both.
        await other.show(chat: "bot:\(id)", inFront: true)
        try await server.runToEnd(id, "one")
        // It leaves: the next reply is new, and notifies in both.
        await other.show(chat: nil, inFront: true)
        let second = try await server.runToEnd(id, "two")
        try await eventually("the second reply's notification") { heardHere.posts.count == 1 && heardOther.posts.count == 1 }
        #expect(heardHere.posts.map(\.id) == ["run:\(second)"])
        #expect(heardOther.posts.map(\.id) == ["run:\(second)"])
        #expect(heardHere.events.filter { $0 == "run_finished" }.count == 2)
    }

    @Test func readingTheChatInAnotherAppRemovesItsNotificationWithinAMoment() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let quiet = try await server.makeBot("Quiet")
        let (here, heard) = try await app(server)
        let (other, _) = try await app(server)
        defer { here.disconnect(); other.disconnect() }
        try await server.runToEnd(id, "one")
        try await eventually("the notification") { heard.posts.count == 1 }
        #expect(heard.removed.isEmpty)

        // Opening a chat that has nothing new changes nothing for the notifications.
        await other.show(chat: "bot:\(quiet)", inFront: true)
        // The owner reads the chat on the web page or the phone.
        await other.show(chat: "bot:\(id)", inFront: true)
        try await eventually("the notification to go", seconds: 3) { heard.removed == ["bot:\(id)"] }
    }

    @Test func afterARestartTheNotificationsOfChatsReadMeanwhileGo() async throws {
        let server = try TestServer()
        let news = try await server.makeBot("News")
        let cook = try await server.makeBot("Cook")
        let gone = try await server.makeBot("Gone")
        try server.reply("Done.")
        for bot in [news, cook, gone] { try await server.runToEnd(bot, "one") }
        let made = try await server.api("chief/chats", method: "POST") as? [String: Any]
        let chat = try #require(made?["id"] as? String)
        try await server.api("chief/chats/\(chat)/messages", method: "POST", body: ["text": "Hello"])
        try await eventuallyAsync("the Chief's reply") { (try await server.api("chief") as? [String: Any])?["unread"] as? Int == 1 }

        // While the Mac app is closed, News is read on the phone and a bot is deleted.
        let (phone, _) = try await app(server)
        await phone.show(chat: "bot:\(news)", inFront: true)
        phone.disconnect()
        try await server.api("bots/\(gone)", method: "DELETE")

        // The app starts again with four reply notifications and a "Needs you" one still delivered.
        let (store, heard) = try await app(server)
        defer { store.disconnect() }
        #expect(heard.steps == [.catchUp(rebuild: false)])
        let delivered = ["bot:\(news)", "bot:\(cook)", "bot:\(gone)", "chief:\(chat)", "need:job:1"]
        #expect(Set(await store.notificationCatchUp(showing: delivered, rebuild: false)?.remove ?? []) == ["bot:\(news)", "bot:\(gone)"])

        // The Chief chat is read too: next time its notification goes as well.
        let (web, _) = try await app(server)
        await web.show(chat: "chief:\(chat)", inFront: true)
        web.disconnect()
        #expect(Set(await store.notificationCatchUp(showing: delivered, rebuild: false)?.remove ?? []) == ["bot:\(news)", "bot:\(gone)", "chief:\(chat)"])

        // A server that can't be asked says nothing: nothing is removed, and what is owed stays owed.
        server.stop()
        #expect(await store.notificationCatchUp(showing: delivered, rebuild: true) == nil)
    }

    @Test func afterAResetOrAStartAChatWithNewRepliesAndNoNotificationGetsOneAgain() async throws {
        let server = try TestServer()
        let news = try await server.makeBot("News")
        let cook = try await server.makeBot("Cook")
        let calm = try await server.makeBot("Calm")
        try server.reply("Found 3 articles.")
        let first = try await server.runToEnd(news, "any news?")
        try server.reply("And two more.")
        try await server.runToEnd(news, "more?")
        try server.fail("boom")
        let failed = try await server.runToEnd(cook, "dinner?")
        let made = try await server.api("chief/chats", method: "POST") as? [String: Any]
        let chat = try #require(made?["id"] as? String)
        try await server.api("chief/chats/\(chat)/messages", method: "POST", body: ["text": "Make me a news bot"])
        try await eventuallyAsync("the Chief's reply") { (try await server.api("chief") as? [String: Any])?["unread"] as? Int == 1 }

        // The app starts with no notification delivered, or its feed says `reset`: each chat with new
        // replies gets one, showing the first of them. A chat with nothing new gets none.
        let (store, _) = try await app(server)
        defer { store.disconnect() }
        let plan = try #require(await store.notificationCatchUp(showing: [], rebuild: true))
        #expect(plan.remove == [])
        #expect(plan.post.count == 3)
        #expect(plan.post.first { $0.chat == "bot:\(news)" } == ReplyNotification(chat: "bot:\(news)", id: "run:\(first)", title: "News", body: "Found 3 articles."))
        let cooks = try #require(plan.post.first { $0.chat == "bot:\(cook)" })
        #expect(cooks.id == "run:\(failed)")
        #expect(cooks.title == "Cook")
        #expect(!cooks.body.isEmpty)
        // The stand-in Claude still fails: the Chief's reply says what went wrong, as its live notification would.
        let chiefs = try #require(plan.post.first { $0.chat == "chief:\(chat)" })
        #expect(chiefs.id == "chief:\(chat)")
        #expect(chiefs.title == "Chief of Staff")
        #expect(chiefs.body.contains("boom"))
        #expect(!plan.post.contains { $0.chat == "bot:\(calm)" })

        // One that still has its notification keeps it; the chat on screen in front gets none (the
        // server is about to hear that it is read); what needs you is not a chat.
        let some = try #require(await store.notificationCatchUp(showing: ["bot:\(news)", "need:job:1"], rebuild: true, watching: "chief:\(chat)"))
        #expect(some.post.map(\.chat) == ["bot:\(cook)"])
        #expect(some.remove == [])

        // `hello` after a replay: the feed brought what was missed, so nothing is posted.
        #expect(await store.notificationCatchUp(showing: [], rebuild: false) == NotificationCatchUp())

        // Read in another app meanwhile: nothing for that chat, and its old notification goes.
        let (phone, _) = try await app(server)
        await phone.show(chat: "bot:\(news)", inFront: true)
        phone.disconnect()
        let after = try #require(await store.notificationCatchUp(showing: ["bot:\(news)"], rebuild: true))
        #expect(after.remove == ["bot:\(news)"])
        #expect(Set(after.post.map(\.chat)) == ["bot:\(cook)", "chief:\(chat)"])
    }

    @Test func theChatsOwedANotification() {
        #expect(ReplyNotifications.owed(showing: ["bot:a", "need:job:1"], unread: ["bot:a", "bot:b", "chief:c"]) == ["bot:b", "chief:c"])
        #expect(ReplyNotifications.owed(showing: [], unread: ["bot:b", "chief:c"], watching: "chief:c") == ["bot:b"])
        #expect(ReplyNotifications.owed(showing: ["bot:b"], unread: []) == [])
    }

    @Test func aServerWithoutNewRepliesNotifiesAsBefore() async throws {
        let server = try TestServer()
        try server.reply("Found 3 articles.")
        let id = try await server.makeBot("News")
        let watching = Watching()
        let store = Store()
        let heard = Heard()
        store.onEvent = { [weak store] name, data in
            heard.events.append(name)
            if let step = store?.notificationStep(name, data, watching: watching.chat) { heard.steps.append(step) }
        }
        try await store.connect(to: server.base.absoluteString)
        defer { store.disconnect() }
        try await eventually("the live feed") { heard.events.contains("hello") }
        // Events are handled one after the other: once a later one is heard, the feed's start (which
        // reads the server's features) is over.
        let watched = try await server.makeBot("Watched")
        watching.chat = "bot:\(watched)"
        try await eventually("the feed's start to be over") { heard.events.contains("bots") }
        // From here the app takes it for a botdot server from before: no `unread` in its features.
        // The test server still sends `new` and `unread`, which such an app does not look at.
        store.followsUnread = false
        #expect(heard.steps == [.catchUp(rebuild: false)])
        #expect(store.readNow(among: ["bot:\(id)", "bot:gone", "chief:gone"]) == []) // it doesn't say what is read

        // A finished run notifies; one in the chat this app shows does not.
        let run = try await server.runToEnd(id, "any news?")
        try await server.runToEnd(watched, "and here?")
        try await eventually("both runs") { heard.events.filter { $0 == "run_finished" }.count == 2 }
        #expect(heard.posts == [ReplyNotification(chat: "bot:\(id)", id: "run:\(run)", title: "News", body: "Found 3 articles.")])
        #expect(heard.removed.isEmpty) // `unread` is not followed

        // Opened somewhere else: `chat_seen` removes it.
        await store.present(chat: "bot:\(id)")
        try await eventually("the notification to go") { heard.removed == ["bot:\(id)"] }

        // The web page is in use and this app is not: it stays silent. While this app is used, it doesn't.
        let finished = json(["id": "r9", "botId": id, "botName": "News", "jobName": "Morning news", "status": "error", "error": "boom", "webActive": true, "new": true])
        #expect(ReplyNotifications.step(event: "run_finished", data: finished, followsUnread: false, usedLately: false) == nil)
        #expect(ReplyNotifications.step(event: "run_finished", data: finished, followsUnread: false, usedLately: true)
            == .post(ReplyNotification(chat: "bot:\(id)", id: "run:r9", title: "News · Morning news", body: "Didn't finish: boom")))
        let passedOn = json(["id": "r9", "botId": id, "status": "success", "result": "Hi", "passedOn": true])
        #expect(ReplyNotifications.step(event: "run_finished", data: passedOn, followsUnread: false) == nil)
        let reply = json(["chatId": "c1", "text": "Hi", "from": ["name": "News"], "webActive": true])
        #expect(ReplyNotifications.step(event: "chief_reply", data: reply, followsUnread: false, usedLately: true)
            == .post(ReplyNotification(chat: "chief:c1", id: "chief:c1", title: "News", body: "Hi")))
        #expect(ReplyNotifications.step(event: "chief_reply", data: reply, followsUnread: false, watching: "chief:c1", usedLately: true) == nil)
    }

    @Test func aServerWithNewRepliesIsNotAskedWhatAppsFromBeforeAre() {
        // `webActive`, the chat this app shows and `chat_seen` are not part of unread state.
        let new = json(["id": "r1", "botId": "b1", "botName": "News", "status": "success", "result": "Hi", "webActive": true, "new": true])
        #expect(ReplyNotifications.step(event: "run_finished", data: new, followsUnread: true, watching: "bot:b1", usedLately: false)
            == .post(ReplyNotification(chat: "bot:b1", id: "run:r1", title: "News", body: "Hi")))
        let seen = json(["chat": "bot:b1"])
        #expect(ReplyNotifications.step(event: "chat_seen", data: seen, followsUnread: true) == nil)
        #expect(ReplyNotifications.step(event: "chat_seen", data: seen, followsUnread: false) == .remove(chat: "bot:b1"))
        // `unread` removes only when nothing is left, and only on a server that has it.
        let left = json(["chat": "bot:b1", "unread": 1, "firstUnread": "r1"])
        let read = json(["chat": "bot:b1", "unread": 0])
        #expect(ReplyNotifications.step(event: "unread", data: left, followsUnread: true) == nil)
        #expect(ReplyNotifications.step(event: "unread", data: read, followsUnread: true) == .remove(chat: "bot:b1"))
        #expect(ReplyNotifications.step(event: "unread", data: read, followsUnread: false) == nil)
        // The feed started (again): what was read meanwhile goes; the server is asked then.
        // `reset` replayed nothing: the notifications of new replies are owed again.
        #expect(ReplyNotifications.step(event: "reset", data: json([:]), followsUnread: true) == .catchUp(rebuild: true))
        #expect(ReplyNotifications.step(event: "hello", data: json([:]), followsUnread: true) == .catchUp(rebuild: false))
        #expect(ReplyNotifications.step(event: "hello", data: json([:]), followsUnread: false) == .catchUp(rebuild: false))
    }
}

/// The lines that stand while botdot cannot work (#379): no answer from botdot, and Claude signed out.
@MainActor
@Suite struct StandingLines {
    static let says: Set<String> = [Feature.messageWaits.rawValue]
    func data(_ json: String) -> Data { Data(json.utf8) }

    @Test func theFeedSaysWhetherClaudeIsSignedOut() {
        var c = ClaudeSignIn()
        c.heard("hello", id: nil, data(#"{"lastEventId":"b1.10","claude":{"loggedIn":false}}"#), features: Self.says)
        #expect(c.signedOut)
        // An event the feed replays from before its first message is older than it.
        c.heard("claude", id: "b1.9", data(#"{"loggedIn":true}"#), features: Self.says)
        #expect(c.signedOut)
        c.heard("claude", id: "b1.11", data(#"{"loggedIn":true}"#), features: Self.says)
        #expect(!c.signedOut)
        c.heard("claude", id: "b1.12", data(#"{"loggedIn":false}"#), features: Self.says)
        #expect(c.signedOut)
        // A check that could not tell keeps what was known.
        c.heard("hello", id: nil, data(#"{"lastEventId":"b1.20","claude":null}"#), features: Self.says)
        #expect(c.signedOut)
        c.heard("claude", id: "b1.21", data(#"{"loggedIn":"no"}"#), features: Self.says)
        #expect(c.signedOut)
        // A server from before the line holds nothing as signed out: no line.
        c.heard("hello", id: nil, data(#"{"claude":{"loggedIn":false}}"#), features: [])
        #expect(!c.signedOut)
        c.heard("claude", id: "b1.30", data(#"{"loggedIn":false}"#), features: [])
        #expect(!c.signedOut)
    }

    @Test func noAnswerFromBotdotComesBeforeASignedOutClaude() async throws {
        let store = Store()
        #expect(store.standing == nil)
        store.claude.heard("hello", id: nil, data(#"{"claude":{"loggedIn":false}}"#), features: Self.says)
        #expect(store.standing == .signedOut && Standing.signedOut.text == "Claude is signed out: bots can't work.")
        store.away = true
        #expect(store.standing == .away && Standing.away.text == "Can't reach botdot. Trying again…" && Standing.away.short == "Can't reach botdot")
    }

    // The line stands from the feed's end until botdot speaks again.
    @Test func theLineStandsWhileTheFeedIsDown() async throws {
        let server = try TestServer()
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the feed to open") { !store.away }
        server.stop()
        try await eventually("the line", seconds: 15) { store.away }
        store.disconnect()
        #expect(!store.away)
    }

    @Test func aGroupsMessageWaitsWholeWhileClaudeIsSignedOut() throws {
        let m = try #require(GroupMessage(json: ["id": "m1", "text": "hi", "at": "2026-10-12T10:00:00.000Z", "canTakeBack": true] as [String: Any]))
        #expect(!GroupWords.waitsWhole(m, []) && GroupWords.waitsWhole(m, [], signedOut: true))
    }
}
