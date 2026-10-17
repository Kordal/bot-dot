import Foundation
import Testing
@testable import BotDotKit

/// "Use another saved login" in a login request (docs/api.md "Login requests").
@MainActor
@Suite struct OtherLoginsTests {
    func request(_ json: String) throws -> LoginRequest { try JSONDecoder().decode(LoginRequest.self, from: Data(json.utf8)) }
    func other(_ id: String, _ name: String, _ username: String, _ site: String) -> LoginRequest.Other {
        LoginRequest.Other(id: id, name: name, username: username, site: site)
    }
    var many: [LoginRequest.Other] { (1...7).map { other("l\($0)", "Login \($0)", "user\($0)", "site\($0).example.net") } }

    @Test func aRequestIsReadWithOtherLoginsWithoutThemAndWithAFieldThisAppDoesNotKnow() throws {
        let with = try request(#"{"id":"r1","site":"shop.example.com","others":[{"id":"a","name":"Food","username":"bart","site":"food.example.org","later":true},{"id":"b"}]}"#)
        #expect(OtherLogins.of(with).map(\.id) == ["a", "b"])
        #expect(OtherLogins.of(with)[0].site == "food.example.org")
        let without = try request(#"{"id":"r2","site":"shop.example.com"}"#)
        #expect(OtherLogins.of(without).isEmpty)
        let card = try request(#"{"id":"r3","kind":"card","site":"shop.example.com","others":[{"id":"a"}]}"#)
        #expect(OtherLogins.of(card).isEmpty)
    }

    @Test func onlyAListOfMoreThanSixHasTheSearch() {
        #expect(OtherLogins.hasSearch(many))
        #expect(!OtherLogins.hasSearch(Array(many.prefix(6))))
    }

    @Test func aRowStaysWhenEveryTypedWordIsInItsNameUsernameOrWebsite() {
        let e = other("p", "Proxmox token", "root@pam!bot", "pve.example.net")
        #expect(OtherLogins.matches(e, ""))
        #expect(OtherLogins.matches(e, "  "))
        #expect(OtherLogins.matches(e, "PROX"))
        #expect(OtherLogins.matches(e, "root@"))
        #expect(OtherLogins.matches(e, "example.net"))
        #expect(OtherLogins.matches(e, "token  pve"))
        #expect(!OtherLogins.matches(e, "token zzz"))
        #expect(OtherLogins.shown(many, "site3").map(\.id) == ["l3"])
        #expect(OtherLogins.shown(many, "nothing").isEmpty)
        #expect(OtherLogins.shown(many, "").count == 7)
    }

    @Test func theSecondQuestionIsAboutALoginTheListStillHas() {
        #expect(OtherLogins.picked(many, "l2")?.name == "Login 2")
        #expect(OtherLogins.picked(many, "gone") == nil)
        #expect(OtherLogins.picked(many, nil) == nil)
    }

    @Test func theConfirmationNamesTheLoginItsWebsiteAndTheRequestedHost() throws {
        let r = try request(#"{"id":"r1","site":"shop.example.com"}"#)
        let c = OtherLogins.confirm(r, other("a", "Recipes", "bart", "food.example.org"), by: "Shopper")
        #expect(c.login == "Recipes")
        #expect(c.savedFor == "saved for food.example.org")
        #expect(c.host == "shop.example.com")
        #expect(c.warning == "Its password will also be used on shop.example.com, by Shopper. Only continue if shop.example.com really takes this login: web pages can try to trick bots into asking.")
        #expect(c.yes == "Use it on shop.example.com")
        #expect(OtherLogins.confirm(r, other("a", "Token", "", ""), by: "Shopper").savedFor == "saved without a website")
    }

    @Test func answeringWithALoginOfAnotherWebsiteAddsTheHostAndTheBot() async throws {
        let server = try TestServer()
        let bot = try await server.makeBot("Shopper")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        try await store.saveVaultLogin(id: nil, name: "Food", site: "food.example.org", username: "bart", password: "fixture-pass", insecureTls: false, bots: [])
        try await server.api("vault/requests", method: "POST", body: ["site": "shop.example.com", "forBot": bot], asChief: true)
        try await eventually("the request") { !store.loginRequests.isEmpty }
        let r = try #require(store.loginRequests.first)
        let e = try #require(OtherLogins.of(r).first)
        #expect(e.name == "Food" && e.site == "food.example.org")

        try await store.allowLogin(r, loginId: e.id)
        let item = try #require(try await store.vault().first)
        #expect(item.allowedHosts == ["shop.example.com"])
        #expect(item.allowedBots.contains(bot))
        try await eventually("the request to close") { store.loginRequests.isEmpty }
    }

    @Test func aLoginWithTwentyHostsIsRefusedAndTheRequestStaysOpen() async throws {
        let server = try TestServer()
        let bot = try await server.makeBot("Shopper")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        try await store.saveVaultLogin(id: nil, name: "Food", site: "food.example.org", username: "bart", password: "fixture-pass", insecureTls: false, bots: [], allowedHosts: (1...20).map { "h\($0).example.org" })
        try await server.api("vault/requests", method: "POST", body: ["site": "shop.example.com", "forBot": bot], asChief: true)
        try await eventually("the request") { !store.loginRequests.isEmpty }
        let r = try #require(store.loginRequests.first)
        let e = try #require(OtherLogins.of(r).first)

        await #expect(throws: (any Error).self) { try await store.allowLogin(r, loginId: e.id) }
        await store.loadNeeds()
        #expect(store.loginRequests.map(\.id) == [r.id])
    }
}
