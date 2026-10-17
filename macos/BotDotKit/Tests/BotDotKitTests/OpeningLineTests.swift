import Foundation
import Testing
@testable import BotDotKit

/// A working bot's opening line (docs/api.md, "The opening line"), against a real botdot test server
/// whose stand-in Claude writes a line before a tool call: the store holds the line while the run goes
/// on and drops it when the run ends.
@MainActor
@Suite struct OpeningLineShown {
    static let line = "Checking the weather in Brussels"

    /// A connected store whose live feed is open, so nothing it is told later is hidden by its first reload.
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        var heard = false
        store.onEvent = { name, _ in if name == "hello" { heard = true } }
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the live feed") { heard }
        return store
    }

    /// Gives the bot a task that is held, and has its stand-in Claude write `events`. The run's id and
    /// the stand-in's name for it.
    func heldRun(_ server: TestServer, _ botId: String, _ events: [[String: Any]]) async throws -> (id: String, n: String) {
        let known = try server.runs()
        let run = try await server.api("bots/\(botId)/run", method: "POST", body: ["prompt": "What is the weather in Brussels?"]) as? [String: Any]
        let n = try await server.newRun(since: known)
        try server.play(events, into: n)
        return (run?["id"] as? String ?? "", n)
    }

    @Test func theLineShowsWhileTheBotWorksAndGoesWithTheAnswer() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Weather")
        let chat = "bot:\(id)"
        try server.reply("It is sunny in Brussels, 21 degrees.")
        try server.hold()
        let store = try await connected(server)
        defer { store.disconnect() }
        #expect(store.openingLine(of: chat) == nil)

        // Text alone is not a line yet: it may be the whole answer.
        let run = try await heldRun(server, id, [TestServer.says("\(Self.line).")])
        try await eventually("the bot to show as working") { store.bots.first?.running == true }
        try await Task.sleep(for: .milliseconds(300))
        #expect(store.openingLine(of: chat) == nil)
        #expect(OpeningLine.preview(store.openingLine(of: chat)) == nil) // the list says "Working…"

        try server.play([TestServer.says("\(Self.line)."), TestServer.uses()], into: run.n)
        try await eventually("the line") { store.openingLine(of: chat) == Self.line }
        #expect(OpeningLine.preview(store.openingLine(of: chat)) == "\(Self.line)…")
        // It is not a reply: no dot and no "New" line while the bot works.
        #expect(store.bots.first?.unread == 0)
        #expect(store.newLine == nil)

        try server.unhold()
        try await eventually("the line to go") { store.openingLine(of: chat) == nil }
        try await eventually("the reply") { store.recentRuns.first?.result == "It is sunny in Brussels, 21 degrees." }
        #expect(store.recentRuns.first?.openingLine == nil)
        #expect(store.openingLine(of: chat) == nil) // the list read after the end doesn't bring it back
    }

    @Test func theLineGoesWhenTheRunFails() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Weather")
        try server.hold()
        let store = try await connected(server)
        defer { store.disconnect() }
        let run = try await heldRun(server, id, [TestServer.says("\(Self.line)."), TestServer.uses()])
        try await eventually("the line") { store.openingLine(of: "bot:\(id)") == Self.line }

        try server.fail("It broke.")
        try server.unhold()
        try await eventually("the failed run") { store.recentRuns.first { $0.id == run.id }?.failed == true }
        #expect(store.openingLine(of: "bot:\(id)") == nil)
    }

    @Test func aBotThatWroteNoLineShowsItsStepsAsBefore() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Weather")
        try server.hold()
        defer { try? server.unhold() }
        let store = try await connected(server)
        defer { store.disconnect() }
        store.openBot(id)
        _ = try await heldRun(server, id, [TestServer.uses()])
        try await eventually("its step") { store.botChat.live?.steps.map(\.text) == ["Searching the web for “weather Brussels”"] }
        #expect(store.bots.first?.running == true)
        // It has no opening line: its line is the server's words for the step (see WorkingLineTests.swift).
        #expect(store.recentRuns.first?.openingLine == nil)
        try await eventually("its working line") { store.openingLine(of: "bot:\(id)") == "Searching the web" }
    }

    @Test func anAppThatConnectsWhileARunGoesOnShowsItsLine() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Weather")
        try server.hold()
        defer { try? server.unhold() }
        let run = try await heldRun(server, id, [TestServer.says("\(Self.line)."), TestServer.uses()])
        try await eventuallyAsync("the server to have the line") {
            (try await server.api("runs/\(run.id)") as? [String: Any])?["openingLine"] as? String == Self.line
        }

        // From the list of runs, as soon as it is connected: the list's preview needs no open chat.
        let store = Store()
        defer { store.disconnect() }
        try await store.connect(to: server.base.absoluteString)
        #expect(store.openingLine(of: "bot:\(id)") == Self.line)

        // And from the run's stream, which says it again to a chat opened later.
        store.lines { $0.clear() }
        store.openBot(id)
        try await eventually("the line again") { store.openingLine(of: "bot:\(id)") == Self.line }
        try await eventually("the step beside it") { store.botChat.live?.steps.isEmpty == false }
    }

    @Test func theChiefsLineShowsInItsChatUntilTheReply() async throws {
        let server = try TestServer()
        try server.reply("Done. I created News Bot.")
        try server.hold()
        let store = try await connected(server)
        defer { store.disconnect() }
        let known = try server.runs()
        try await store.sendToChief("Make me a news bot")
        let chatId = try #require(store.chief.chatId)
        let chat = "chief:\(chatId)"
        let n = try await server.newRun(since: known)
        #expect(store.openingLine(of: chat) == nil)

        try server.play([TestServer.says("Setting up your news bot."), TestServer.uses("mcp__botdot__list_bots", [:])], into: n)
        try await eventually("the Chief's line") { store.openingLine(of: chat) == "Setting up your news bot" }
        #expect(store.chiefUnread == 0) // not a reply
        #expect(store.newLine == nil)

        // Another app that connects now has it too, from the list of chats.
        let other = Store()
        defer { other.disconnect() }
        try await other.connect(to: server.base.absoluteString)
        #expect(other.openingLine(of: chat) == "Setting up your news bot")
        var heard = false
        other.onEvent = { name, _ in if name == "hello" { heard = true } }
        try await eventually("the other app's live feed") { heard }

        try server.unhold()
        try await eventually("the reply") { store.chief.messages.last?.text == "Done. I created News Bot." }
        #expect(store.openingLine(of: chat) == nil)
        try await eventually("the other app's line to go") { other.openingLine(of: chat) == nil }
    }

    // ---------- the lines the app keeps ----------

    @Test func aChatShowsTheLineOfTheLatestRunThatStillGoesOn() {
        var lines = OpeningLines()
        do { let changed = lines.say("bot:a", "Checking the disks", run: "r1"); #expect(changed) }
        do { let changed = lines.say("bot:a", "Checking the disks", run: "r1"); #expect(!changed) } // said already: nothing to redraw
        do { let changed = lines.say("bot:a", "Reading the logs", run: "r2"); #expect(changed) }
        #expect(lines.of("bot:a") == "Reading the logs")
        #expect(lines.of("bot:b") == nil)
        // The newer run ends: the older one's line shows again; its own end takes it too.
        do { let changed = lines.end("bot:a", run: "r2"); #expect(changed) }
        #expect(lines.of("bot:a") == "Checking the disks")
        do { let changed = lines.end("bot:a", run: "r1"); #expect(changed) }
        #expect(lines.of("bot:a") == nil)
        do { let changed = lines.end("bot:a", run: "r1"); #expect(!changed) }
    }

    @Test func aListFetchedBeforeARunEndedDoesNotBringItsLineBack() {
        var lines = OpeningLines()
        _ = lines.say("bot:a", "Checking the disks", run: "r1")
        _ = lines.end("bot:a", run: "r1")
        do { let changed = lines.sync([.init(chat: "bot:a", run: "r1", text: "Checking the disks")], scope: "bot:"); #expect(!changed) }
        do { let changed = lines.say("bot:a", "Checking the disks", run: "r1"); #expect(!changed) }
        #expect(lines.of("bot:a") == nil)
    }

    @Test func aRunThatEndedBeforeItsLineWasHeardStaysEnded() {
        // The app held no line for it when it ended; a list fetched before the end still has one.
        let store = Store()
        store.lines { $0.end("bot:a", run: "r1") }
        store.lines { $0.sync([.init(chat: "bot:a", run: "r1", text: "Checking the disks")], scope: "bot:") }
        #expect(store.openingLine(of: "bot:a") == nil)
    }

    @Test func theServersListsKeepWhatStillGoesOnAndDropTheRest() {
        var lines = OpeningLines()
        _ = lines.say("bot:a", "Checking the disks", run: "r1")
        _ = lines.say("bot:b", "Reading the news", run: "r2")
        _ = lines.say("chief:c1", "Setting up your news bot")
        // r1 still runs (the list has no line for it: the feed's stays), r2 is gone, r3 is new.
        do { let changed = lines.sync([.init(chat: "bot:a", run: "r1", text: nil), .init(chat: "bot:c", run: "r3", text: "Sorting the mail")], scope: "bot:"); #expect(changed) }
        #expect(lines.of("bot:a") == "Checking the disks")
        #expect(lines.of("bot:b") == nil)
        #expect(lines.of("bot:c") == "Sorting the mail")
        #expect(lines.of("chief:c1") == "Setting up your news bot") // the runs' list says nothing about the Chief
        // The Chief is no longer replying: its line goes, the bots' stay.
        do { let changed = lines.sync([], scope: "chief:"); #expect(changed) }
        #expect(lines.of("chief:c1") == nil)
        #expect(lines.of("bot:a") == "Checking the disks")
        do { let changed = lines.clear(); #expect(changed) }
        do { let changed = lines.clear(); #expect(!changed) }
    }

    @Test func whatIsNotALineIsNone() {
        var lines = OpeningLines()
        do { let changed = lines.say("bot:a", nil, run: "r1"); #expect(!changed) }
        do { let changed = lines.say("bot:a", "  \n ", run: "r1"); #expect(!changed) }
        do { let changed = lines.say(nil, "Checking", run: "r1"); #expect(!changed) }
        do { let changed = lines.say("", "Checking", run: "r1"); #expect(!changed) }
        #expect(lines.of("bot:a") == nil)
        #expect(OpeningLine.preview(nil) == nil)
        #expect(OpeningLine.preview("  ") == nil)
        #expect(OpeningLine.preview(" Checking the disks ") == "Checking the disks…")
    }
}

/// A working bot is one line in its chat (MSG-013): its opening line, or "Working" until it says one.
@Suite struct WorkingBotIsOneLine {
    @Test func theLineOrWorking() {
        #expect(OpeningLine.status("Checking the Agent Mail inbox", working: true) == "Checking the Agent Mail inbox")
        #expect(OpeningLine.status(nil, working: true) == "Working")
        #expect(OpeningLine.status("  ", working: true) == "Working")
        // At rest there is a line only when one was said.
        #expect(OpeningLine.status(nil, working: false) == nil)
        #expect(OpeningLine.status("Looking at your bots", working: false) == "Looking at your bots")
    }
}
