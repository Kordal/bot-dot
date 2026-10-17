import Foundation
import Testing
@testable import BotDotKit

/// Milestone 8 on the Mac, a bot that asks (docs/api.md, "A bot that asks"): the list says "Asks: …"
/// and its notification carries the question. The server says who asks; the app draws it.
@MainActor
@Suite struct BotAsksYou {
    static let bots = ##"""
    [{ "id": "mail", "name": "Mail Sorter", "color": "#378add", "state": "needs_you", "asks": { "text": "Should I send the **digest** now?", "runId": "r1", "at": "2026-10-06T09:00:00.000Z" } },
     { "id": "news", "name": "News Watcher", "state": "idle" }]
    """##

    func store(_ bots: String = BotAsksYou.bots, features: Set<String> = [Feature.asksYou.rawValue]) throws -> Store {
        let store = Store()
        store.features = features
        store.bots = try JSONDecoder().decode([Bot].self, from: Data(bots.utf8))
        return store
    }
    func feed(_ store: Store, _ event: String, _ data: String) async { await store.handle(ServerSentEvent(event: event, data: data)) }
    func step(_ data: String, asksYou: Bool = true) -> ReplyNotification? {
        guard case .post(let n) = ReplyNotifications.step(event: "run_finished", data: Data(data.utf8), followsUnread: true, asksYou: asksYou) else { return nil }
        return n
    }

    // MARK: the list

    @Test func aBotThatAsksShowsAsksInTheList() throws {
        let store = try store()
        #expect(store.bots[0].asks?.runId == "r1")
        // One line, as text: what a bot writes is never markup.
        #expect(store.asksLine(store.bots[0]) == "Asks: Should I send the digest now?")
        #expect(store.asksLine(store.bots[1]) == nil)
        // While it works its row says what it does.
        let working = try self.store(Self.bots.replacingOccurrences(of: #""state": "needs_you""#, with: #""state": "working", "running": true"#))
        #expect(working.asksLine(working.bots[0]) == nil)
        let run = try JSONDecoder().decode(RunSummary.self, from: Data(#"{ "id": "r2", "botId": "mail", "status": "running" }"#.utf8))
        #expect(store.asksLine(store.bots[0], lastRun: run) == nil)
        // A long question is cut for the row.
        let long = try self.store(Self.bots.replacingOccurrences(of: "Should I send the **digest** now?", with: String(repeating: "word ", count: 60)))
        #expect(long.asksLine(long.bots[0])?.count == 6 + 120)
    }

    @Test func theFeedSetsAndClearsTheQuestionAtOnce() async throws {
        let store = try store()
        await feed(store, "asks", #"{ "botId": "news", "asks": { "text": "Which paper?", "runId": "r7", "at": "2026-10-06T10:00:00.000Z" } }"#)
        #expect(store.asksLine(store.bots[1]) == "Asks: Which paper?")
        // The owner wrote to it, or tapped an answer: the question ended.
        await feed(store, "asks", #"{ "botId": "mail", "asks": null }"#)
        #expect(store.bots[0].asks == nil && store.asksLine(store.bots[0]) == nil)
        #expect(store.asksLine(store.bots[1]) == "Asks: Which paper?")
        // The event of the same name about what waits in Needs you names no bot and changes nothing here.
        await feed(store, "asks", #"{ "waiting": 1, "list": [{ "id": "a1", "text": "Asks to install gh" }] }"#)
        #expect(store.asksLine(store.bots[1]) == "Asks: Which paper?")
        // One this app can't read changes nothing either.
        for odd in [#"{ "botId": "news" }"#, #"{ "botId": 7, "asks": null }"#, #"{ "botId": "gone", "asks": null }"#, "not json"] {
            await feed(store, "asks", odd)
            #expect(store.asksLine(store.bots[1]) == "Asks: Which paper?", "\(odd)")
        }
    }

    @Test func aQuestionThisAppCannotReadIsNoneAndTheBotsAreStillRead() throws {
        for odd in [#""a question""#, "true", "7", #"["a"]"#, #"{ "runId": "r1" }"#, #"{ "text": "  " }"#, #"{ "text": { "a": 1 } }"#, "null"] {
            let store = try store(Self.bots.replacingOccurrences(of: #""asks": {"#, with: #""asks": \#(odd), "was": {"#))
            #expect(store.bots.count == 2, "\(odd)")
            #expect(store.asksLine(store.bots[0]) == nil, "\(odd)")
        }
    }

    @Test func aServerWithoutAsksYouShowsTheListAsBefore() throws {
        // The field is there all the same: the app asks `features` before it uses it.
        let store = try store(features: [])
        #expect(store.bots[0].asks != nil)
        #expect(store.asksLine(store.bots[0]) == nil)
    }

    // MARK: the notification

    static let asked = ##"{ "id": "r1", "botId": "mail", "botName": "Mail Sorter", "jobName": "Digest", "status": "success", "new": true, "asks": true, "title": "Mail Sorter asks", "question": "Should I send the digest now?", "result": "I found two drafts.\nShould I send the digest now?" }"##

    @Test func theNotificationOfABotThatAsksCarriesTheQuestion() throws {
        let n = try #require(step(Self.asked))
        #expect(n.title == "Mail Sorter asks") // the server's title, in place of the bot's name and its job's
        #expect(n.body == "Should I send the digest now?")
        #expect(n.chat == "bot:mail" && n.id == "run:r1") // a click opens the chat, where the answers are

        // Without the server's title: "<bot> asks". Without its question: the reply, as before.
        #expect(step(Self.asked.replacingOccurrences(of: #""title": "Mail Sorter asks", "#, with: ""))?.title == "Mail Sorter asks")
        #expect(step(Self.asked.replacingOccurrences(of: #""title": "Mail Sorter asks", "#, with: #""title": " ", "#))?.title == "Mail Sorter asks")
        let bare = try #require(step(Self.asked.replacingOccurrences(of: #""question": "Should I send the digest now?", "#, with: "")))
        #expect(bare.title == "Mail Sorter asks" && bare.body == "I found two drafts.\nShould I send the digest now?")

        // A run that does not ask notifies as a reply does, and `asks` in quotes says nothing.
        for none in [#""asks": false"#, #""asks": "true""#, #""was": true"#] {
            let plain = try #require(step(Self.asked.replacingOccurrences(of: #""asks": true"#, with: none)), "\(none)")
            #expect(plain.title == "Mail Sorter · Digest" && plain.body == "I found two drafts.\nShould I send the digest now?", "\(none)")
        }
        // The server still decides whether it notifies at all.
        #expect(step(Self.asked.replacingOccurrences(of: #""new": true, "#, with: "")) == nil)
    }

    @Test func aServerWithoutAsksYouNotifiesAsBefore() throws {
        let n = try #require(step(Self.asked, asksYou: false))
        #expect(n.title == "Mail Sorter · Digest")
        #expect(n.body == "I found two drafts.\nShould I send the digest now?")
        // The store asks its server's `features`.
        let old = try store(features: [])
        old.followsUnread = true
        #expect(old.notificationStep("run_finished", Data(Self.asked.utf8)) == .post(n))
        let new = try store()
        new.followsUnread = true
        guard case .post(let asks) = new.notificationStep("run_finished", Data(Self.asked.utf8)) else { Issue.record("no notification"); return }
        #expect(asks.title == "Mail Sorter asks")
    }

    @Test func aRunSaysThatItAsks() throws {
        let runs = try JSONDecoder().decode([RunSummary].self, from: Data(#"""
        [{ "id": "r1", "botId": "mail", "status": "success", "asks": true, "title": "Mail Sorter asks", "question": "Send it?" },
         { "id": "r2", "botId": "mail", "status": "success" }, { "id": "r3", "botId": "mail", "status": "success", "asks": "true", "title": 7, "question": ["a"] }]
        """#.utf8))
        #expect(runs.map { $0.asks?.value == true } == [true, false, false])
        #expect(runs[0].question?.text == "Send it?")
    }
}

/// The same against a real botdot test server and the stand-in Claude.
@MainActor
@Suite struct BotAsksYouOnAServer {
    @MainActor final class Heard { var events: [String] = []; var posts: [ReplyNotification] = [] }

    @Test func aBotAsksUntilTheOwnerWritesToIt() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Mail Sorter")
        let store = Store()
        let heard = Heard()
        store.onEvent = { name, data in
            Task { @MainActor in
                heard.events.append(name)
                if case .post(let n) = store.notificationStep(name, data) { heard.posts.append(n) }
            }
        }
        try await store.connect(to: server.base.absoluteString)
        defer { store.disconnect() }
        try await eventually("the live feed") { heard.events.contains("hello") } // a run that ends before it is listened to notifies nobody
        #expect(store.has(.asksYou)) // read from the server's `features`
        let bot = { store.bots.first { $0.id == id } }
        #expect(bot().flatMap { store.asksLine($0) } == nil)

        // A reply that ends in answer buttons: the bot asks, in the list and in its notification.
        try server.reply("I found two drafts.\nShould I send the digest now?\n\n[[choices: Yes | No]]")
        try await server.runToEnd(id, "make the digest")
        try await eventually("the list to say that it asks") { bot().flatMap { store.asksLine($0, lastRun: store.recentRuns.first { $0.botId == id }) } != nil }
        #expect(bot().flatMap { store.asksLine($0) } == "Asks: Should I send the digest now?")
        #expect(bot()?.state == "needs_you")
        try await eventually("its notification") { !heard.posts.isEmpty }
        #expect(heard.posts.first?.title == "Mail Sorter asks")
        #expect(heard.posts.first?.body == "Should I send the digest now?")
        #expect(store.recentRuns.first { $0.botId == id }?.asks?.value == true)

        // Any message of the owner's to that bot answers it: the mark goes.
        try server.reply("Sent.")
        try await server.runToEnd(id, "Yes")
        try await eventually("the question to end") { bot()?.asks == nil && bot()?.running != true }
        #expect(bot().flatMap { store.asksLine($0) } == nil)
    }
}
