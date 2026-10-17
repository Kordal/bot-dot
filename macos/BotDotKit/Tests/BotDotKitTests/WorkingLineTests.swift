import Foundation
import Testing
@testable import BotDotKit

/// A working bot's working line (docs/api.md, "The working line"), as the Android app's
/// WorkingLineTest: with `working-line` in the server's `features` the line under a bot's chat and in
/// its row is the server's text, and follows it as it changes: from the feed, from the run's stream
/// and from the runs as they are read. Against a server without the feature the app shows the opening
/// line as before. The Chief has no `working_line`: its line is the `activity` of its reply.
@MainActor
@Suite struct WorkingLineShown {
    static let with: Set<String> = ["opening-line", "working-line"]
    static let without: Set<String> = ["opening-line"]
    let chat = "bot:news"

    /// A store that was told what its server offers, and hears the feed's events one by one.
    func on(_ features: Set<String>) -> Store {
        let store = Store()
        store.features = features
        return store
    }

    func hear(_ store: Store, _ event: String, _ json: String) async {
        await store.handle(ServerSentEvent(event: event, id: nil, data: json))
    }

    func line(_ store: Store, _ event: String, _ text: String, run: String = "r1") async {
        let said = String(decoding: try! JSONSerialization.data(withJSONObject: ["chat": chat, "botId": "news", "runId": run, "text": text]), as: UTF8.self)
        await hear(store, event, said)
    }

    func runs(_ json: String) throws -> [RunSummary] { try JSON.decoder.decode([RunSummary].self, from: Data(json.utf8)) }

    /// The line under the chat, as the screen words it; the row's words are the same with an ellipsis.
    func under(_ store: Store, working: Bool = true, waiting: Bool = false) -> String? {
        OpeningLine.status(store.openingLine(of: chat), working: working, waiting: waiting)
    }

    // MARK: which line a server's run has

    @Test func onlyAServerThatAnnouncesItHasTheWorkingLine() {
        #expect(on(Self.with).has(.workingLine))
        #expect(!on(Self.without).has(.workingLine))
        #expect(!Store().has(.workingLine)) // its features are not known yet
    }

    @Test func aRunsLineIsItsWorkingLineFromAServerThatHasOneItsOpeningLineFromOneThatDoesNot() {
        #expect(OpeningLine.ofRun(working: "Reading nytimes.com", opening: "Checking the news", follows: true) == "Reading nytimes.com")
        // A field the app was not told about is not drawn.
        #expect(OpeningLine.ofRun(working: "Reading nytimes.com", opening: "Checking the news", follows: false) == "Checking the news")
        // A run that has an opening line and no working line shows its opening line.
        #expect(OpeningLine.ofRun(working: nil, opening: "Checking the news", follows: true) == "Checking the news")
        #expect(OpeningLine.ofRun(working: "   ", opening: "Checking the news", follows: true) == "Checking the news")
        // A run that did nothing yet: "Working".
        #expect(OpeningLine.ofRun(working: nil, opening: nil, follows: true) == nil)
        #expect(OpeningLine.ofRun(working: "   ", opening: nil, follows: true) == nil)
    }

    @Test func whichEventBringsARunsLine() {
        #expect(OpeningLine.says("working_line", follows: true))
        // The working line starts with it: read twice, the line would change twice in a second.
        #expect(!OpeningLine.says("opening_line", follows: true))
        #expect(OpeningLine.says("opening_line", follows: false))
        #expect(!OpeningLine.says("working_line", follows: false))
        for other in ["run_end", "step", "phase", ""] { for follows in [true, false] { #expect(!OpeningLine.says(other, follows: follows), "\(other)") } }
    }

    @Test func theRunReadsTheServersField() throws {
        #expect(try runs(#"[{"id":"r1","status":"running","workingLine":"Reading nytimes.com"}]"#).first?.workingLine == "Reading nytimes.com")
        #expect(try runs(#"[{"id":"r1","status":"success"}]"#).first?.workingLine == nil)
    }

    // MARK: the feed

    @Test func withTheFeatureTheLineUnderTheChatAndInTheRowFollowsTheFeed() async {
        let store = on(Self.with)
        #expect(under(store) == "Working") // before the server said anything
        #expect(OpeningLine.preview(store.openingLine(of: chat)) == nil) // the row says "Working…"
        // The opening line first: the server sends it as the line's first text.
        await line(store, "working_line", "Checking the news")
        #expect(under(store) == "Checking the news")
        #expect(OpeningLine.preview(store.openingLine(of: chat)) == "Checking the news…")
        // A change: the run's new text takes the place of its last.
        await line(store, "working_line", "Reading nytimes.com")
        #expect(under(store) == "Reading nytimes.com")
        #expect(OpeningLine.preview(store.openingLine(of: chat)) == "Reading nytimes.com…")
        await line(store, "working_line", "Starting its computer")
        #expect(under(store) == "Starting its computer")
        // The server's `opening_line`, sent as before for an older app, changes nothing here.
        await line(store, "opening_line", "Checking the news")
        #expect(under(store) == "Starting its computer")
    }

    @Test func whatIsNoLineIsNotDrawn() async {
        let store = on(Self.with)
        await line(store, "working_line", "Reading nytimes.com")
        await line(store, "working_line", "   ")
        await hear(store, "working_line", #"{"chat":"bot:news","botId":"news","runId":"r1"}"#)
        await hear(store, "working_line", #"{"chat":"bot:news","botId":"news","runId":"r1","text":{"a":1}}"#)
        #expect(store.openingLine(of: chat) == "Reading nytimes.com") // the line stays as it was
    }

    @Test func theLineIsGoneOnTheReplyAndOnStop() async {
        // The reply, a failure, Stop, a restart of the server: the run's end takes the line away.
        for status in ["success", "error", "stopped", "interrupted"] {
            let store = on(Self.with)
            await line(store, "working_line", "Reading nytimes.com")
            await hear(store, "run_finished", #"{"id":"r1","botId":"news","status":"\#(status)"}"#)
            #expect(store.openingLine(of: chat) == nil, "\(status)")
            #expect(under(store, working: false) == nil, "\(status)")
            // A line that comes after its run ended is not drawn.
            await line(store, "working_line", "Reading late.example.com")
            #expect(store.openingLine(of: chat) == nil, "\(status)")
        }
    }

    @Test func aRestartedRunSaysItsJobAgain() async {
        // A job's run starts as "Running <job's name>". When the server starts the run again (its
        // sign-in was renewed), it sends that line once more for the same run: it stands again.
        let store = on(Self.with)
        await line(store, "working_line", "Running Disk check", run: "r2")
        #expect(under(store) == "Running Disk check")
        await line(store, "working_line", "Running a command", run: "r2")
        #expect(under(store) == "Running a command")
        await line(store, "working_line", "Running Disk check", run: "r2")
        #expect(under(store) == "Running Disk check")
        #expect(OpeningLine.preview(store.openingLine(of: chat)) == "Running Disk check…")
        // The app has no words of its own for a job's run: without a line from the server it says "Working".
        #expect(OpeningLine.status(nil, working: true) == "Working")
    }

    @Test func withoutTheFeatureTheOpeningLineIsShownAsBefore() async throws {
        let store = on(Self.without)
        #expect(under(store) == "Working")
        await line(store, "opening_line", "Checking the news")
        #expect(under(store) == "Checking the news")
        await line(store, "working_line", "Reading nytimes.com") // not a thing this server says
        #expect(under(store) == "Checking the news")
        // Its lists: `openingLine`, and no field the app was not told about.
        let fresh = on(Self.without)
        fresh.showLines(of: try runs(#"[{"id":"r1","botId":"news","status":"running","openingLine":"Checking the news","workingLine":"Reading nytimes.com"}]"#))
        #expect(fresh.openingLine(of: chat) == "Checking the news")
        await hear(fresh, "run_finished", #"{"id":"r1","botId":"news","status":"success"}"#)
        #expect(fresh.openingLine(of: chat) == nil)
    }

    @Test func anAppThatDoesNotKnowTheServersFeaturesYetShowsTheOpeningLine() async {
        let store = Store()
        await line(store, "opening_line", "Checking the news")
        #expect(store.openingLine(of: chat) == "Checking the news")
    }

    @Test func theRunsAsTheyAreReadBringTheLineTheServerHolds() async throws {
        let store = on(Self.with)
        await line(store, "working_line", "Checking the news")
        _ = store.openingLines.say("bot:gone", "From before", run: "r0") // its run ended while the app was away
        store.showLines(of: try runs(#"[{"id":"r1","botId":"news","status":"running","openingLine":"Checking the news","workingLine":"Reading nytimes.com"},{"id":"r2","botId":"b2","status":"running"},{"id":"r9","botId":"news","status":"success","workingLine":"Never shown"}]"#))
        #expect(store.openingLine(of: chat) == "Reading nytimes.com")
        #expect(store.openingLine(of: "bot:b2") == nil)
        #expect(store.openingLine(of: "bot:gone") == nil)
        // And it goes on changing.
        await line(store, "working_line", "Reading bbc.com")
        #expect(under(store) == "Reading bbc.com")
        // A run without a working line but with an opening line shows that.
        let other = on(Self.with)
        other.showLines(of: try runs(#"[{"id":"r1","botId":"news","status":"running","openingLine":"Checking the news"}]"#))
        #expect(other.openingLine(of: chat) == "Checking the news")
        // The run ended meanwhile: the list has no line for it, and none is left for the next run.
        other.showLines(of: try runs(#"[{"id":"r1","botId":"news","status":"success","result":"Here is the news."}]"#))
        #expect(other.openingLine(of: chat) == nil)
    }

    @Test func theOpenChatFollowsTheRunsStream() {
        let store = on(Self.with)
        // A reconnect: what happened is replayed, then the opening line as before, then what the line reads now.
        store.streamedLine("opening_line", "Checking the news", in: chat, run: "r1")
        #expect(under(store) == "Working") // `opening_line` is not read from a server with the working line
        store.streamedLine("working_line", "Reading nytimes.com", in: chat, run: "r1")
        #expect(under(store) == "Reading nytimes.com")
        store.streamedLine("working_line", "Starting its computer", in: chat, run: "r1")
        #expect(under(store) == "Starting its computer")
        // Against a server without the feature: its opening line, as before.
        let old = on(Self.without)
        old.streamedLine("opening_line", "Checking the news", in: chat, run: "r1")
        old.streamedLine("working_line", "Reading nytimes.com", in: chat, run: "r1")
        #expect(under(old) == "Checking the news")
    }

    @Test func waitingForYourOkKeepsItsWordsAndItsPlaceOverTheWorkingLine() async {
        let store = on(Self.with.union(["connector-waits"]))
        await line(store, "working_line", "Using gmail")
        await hear(store, "run_waits", #"{"chat":"bot:news","runId":"r1","waitingFor":"ok"}"#)
        #expect(under(store, waiting: store.waitsForOk(chat, run: "r1")) == OpeningLine.waitingForOk)
        // The line changes beneath, and is back when the owner answered.
        await line(store, "working_line", "Sending the email")
        #expect(under(store, waiting: store.waitsForOk(chat, run: "r1")) == OpeningLine.waitingForOk)
        await hear(store, "run_waits", #"{"chat":"bot:news","runId":"r1"}"#)
        #expect(under(store, waiting: store.waitsForOk(chat, run: "r1")) == "Sending the email")
    }

    // MARK: the Chief of Staff

    @Test func theChiefHasNoWorkingLineEventItsOpeningLineIsReadAsBefore() async {
        let store = on(Self.with)
        await hear(store, "opening_line", #"{"chat":"chief:c1","chatId":"c1","text":"Looking at your bots"}"#)
        #expect(store.openingLine(of: "chief:c1") == "Looking at your bots")
        await hear(store, "working_line", #"{"chat":"chief:c1","chatId":"c1","text":"Not a thing the server says"}"#)
        #expect(store.openingLine(of: "chief:c1") == "Looking at your bots")
    }

    @Test func theChiefsLineIsWhatItIsDoingElseItsOpeningLineElseThinking() {
        // The server's activity is the whole line: its opening line first, then the steps that follow.
        #expect(OpeningLine.chiefLine("Looking at your bots", doing: "Looking at your bots", busy: true) == "Looking at your bots")
        #expect(OpeningLine.chiefLine("Looking at your bots", doing: "Waiting for Web Surfer", busy: true) == "Waiting for Web Surfer")
        #expect(OpeningLine.chiefLine("Looking at your bots", doing: "Thinking", busy: true) == "Thinking")
        // No words in the activity (none came yet, or a server from before names the tool alone): the opening line stands.
        #expect(OpeningLine.chiefLine("Looking at your bots", doing: nil, busy: true) == "Looking at your bots")
        #expect(OpeningLine.chiefActivity(nil) == OpeningLine.noWords)
        #expect(OpeningLine.chiefActivity("  ") == "Working")
        #expect(OpeningLine.chiefActivity(" Reading nytimes.com ") == "Reading nytimes.com")
        #expect(OpeningLine.chiefLine("Looking at your bots", doing: OpeningLine.chiefActivity(nil), busy: true) == "Looking at your bots")
        #expect(OpeningLine.chiefLine(nil, doing: OpeningLine.chiefActivity(nil), busy: true) == "Working")
        #expect(OpeningLine.chiefLine(nil, doing: "Waiting for Web Surfer", busy: true) == "Waiting for Web Surfer")
        #expect(OpeningLine.chiefLine(nil, doing: nil, busy: true) == "Thinking")
        #expect(OpeningLine.chiefLine(" ", doing: " ", busy: true) == "Thinking")
        #expect(OpeningLine.chiefLine("Looking at your bots", doing: "Reading nytimes.com", busy: false) == nil)
    }

    // MARK: where the app once had its own words

    @Test func aRunsDetailsAndItsComputersWindowReadTheLineFromAServerThatHasOne() async {
        let store = on(Self.with)
        #expect(store.workingLine(of: "news") == "Working…")
        await line(store, "working_line", "Starting its computer")
        #expect(store.workingLine(of: "news") == "Starting its computer…")
        #expect(on(Self.without).workingLine(of: "news") == nil) // the app's own words stand
    }

    // MARK: against a real botdot server

    /// A connected store whose live feed is open.
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        var heard = false
        store.onEvent = { name, _ in if name == "hello" { heard = true } }
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the live feed") { heard }
        return store
    }

    @Test func theLineFollowsTheRunStepByStepAndGoesWithTheAnswer() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let chat = "bot:\(id)"
        try server.reply("Here is the news.")
        try server.hold()
        let store = try await connected(server)
        defer { store.disconnect() }
        #expect(store.has(.workingLine))
        store.openBot(id)

        let known = try server.runs()
        try await store.sendToBot("What is in the news?")
        let n = try await server.newRun(since: known)
        let run = try #require(store.botChat.runs.last?.id)
        // Its opening line is the line's first text, and the step it announced does not take its place.
        let opener: [[String: Any]] = [TestServer.says("Checking the news."), TestServer.uses()]
        try server.play(opener, into: n)
        try await eventually("the opening line") { store.openingLine(of: chat) == "Checking the news" }
        // The line goes on: the next step, in the server's words.
        let read: [String: Any] = ["type": "assistant", "message": ["content": [["type": "tool_use", "id": "t2", "name": "WebFetch", "input": ["url": "https://www.nytimes.com/section/world"]]]]]
        try server.play(opener + [read], into: n)
        try await eventually("the next step") { store.openingLine(of: chat) == "Reading nytimes.com" }
        #expect(store.workingLine(of: id) == "Reading nytimes.com…")
        // It is no reply: no dot while the bot works.
        #expect(store.bots.first?.unread == 0)

        // Another app that connects now reads it from the runs, and a chat opened later from the run's stream.
        let other = Store()
        defer { other.disconnect() }
        try await other.connect(to: server.base.absoluteString)
        #expect(other.openingLine(of: chat) == "Reading nytimes.com")
        other.lines { $0.clear() }
        other.openBot(id)
        try await eventually("the line again") { other.openingLine(of: chat) == "Reading nytimes.com" }

        try server.unhold()
        try await eventually("the line to go") { store.openingLine(of: chat) == nil }
        try await eventually("the reply") { store.botChat.runs.last?.result == "Here is the news." }
        #expect(store.botChat.runs.last?.id == run)
        #expect(store.botChat.runs.last?.workingLine == nil)
        #expect(store.openingLine(of: chat) == nil) // the list read after the end doesn't bring it back
    }
}
