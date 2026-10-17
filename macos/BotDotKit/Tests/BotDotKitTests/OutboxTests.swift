import Foundation
import Testing
@testable import BotDotKit

/// A message that could not be sent is kept, and botdot takes it once (docs/api.md, "A message sent twice").
@MainActor
@Suite struct KeptMessages {
    static let stillHere = "Your message is still here."
    static let cantReach = "Not sent: can't reach botdot. \(stillHere)"
    static let maybeSent = "It may have been sent: check the chat. \(stillHere)"

    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    /// The owner's messages a bot was given, as the server has them.
    func prompts(_ server: TestServer, _ botId: String) async throws -> [String] {
        let runs = try await server.api("runs") as? [[String: Any]] ?? []
        return runs.filter { $0["botId"] as? String == botId }.compactMap { $0["prompt"] as? String }
    }

    @Test func aMessageThatGotNoAnswerIsKeptWithItsFilesAndOneLine() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = try await connected(server)
        store.openBot(id)
        try await eventually("the chat to load") { store.botChat.loaded }
        let file = FileRef(name: "notes.txt", file: "bot-\(id)/notes.txt", size: 5)
        server.stop()

        let went = await store.deliverToBot("any news?", attachments: [file])

        let outbox = store.outbox("bot:\(id)")
        #expect(!went)
        #expect(outbox.note == Self.cantReach)
        #expect(outbox.back == KeptMessage(text: "any news?", attachments: [file]))
        #expect(!outbox.sending)
        #expect(store.problem == nil) // one line above the box, no alert beside it
    }

    @Test func theKeptMessageGoesBackInFrontOfWhatWasTypedSince() async throws {
        let outbox = Outbox()
        let file = FileRef(name: "a.txt", file: "f/a.txt")
        await outbox.send("first", attachments: [file], box: true, once: true) { _ in throw URLError(.cannotConnectToHost) }

        #expect(outbox.take(typedSince: "second") == KeptMessage(text: "first\nsecond", attachments: [file]))
        #expect(outbox.back == nil)
        #expect(outbox.take(typedSince: "second") == nil)
        // The box showing what came back is no edit: the line stays until the owner changes it.
        outbox.edited("first\nsecond")
        #expect(outbox.note == Self.cantReach)
        outbox.edited("first\nsecond!")
        #expect(outbox.note == nil)
    }

    @Test func sentAgainItHasTheSameKeyAndBotdotRunsItOnce() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        try server.reply("Nothing new.")
        let store = try await connected(server)
        #expect(store.takesOnce)
        store.openBot(id)
        let outbox = store.outbox("bot:\(id)")
        var keys: [String] = []

        // botdot took the message, and its answer was lost on the way.
        let went = await outbox.send("any news?", box: true, once: store.takesOnce) { key in
            keys.append(key)
            try await store.sendToBot("any news?", key: key)
            throw URLError(.networkConnectionLost)
        }
        #expect(!went)
        #expect(outbox.note == Self.cantReach)
        #expect(outbox.take(typedSince: "")?.text == "any news?")

        // Send again, as it is.
        let again = await outbox.send("any news?", box: true, once: store.takesOnce) { key in
            keys.append(key)
            try await store.sendToBot("any news?", key: key)
        }
        #expect(again)
        #expect(outbox.note == nil)
        #expect(outbox.back == nil)
        #expect(keys.count == 2 && keys[0] == keys[1])
        #expect(try await prompts(server, id) == ["any news?"])
        #expect(store.botChat.runs.map(\.prompt) == ["any news?"])

        // Another message is another key, and the one that went is not kept for the next.
        for text in ["and sport?", "any news?"] {
            await outbox.send(text, box: true, once: store.takesOnce) { key in keys.append(key) }
        }
        #expect(Set(keys).count == 3)
    }

    @Test func aKeyIsOneTheServerTakes() {
        let key = MessageKey.new()
        #expect(key.wholeMatch(of: /[A-Za-z0-9_-]{8,64}/) != nil)
        #expect(MessageKey.new() != key)
    }

    @Test func onlyAServerWithMessageKeyTakesOnce() {
        let store = Store()
        #expect(!store.takesOnce) // not known yet
        store.features = ["events", "message-key", "unread"]
        #expect(store.takesOnce)
        store.features = ["events", "unread"]
        #expect(!store.takesOnce)
    }

    @Test func aServerWithoutMessageKeyGetsMessagesAsBefore() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        try server.reply("Nothing new.")
        let store = try await connected(server)
        store.features.remove(Feature.messageKey.rawValue) // as against a botdot server from before `message-key`
        store.openBot(id)
        let outbox = store.outbox("bot:\(id)")

        // No key goes with it: sent twice, it is taken twice, as before.
        await outbox.send("any news?", box: true, once: store.takesOnce) { key in
            try await store.sendToBot("any news?", key: key)
            throw URLError(.networkConnectionLost)
        }
        #expect(outbox.note == Self.maybeSent) // nobody can tell, so the line does not say "not sent"
        #expect(await store.deliverToBot("any news?"))
        try await eventuallyAsync("both to be taken") { try await prompts(server, id) == ["any news?", "any news?"] }
    }

    @Test func theLineSaysWhyInAndroidsWords() {
        func note(_ e: Error, once: Bool = false) -> String { Outbox.note(for: e, once: once) }
        // botdot's own sentence for a refusal.
        #expect(note(API.Failure(status: 409, message: "The Chief is still replying", said: true)) == "Not sent: The Chief is still replying. \(Self.stillHere)")
        #expect(note(API.Failure(status: 429, message: "Ten messages already wait.", said: true)) == "Not sent: Ten messages already wait. \(Self.stillHere)")
        // No answer, or a gateway's that botdot is not there.
        #expect(note(URLError(.cannotConnectToHost)) == Self.cantReach)
        #expect(note(URLError(.notConnectedToInternet)) == Self.cantReach)
        #expect(note(API.Failure(status: 502, message: "botdot answered 502")) == Self.cantReach)
        #expect(note(API.Failure(status: 503, message: "botdot answered 503")) == Self.cantReach)
        // Nobody can tell: the request had gone out, a gateway gave up waiting, or botdot failed without a sentence.
        #expect(note(URLError(.networkConnectionLost)) == Self.maybeSent)
        #expect(note(URLError(.timedOut)) == Self.maybeSent)
        #expect(note(API.Failure(status: 504, message: "botdot answered 504")) == Self.maybeSent)
        #expect(note(API.Failure(status: 500, message: "botdot answered 500")) == Self.maybeSent)
        // A botdot that takes a key once: sending again is safe, so a lost connection is "not sent".
        #expect(note(URLError(.networkConnectionLost), once: true) == Self.cantReach)
        #expect(note(URLError(.timedOut), once: true) == Self.cantReach)
        // An answer without a sentence.
        #expect(note(API.Failure(status: 400, message: "botdot answered 400")) == "Not sent: botdot couldn't do that (400). \(Self.stillHere)")
        // The message never left (its chat could not be made): never "it may have been sent".
        #expect(note(NotSent(cause: URLError(.networkConnectionLost))) == Self.cantReach)
        #expect(note(NotSent(cause: API.Failure(status: 500, message: "botdot answered 500"))) == "Not sent: botdot couldn't do that (500). \(Self.stillHere)")
        #expect(note(NotSent(cause: API.Failure(status: 403, message: "Not yours", said: true))) == "Not sent: Not yours. \(Self.stillHere)")
    }

    @Test func aRefusalIsSaidInBotdotsOwnSentence() async throws {
        let server = try TestServer()
        let store = try await connected(server)
        store.openBot("no-such-bot")

        #expect(!(await store.deliverToBot("hello")))

        let outbox = store.outbox("bot:no-such-bot")
        let note = try #require(outbox.note)
        #expect(note.hasPrefix("Not sent: ") && note.hasSuffix(" \(Self.stillHere)"))
        #expect(!note.contains("botdot answered") && !note.contains("couldn't do that")) // the server's sentence
        #expect(outbox.back?.text == "hello")
    }

    @Test func whileOneIsUnderWayAnotherIsGivenBack() async throws {
        let outbox = Outbox()
        var second: Bool?
        let first = await outbox.send("one", box: true, once: true) { _ in
            #expect(outbox.sending)
            second = await outbox.send("two", box: true, once: true) { _ in Issue.record("two messages went at once") }
        }
        #expect(first)
        #expect(second == false)
        #expect(outbox.take(typedSince: "")?.text == "two") // nothing typed is lost
    }

    @Test func aTappedAnswerStaysOnScreenAndKeepsItsKey() async throws {
        let outbox = Outbox()
        var answers = AnswerKeys()
        let key = answers.of("Send it")
        #expect(answers.of("Send it") == key)
        #expect(answers.of("Not yet") != key)

        var sent: [String] = []
        let went = await outbox.send("Send it", box: false, key: key, once: true) { sent.append($0); throw URLError(.cannotConnectToHost) }
        #expect(!went)
        #expect(outbox.note == Self.cantReach)
        #expect(outbox.back == nil) // it is still there to tap: nothing goes into the box
        await outbox.send("Send it", box: false, key: answers.of("Send it"), once: true) { sent.append($0) }
        #expect(sent == [key, key])
        #expect(outbox.note == nil)
    }

    @Test func anAnswerThatCouldNotBeReadIsAMessageThatWent() async throws {
        let outbox = Outbox()
        let went = await outbox.send("hello", box: true, once: true) { _ in
            _ = try JSONDecoder().decode([String].self, from: Data("{}".utf8))
        }
        #expect(went)
        #expect(outbox.note == nil && outbox.back == nil)
    }

    @Test func aMessageToTheChiefIsKeptAndTakenOnce() async throws {
        let server = try TestServer()
        try server.reply("Here's the plan.")
        let store = try await connected(server)
        store.openChief(chatId: nil)
        let outbox = store.outbox("chief")

        // botdot took the message, and its answer was lost on the way.
        await outbox.send("Make me a news bot", box: true, once: store.takesOnce) { key in
            try await store.sendToChief("Make me a news bot", key: key)
            throw URLError(.networkConnectionLost)
        }
        #expect(outbox.note == Self.cantReach)
        #expect(outbox.take(typedSince: "")?.text == "Make me a news bot")
        try await eventually("the Chief's reply") { store.chief.messages.last?.text == "Here's the plan." }

        #expect(await store.deliverToChief("Make me a news bot"))

        #expect(outbox.note == nil)
        let chatId = try #require(store.chief.chatId)
        let chat = try await server.api("chief/chats/\(chatId)") as? [String: Any]
        let saved = (chat?["messages"] as? [[String: Any]] ?? []).filter { $0["role"] as? String == "user" }
        #expect(saved.count == 1)
        try await eventually("the chat as it is") { store.chief.messages.map(\.role) == ["user", "chief"] }
    }

    @Test func aFirstMessageWhoseChatCouldNotBeMadeIsNotSent() async throws {
        let server = try TestServer()
        let store = try await connected(server)
        store.features.remove(Feature.messageKey.rawValue)
        store.openChief(chatId: nil)
        server.stop()

        #expect(!(await store.deliverToChief("Make me a news bot")))

        #expect(store.outbox("chief").note == Self.cantReach)
        #expect(store.outbox("chief").back?.text == "Make me a news bot")
        #expect(store.chief.messages.isEmpty)
    }

    @Test func aMessageSentAfterTheServerWasLeftIsKeptAndSaidNotSent() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = try await connected(server)
        store.openBot(id)
        try await eventually("the chat to load") { store.botChat.loaded }
        store.openChief(chatId: nil)
        // Another botdot server is chosen between Send and the send itself.
        store.disconnect()

        #expect(!(await store.deliverToChief("Make me a news bot")))
        #expect(store.outbox("chief").note == Self.cantReach)
        #expect(store.outbox("chief").back?.text == "Make me a news bot")

        // A bot's message box is told the same by the send it calls.
        await #expect(throws: NotSent.self) { try await store.sendToBot("any news?") }
        let outbox = store.outbox("bot:\(id)")
        let went = await outbox.send("any news?", box: true, once: false) { key in try await store.sendToBot("any news?", key: key) }
        #expect(!went)
        #expect(outbox.note == Self.cantReach)
        #expect(outbox.back?.text == "any news?")
        #expect(try await prompts(server, id).isEmpty)
    }

    @Test func aFailedChiefReplyKeepsItsTextAndSaysItsProblem() throws {
        let chat = try JSON.decoder.decode(BotDotKit.ChiefChat.self, from: Data(#"""
        {"id":"c1","messages":[
          {"role":"chief","text":"I made the bot, then","error":"Claude stopped before it finished. Send it again."},
          {"role":"chief","text":"","error":"Claude is signed out."},
          {"role":"chief","text":"All set."},
          {"role":"chief","text":"  "},
          {"role":"chief"}
        ]}
        """#.utf8))
        let drawn = chat.messages.map(\.reply)
        // What it wrote stays, and its problem stands under it.
        #expect(drawn[0] == ChiefReply(text: "I made the bot, then", problem: "Claude stopped before it finished. Send it again."))
        #expect(drawn[1] == ChiefReply(text: nil, problem: "Claude is signed out."))
        #expect(drawn[2] == ChiefReply(text: "All set.", problem: nil))
        // An empty reply is nothing: the app writes no "Done." of its own.
        #expect(drawn[3] == ChiefReply(text: nil, problem: nil))
        #expect(drawn[4] == ChiefReply(text: nil, problem: nil))
        #expect(drawn.map(\.isEmpty) == [false, false, false, true, true])
    }
}
