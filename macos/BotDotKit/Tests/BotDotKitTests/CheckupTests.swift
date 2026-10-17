import Foundation
import Testing
@testable import BotDotKit

/// The Chief's checkup (docs/api.md "The Chief's checkup"): what its setting and its message read as,
/// without a server; the suite below asks real botdot servers.
@Suite struct CheckupWords {
    @Test func theSettingIsReadWithWhatThisAppDoesNotKnow() throws {
        let c = try JSON.decoder.decode(CheckupSetting.self, from: Data(#"""
        {"on":true,"days":[1,4],"time":"07:30","webSearch":true,"when":"Mondays and Thursdays at 07:30","timeZone":"Europe/Brussels","lastRanAt":null,"later":{"a":1}}
        """#.utf8))
        #expect(c.on && c.webSearch)
        #expect(c.days == [1, 4] && c.time == "07:30" && c.timeZone == "Europe/Brussels" && c.lastRanAt == nil)
        #expect(c.line == "Mondays and Thursdays at 07:30. Ask the Chief to change it.")
    }

    @Test func aFieldThisAppCannotReadCostsOnlyThatField() throws {
        let c = try JSON.decoder.decode(CheckupSetting.self, from: Data(#"{"on":false,"days":"weekdays","time":8,"when":7}"#.utf8))
        #expect(!c.on && !c.webSearch)
        #expect(c.days == nil && c.time == nil)
        #expect(c.line == "Ask the Chief to change it.") // no words from the server: none are made up here
        // Without `on` there is no switch to draw.
        #expect((try? JSON.decoder.decode(CheckupSetting.self, from: Data(#"{"when":"Weekdays at 08:00"}"#.utf8))) == nil)
    }

    @Test func aCheckupsMessageIsAReplyWithAnswerButtonsAndNoThumbs() throws {
        let chat = try JSON.decoder.decode(BotDotKit.ChiefChat.self, from: Data(#"""
        {"id":"c1","title":"Checkup, 12 Oct","messages":[
          {"role":"chief","text":"2 things I would change after this checkup:","at":"2026-10-12T08:00:00.000Z","checkup":true,"choices":["Do 1","Do all","Not now"],"startedBy":"botdot","later":[1]},
          {"role":"chief","text":"A tip.","unasked":true}
        ]}
        """#.utf8))
        let m = chat.messages[0]
        #expect(m.checkup == true && m.unasked == nil && m.rating == nil)
        #expect(m.choices == ["Do 1", "Do all", "Not now"])
        #expect(!Ratings.shows(m, rates: true))
        #expect(chat.messages[1].checkup == nil && Ratings.shows(chat.messages[1], rates: true))
        // Never rated, whatever else a server says of it.
        #expect(!Ratings.shows(ChiefMessage(role: "chief", text: "Proposals.", unasked: true, checkup: true), rates: true))
    }
}

/// The same against real botdot test servers and the stand-in Claude.
@MainActor
@Suite struct CheckupOnAServer {
    @MainActor final class Heard { var events: [String] = [] }

    /// A store that asks that server and follows no feed: a click's own `checkup` event, when it is
    /// late, would put the setting of before over the next click's (as with a rating, ChiefChatTests).
    func asking(_ server: TestServer) async -> Store {
        let store = Store()
        store.api = API(base: server.base)
        store.features = [Feature.checkup.rawValue]
        await store.loadCheckup()
        return store
    }

    func saved(_ server: TestServer) async throws -> [String: Any] {
        let answer = try await server.api("settings/checkup") as? [String: Any]
        return try #require(answer?["checkup"] as? [String: Any])
    }

    @Test func theSettingIsReadWhenConnecting() async throws {
        let server = try TestServer()
        let store = Store()
        defer { store.disconnect() }
        try await store.connect(to: server.base.absoluteString)
        #expect(store.has(.checkup))
        let c = try #require(store.checkup)
        #expect(c.on && !c.webSearch)
        #expect(c.when == "Weekdays at 08:00" && c.days == [1, 2, 3, 4, 5] && c.time == "08:00" && c.lastRanAt == nil)
        #expect(c.line == "Weekdays at 08:00. Ask the Chief to change it.")
    }

    @Test func eachSwitchIsChangedAndReadBack() async throws {
        let server = try TestServer()
        let store = await asking(server)
        #expect(store.checkup?.on == true && store.checkup?.webSearch == false)

        await store.setCheckup(webSearch: true)
        #expect(store.checkup?.webSearch == true && store.checkup?.on == true)
        #expect(try await saved(server)["webSearch"] as? Bool == true)
        await store.setCheckup(on: false)
        #expect(store.checkup?.on == false && store.checkup?.webSearch == true) // only what was named changed
        #expect(try await saved(server)["on"] as? Bool == false)
        await store.setCheckup(on: true)
        await store.setCheckup(webSearch: false)
        let now = try await saved(server)
        #expect(now["on"] as? Bool == true && now["webSearch"] as? Bool == false)
        #expect(store.checkup?.when == "Weekdays at 08:00")
        #expect(store.problem == nil)
    }

    @Test func aRefusedOrUnsentChangeGoesBackAndSaysWhy() async throws {
        let server = try TestServer()
        let store = await asking(server)
        let before = try #require(store.checkup)

        // Refused by the server: its own sentence, and the switch as it was.
        await store.changeCheckup(["on": false, "time": "8 o'clock"]) { $0.on = false }
        #expect(store.checkup == before)
        #expect(store.problem?.isEmpty == false && store.problem?.hasPrefix("botdot answered") == false)
        #expect(try await saved(server)["on"] as? Bool == true)

        // Not sent at all: the server is gone.
        store.problem = nil
        server.stop()
        await store.setCheckup(webSearch: true)
        #expect(store.checkup == before)
        #expect(store.problem != nil)
    }

    @Test func aChangeMadeElsewhereMovesTheSwitches() async throws {
        let server = try TestServer()
        let store = Store()
        defer { store.disconnect() }
        let heard = Heard()
        store.onEvent = { name, _ in heard.events.append(name) }
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the live feed") { heard.events.contains("hello") }

        // In another app.
        try await server.api("settings/checkup", method: "PUT", body: ["webSearch": true])
        try await eventually("the web search switch from the feed") { store.checkup?.webSearch == true }
        // By the Chief in a chat, in a turn the owner started: the days and the time, in the server's words.
        try server.hold()
        let made = try await server.api("chief/chats", method: "POST") as? [String: Any]
        let chat = try #require(made?["id"] as? String)
        try await server.api("chief/chats/\(chat)/messages", method: "POST", body: ["text": "Checkups on Mondays and Thursdays at 07:30, and off for now"])
        try await eventually("the Chief's turn") { (try? server.runs().isEmpty) == false }
        try await server.api("settings/checkup", method: "PUT", body: ["on": false, "days": ["Monday", "Thursday"], "time": "07:30"], asChief: true, chiefChat: chat)
        try server.unhold()
        try await eventually("the Chief's change from the feed") { store.checkup?.on == false }
        #expect(store.checkup?.when == "Mondays and Thursdays at 07:30")
        #expect(store.checkup?.webSearch == true)
        // An event this app can't read changes nothing.
        let before = store.checkup
        await store.handle(ServerSentEvent(event: "checkup", data: #"{"when":"Daily"}"#))
        #expect(store.checkup == before)
    }

    @Test func aServerWithoutTheCheckupHasNoSwitches() async throws {
        let server = try TestServer()
        let store = Store()
        store.api = API(base: server.base)
        // An older server: no `checkup` in its `features`. Nothing is asked, drawn or sent.
        store.features = ["ratings"]
        await store.loadCheckup()
        #expect(!store.has(.checkup) && store.checkup == nil)
        await store.handle(ServerSentEvent(event: "checkup", data: #"{"on":true,"webSearch":false,"when":"Weekdays at 08:00"}"#))
        #expect(store.checkup == nil)
        await store.setCheckup(on: false)
        #expect(store.checkup == nil && store.problem == nil)
        #expect(try await saved(server)["on"] as? Bool == true)

        // Updated since: the switches come with the next reload, and go with a server that lost them.
        store.features = [Feature.checkup.rawValue]
        await store.loadCheckup()
        #expect(store.checkup?.on == true)
        store.features = []
        await store.loadCheckup()
        #expect(store.checkup == nil)
    }

    @Test func aCheckupsChatLoadsWithItsAnswerButtonsAndNoThumbs() async throws {
        let server = try TestServer(env: ["BOT_DOT_LOOK_ON_DEMAND": "1"])
        try await server.api("settings/quiet-hours", method: "PUT", body: ["start": 0, "end": 0]) // the test runs at any hour
        _ = try await server.makeBot("Web Surfer")
        // A day that is over in every time zone: a proposal dated after the server's today is left out.
        let day = String(ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86400)).prefix(10))
        try server.reply(String(decoding: try JSONSerialization.data(withJSONObject: ["proposals": [
            ["kind": "rule", "bot": "Web Surfer", "change": "Use the saved X login straight away.", "day": day, "evidence": "you answered \"Yes, use the X account\""],
        ]]), as: UTF8.self))
        let store = Store()
        defer { store.disconnect() }
        try await store.connect(to: server.base.absoluteString)

        let ran = try await server.api("chief/checkup/now", method: "POST") as? [String: Any]
        #expect(ran?["posted"] as? Bool == true)
        let chatId = try #require(ran?["chatId"] as? String)
        try await eventually("the checkup's chat in the list") { store.chiefChats.contains { $0.id == chatId } }
        #expect(store.chiefChats.first { $0.id == chatId }?.title?.hasPrefix("Checkup, ") == true)

        store.openChief(chatId: chatId)
        try await eventually("the chat to load") { store.chief.messages.count == 1 }
        let m = store.chief.messages[0]
        #expect(m.role == "chief" && m.checkup == true && m.pending != true)
        #expect(m.text?.contains("Use the saved X login straight away.") == true)
        #expect(m.choices == ["Do it", "Not now"])
        #expect(m.unasked == nil && store.rates && !Ratings.shows(m, rates: store.rates))
        // It ran: the setting says when, once it is read again.
        await store.reloadAll()
        #expect(store.checkup?.lastRanAt != nil)
        #expect(store.problem == nil)
    }
}
