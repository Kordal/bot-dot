import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct Team {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    @Test func aTeammatesNoteWaitsInTheChatThenShowsWithTheRunThatReadIt() async throws {
        let server = try TestServer()
        let surfer = try await server.makeBot("Web Surfer", color: "#378add")
        let news = try await server.makeBot("News", color: "#1d9e75")
        let store = try await connected(server)
        store.openBot(news)

        try server.hold()
        try await server.api("bots/\(surfer)/run", method: "POST", body: ["prompt": "look around"])
        try await server.selfTool("message", ["to": news, "message": "Prefer sources from the last 24 hours.", "priority": false])
        try server.unhold()

        try await eventually("the note, waiting") { store.botChat.notes.map(\.from) == ["Web Surfer"] }
        #expect(store.botChat.notes.first?.text == "Prefer sources from the last 24 hours.")

        try await store.sendToBot("any news?")
        try await eventually("the run that read it") { store.botChat.runs.last?.status == "success" }
        try await eventually("no note waiting") { store.botChat.notes.isEmpty }
        #expect(store.botChat.runs.last?.inbox?.map(\.from) == ["Web Surfer"])
    }

    @Test func aMessageFromATeammateStartsARunThatFoldsToItsSender() async throws {
        let server = try TestServer()
        let surfer = try await server.makeBot("Web Surfer")
        let news = try await server.makeBot("News")
        let store = try await connected(server)
        store.openBot(news)
        try server.hold()
        try await server.api("bots/\(surfer)/run", method: "POST", body: ["prompt": "ask News"])
        try await server.selfTool("message", ["to": news, "message": "What's new in games?", "priority": true])
        try server.unhold()
        try server.releaseAll()
        try await eventually("its run", seconds: 15) { store.botChat.runs.last?.trigger == "bot" && store.botChat.runs.last?.status == "success" }
        #expect(store.botChat.runs.last?.sender?.name == "Web Surfer")
    }

    @Test func aNoteABotKeptShowsNothingUnderItsReply() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Cook")
        let store = try await connected(server)
        store.openBot(id)
        try server.hold()
        try await store.sendToBot("I'm vegetarian")
        try await eventually("it to work") { store.botChat.live != nil }
        try await server.selfTool("memory", ["action": "add", "text": "The owner is vegetarian."])
        try server.unhold()
        try await eventually("the reply") { store.botChat.runs.last?.status == "success" }
        // The note is kept, and no row says so (ADR 024).
        #expect(store.chips(of: try #require(store.botChat.runs.last)).isEmpty)
        let bots = (try await server.api("memory") as? [String: Any])?["bots"] as? [[String: Any]]
        let notes = (bots?.first { $0["id"] as? String == id }?["notes"] as? [[String: Any]] ?? []).compactMap { $0["text"] as? String }
        #expect(notes.contains { $0.contains("The owner is vegetarian.") })
    }
}
