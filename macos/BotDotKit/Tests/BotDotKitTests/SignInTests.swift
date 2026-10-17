import Foundation
import Testing
@testable import BotDotKit

/// A machine of one account, as the Mac's local botdot server is (ADR 028): a real test botdot server behind the
/// real front door, with a setup key (test/fixtures/test-front-door.js). `open(_:)` does the work of the sign-in
/// sheet's page with a software passkey, and gives back the address the sheet ends at.
final class TestFrontDoor: @unchecked Sendable {
    let base: URL
    let setupKey: String
    private let process: Process
    private let stdin: Pipe
    private let stdout: Pipe

    init() throws {
        process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "test/fixtures/test-front-door.js"]
        process.currentDirectoryURL = TestServer.repo
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        process.environment = env
        stdin = Pipe()
        stdout = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        try process.run()
        let line = Self.readLine(stdout)
        struct Where: Decodable { let base: String; let setupKey: String }
        guard let w = try? JSONDecoder().decode(Where.self, from: line), let url = URL(string: w.base) else {
            throw NSError(domain: "TestFrontDoor", code: 1, userInfo: [NSLocalizedDescriptionKey: "The test front door didn't start: \(String(decoding: line, as: UTF8.self))"])
        }
        base = url
        setupKey = w.setupKey
    }

    deinit {
        guard process.isRunning else { return }
        try? stdin.fileHandleForWriting.close()
        process.waitUntilExit()
    }

    private static func readLine(_ pipe: Pipe) -> Data {
        var line = Data()
        while true {
            let byte = pipe.fileHandleForReading.readData(ofLength: 1)
            if byte.isEmpty || byte == Data("\n".utf8) { break }
            line.append(byte)
        }
        return line
    }

    private func ask(_ question: [String: Any]) throws -> [String: String] {
        stdin.fileHandleForWriting.write(try JSONSerialization.data(withJSONObject: question) + Data("\n".utf8))
        return (try? JSONDecoder().decode([String: String].self, from: Self.readLine(stdout))) ?? [:]
    }

    /// The sheet opens `page`: the passkey is made (sign-up) or signs in, and the page sends the sheet on.
    func open(_ page: URL) throws -> URL {
        let answer = try ask(["open": page.absoluteString])
        guard let callback = answer["callback"].flatMap(URL.init(string:)) else {
            throw NSError(domain: "TestFrontDoor", code: 2, userInfo: [NSLocalizedDescriptionKey: answer["error"] ?? "No answer"])
        }
        return callback
    }

    /// A sign-in in a browser, for a session in another app: its cookie.
    func browserSignIn() throws -> String { try ask(["signIn": true])["cookie"] ?? "" }
}

/// The Mac app signs in with the passkey through the front door's sheet, keeps its session, and signs out
/// everywhere (#469).
@MainActor
@Suite struct SignIn {
    @Test func theFrontDoorAsksForASignInAndTheSetupKeyMakesThePasskeyThatSignsTheAppIn() async throws {
        let door = try TestFrontDoor()
        let keep = MemorySecrets()
        let store = Store(sessions: Sessions(keep: keep))
        try await store.connect(to: door.base.absoluteString)
        #expect(!store.connected)
        #expect(store.signInNeeded == door.base)

        // The sheet's page is the one-account sign-up, opened with the setup key, and carries only the challenge.
        #expect(await store.signUpOpens(at: door.base, setupKey: door.setupKey))
        let handoff = Handoff()
        let page = handoff.page(at: door.base, setupKey: door.setupKey)
        #expect(page.path == "/sign-up/\(door.setupKey)")
        #expect(page.query?.contains("app=mac") == true)
        #expect(page.query?.contains("handoff=\(handoff.challenge)") == true)
        #expect(page.query?.contains(handoff.verifier) == false)
        let callback = try door.open(page)
        #expect(callback.scheme == Handoff.callbackScheme)

        try await store.signIn(at: door.base, handoff: handoff, callback: callback)
        #expect(store.connected)
        #expect(store.signInNeeded == nil)
        try await store.loadBots() // botdot's own answers come through the front door
        #expect(store.sessions.token(for: door.base) != nil)
        // Kept: only the session's secret, by address.
        #expect(keep.get(Sessions.origin(of: door.base)) == store.sessions.token(for: door.base))

        // The setup key works once: the next sign-in uses the passkey.
        #expect(await store.signUpOpens(at: door.base, setupKey: door.setupKey) == false)
        // A code with another secret signs nobody in.
        let other = Store(sessions: Sessions())
        let stolen = try door.open(Handoff().page(at: door.base))
        await #expect(throws: (any Error).self) { try await other.signIn(at: door.base, handoff: Handoff(), callback: stolen) }
        #expect(!other.connected)
    }

    @Test func theSessionIsKeptAcrossARestartAndSignOutEverywhereEndsItHereAndElsewhere() async throws {
        let door = try TestFrontDoor()
        let keep = MemorySecrets()
        let first = Store(sessions: Sessions(keep: keep))
        let handoff = Handoff()
        try await first.signIn(at: door.base, handoff: handoff, callback: try door.open(handoff.page(at: door.base, setupKey: door.setupKey)))
        #expect(first.connected)

        // The app starts again: the same session, no sign-in.
        let again = Store(sessions: Sessions(keep: keep))
        try await again.connect(to: door.base.absoluteString)
        #expect(again.connected)
        #expect(again.signInNeeded == nil)

        // A browser is signed in too; then "Sign out everywhere" from the app.
        let browser = try door.browserSignIn()
        #expect(browser.hasPrefix("botdot_session="))
        try await again.signOutEverywhere()
        #expect(!again.connected)
        #expect(again.signInNeeded == door.base)
        #expect(keep.get(Sessions.origin(of: door.base)) == nil)
        var req = URLRequest(url: door.base.appendingPathComponent("api/bots"))
        req.httpShouldHandleCookies = false
        req.setValue(browser, forHTTPHeaderField: "Cookie")
        let (_, answer) = try await URLSession.shared.data(for: req)
        #expect((answer as? HTTPURLResponse)?.statusCode == 401, "the browser's session ended too")

        // The first Store, still showing botdot, finds its session ended at its next request, and asks for a sign-in.
        #expect(first.connected)
        try? await first.loadBots()
        try await eventually("the sign-in is asked again") { first.signInNeeded == door.base && !first.connected }

        // The passkey signs in again (no setup key now).
        let h = Handoff()
        try await again.signIn(at: door.base, handoff: h, callback: try door.open(h.page(at: door.base)))
        #expect(again.connected)
    }

    @Test func aHandoffIsItsOwnSecretAndItsChallengesSHA256() throws {
        let a = Handoff(), b = Handoff()
        #expect(a.verifier != b.verifier)
        #expect(a.challenge.count == 43)
        #expect(!a.challenge.contains("=") && !a.challenge.contains("+") && !a.challenge.contains("/"))
        #expect(Handoff.code(in: URL(string: "botdot://signed-in?code=abc")!) == "abc")
        #expect(Handoff.code(in: URL(string: "https://evil.example/signed-in?code=abc")!) == nil)
        #expect(Sessions.origin(of: URL(string: "http://LocalHost:4747/api/bots")!) == "http://localhost:4747")
        #expect(Sessions.origin(of: URL(string: "https://my-vm.ts.net:443/")!) == "https://my-vm.ts.net")
    }
}
