import Foundation
import Testing
@testable import BotDotKit

/// New replies (ADR 005): the counts the server gives, the report of the chat on screen, and the
/// "New" line, against a real botdot test server.
@MainActor
@Suite struct NewReplies {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    /// What the server says about a bot's new replies, asked now.
    func onServer(_ server: TestServer, _ botId: String) async throws -> Int {
        (try await server.api("bots/\(botId)") as? [String: Any])?["unread"] as? Int ?? -1
    }

    @Test func aBotArrivesWithItsNewRepliesAndTheRunTheyBeginAt() async throws {
        let server = try TestServer()
        let quiet = try await server.makeBot("Quiet")
        let id = try await server.makeBot("News")
        let first = try await server.runToEnd(id, "one")
        try await server.runToEnd(id, "two")
        let store = try await connected(server)
        defer { store.disconnect() }

        #expect(store.followsUnread)
        let bot = try #require(store.bots.first { $0.id == id })
        #expect(bot.unread == 2)
        #expect(bot.firstUnread == first)
        #expect(Unread.dots(bot.unread) == 2)
        #expect(Unread.dots(store.bots.first { $0.id == quiet }?.unread) == 0)
        // New replies do not move a bot: the list keeps the owner's order.
        #expect(store.sidebar.groups.first?.bots.map(\.name) == ["Quiet", "News"])
    }

    @Test func theListShowsOneDotPerNewReplyAndAtMostThree() {
        #expect([nil, 0, -2, 1, 2, 3, 4, 50].map { Unread.dots($0) } == [0, 0, 0, 1, 2, 3, 3, 3])
    }

    @Test func aReplyThatArrivesMakesADotWithoutAReload() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = try await connected(server)
        defer { store.disconnect() }
        #expect(store.bots.first?.unread == 0)
        let run = try await server.runToEnd(id, "any news?")
        try await eventually("the dot") { store.bots.first?.unread == 1 && store.bots.first?.firstUnread == run }
    }

    @Test func reportingTheChatClearsItsDotsHereAndInAnotherApp() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let chat = "bot:\(id)"
        let first = try await server.runToEnd(id, "one")
        let here = try await connected(server)
        let other = try await connected(server)
        defer { here.disconnect(); other.disconnect() }
        var heard = false
        other.onEvent = { name, _ in if name == "hello" { heard = true } }
        try await eventually("the other app's live feed") { heard }
        #expect(other.bots.first?.unread == 1)

        // The owner opens the chat, the window in front: the line is placed, then the chat is read.
        await here.show(chat: chat, inFront: true)
        #expect(here.newLine == NewLine(chat: chat, first: .run(first)))
        #expect(here.bots.first?.unread == 0)
        #expect(here.bots.first?.firstUnread == nil)
        #expect(try await onServer(server, id) == 0)
        try await eventually("the other app's dots to go") { other.bots.first?.unread == 0 }

        // A reply in the chat on screen is read at once: no dot anywhere, and the line stays.
        try await server.runToEnd(id, "two")
        #expect(try await onServer(server, id) == 0)
        try await eventuallyAsync("both apps to have the second run") {
            try await here.loadBots(); try await other.loadBots()
            return here.recentRuns.count == 2 && other.recentRuns.count == 2
        }
        #expect(here.bots.first?.unread == 0)
        #expect(other.bots.first?.unread == 0)
        #expect(here.newLine == NewLine(chat: chat, first: .run(first)))

        // The window is no longer in front: a reply is new, the chat's line stays where it was.
        await here.show(chat: chat, inFront: false)
        let third = try await server.runToEnd(id, "three")
        try await eventually("the dot here") { here.bots.first?.unread == 1 }
        try await eventually("the dot in the other app") { other.bots.first?.unread == 1 }
        #expect(here.newLine == NewLine(chat: chat, first: .run(first)))

        // Back in front: the line moves above the reply that came meanwhile, and the dots go.
        await here.show(chat: chat, inFront: true)
        #expect(here.newLine == NewLine(chat: chat, first: .run(third)))
        try await eventually("the other app's dots to go again") { other.bots.first?.unread == 0 }

        // Leaving the chat takes its line away.
        await here.show(chat: nil, inFront: true)
        #expect(here.newLine == nil)
    }

    @Test func aChatWithNothingNewGetsNoLine() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = try await connected(server)
        defer { store.disconnect() }
        await store.show(chat: "bot:\(id)", inFront: true)
        #expect(store.newLine == nil)
    }

    @Test func aChatShownBehindAnotherWindowIsNotRead() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        try await server.runToEnd(id, "one")
        let store = try await connected(server)
        defer { store.disconnect() }
        await store.show(chat: "bot:\(id)", inFront: false)
        #expect(store.newLine == nil)
        #expect(store.bots.first?.unread == 1)
        #expect(try await onServer(server, id) == 1)
    }

    @Test func theReportIsRepeatedSoAWatchedChatStaysRead() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = try await connected(server)
        defer { store.disconnect() }
        await store.show(chat: "bot:\(id)", inFront: true)
        // One report counts for 15 seconds; only its repeat keeps the chat on screen after that.
        try await Task.sleep(for: .seconds(16))
        try await server.runToEnd(id, "still there?")
        #expect(try await onServer(server, id) == 0)
    }

    @Test func theChiefsRowSumsItsChatsAndOpensTheOneWithNewReplies() async throws {
        let server = try TestServer()
        try server.reply("Here's the plan.")
        let here = try await connected(server)
        let other = try await connected(server)
        defer { here.disconnect(); other.disconnect() }

        // Asked through the API, as from an app that shows no chat: the reply is new.
        let made = try await server.api("chief/chats", method: "POST") as? [String: Any]
        let old = try #require(made?["id"] as? String)
        try await server.api("chief/chats/\(old)/messages", method: "POST", body: ["text": "Make me a news bot"])
        try await eventually("the Chief's dot") { here.chiefUnread == 1 && other.chiefUnread == 1 }
        #expect(here.chiefChats.first { $0.id == old }?.firstUnread == 1) // the reply, below the owner's message

        // A newer chat with nothing new: the row still opens the one that has the new reply.
        let newer = try await server.api("chief/chats", method: "POST") as? [String: Any]
        let latest = try #require(newer?["id"] as? String)
        try await here.loadChiefChats()
        #expect(here.chiefChats.contains { $0.id == latest })
        #expect(here.chiefChatWithNewReplies == old)

        here.openChief(chatId: old)
        await here.show(chat: "chief:\(old)", inFront: true)
        #expect(here.newLine == NewLine(chat: "chief:\(old)", first: .message(1)))
        try await eventually("the Chief's dots to go") { here.chiefUnread == 0 && other.chiefUnread == 0 }
        #expect(here.chiefChatWithNewReplies == nil) // nothing new: the row shows the chat it showed before
    }

    @Test func afterALostConnectionTheDotsAreTheServers() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = try await connected(server)
        defer { store.disconnect() }
        store.stopFeed() // the connection is lost: nothing arrives
        try await server.runToEnd(id, "one")
        try await server.runToEnd(id, "two")
        #expect(store.bots.first?.unread == 0)
        store.startFeed() // back: the feed's hello reads everything again
        try await eventually("the server's count") { store.bots.first?.unread == 2 }
    }

    @Test func aServerWithoutTheFeatureGivesNoDotsNoLineAndGetsNoReport() async throws {
        // Its bots and chats come without the fields.
        let bot = try JSON.decoder.decode(Bot.self, from: Data(##"{"id":"b1","name":"News","color":"#378add"}"##.utf8))
        #expect(bot.unread == nil && bot.firstUnread == nil)
        #expect(Unread.dots(bot.unread) == 0)
        let chat = try JSON.decoder.decode(ChiefChatSummary.self, from: Data(#"{"id":"c1","title":"Hello"}"#.utf8))
        #expect(Unread.dots(chat.unread) == 0)
        #expect(UnreadNow(unread: nil, first: .run("r1")).first == nil)

        // An app that knows the server has no `unread` in its features reports nothing to it.
        let server = try TestServer()
        let id = try await server.makeBot("News")
        try await server.runToEnd(id, "one")
        let store = try await connected(server)
        defer { store.disconnect() }
        store.followsUnread = false
        await store.show(chat: "bot:\(id)", inFront: true)
        #expect(store.newLine == nil)
        #expect(try await onServer(server, id) == 1)

        // The server is updated while the chat is open: the app learns it and reports the chat it shows.
        await store.follows(unread: true)
        #expect(store.newLine != nil)
        #expect(try await onServer(server, id) == 0)
    }

    @Test func aReportQueuedBeforeTheWindowLeftIsNotSentAfterIt() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = try await connected(server)
        defer { store.disconnect() }
        await store.show(chat: "bot:\(id)", inFront: true)
        // Counts read before the report still show a new reply: the app means to report once more…
        store.bots[0].unread = 1
        store.reportAgainIfStale()
        // …but the window leaves first. The chat must not come back on screen.
        await store.show(chat: "bot:\(id)", inFront: false)
        try await Task.sleep(for: .milliseconds(300))
        #expect(store.reported == nil)
        try await server.runToEnd(id, "after leaving")
        #expect(try await onServer(server, id) == 1)
    }

    @Test func aNewReplyUnderMoreRunsThanTheChatLoadsIsReachedAndKeptWhileTheLineStays() async throws {
        // One reply for the owner, then sixty scheduled runs with nothing to say.
        let server = try TestServer(seed: [["bot": ["name": "Parcels", "learning": "off"], "runs": [["result": "Your parcel arrived."], ["quiet": true, "times": 60]]]])
        let store = try await connected(server)
        defer { store.disconnect() }
        let bot = try #require(store.bots.first)
        let first = try #require(bot.firstUnread)
        #expect(bot.unread == 1) // the quiet runs after it are not new
        let chat = "bot:\(bot.id)"

        // The chat opens with its newest runs, which do not hold the reply.
        store.openBot(bot.id)
        try await eventually("the chat") { store.botChat.loaded }
        #expect(store.botChat.runs.count == Store.chatRuns)
        #expect(!store.botChat.runs.contains { $0.id == first })

        // It comes on screen in front: the line is placed, and the runs back to it are read.
        await store.show(chat: chat, inFront: true)
        #expect(store.newLine == NewLine(chat: chat, first: .run(first)))
        try await eventually("the runs back to the line") { store.botChat.runs.first?.id == first }
        #expect(store.botChat.runs.count == 61)
        #expect(store.botChat.runs.first?.result == "Your parcel arrived.")
        #expect(Set(store.botChat.runs.map(\.id)).count == 61) // each once
        #expect(store.botChat.runs.map(\.startedAt) == store.botChat.runs.map(\.startedAt).sorted { ($0 ?? "") < ($1 ?? "") }) // oldest first

        // The chat is read now; the line stays while the chat is open, and so do its runs, over a reload
        // and a reply that arrives.
        try await eventually("the dot to go") { store.bots.first?.unread == 0 }
        await store.loadBotRuns(bot.id)
        #expect(store.botChat.runs.first?.id == first)
        #expect(store.botChat.runs.count == 61)
        let next = try await server.runToEnd(bot.id, "and now?")
        try await eventually("the new reply in the chat") { store.botChat.runs.last?.id == next && store.botChat.live == nil }
        await store.loadBotRuns(bot.id)
        #expect(store.botChat.runs.first?.id == first)
        #expect(store.botChat.runs.count == 62)

        // The chat is left: its line goes, and the next look shows the newest runs as before.
        await store.show(chat: nil, inFront: true)
        #expect(store.newLine == nil)
        await store.loadBotRuns(bot.id)
        #expect(store.botChat.runs.count == Store.chatRuns)
        #expect(store.botChat.runs.last?.id == next)
    }

    @Test func aLineWhoseRunCannotBeReachedLeavesTheNewestRuns() async throws {
        let server = try TestServer(seed: [["bot": ["name": "Parcels", "learning": "off"], "runs": [["quiet": true, "times": 45]]]])
        let store = try await connected(server)
        defer { store.disconnect() }
        let bot = try #require(store.bots.first)
        store.openBot(bot.id)
        try await eventually("the chat") { store.botChat.loaded }
        let newest = store.botChat.runs.map(\.id)
        #expect(newest.count == Store.chatRuns)

        // The run the line names is gone (deleted since): every older page is read, and it isn't there.
        store.newLine = NewLine(chat: "bot:\(bot.id)", first: .run("gone"))
        await store.loadBotRuns(bot.id)
        #expect(store.botChat.runs.map(\.id) == newest)
        #expect(store.problem == nil)
        #expect(store.lineNotReached == store.newLine) // and the next reload doesn't read every page again

        // Runs the chat holds already are not read again: a newer page is joined to them.
        let page: [RunSummary] = Array(store.botChat.runs.reversed().prefix(3))
        store.newLine = NewLine(chat: "bot:\(bot.id)", first: .run(newest[0])) // the oldest of the 40
        let joined = await store.back(toNewLineOf: bot.id, from: page)
        #expect(joined.map(\.id) == Array(newest.reversed()))

        // A server that can't be asked for older runs: the newest as they are.
        server.stop()
        store.newLine = NewLine(chat: "bot:\(bot.id)", first: .run("gone"))
        #expect(await store.back(toNewLineOf: bot.id, from: page).map(\.id) == page.map(\.id))
        // Another chat's line is not this chat's.
        store.newLine = NewLine(chat: "bot:other", first: .run("gone"))
        #expect(await store.back(toNewLineOf: bot.id, from: page).map(\.id) == page.map(\.id))
    }

    @Test func theFeedsEventNamesARunOrAMessagesPlace() throws {
        let run = try #require(UnreadNow(event: Data(#"{"chat":"bot:b1","unread":2,"firstUnread":"r7","readAt":"2026-10-02T10:00:00.000Z"}"#.utf8)))
        #expect(run.unread == 2 && run.first == .run("r7"))
        let message = try #require(UnreadNow(event: Data(#"{"chat":"chief:c1","unread":1,"firstUnread":0}"#.utf8)))
        #expect(message.first == .message(0)) // the first message of a Chief chat is place 0
        let read = try #require(UnreadNow(event: Data(#"{"chat":"bot:b1","unread":0,"firstUnread":null}"#.utf8)))
        #expect(read.unread == 0 && read.first == nil)
        #expect(UnreadNow(event: Data("not json".utf8)) == nil)
    }

    // The chips under a reply of the Chief, as the web page and the Android app print them.
    @Test func aChipHasItsKindsMarkOrNoneAndWhatItWaitsFor() throws {
        #expect(ChiefAction(kind: "from", text: "From Scout").label == "↩ From Scout")
        #expect(ChiefAction(kind: "memory", text: "Noted for myself: tea").label == "Noted for myself: tea")
        #expect(ChiefAction(kind: "group", text: "Made the group Trip").label == "Made the group Trip")
        #expect(ChiefAction(kind: "created", text: "Created News").label == "✨ Created News")
        let waits = try JSONDecoder().decode(ChiefAction.self, from: Data(#"{"kind":"job","text":"Set a job","waits":" waits for your OK "}"#.utf8))
        #expect(waits.label == "⏰ Set a job · waits for your OK")
    }

    @Test func theLineGoesBelowTheOwnersOwnMessageAndAboveEverythingElse() throws {
        #expect(RunSummary(id: "r", botId: "b", trigger: "manual", status: "success", prompt: "any news?").startedByOwnMessage)
        #expect(RunSummary(id: "r", botId: "b", trigger: "manual", status: "success", jobName: "Morning news").asked == .job("Morning news"))
        #expect(RunSummary(id: "r", botId: "b", trigger: "manual", status: "success", startedBy: "chief").asked == .message(.chief))
        #expect(!RunSummary(id: "r", botId: "b", trigger: "manual", status: "success", customPrompt: false).startedByOwnMessage) // its usual task
        // A run that carries on after the owner's OK is no run of the main assignment: nothing stands above it.
        #expect(RunSummary(id: "r2", botId: "b", trigger: "manual", status: "success", customPrompt: false, continues: "r").asked == .carriedOn)
        #expect(try JSONDecoder().decode(RunSummary.self, from: Data(#"{"id":"r2","customPrompt":false,"continues":"r"}"#.utf8)).asked == .carriedOn)
        #expect(!RunSummary(id: "r", botId: "b", trigger: "schedule", status: "success").startedByOwnMessage)
        // A new bot's first message (#511): nothing stands above it, and the line goes above it.
        #expect(RunSummary(id: "r", botId: "b", trigger: "hello", status: "success", prompt: "You were made just now…").asked == .firstMessage)
        #expect(!RunSummary(id: "r", botId: "b", trigger: "hello", status: "success", prompt: "You were made just now…").startedByOwnMessage)
        #expect(!RunSummary(id: "r", botId: "b", trigger: "manual", status: "success", jobName: "Morning news").startedByOwnMessage)
        #expect(!RunSummary(id: "r", botId: "b", kind: "script", status: "success").startedByOwnMessage)
        #expect(!RunSummary(id: "r", botId: "b", trigger: "replies", status: "success").startedByOwnMessage)
        #expect(!RunSummary(id: "r", botId: "b", trigger: "manual", status: "success", startedBy: "chief").startedByOwnMessage) // folded
    }

    @Test func aCalledRunSaysCalled() throws {
        let called = try JSONDecoder().decode(RunSummary.self, from: Data(#"{"id":"r","trigger":"call","jobId":"j1","jobName":"Motion","status":"success"}"#.utf8))
        #expect(called.asked == .job("Motion"))
        #expect(called.jobWords == "Motion, called")
        #expect(called.startedWords == "⏰ Motion, called")
        #expect(RunSummary(id: "r", botId: "b", trigger: "schedule", status: "success", jobName: "Motion").jobWords == "Motion")
        #expect(RunSummary(id: "r", botId: "b", trigger: "schedule", status: "success", jobName: "Motion").startedWords == "⏰ Motion, scheduled")
        #expect(RunSummary(id: "r", botId: "b", trigger: "manual", status: "success", jobName: "Motion").startedWords == "⏰ Motion, started")
        #expect(RunSummary(id: "r", botId: "b", trigger: "schedule", status: "success").startedWords == "⏰ Scheduled")
        #expect(RunSummary(id: "r", botId: "b", trigger: "manual", status: "success").startedWords == "Started")
    }
}
