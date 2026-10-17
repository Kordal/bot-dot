import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct Searching {
    @Test func findsWordsInABotsChatAndInTheChiefsWithWhereToOpenThem() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Coder")
        try server.reply("The GitHub token expires on 24 December.")
        try await server.runToEnd(id, "When does the token expire?")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)

        var hits: [SearchHit] = []
        try await eventuallyAsync("the run to be indexed") { hits = try await store.search("github toke"); return !hits.isEmpty }
        #expect(hits.first?.bot?.name == "Coder")
        #expect(hits.first?.runId != nil)
        #expect(hits.first?.snippet?.contains("«GitHub»") == true)
        #expect(try await store.search("github pineapple").isEmpty)
        #expect(try await store.search("g").isEmpty) // too short to look for

        store.openChief(chatId: nil)
        try server.reply("Your pineapple order is on its way.")
        try await store.sendToChief("Where is my order?")
        try await eventuallyAsync("the reply to be indexed") { hits = try await store.search("pineapple"); return !hits.isEmpty }
        #expect(hits.first?.chatId == store.chief.chatId)
        #expect(hits.first?.index == 1)
        #expect(hits.first?.title == "Where is my order?")
    }

    @Test func theSearchedWordsAreTheOnesToMark() {
        #expect(SearchHit.terms("  GitHub toke ") == ["github", "toke"])
        #expect(SearchHit.terms("a").isEmpty)
    }
}
