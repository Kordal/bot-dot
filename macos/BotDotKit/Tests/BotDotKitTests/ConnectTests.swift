import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct Connecting {
    @Test func aBotdotServerShowsTheChiefAndItsBots() async throws {
        let server = try TestServer()
        _ = try await server.makeBot("Web Surfer")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        #expect(store.connected)
        #expect(store.bots.map(\.name) == ["Web Surfer"])
    }

    @Test func anAddressWithoutAPortOrSchemeIsUnderstood() async throws {
        let server = try TestServer()
        let store = Store()
        try await store.connect(to: "localhost:\(server.base.port!)")
        #expect(store.connected)
    }

    @Test func anAddressWhereNothingAnswersSaysSoPlainly() async throws {
        let store = Store()
        let error = await #expect(throws: ConnectError.self) { try await store.connect(to: "127.0.0.1:9") }
        #expect(error?.message == "No botdot server answers at 127.0.0.1.")
        #expect(!store.connected)
    }

    @Test func aWebServerThatIsNotBotdotSaysSoPlainly() async throws {
        let server = try TestServer()
        let store = Store()
        let error = await #expect(throws: ConnectError.self) { try await store.connect(to: server.base.absoluteString + "/somewhere-else") }
        #expect(error?.message == "That address isn't a botdot server.")
        #expect(!store.connected)
    }
}
