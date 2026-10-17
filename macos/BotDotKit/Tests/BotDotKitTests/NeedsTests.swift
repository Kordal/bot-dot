import Foundation
import Testing
@testable import BotDotKit

@MainActor
@Suite struct NeedsYou {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    @Test func aScriptJobTheChiefSetUpWaitsInNeedsYouAndInTheChiefChatUntilApproved() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Servers")
        let store = try await connected(server)
        try await server.api("bots/\(id)/jobs", method: "POST", body: ["name": "Disk check", "kind": "script", "script": "df -h", "cron": "0 9 * * *", "assessment": "a rule, no AI"], asChief: true)

        try await eventually("the job to wait") { store.needs.contains { $0.title == "Disk check" } }
        let item = try #require(store.needs.first { $0.title == "Disk check" })
        #expect(item.kind == .job)
        #expect(item.meta == "Daily at 09:00 · a script, no AI · added by the Chief")
        #expect(item.body == ["df -h"])
        #expect(store.chatNeeds(.chief).map(\.key) == [item.key])
        #expect(store.chatNeeds(.bot(id)).isEmpty)

        try await store.decide(item, yes: true)
        try await eventually("it to be approved") { store.needs.isEmpty }
    }

    @Test func aRefusedCommandAsksForThePermissionInTheBotsChat() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Coder")
        try await server.api("bots/\(id)", method: "PUT", body: ["allowedTools": ["Read"]])
        try server.refuse([["tool_name": "Bash", "tool_use_id": "t1", "tool_input": ["command": "gh pr list", "description": "List open pull requests"]]])
        let store = try await connected(server)
        try await server.api("bots/\(id)/run", method: "POST", body: ["prompt": "Check the PRs"])

        try await eventually("the permission card") { store.chatNeeds(.bot(id)).contains { $0.kind == .permission } }
        let ask = try #require(store.chatNeeds(.bot(id)).first)
        #expect(ask.title == "Let it run commands?")
        try await store.decide(ask, yes: true)
        try await eventually("it to be allowed") { store.needs.isEmpty }
    }

    @Test func aLoginRequestIsAnsweredWithANewLogin() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Shopper")
        let store = try await connected(server)
        try await server.api("vault/requests", method: "POST", body: ["site": "example.com", "forBot": id, "reason": "to check the order"], asChief: true)

        try await eventually("the login request") { store.needs.contains { $0.kind == .login } }
        let item = try #require(store.needs.first { $0.kind == .login })
        #expect(item.title == "A login for example.com")
        let request = try #require(item.loginRequest)
        try await store.saveLogin(request, username: "me@example.com", password: "s3cret-pass", name: "Example", insecureTls: false, unlockPassword: nil)
        try await eventually("the request to close") { !store.needs.contains { $0.kind == .login } }
        let vault = try await server.api("vault") as? [[String: Any]]
        #expect(vault?.contains { $0["username"] as? String == "me@example.com" } == true)
    }

    @Test func decliningALoginRequestClosesIt() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Shopper")
        let store = try await connected(server)
        try await server.api("vault/requests", method: "POST", body: ["site": "shop.test", "forBot": id], asChief: true)
        try await eventually("the request") { store.needs.contains { $0.kind == .login } }
        try await store.declineRequest(try #require(store.needs.first?.loginRequest))
        try await eventually("it to close") { store.needs.isEmpty }
    }
}

@MainActor
@Suite struct NeedsYouAll {
    @Test func approvingSeveralJobsInARowLeavesNoneWaiting() async throws {
        let server = try TestServer()
        let id = try await server.makeBot("Servers")
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        for name in ["Backup check", "Uptime check"] {
            try await server.api("bots/\(id)/jobs", method: "POST", body: ["name": name, "kind": "script", "script": "echo ok", "cron": "0 */6 * * *", "assessment": "a rule"], asChief: true)
        }
        try await eventually("both to wait") { store.needs.count == 2 }
        for x in store.needs { try await store.decide(x, yes: true) }
        #expect(store.needs.isEmpty)
    }
}
