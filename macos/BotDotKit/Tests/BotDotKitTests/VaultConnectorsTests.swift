import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct VaultAndConnectors {
    @Test func aLoginIsSavedChangedAndDeletedWithoutItsPasswordComingBack() async throws {
        let server = try TestServer()
        let bot = try await server.makeBot("Shopper")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)

        try await store.saveVaultLogin(id: nil, name: "Shop", site: "shop.example.com", username: "me", password: "s3cret-pass", insecureTls: false, bots: [bot])
        var items = try await store.vault()
        #expect(items.map(\.name) == ["Shop"])
        #expect(items[0].allowedBots == [bot])
        #expect(items[0].isLogin)
        let raw = String(decoding: try JSONSerialization.data(withJSONObject: try await server.api("vault")), as: UTF8.self)
        #expect(!raw.contains("s3cret-pass"))

        // An empty password keeps the saved one.
        try await store.saveVaultLogin(id: items[0].id, name: "Shop", site: "shop.example.com", username: "me2", password: "", insecureTls: true, bots: [])
        items = try await store.vault()
        #expect(items[0].username == "me2")
        #expect(items[0].allowedBots.isEmpty)
        #expect(items[0].insecureTls == true)

        try await store.deleteVaultItem(items[0].id)
        #expect(try await store.vault().isEmpty)
        #expect(try await store.bitwardenDetails().configured == false)
    }

    @Test func connectorsSayWhyTheyArentWorking() async throws {
        // The test server can't reach Composio, so botdot can't set up its account.
        let server = try TestServer()
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        let c = try await store.connectors()
        #expect(c.configured == false)
        #expect(c.error?.isEmpty == false)
        #expect(c.connections.isEmpty)
    }

    @Test func catalogPagesReadWithEitherKindOfOffset() throws {
        let a = try JSON.decoder.decode(CatalogPage.self, from: Data(#"{"items":[{"slug":"gmail","name":"Gmail","categories":["Email"],"toolsCount":60,"connect":"signin"}],"nextOffset":20,"total":900}"#.utf8))
        #expect(a.nextOffset == "20")
        #expect(a.items[0].subtitle == "Email · 60 actions")
        let b = try JSON.decoder.decode(CatalogPage.self, from: Data(#"{"items":[],"nextOffset":null,"total":0}"#.utf8))
        #expect(b.nextOffset == nil)
    }
}
