import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct BotSettingsPage {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    @Test func aChangedSettingIsSavedAndShows() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("News")
        let store = try await connected(server)
        try await store.updateBot(id, ["name": "Morning News", "color": "#d4537e", "allowedTools": ["WebSearch", "WebFetch"]])
        #expect(store.bots.first?.name == "Morning News")
        let saved = try await server.api("bots/\(id)") as? [String: Any]
        #expect(saved?["color"] as? String == "#d4537e")
        #expect(saved?["allowedTools"] as? [String] == ["WebSearch", "WebFetch"])
    }

    @Test func deletingABotTakesItOutOfTheSidebar() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Temp")
        let store = try await connected(server)
        _ = try await store.deleteBot(id)
        #expect(store.bots.isEmpty)
    }

    @Test func theModelsAndReasoningLevelsComeFromTheServer() async throws {
        let server = try TestServer()
        let store = try await connected(server)
        let s = try await store.settings()
        #expect(!s.models.isEmpty)
        #expect(s.efforts.map(\.id).contains("high"))
    }
}
