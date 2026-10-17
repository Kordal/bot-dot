import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct BotChat {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    @Test func messagingABotShowsTheTaskThenItsReply() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        try server.reply("Found **3** articles.")
        let store = try await connected(server)

        store.openBot(id)
        try await store.sendToBot("any news?")

        try await eventually("the reply") { store.botChat.runs.last?.status == "success" }
        let run = try #require(store.botChat.runs.last)
        #expect(run.prompt == "any news?")
        #expect(run.result == "Found **3** articles.")
        #expect(run.durationMs != nil)
    }

    @Test func whileItWorksItsStepsShowInWords() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Web Surfer")
        try server.steps([("WebSearch", ["query": "game news"]), ("WebFetch", ["url": "https://www.example.com/a"])])
        try server.hold()
        let store = try await connected(server)
        store.openBot(id)
        try await store.sendToBot("look it up")

        try await eventually("its steps") { store.botChat.live?.steps.count == 2 }
        #expect(store.botChat.live?.steps.map(\.text) == ["Searching the web for “game news”", "Reading example.com"])
        #expect(store.botChat.live?.activity == "Reading example.com…")
        try server.unhold()
        try await eventually("the run to end") { store.botChat.live == nil && store.botChat.runs.last?.status == "success" }
    }

    @Test func stopEndsTheRunAndSaysSo() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Slow")
        try server.hold()
        let store = try await connected(server)
        store.openBot(id)
        try await store.sendToBot("take your time")
        try await eventually("it to work") { store.botChat.runs.last?.status == "running" }

        await store.stopRun(try #require(store.botChat.runs.last?.id))

        try await eventually("it to stop") { store.botChat.runs.last?.status == "stopped" }
        #expect(store.botChat.runs.last?.problemText == "You stopped this run before it finished.")
    }

    @Test func runningItsUsualTaskSendsNoMessage() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = try await connected(server)
        store.openBot(id)
        try await store.sendToBot(nil)
        try await eventually("the run") { store.botChat.runs.last?.status == "success" }
        #expect(store.botChat.runs.last?.customPrompt == false)
    }

    @Test func aQuestionAtTheEndComesWithQuickAnswers() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Mail")
        try server.reply("Draft ready. Should I send it?\n[[choices: Send it | Not yet]]")
        let store = try await connected(server)
        store.openBot(id)
        try await store.sendToBot("write to Ann")
        try await eventually("the reply") { store.botChat.runs.last?.status == "success" }
        #expect(store.botChat.runs.last?.result == "Draft ready. Should I send it?")
        #expect(store.botChat.runs.last?.choices == ["Send it", "Not yet"])
    }

    @Test func severalQuestionsComeAsACardAndAreAnsweredInOneMessage() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Mail")
        try server.reply("Two things first.\n\n[[ask: Which account?]]\n[[ask: Who is in copy?]]")
        let store = try await connected(server)
        store.openBot(id)
        try await store.sendToBot("write to Ann")
        try await eventually("the questions") { store.botChat.runs.last?.questions != nil }
        #expect(store.botChat.runs.last?.result == "Two things first.")
        let questions = try #require(store.botChat.runs.last?.questions)
        #expect(questions == ["Which account?", "Who is in copy?"])
        let answer = Questions.answer(questions, ["Work ", ""])
        #expect(answer == "Which account?\n→ Work\n\nWho is in copy?\n→ –")
        try server.reply("Sent.")
        try await store.sendToBot(answer)
        try await eventually("the answer") { store.botChat.runs.last?.result == "Sent." }
        #expect(store.botChat.runs.last?.prompt == answer)
    }

    @Test func detailsListEveryStep() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Web Surfer")
        try server.steps([("WebSearch", ["query": "game news"]), ("Bash", ["command": "ls", "description": "List the files"])])
        try server.reply("Done here.")
        let store = try await connected(server)
        store.openBot(id)
        try await store.sendToBot("go")
        try await eventually("the reply") { store.botChat.runs.last?.status == "success" }

        let details = try await store.runDetails(try #require(store.botChat.runs.last?.id))
        #expect(details.run.prompt == "go")
        #expect(details.answer == "Done here.")
        #expect(details.transcript.compactMap(\.toolName) == ["WebSearch", "Bash"])
        #expect(details.transcript.compactMap(\.toolArgument) == ["game news", "ls"])
    }

    @Test func tappingAQuickAnswerSendsIt() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Mail")
        try server.reply("Should I send it?\n[[choices: Send it | Not yet]]")
        let store = try await connected(server)
        store.openBot(id)
        try await store.sendToBot("write to Ann")
        try await eventually("the question") { store.botChat.runs.last?.choices != nil }
        try server.reply("Sent.")
        try await store.sendToBot("Send it")
        try await eventually("the answer") { store.botChat.runs.last?.result == "Sent." }
        #expect(store.botChat.runs.map(\.prompt) == ["write to Ann", "Send it"])
    }

    @Test func aTaskFromTheChiefFoldsToTwoLines() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Fleet Doctor")
        try server.reply("All servers are fine.")
        let store = try await connected(server)
        store.openBot(id)
        // As the Chief hands a bot a task, with its own key.
        try await server.api("bots/\(id)/run", method: "POST", body: ["prompt": "check the servers"], asChief: true)
        try await eventually("the reply") { store.botChat.runs.last?.status == "success" }
        let run = try #require(store.botChat.runs.last)
        #expect(run.sender?.name == "Chief of Staff")
        #expect(run.exchange.prefix == "Replied to")
        #expect(run.exchange.who.map(\.name) == ["Chief of Staff"])
    }

    @Test func aScriptRunShowsItsOutputEvenWhenItFails() async throws {
        let run = RunSummary(id: "r", botId: "b", kind: "script", status: "error", result: "disk full\n", error: "exit 1")
        #expect(run.replyText == "disk full")
        #expect(RunSummary(id: "r", botId: "b", kind: "script", status: "success").replyText == "No output.")
        #expect(RunSummary(id: "r", botId: "b", status: "stopped").replyText == "You stopped this run before it finished.")
        #expect(RunSummary(id: "r", botId: "b", status: "success").replyText == "Done. (No written reply.)")
    }
}
