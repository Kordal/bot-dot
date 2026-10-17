import Foundation
import Testing
@testable import BotDotKit

/// Busy and stopped (Milestone 7): the owner's message to a working bot or a replying Chief waits its
/// turn and can be taken back, Stop ends what it started and the run says who ended it, a job's line
/// says why it failed, and servers from before behave as before.
@MainActor
@Suite struct BusyAndStopped {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    /// A file in the bot's workspace on the server, to go with a message.
    func uploaded(_ store: Store, _ name: String, to target: UploadTarget) async throws -> FileRef {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent(name)
        try Data("Friday is free.".utf8).write(to: url)
        return try await store.upload(url, to: target)
    }

    /// A store that asks this server and follows no feed, with the `features` the test names: nothing
    /// reads them again, as the feed's `hello` does for a store that connected.
    func unfollowed(_ server: TestServer, features: Set<String>) -> Store {
        let store = Store()
        store.api = API(base: server.base)
        store.features = features
        return store
    }

    /// A bot at work on the owner's first message, in its open chat.
    func working(_ server: TestServer, _ name: String = "Fleet Doctor") async throws -> (Store, String) {
        let id = try await server.makeBot(name)
        try server.hold()
        let store = try await connected(server)
        store.openBot(id)
        try await eventually("the chat to load") { store.botChat.loaded }
        #expect(await store.deliverToBot("check the fleet"))
        try await eventually("it to work") { store.botChat.runs.last?.isRunning == true }
        return (store, id)
    }

    // MARK: the feature checks

    @Test func onlyAServerWithMessageWaitsKeepsSend() {
        let store = Store()
        #expect(!store.sendStays && !store.saysWhoEnded) // not known yet
        store.features = ["events", "message-waits", "ended-by"]
        #expect(store.sendStays && store.saysWhoEnded)
        store.features = ["events", "message-key"]
        #expect(!store.sendStays && !store.saysWhoEnded)
        store.features = ["ended-by"]
        #expect(!store.sendStays && store.saysWhoEnded)
        // The box shows Stop in Send's place only where the server would not take a message meanwhile.
        #expect(!MessageWaits.boxStops(busy: true, sendStays: true))
        #expect(MessageWaits.boxStops(busy: true, sendStays: false))
        #expect(!MessageWaits.boxStops(busy: false, sendStays: false))
    }

    @Test func theStoreReadsTheFeaturesAndForgetsThemWhenItLeaves() async throws {
        let server = try TestServer()
        let store = try await connected(server)
        #expect(store.sendStays)
        #expect(store.saysWhoEnded)
        store.disconnect()
        #expect(!store.sendStays)
        #expect(!store.saysWhoEnded)
        #expect(store.queued.isEmpty)
    }

    // MARK: the waiting list

    @Test func aMessageToAWorkingBotWaitsAndStartsWhenItIsFree() async throws {
        let server = try TestServer()
        let (store, id) = try await working(server)
        let chat = "bot:\(id)"
        let file = try await uploaded(store, "notes.txt", to: .bot(id))

        #expect(await store.deliverToBot("and the tyres", attachments: [file]))

        // It is in the bot's list at once, and is no run: nothing runs beside the first.
        #expect(store.waiting(in: chat).map(\.text) == ["and the tyres"])
        #expect(store.waiting(in: chat).first?.attachments.map(\.name) == ["notes.txt"])
        #expect(store.botChat.runs.map(\.prompt) == ["check the fleet"])
        #expect(store.outbox(chat).note == nil)
        // The server's list says the same.
        try await store.loadBots()
        #expect(store.waiting(in: chat).map(\.text) == ["and the tyres"])
        #expect(store.waiting(in: chat).first?.at != nil)

        try server.unhold()
        try await eventually("the waiting message to start") { store.botChat.runs.map(\.prompt) == ["check the fleet", "and the tyres"] }
        try await eventually("the list to empty") { store.waiting(in: chat).isEmpty }
    }

    @Test func aMessageSentFromAnotherAppWaitsHereToo() async throws {
        let server = try TestServer()
        let (store, id) = try await working(server)

        try await server.api("bots/\(id)/run", method: "POST", body: ["prompt": "from the phone"])

        try await eventually("the feed to say it") { store.waiting(in: "bot:\(id)").map(\.text) == ["from the phone"] }
        let waits = try #require(store.waiting(in: "bot:\(id)").first)
        try await server.api("bots/\(id)/queued/\(waits.id)", method: "DELETE")
        try await eventually("it to go, taken back there") { store.waiting(in: "bot:\(id)").isEmpty }
        try server.unhold()
    }

    @Test func theListIsReadEntryByEntry() throws {
        let json = #"[{"id":"q1","text":"first","attachments":[{"name":"a.txt","file":"f/a.txt"}],"at":"2026-10-06T09:00:00.000Z"},{"text":"no id"},7,{"id":"q2"},{"id":"q3","text":5,"attachments":"none"}]"#
        let list = try JSONDecoder().decode(QueuedList.self, from: Data(json.utf8)).items
        #expect(list.map(\.id) == ["q1", "q2", "q3"])
        #expect(list[0] == Queued(id: "q1", text: "first", attachments: [FileRef(name: "a.txt", file: "f/a.txt")], at: "2026-10-06T09:00:00.000Z"))
        #expect(list[1] == Queued(id: "q2"))
        #expect(list[2] == Queued(id: "q3"))
        // Something else than a list is none, and the bot it came with stays readable.
        let bot = try JSONDecoder().decode(Bot.self, from: Data(#"{"id":"b1","name":"News","queued":"soon"}"#.utf8))
        #expect(bot.queued?.items == [])
    }

    @Test func theFeedsListReplacesTheChatsList() async throws {
        let store = Store()
        store.waitingChanged(Data(#"{"chat":"chief:c1","chatId":"c1","queued":[{"id":"w1","text":"And the weather?","attachments":[],"at":"x"}]}"#.utf8))
        #expect(store.waiting(in: "chief:c1").map(\.text) == ["And the weather?"])
        #expect(store.waiting(in: "bot:c1").isEmpty)
        // An event without a chat or without a list changes nothing.
        store.waitingChanged(Data(#"{"queued":[]}"#.utf8))
        store.waitingChanged(Data(#"{"chat":"chief:c1"}"#.utf8))
        #expect(store.waiting(in: "chief:c1").count == 1)
        store.waitingChanged(Data(#"{"chat":"chief:c1","queued":[]}"#.utf8))
        #expect(store.waiting(in: "chief:c1").isEmpty)
    }

    // MARK: take back

    @Test func takeBackPutsTheMessageAndItsFilesInTheBoxAndNothingStarts() async throws {
        let server = try TestServer()
        let (store, id) = try await working(server)
        let chat = "bot:\(id)"
        let file = try await uploaded(store, "notes.txt", to: .bot(id))
        #expect(await store.deliverToBot("and the tyres", attachments: [file]))
        let waits = try #require(store.waiting(in: chat).first)

        #expect(await store.takeBack(waits, from: chat))

        let outbox = store.outbox(chat)
        #expect(store.waiting(in: chat).isEmpty)
        #expect(outbox.note == nil)
        // It comes back as a failed send does: in front of what was typed since.
        let back = try #require(outbox.take(typedSince: "one more thing"))
        #expect(back.text == "and the tyres\none more thing")
        #expect(back.attachments.map(\.name) == ["notes.txt"])
        // It is gone from the server, and starts nothing.
        let bot = try await server.api("bots/\(id)") as? [String: Any]
        #expect((bot?["queued"] as? [Any])?.isEmpty == true)
        try server.unhold()
        try await eventually("the first run to end") { store.botChat.runs.last?.status == "success" }
        #expect(store.botChat.runs.map(\.prompt) == ["check the fleet"])
    }

    @Test func takeBackThatComesTooLateSaysItHasStarted() async throws {
        let server = try TestServer()
        let (store, id) = try await working(server)
        let chat = "bot:\(id)"
        #expect(await store.deliverToBot("and the tyres"))
        let waits = try #require(store.waiting(in: chat).first)
        _ = try await server.newRun(since: []) // the stand-in Claude has the first run: it can be let go
        try server.releaseAll() // the first run ends, and the message starts
        try await eventually("the waiting message to start") { store.botChat.runs.last?.id == waits.id }

        #expect(!(await store.takeBack(waits, from: chat)))

        let outbox = store.outbox(chat)
        #expect(outbox.note == "It has already started.")
        #expect(outbox.back == nil) // nothing comes back: the message is where it was
        #expect(store.botChat.runs.map(\.prompt) == ["check the fleet", "and the tyres"])
        try server.unhold()
    }

    @Test func theLineAfterAFailedTakeBackIsAndroids() {
        func note(_ e: Error) -> String { MessageWaits.takeBackNote(for: e) }
        #expect(note(API.Failure(status: 409, message: "It has already started.", said: true)) == "It has already started.")
        #expect(note(API.Failure(status: 403, message: "Only the owner may take a message back.", said: true)) == "Only the owner may take a message back.")
        #expect(note(API.Failure(status: 404, message: "botdot answered 404")) == "It is no longer waiting.")
        #expect(note(URLError(.cannotConnectToHost)) == "Not taken back: can't reach botdot.")
        #expect(note(API.Failure(status: 502, message: "botdot answered 502")) == "Not taken back: can't reach botdot.")
        #expect(note(API.Failure(status: 500, message: "botdot answered 500")) == "Not taken back: botdot couldn't do that (500).")
        #expect(MessageWaits.waitsUntil("Fleet Doctor") == "Waits until Fleet Doctor is free")
        #expect(MessageWaits.waitsUntil("the Chief") == "Waits until the Chief is free")
    }

    // MARK: the Chief

    @Test func aMessageToAReplyingChiefWaitsAndIsAnsweredNext() async throws {
        let server = try TestServer()
        try server.hold()
        let store = try await connected(server)
        store.openChief(chatId: nil)
        #expect(await store.deliverToChief("Plan my week"))
        let id = try #require(store.chief.chatId)
        let chat = "chief:\(id)"
        #expect(store.chief.busy)
        #expect(store.chief.messages.map(\.role) == ["user", "chief"])
        #expect(store.waiting(in: chat).isEmpty)
        // Send stays: the box has no Stop, and the working line stands with Stop at its end.
        #expect(!MessageWaits.boxStops(busy: store.chief.busy, sendStays: store.sendStays))
        #expect(OpeningLine.chiefLine(store.openingLine(of: chat), doing: store.chief.doing, busy: store.chief.busy) != nil)

        #expect(await store.deliverToChief("And book the dentist"))

        // Not in the messages until its turn starts: it waits, and is not refused.
        #expect(store.waiting(in: chat).map(\.text) == ["And book the dentist"])
        #expect(store.chief.messages.map(\.role) == ["user", "chief"])
        #expect(store.outbox("chief").note == nil)
        #expect(store.chief.busy)

        try server.reply("Done.")
        try server.unhold()
        try await eventually("both to be answered") {
            !store.chief.busy && store.chief.messages.map(\.role) == ["user", "chief", "user", "chief"] && store.chief.messages.last?.pending != true
        }
        #expect(store.chief.messages[2].text == "And book the dentist")
        #expect(store.waiting(in: chat).isEmpty)
        #expect(store.chief.doing == nil)
    }

    @Test func aMessageThatWaitsForTheChiefIsTakenBack() async throws {
        let server = try TestServer()
        try server.hold()
        let store = try await connected(server)
        store.openChief(chatId: nil)
        #expect(await store.deliverToChief("Plan my week"))
        let chat = "chief:\(try #require(store.chief.chatId))"
        #expect(await store.deliverToChief("And book the dentist"))
        let waits = try #require(store.waiting(in: chat).first)

        #expect(await store.takeBack(waits, from: chat))

        #expect(store.waiting(in: chat).isEmpty)
        #expect(store.outbox("chief").back == KeptMessage(text: "And book the dentist"))
        try server.unhold()
        try await eventually("the reply") { !store.chief.busy && store.chief.messages.last?.pending != true }
        #expect(store.chief.messages.map(\.role) == ["user", "chief"])
    }

    @Test func theChiefsWorkingLineIsTheServersWordsThenItsOpeningLineThenThinking() {
        #expect(OpeningLine.chiefLine("Looking at your bots", doing: "Reading nytimes.com", busy: true) == "Reading nytimes.com")
        #expect(OpeningLine.chiefLine("Looking at your bots", doing: nil, busy: true) == "Looking at your bots")
        #expect(OpeningLine.chiefLine(nil, doing: " ", busy: true) == "Thinking")
        #expect(OpeningLine.chiefLine("Looking at your bots", doing: "Reading nytimes.com", busy: false) == nil)
    }

    // MARK: Stop, and who ended it

    @Test func stopEndsTheRunAndTheWaitingMessageStartsAtOnce() async throws {
        let server = try TestServer()
        let (store, id) = try await working(server)
        #expect(await store.deliverToBot("no, the tyres"))
        let first = try #require(store.botChat.runs.last)

        await store.stopRun(first.id)

        try await eventually("the first to stop and the message to start") {
            store.botChat.runs.map(\.status) == ["stopped", "running"] && store.waiting(in: "bot:\(id)").isEmpty
        }
        let stopped = store.botChat.runs[0]
        #expect(stopped.endedBy == "owner")
        #expect(stopped.ended(saysWho: store.saysWhoEnded) == .problem("You stopped this run before it finished."))
        #expect(store.botChat.runs[1].prompt == "no, the tyres")
        try server.unhold()
    }

    @Test func stopInTheChiefsChatEndsTheReplyAndSaysSo() async throws {
        let server = try TestServer()
        try server.hold()
        let store = try await connected(server)
        store.openChief(chatId: nil)
        #expect(await store.deliverToChief("Plan my week"))
        #expect(store.chief.busy)

        await store.stopChief()

        try await eventually("the reply to end") { !store.chief.busy && store.chief.messages.last?.pending != true }
        #expect(store.chief.messages.last?.reply.problem == "You stopped this reply.")
        try server.unhold()
    }

    @Test func aRunSaysWhoEndedItInTheServersSentence() throws {
        func run(_ json: String) throws -> RunSummary { try JSONDecoder().decode(RunSummary.self, from: Data(json.utf8)) }
        let chief = try run(#"{"id":"r1","status":"stopped","endedBy":"chief","problem":"The Chief stopped this run before it finished."}"#)
        #expect(chief.endedBy == "chief")
        #expect(chief.ended(saysWho: true) == .problem("The Chief stopped this run before it finished."))
        let limit = try run(#"{"id":"r2","status":"error","endedBy":"limit","problem":"I stopped after 60 minutes: this took too long. Send it again, or break it into smaller pieces."}"#)
        #expect(limit.ended(saysWho: true).text == "I stopped after 60 minutes: this took too long. Send it again, or break it into smaller pieces.")
        #expect(limit.ended(saysWho: true).isProblem)
        // A stopped run the server says nothing of: the app's own word, and no problem.
        let bare = try run(#"{"id":"r3","status":"stopped"}"#)
        #expect(bare.ended(saysWho: true) == .stopped("Stopped."))
        #expect(!bare.ended(saysWho: true).isProblem)
        // Against a server from before `ended-by` a run reads as it did.
        #expect(bare.endedBy == nil)
        #expect(bare.ended(saysWho: false) == .problem("You stopped this run before it finished."))
        #expect(chief.ended(saysWho: false) == .problem(chief.problemText))
    }

    // MARK: a job's line

    @Test func aJobsLineIsTheServersAndSaysWhyItFailed() throws {
        func job(_ last: String) throws -> Job {
            try JSONDecoder().decode(Job.self, from: Data(#"{"id":"j1","name":"Morning news","cron":"0 8 * * *","last":\#(last)}"#.utf8))
        }
        let failed = try job(#"{"status":"error","at":"2026-10-06T12:00:00.000Z","runId":"r1","text":"Last run at 14:00: failed, 5 times in a row since 02:00. Claude's servers were busy.","failures":5,"since":"2026-10-06T00:00:00.000Z"}"#)
        #expect(failed.lastText(said: true) == "Last run at 14:00: failed, 5 times in a row since 02:00. Claude's servers were busy.")
        #expect(failed.lineTone == .failed)
        let missed = try job(#"{"status":"missed","at":"2026-10-06T06:00:00.000Z","text":"Did not run at 08:00: botdot was off."}"#)
        #expect(missed.lastText(said: true) == "Did not run at 08:00: botdot was off.")
        #expect(missed.lineTone == .missed)
        let done = try job(#"{"status":"success","at":"2026-10-06T12:00:00.000Z","text":"Last run at 14:00: done."}"#)
        #expect(done.lineTone == .fine)
        // A server from before `job-line` sends no line: the app's own, as before.
        let old = try job(#"{"status":"error","at":"2026-10-06T12:00:00.000Z"}"#)
        #expect(old.lastText(said: false).hasPrefix("Last run "))
        #expect(old.lastText(said: false).hasSuffix(": failed."))
        #expect(old.lineTone == .failed)
        #expect(try job("null").lastText(said: true) == "Not run yet.")
        // The app asks the server's `features` before it draws the server's line (`Store.lastText`).
        let store = Store()
        #expect(store.lastText(of: failed).hasPrefix("Last run ") && store.lastText(of: failed).hasSuffix(": failed."))
        store.features = [Feature.jobLine.rawValue]
        #expect(store.lastText(of: failed) == failed.last?.text)
    }

    @Test func runNowSaysThatNothingStartedOnlyWhereTheServerHasTheJobsLine() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Servers")
        let job = try await server.api("bots/\(id)/jobs", method: "POST", body: ["name": "Slow check", "cron": "0 8 * * *", "kind": "script", "script": "sleep 5"]) as? [String: Any]
        let jobId = try #require(job?["id"] as? String)
        let store = unfollowed(server, features: [Feature.jobLine.rawValue])

        #expect(try await store.runJob(id, jobId).hasPrefix("Script started"))
        #expect(try await store.runJob(id, jobId) == "Its last run is still going.")
        // Without `job-line` the app reads no `skipped`: the answer reads as one without it did.
        store.features = []
        #expect(try await store.runJob(id, jobId) == "Started")
    }

    @Test func aFailedJobsLineComesFromTheServer() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let job = try await server.api("bots/\(id)/jobs", method: "POST", body: ["name": "Morning news", "cron": "0 8 * * *", "kind": "ai", "prompt": "Read the news."]) as? [String: Any]
        let jobId = try #require(job?["id"] as? String)
        try server.fail("boom")
        let store = try await connected(server)

        #expect(try await store.runJob(id, jobId) == "Started")

        try await eventuallyAsync("the job's line") {
            try await store.loadBots()
            return store.bots.first { $0.id == id }?.jobs?.first?.last?.status == "error"
        }
        let line = try #require(store.bots.first { $0.id == id }?.jobs?.first)
        let said = try #require(line.last?.text)
        #expect(store.lastText(of: line) == said)
        #expect(said.contains("failed"))
        #expect(line.lineTone == .failed)
    }

    // MARK: a Chief reply about a bot's result, and the sign-in check

    @Test func aChiefReplyAboutABotsResultShowsThatRunsFiles() throws {
        func message(_ json: String) throws -> ChiefMessage { try JSONDecoder().decode(ChiefMessage.self, from: Data(json.utf8)) }
        let file = FileRef(name: "report.pdf", file: "bot-b1/report.pdf", size: 9)
        let files = #""files":[{"name":"report.pdf","file":"bot-b1/report.pdf","size":9}]"#
        let told = try message(#"{"role":"chief","text":"Web Surfer found three flights.","actions":[{"kind":"from","text":"From Web Surfer","botId":"b1","runId":"r1"}],\#(files)}"#)
        #expect(told.reply == ChiefReply(text: "Web Surfer found three flights.", problem: nil, files: [file]))
        #expect(!told.reply.filesAlone)
        // Files alone: a bubble that holds them, with no time under it.
        let alone = try message(#"{"role":"chief","text":"",\#(files)}"#)
        #expect(alone.reply.filesAlone)
        #expect(!alone.reply.isEmpty)
        // A reply still being written shows none.
        #expect(try message(#"{"role":"chief","pending":true,\#(files)}"#).reply.isEmpty)
        #expect(try message(#"{"role":"chief","text":"All set."}"#).reply.files.isEmpty)
    }

    @Test func aSignInTheServerCouldNotCheckHasItsSentence() throws {
        struct Answer: Decodable { let claude: SetupState.Claude }
        func claude(_ json: String) throws -> SetupState.Claude { try JSONDecoder().decode(Answer.self, from: Data(json.utf8)).claude }
        let unsure = try claude(#"{"claude":{"installed":true,"loggedIn":false,"error":"botdot could not check the sign-in: Claude Code did not answer."}}"#)
        #expect(unsure.couldNotTell == "botdot could not check the sign-in: Claude Code did not answer.")
        #expect(try claude(#"{"claude":{"installed":true,"loggedIn":true,"email":"me@example.com"}}"#).couldNotTell == nil)
        #expect(try claude(#"{"claude":{"loggedIn":true,"error":" "}}"#).couldNotTell == nil)
    }

    // MARK: a server from before

    @Test func aServerWithoutTheseFeaturesBehavesAsBefore() async throws {
        let server = try TestServer()
        try server.hold()
        // As against a botdot server from before Milestone 7. No feed is followed: its `hello` would
        // read the server's `features` again, over these.
        let store = unfollowed(server, features: ["events", "message-key"])
        #expect(!store.sendStays)
        #expect(!store.saysWhoEnded)
        store.openChief(chatId: nil)

        try await store.sendToChief("Plan my week")

        // The message and the pending reply are shown by the app, as before, and the box stops.
        #expect(store.chief.messages.map(\.role) == ["user", "chief"])
        #expect(store.chief.messages.last?.pending == true)
        #expect(store.chief.activity == "Thinking…")
        #expect(MessageWaits.boxStops(busy: store.chief.busy, sendStays: store.sendStays))
        // Its bots carry no list, and nothing waits anywhere.
        let bots = try JSONDecoder().decode([Bot].self, from: Data(#"[{"id":"b1","name":"News","running":true}]"#.utf8))
        #expect(bots[0].queued == nil)
        #expect(store.queued.isEmpty)
        try server.unhold()
        try await eventually("the reply") { !store.chief.busy && store.chief.messages.last?.pending != true }
    }
}
