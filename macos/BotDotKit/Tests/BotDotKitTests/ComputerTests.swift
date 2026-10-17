import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct Computer {
    @Test func aBotWithoutAComputerSaysSoAndItsScreenAddressIsBotdots() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Web Surfer")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        #expect(try await store.computer(id).state == "none")
        let url = try #require(store.screenURL(id, control: true))
        #expect(url.path == "/computer/\(id)/vnc.html")
        #expect(url.query?.contains("view_only=0") == true)
        #expect(store.screenURL(id, control: false)?.query?.contains("view_only=1") == true)
    }
}
