import Foundation
import Testing
@testable import BotDotKit

/// The sent message is there at once, as the Android app's SentAtOnceTest: from Send until the botdot
/// server answered, the chat draws the owner's own words and files and "Working" under them; the
/// server's version then takes their place, once; a send that failed takes them away and the box has
/// them again. In a bot's chat and a Chief chat, and for a quick answer as for a typed message.
/// OutboxTests.swift and BusyTests.swift hold what a failed send and a waiting message did before.
@MainActor
@Suite struct SentAtOnce {
    let file = FileRef(name: "a.pdf", file: "u1/a.pdf", size: 10)

    /// The owner's own message as a run of the bot's chat.
    func mine(_ id: String, _ prompt: String, status: String = "success", files: [FileRef] = []) throws -> RunSummary {
        let json: [String: Any] = ["id": id, "botId": "doctor", "prompt": prompt, "customPrompt": true, "status": status,
                                   "attachments": files.map { ["name": $0.name, "file": $0.file] }]
        return try JSON.decoder.decode(RunSummary.self, from: JSONSerialization.data(withJSONObject: json))
    }

    /// A send whose request waits until `look` has seen what the chat holds between Send and the answer;
    /// `then` is what the answer does (it puts the server's version in the chat, or throws).
    func during(_ box: Outbox, _ text: String, _ files: [FileRef] = [], fromBox: Bool = true, key: String? = nil, chat: String? = nil,
                known: Set<String> = [], draw: Bool = true, then: @escaping @MainActor () throws -> Void = {}, look: () -> Void) async -> Bool {
        let (answered, answer) = AsyncStream<Void>.makeStream()
        let went = Task { await box.send(text, attachments: files, box: fromBox, key: key, once: true, chat: chat, known: known, draw: draw) { _ in
            for await _ in answered { break }
            try then()
        } }
        while !box.sending { await Task.yield() }
        look()
        answer.yield()
        answer.finish()
        return await went.value
    }

    @Test func onSendTheMessageAndWorkingAreThereBeforeTheAnswer() async throws {
        let box = Outbox()
        var runs = [try mine("r1", "Earlier")]
        let answer = try mine("r2", "Check the backup", status: "running", files: [file])
        let went = await during(box, "Check the backup", [file], known: ["r1"], then: { runs.append(answer) }) {
            // Nothing has answered yet: the owner's words and files stand in the chat, and "Working" under them.
            let sent = box.sent?.unlessIn(SentMessage.ownWords(runs: runs, queued: []))
            #expect(sent?.text == "Check the backup")
            #expect(sent?.attachments == [file])
            #expect(OpeningLine.withSent(nil, sent) == "Working")
            #expect(box.sending)
        }
        #expect(went)
        // The answer came: one message stands, the server's, and the line is the run's own.
        #expect(box.sent == nil)
        #expect(runs.map(\.id) == ["r1", "r2"])
        #expect(OpeningLine.withSent(nil, box.sent) == nil)
    }

    @Test func theLineKeepsItsOwnWordsAndSaysWorkingOnlyWhileAMessageIsOnItsWay() {
        let sent = SentMessage(key: "k1", text: "hi")
        #expect(OpeningLine.withSent(nil, sent) == "Working")
        #expect(OpeningLine.withSent("Checking the disk", sent) == "Checking the disk") // the bot's own line wins
        #expect(OpeningLine.withSent(nil, nil) == nil)
        #expect(OpeningLine.withSent("Thinking", nil) == "Thinking")
    }

    @Test func theSameSendAgainHasTheSameKey() async throws {
        let box = Outbox()
        var keys: [String] = []
        // The first try's answer is lost: nothing stays in the chat, and the box has the message again with the line.
        #expect(!(await during(box, "Check the backup", then: { throw URLError(.networkConnectionLost) }) { keys.append(box.sent?.key ?? "") }))
        #expect(box.sent == nil)
        #expect(box.take(typedSince: "") == KeptMessage(text: "Check the backup"))
        // Sent again as it is: the same key, so botdot answers the run it started the first time.
        #expect(await during(box, "Check the backup") { keys.append(box.sent?.key ?? "") })
        #expect(Set(keys).count == 1 && keys.first?.isEmpty == false)
    }

    @Test func theServersVersionBroughtByTheFeedBeforeTheAnswerIsNotDrawnTwice() async throws {
        let box = Outbox()
        let had = [try mine("r1", "Check the backup")] // the same words, sent before: not this message
        _ = await during(box, "Check the backup ", [file], known: ["r1"]) {
            let sent = box.sent
            func theirs(_ runs: [RunSummary], _ queued: [Queued] = []) -> [Queued] { SentMessage.ownWords(runs: runs, queued: queued) }
            // An older message with the same words hides nothing.
            #expect(sent?.unlessIn(theirs(had))?.text == "Check the backup ")
            // The feed's refresh brings the run before the request answers: the local one gives way to it.
            #expect(sent?.unlessIn(theirs(had + [try! mine("r2", "Check the backup", status: "running", files: [file])])) == nil)
            // Not for other words, other files, or a run the owner did not start.
            #expect(sent?.unlessIn(theirs([try! mine("r2", "Check the disk", status: "running", files: [file])])) == sent)
            #expect(sent?.unlessIn(theirs([try! mine("r2", "Check the backup", status: "running")])) == sent)
            let job = try! JSON.decoder.decode(RunSummary.self, from: Data(#"{"id":"r2","prompt":"Check the backup","jobName":"Nightly","status":"running","attachments":[{"name":"a.pdf","file":"u1/a.pdf"}]}"#.utf8))
            #expect(sent?.unlessIn(theirs([job])) == sent)
            // Nor twice when it came as a message that waits.
            #expect(sent?.unlessIn(theirs(had, [Queued(id: "r2", text: "Check the backup", attachments: [file])])) == nil)
        }
    }

    @Test func aFailedSendLeavesNoMessageInTheChatAndTheBoxAsBefore() async {
        let box = Outbox()
        let refused = API.Failure(status: 409, message: "This bot is paused.", said: true)
        let went = await during(box, "Do the thing", [file], then: { throw refused }) { #expect(box.sent?.text == "Do the thing") }
        #expect(!went)
        #expect(box.sent == nil) // nothing of it stays in the chat
        #expect(OpeningLine.withSent(nil, box.sent) == nil)
        #expect(box.note == "Not sent: This bot is paused. Your message is still here.")
        #expect(box.take(typedSince: "") == KeptMessage(text: "Do the thing", attachments: [file]))
        #expect(!box.sending)
    }

    @Test func aQuickAnswerIsThereAtOnceLikeATypedMessage() async {
        let box = Outbox()
        // Tapped: it comes with its own key and is drawn as a typed message is.
        let went = await during(box, "Yes", fromBox: false, key: "answer-key-1") {
            #expect(box.sent == SentMessage(key: "answer-key-1", text: "Yes"))
            #expect(OpeningLine.withSent(nil, box.sent) == "Working")
        }
        #expect(went)
        #expect(box.sent == nil)
        // One that failed leaves the chat, and stays where it was tapped: nothing goes to the box.
        let again = await during(box, "Yes", fromBox: false, key: "answer-key-1", then: { throw URLError(.cannotConnectToHost) }) { #expect(box.sent?.text == "Yes") }
        #expect(!again)
        #expect(box.sent == nil)
        #expect(box.back == nil)
    }

    @Test func onlyOneMessageIsOnItsWayAndASecondChangesNothingOfIt() async {
        let box = Outbox()
        var second: Bool?
        let first = await box.send("first", box: true, once: true) { _ in
            second = await box.send("second", box: true, once: true) { _ in Issue.record("two messages went at once") }
            #expect(box.sent?.text == "first")
        }
        #expect(first)
        #expect(second == false)
        #expect(box.sent == nil)
        #expect(box.take(typedSince: "")?.text == "second")
    }

    @Test func whatIsNoMessageIsNotDrawn() async {
        // "Run its usual task" sends no words of the owner's: the run's own chip says it when the server answered.
        let box = Outbox()
        let went = await during(box, "", draw: false) {
            #expect(box.sent == nil)
            #expect(box.sending)
        }
        #expect(went)
    }

    @Test func inAChiefChatTheMessageIsToldByItsPlace() {
        let user = ChiefMessage(role: "user", text: "Find a flight")
        let reply = ChiefMessage(role: "chief", text: "Here it is")
        // A long chat, read from its message 10 on.
        let had = SentMessage.ownWords(messages: [user, reply], offset: 10, queued: [])
        #expect(had.map(\.id) == ["at:10"])
        let known = Set(had.map(\.id))
        let sent = SentMessage(key: "k", text: "And a hotel", attachments: [file], chat: "c1", known: known)
        #expect(sent.unlessIn(had) == sent)
        // The answer is the chat with the message in it: the local one gives way.
        let now = [user, reply, ChiefMessage(role: "user", text: "And a hotel", attachments: [file]), ChiefMessage(role: "chief", pending: true)]
        #expect(sent.unlessIn(SentMessage.ownWords(messages: now, offset: 10, queued: [])) == nil)
        // The same words from before Send hide nothing.
        #expect(SentMessage(key: "k", text: "Find a flight", known: known).unlessIn(SentMessage.ownWords(messages: now, offset: 10, queued: []))?.text == "Find a flight")
        // To a replying Chief the message is among those that wait: the waiting message is the server's then.
        #expect(sent.unlessIn(SentMessage.ownWords(messages: [user, reply], offset: 10, queued: [Queued(id: "q1", text: "And a hotel", attachments: [file])])) == nil)
    }

    @Test func aFirstMessageStandsInItsNewChiefChatAndInNoOther() async {
        let box = Outbox()
        _ = await during(box, "Hello", chat: nil) {
            // No chat yet: it belongs to the new one (nil), not to another the owner opens meanwhile.
            #expect(box.sent != nil && box.sent?.chat == nil)
            box.sentIn("c9") // its chat was made
            #expect(box.sent?.chat == "c9")
        }
        #expect(box.sent == nil)
        box.sentIn("c9") // nothing is on its way: nothing changes
        #expect(box.sent == nil)
    }

    // MARK: against a real botdot server

    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        var heard = false
        store.onEvent = { name, _ in if name == "hello" { heard = true } }
        try await store.connect(to: server.base.absoluteString)
        try await eventually("the live feed") { heard }
        return store
    }

    @Test func aMessageToABotIsInItsChatAtOnceAndTheRunTakesItsPlace() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Doctor")
        try server.reply("All disks are fine.")
        let store = try await connected(server)
        defer { store.disconnect() }
        store.openBot(id)
        try await eventually("the chat to load") { store.botChat.loaded }
        #expect(store.sent(toBot: id) == nil)

        // Every look between Send and the end: the message is there, as the app's own or as the server's run, never both and never neither.
        var seen: [String] = []
        let send = Task { await store.deliverToBot("Check the disks") }
        while !store.outbox("bot:\(id)").sending { await Task.yield() }
        while store.outbox("bot:\(id)").sending {
            let local = store.sent(toBot: id), theirs = store.botChat.runs.filter { $0.prompt == "Check the disks" }
            #expect((local == nil) != theirs.isEmpty, "the message is drawn once")
            seen.append(local != nil ? "sent" : "run")
            await Task.yield()
        }
        #expect(await send.value)
        #expect(seen.first == "sent") // before botdot answered
        #expect(store.sent(toBot: id) == nil)
        #expect(store.botChat.runs.map(\.prompt) == ["Check the disks"])
        try await eventually("the reply") { store.botChat.runs.last?.result == "All disks are fine." }

        // "Run its usual task" is no message of the owner's: nothing is drawn for it.
        let usual = Task { await store.deliverToBot(nil) }
        while !store.outbox("bot:\(id)").sending { await Task.yield() }
        #expect(store.sent(toBot: id) == nil)
        #expect(await usual.value)
    }

    @Test func aFirstMessageToTheChiefIsInItsNewChatAtOnce() async throws {
        let server = try TestServer()
        try server.reply("Here is your week.")
        let store = try await connected(server)
        defer { store.disconnect() }
        store.openChief(chatId: nil)

        let send = Task { await store.deliverToChief("Plan my week") }
        while !store.outbox("chief").sending { await Task.yield() }
        #expect(store.sentToChief?.text == "Plan my week") // a new chat: no id yet, and the message is in it
        while store.outbox("chief").sending {
            let local = store.sentToChief, theirs = store.chief.messages.filter { $0.role == "user" && $0.text == "Plan my week" }
            #expect((local == nil) != theirs.isEmpty, "the message is drawn once")
            await Task.yield()
        }
        #expect(await send.value)
        #expect(store.sentToChief == nil)
        #expect(store.chief.loaded)
        #expect(store.chief.messages.filter { $0.role == "user" }.map(\.text) == ["Plan my week"])
        // Another chat of the Chief's does not show a message that is on its way in this one.
        let chat = try #require(store.chief.chatId)
        try await eventually("the reply") { !store.chief.busy }
        try server.hold()
        defer { try? server.unhold() }
        let second = Task { await store.deliverToChief("And the weekend") }
        while store.outbox("chief").sent == nil && store.outbox("chief").sending == false { await Task.yield() }
        #expect(store.outbox("chief").sent?.chat == chat)
        store.openChief(chatId: nil) // the owner starts a new chat meanwhile
        #expect(store.sentToChief == nil)
        _ = await second.value
    }
}
