import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct ChiefChat {
    @Test func pendingActivityAndStreamKeepTheServersWords() throws {
        let chat = try JSON.decoder.decode(BotDotKit.ChiefChat.self, from: Data(#"{"id":"c1","busy":true,"messages":[{"role":"chief","pending":true,"activity":{"tool":"wait_for_run","text":"Waiting for Proxmox Keeper"}}]}"#.utf8))
        let saved = try #require(chat.messages.last?.activity)
        #expect(ChiefActivity.text(for: saved.tool, text: saved.text) == "Waiting for Proxmox Keeper…")
        let event = try JSON.decoder.decode(ChiefStreamEvent.self, from: Data(#"{"type":"activity","tool":"thinking","text":"Thinking"}"#.utf8))
        #expect(ChiefActivity.text(for: event.tool, text: event.text) == "Thinking…")
        let legacy = try JSON.decoder.decode(ChiefStreamEvent.self, from: Data(#"{"type":"activity","tool":"wait_for_run"}"#.utf8))
        #expect(ChiefActivity.text(for: legacy.tool, text: legacy.text) == "Waiting for the bot to finish…")
        let oldChat = try JSON.decoder.decode(BotDotKit.ChiefChat.self, from: Data(#"{"id":"c1","messages":[{"role":"chief","pending":true}]}"#.utf8))
        #expect(oldChat.messages.last?.activity == nil)
    }

    @Test func aChatWithAFailedReportLoads() throws {
        // A bot's report that didn't finish has `error: true`; the Chief's own failed reply has words.
        let chat = try JSON.decoder.decode(BotDotKit.ChiefChat.self, from: Data(#"""
        {"id":"c1","messages":[
          {"role":"report","from":{"id":"b1","name":"News"},"text":"It timed out.","runId":"r1","error":true},
          {"role":"chief","text":"","error":"Claude stopped"},
          {"role":"report","from":{"id":"b1","name":"News"},"text":"Done.","runId":"r2"}
        ]}
        """#.utf8))
        #expect(chat.messages.map(\.failed) == [true, true, false])
        #expect(chat.messages[0].error == nil)
        #expect(chat.messages[0].text == "It timed out.")
        #expect(chat.messages[1].error == "Claude stopped")
        #expect(chat.messages[2].error == nil)
    }

    @Test func aFailedReportLoadsFromTheServer() async throws {
        let server = try TestServer()
        try server.writeChat("failed", [
            ["role": "user", "text": "Ask News", "at": "2026-10-01T09:00:00.000Z"],
            ["role": "report", "from": ["id": "b1", "name": "News", "color": "#378add"], "text": "It timed out.", "runId": "r1", "error": true, "at": "2026-10-01T09:01:00.000Z"],
        ])
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        store.openChief(chatId: "failed")
        try await eventually("the chat to load") { store.chief.messages.count == 2 }
        #expect(store.chief.messages[1].failed)
        #expect(store.chief.messages[1].text == "It timed out.")
        #expect(store.problem == nil)
    }

    @Test func unaskedAndRatingAreReadAndOlderMessagesLackThem() throws {
        let chat = try JSON.decoder.decode(BotDotKit.ChiefChat.self, from: Data(#"""
        {"id":"c1","offset":3,"messages":[
          {"role":"chief","text":"A tip.","unasked":true,"rating":"up"},
          {"role":"chief","text":"Another.","unasked":true,"rating":"sideways"},
          {"role":"chief","text":"Asked for."}
        ]}
        """#.utf8))
        #expect(chat.offset == 3)
        #expect(chat.messages.map(\.unasked) == [true, true, nil])
        #expect(chat.messages.map(\.rating) == ["up", nil, nil])
        #expect(chat.messages.map(\.failed) == [false, false, false])
    }

    @Test func aClickFillsClearsOrMovesTheRating() {
        #expect(Ratings.next(nil, "up") == "up")
        #expect(Ratings.next("up", "up") == nil)
        #expect(Ratings.next("up", "down") == "down")
        #expect(Ratings.next("down", "down") == nil)
        #expect(Ratings.next("down", "sideways") == "down")
        #expect(Ratings.label["up"] == "More like this")
        #expect(Ratings.label["down"] == "Less like this")
    }

    @Test func onlyUnaskedChiefMessagesFromARatingServerGetThumbs() {
        let unasked = ChiefMessage(role: "chief", text: "A tip.", unasked: true)
        #expect(Ratings.shows(unasked, rates: true))
        #expect(!Ratings.shows(unasked, rates: false)) // a server without `ratings`
        #expect(!Ratings.shows(ChiefMessage(role: "chief", text: "Asked for."), rates: true))
        #expect(!Ratings.shows(ChiefMessage(role: "user", text: "Hi", unasked: true), rates: true))
        #expect(!Ratings.shows(ChiefMessage(role: "chief", unasked: true, pending: true), rates: true))
    }

    @Test func aRatingIsStoredClearedAndMoved() async throws {
        let server = try TestServer()
        try server.writeChat("tips", [
            ["role": "chief", "text": "Asked for.", "at": "2026-10-01T09:00:00.000Z"],
            ["role": "chief", "text": "A tip.", "at": "2026-10-01T10:00:00.000Z", "unasked": true],
        ])
        let connected = Store()
        try await connected.connect(to: server.base.absoluteString)
        #expect(connected.rates)
        connected.disconnect()
        // The clicks are made in a store that follows no feed. On the feed each rating comes back as
        // an event, and one that is late puts the rating before over the next click's; the reload
        // after `hello` can do the same. What the feed brings is `aRatingMadeInAnotherAppShows`.
        let store = Store()
        store.api = API(base: server.base)
        store.openChief(chatId: "tips")
        try await eventually("the chat to load") { store.chief.messages.count == 2 }
        func saved() async throws -> Any? {
            let chat = try await server.api("chief/chats/tips") as? [String: Any]
            return ((chat?["messages"] as? [[String: Any]])?[1])?["rating"]
        }

        await store.rate(1, "up")
        #expect(store.chief.messages[1].rating == "up")
        #expect(try await saved() as? String == "up")
        await store.rate(1, "down")
        #expect(store.chief.messages[1].rating == "down")
        #expect(try await saved() as? String == "down")
        await store.rate(1, "down")
        #expect(store.chief.messages[1].rating == nil)
        #expect(try await saved() == nil)
        #expect(store.problem == nil)
    }

    @Test func aRefusedOrUnsentRatingGoesBack() async throws {
        let server = try TestServer()
        try server.writeChat("tips", [
            ["role": "chief", "text": "Asked for.", "at": "2026-10-01T09:00:00.000Z"],
            ["role": "chief", "text": "A tip.", "at": "2026-10-01T10:00:00.000Z", "unasked": true, "rating": "up"],
        ])
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        store.openChief(chatId: "tips")
        try await eventually("the chat to load") { store.chief.messages.count == 2 }

        // The server refuses: the message wasn't written unasked.
        await store.rate(0, "up")
        #expect(store.chief.messages[0].rating == nil)
        #expect(store.problem == "Couldn't save your rating.")
        store.problem = nil

        // The server can't be reached.
        server.stop()
        await store.rate(1, "down")
        #expect(store.chief.messages[1].rating == "up")
        #expect(store.problem == "Couldn't save your rating.")
    }

    @Test func aRatingMadeInAnotherAppShows() async throws {
        let server = try TestServer()
        try server.writeChat("tips", [
            ["role": "chief", "text": "A tip.", "at": "2026-10-01T10:00:00.000Z", "unasked": true],
        ])
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        store.openChief(chatId: "tips")
        try await eventually("the chat to load") { store.chief.messages.count == 1 }

        try await server.api("chief/chats/tips/messages/0/rating", method: "PUT", body: ["rating": "down"])
        try await eventually("the rating from the feed") { store.chief.messages[0].rating == "down" }
        try await server.api("chief/chats/tips/messages/0/rating", method: "PUT", body: ["rating": NSNull()])
        try await eventually("the cleared rating from the feed") { store.chief.messages[0].rating == nil }

        // A rating in another chat leaves this one alone.
        store.ratingChanged(Data(#"{"chatId":"other","index":0,"rating":"up"}"#.utf8))
        #expect(store.chief.messages[0].rating == nil)
    }

    @Test func aMessageToTheChiefGetsItsReply() async throws {
        let server = try TestServer()
        try server.reply("Here's the plan.")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)

        store.openChief(chatId: nil) // a new chat
        try await store.sendToChief("Make me a news bot")

        #expect(store.chief.chatId != nil)
        #expect(store.chief.messages.first?.role == "user")
        #expect(store.chief.messages.first?.text == "Make me a news bot")
        try await eventually("the Chief's reply") { store.chief.messages.last?.text == "Here's the plan." }
        #expect(!store.chief.busy)
        #expect(store.chiefChats.contains { $0.id == store.chief.chatId })
    }

    @Test func whileTheChiefWorksItsReplyIsPending() async throws {
        let server = try TestServer()
        try server.hold()
        try server.steps([("mcp__botdot__wait_for_run", ["run_id": "held-run"])])
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        store.openChief(chatId: nil)
        try await store.sendToChief("Hello")
        #expect(store.chief.busy)
        #expect(store.chief.messages.last?.pending == true)
        try await eventually("live waiting activity") { store.chief.activity == "Waiting for the bot to finish…" }
        let reopened = Store()
        try await reopened.connect(to: server.base.absoluteString)
        reopened.openChief(chatId: store.chief.chatId)
        try await eventually("saved activity after reopening") {
            reopened.chief.messages.last?.activity?.text == "Waiting for the bot to finish" &&
                reopened.chief.activity == "Waiting for the bot to finish…"
        }
        try server.unhold()
        try await eventually("the reply") { !store.chief.busy && store.chief.messages.last?.pending != true }
        #expect(store.chief.activity == nil)
        try await eventually("reopened chat clears activity") { !reopened.chief.busy && reopened.chief.activity == nil }
    }

    @Test func openingAnEarlierChatShowsItsMessages() async throws {
        let server = try TestServer()
        try server.reply("First answer.")
        let first = Store()
        try await first.connect(to: server.base.absoluteString)
        first.openChief(chatId: nil)
        try await first.sendToChief("First question")
        try await eventually("the first reply") { first.chief.messages.last?.text == "First answer." }

        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        store.openChief(chatId: first.chief.chatId)
        try await eventually("the chat to load") { store.chief.messages.map(\.text) == ["First question", "First answer."] }
    }
}
