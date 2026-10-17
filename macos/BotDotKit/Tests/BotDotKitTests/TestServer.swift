import Foundation

/// A real botdot server for a test: the repo's test/fixtures/test-server.js (scratch data, the
/// stand-in Claude), stopped when the test is done. Steer the stand-in Claude with `reply(_:)`, and
/// set things up the way the Node tests do, through the API.
final class TestServer: @unchecked Sendable {
    let base: URL
    let out: URL
    let data: URL
    let chiefKey: String
    private let process: Process
    private let stdin: Pipe

    static let repo = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()

    /// `env`: extra settings for the server (TEST_SERVER_ENV in test-server.js). `seed`: bots that
    /// start with runs of their own (TEST_SERVER_SEED): `[["bot": ["name": …], "runs": [["result": …], ["quiet": true, "times": 60]]]]`.
    init(env: [String: String] = [:], seed: [[String: Any]] = []) throws {
        process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "test/fixtures/test-server.js"]
        process.currentDirectoryURL = Self.repo
        let extra = env
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        if !extra.isEmpty { env["TEST_SERVER_ENV"] = String(decoding: try JSONEncoder().encode(extra), as: UTF8.self) }
        if !seed.isEmpty { env["TEST_SERVER_SEED"] = String(decoding: try JSONSerialization.data(withJSONObject: seed), as: UTF8.self) }
        process.environment = env
        stdin = Pipe()
        let stdout = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        try process.run()
        var line = Data()
        while true {
            let byte = stdout.fileHandleForReading.readData(ofLength: 1)
            if byte.isEmpty || byte == Data("\n".utf8) { break }
            line.append(byte)
        }
        struct Where: Decodable { let base: String; let out: String; let data: String; let chiefKey: String }
        guard let w = try? JSONDecoder().decode(Where.self, from: line), let url = URL(string: w.base) else {
            throw NSError(domain: "TestServer", code: 1, userInfo: [NSLocalizedDescriptionKey: "The test botdot server didn't start: \(String(decoding: line, as: UTF8.self))"])
        }
        base = url
        out = URL(fileURLWithPath: w.out)
        chiefKey = w.chiefKey
        data = URL(fileURLWithPath: w.data)
    }

    deinit { stop() }

    func stop() {
        guard process.isRunning else { return }
        try? stdin.fileHandleForWriting.close()
        process.waitUntilExit()
    }

    /// What the stand-in Claude answers from now on.
    func reply(_ text: String) throws {
        try text.write(to: out.appendingPathComponent("result.txt"), atomically: true, encoding: .utf8)
    }

    /// Tool calls the stand-in Claude reports while it works (Claude Code's stream-json lines).
    func steps(_ tools: [(name: String, input: [String: Any])]) throws {
        let events = tools.enumerated().map { i, t in
            ["type": "assistant", "message": ["content": [["type": "tool_use", "id": "tool-\(i)", "name": t.name, "input": t.input]]]] as [String: Any]
        }
        try JSONSerialization.data(withJSONObject: events).write(to: out.appendingPathComponent("events.json"))
    }

    /// The stand-in Claude's runs so far, by the name it gave each (run-<n>.json).
    func runs() throws -> Set<String> {
        Set(try FileManager.default.contentsOfDirectory(atPath: out.path).filter { $0.hasPrefix("run-") && $0.hasSuffix(".json") }.map { String($0.dropFirst(4).dropLast(5)) })
    }

    /// The run the stand-in Claude started since `known`, once it is there.
    func newRun(since known: Set<String>) async throws -> String {
        for _ in 0..<200 {
            if let n = try runs().subtracting(known).first { return n }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw NSError(domain: "TestServer", code: 5, userInfo: [NSLocalizedDescriptionKey: "No new run started"])
    }

    /// What a held run of the stand-in Claude has reported so far: all of it, each time (events-<n>.json).
    func play(_ events: [[String: Any]], into run: String) throws {
        try JSONSerialization.data(withJSONObject: events).write(to: out.appendingPathComponent("events-\(run).json"), options: .atomic)
    }

    /// Claude Code's stream-json lines: text it wrote, and a tool it called.
    static func says(_ text: String) -> [String: Any] {
        ["type": "assistant", "message": ["content": [["type": "text", "text": text]]]]
    }
    static func uses(_ name: String = "WebSearch", _ input: [String: Any] = ["query": "weather Brussels"]) -> [String: Any] {
        ["type": "assistant", "message": ["content": [["type": "tool_use", "id": "t1", "name": name, "input": input]]]]
    }

    /// From now on the stand-in Claude's runs fail with this on stderr.
    func fail(_ why: String) throws {
        try why.write(to: out.appendingPathComponent("fail.txt"), atomically: true, encoding: .utf8)
    }

    /// The tools the stand-in Claude reports as refused by the bot's settings, as Claude Code does.
    func refuse(_ denials: [[String: Any]]) throws {
        try JSONSerialization.data(withJSONObject: denials).write(to: out.appendingPathComponent("denials.json"))
    }

    /// While held, the stand-in Claude's runs keep going until `unhold()`.
    func hold() throws { try Data().write(to: out.appendingPathComponent("hold")) }
    func unhold() throws {
        try FileManager.default.removeItem(at: out.appendingPathComponent("hold"))
        // Runs held so far finish too.
        for f in try FileManager.default.contentsOfDirectory(atPath: out.path) where f.hasPrefix("run-") && f.hasSuffix(".json") {
            let n = f.dropFirst(4).dropLast(5)
            try Data().write(to: out.appendingPathComponent("done-\(n)"))
        }
    }

    /// A call to the API as the owner, for setting things up.
    @discardableResult
    func api(_ path: String, method: String = "GET", body: [String: Any]? = nil, asChief: Bool = false, chiefChat: String? = nil) async throws -> Any {
        var req = URLRequest(url: base.appendingPathComponent("api").appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("1", forHTTPHeaderField: "X-Bot-Dot")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if asChief { req.setValue(chiefKey, forHTTPHeaderField: "X-Chief-Key") }
        // The Chief chat its tools were called from, as lib/mcp-server.js says it.
        if let chiefChat { req.setValue(chiefChat, forHTTPHeaderField: "X-Chief-Chat") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONSerialization.jsonObject(with: data)
    }

    /// The newest run's key, for the tools a bot calls while it works.
    func newestRunToken() async throws -> String {
        for _ in 0..<100 {
            var token: String?
            var newest = 0.0
            for f in try FileManager.default.contentsOfDirectory(atPath: out.path) where f.hasPrefix("run-") && f.hasSuffix(".json") {
                let rec = try JSONSerialization.jsonObject(with: Data(contentsOf: out.appendingPathComponent(f))) as? [String: Any]
                let env = (rec?["self"] as? [String: Any])?["env"] as? [String: String]
                let at = rec?["at"] as? Double ?? 0
                if let t = env?["RUN_TOKEN"], at >= newest { token = t; newest = at }
            }
            if let token { return token }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw NSError(domain: "TestServer", code: 4, userInfo: [NSLocalizedDescriptionKey: "No run is going on"])
    }

    /// A tool of the bot whose run goes on now (the newest), as its self tools call it.
    @discardableResult
    func selfTool(_ what: String, _ body: [String: Any]) async throws -> [String: Any] {
        let token = try await newestRunToken()
        var req = URLRequest(url: base.appendingPathComponent("api/self/session/\(what)"))
        req.httpMethod = "POST"
        req.setValue("1", forHTTPHeaderField: "X-Bot-Dot")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "X-Run-Token")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "TestServer", code: 3, userInfo: [NSLocalizedDescriptionKey: "\(what) failed: \(json)"]) }
        return json
    }

    /// A call of the bot whose run goes on now (the newest) to a connected app, as its tools server
    /// makes it (lib/connectors-mcp.js): "run" for an action, which a write answers with `waits` and
    /// the ask it waits for. The body is JSON as text: an action's arguments keep their order, which is
    /// the order of the card's rows. Returns botdot's answer, also when it says no.
    @discardableResult
    func connectorTool(_ what: String, json body: String) async throws -> [String: Any] {
        let token = try await newestRunToken()
        var req = URLRequest(url: base.appendingPathComponent("api/connectors/session/\(what)"))
        req.httpMethod = "POST"
        req.setValue("1", forHTTPHeaderField: "X-Bot-Dot")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "X-Run-Token")
        req.httpBody = Data(body.utf8)
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    /// A Chief chat in which the owner asked for something, once the Chief's reply ended. Returns its id.
    func chiefChat(about text: String) async throws -> String {
        let chat = try await api("chief/chats", method: "POST") as? [String: Any]
        let id = chat?["id"] as? String ?? ""
        try await api("chief/chats/\(id)/messages", method: "POST", body: ["text": text])
        for _ in 0..<200 {
            let now = try await api("chief/chats/\(id)") as? [String: Any]
            if now?["busy"] as? Bool != true, (now?["messages"] as? [Any])?.count ?? 0 > 1 { return id }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw NSError(domain: "TestServer", code: 6, userInfo: [NSLocalizedDescriptionKey: "The Chief didn't finish its reply"])
    }

    /// While a held run of this bot goes on (the newest run), the bot attaches a file from its
    /// workspace to its reply (its attach_file tool).
    func botAttaches(_ botId: String, name: String, contents: Data) async throws {
        let ws = data.appendingPathComponent("workspaces").appendingPathComponent(botId)
        try FileManager.default.createDirectory(at: ws, withIntermediateDirectories: true)
        try contents.write(to: ws.appendingPathComponent(name))
        try await selfTool("file", ["path": name])
    }

    /// Lets the held runs so far finish, and holds the next ones again.
    func releaseAll() throws {
        for f in try FileManager.default.contentsOfDirectory(atPath: out.path) where f.hasPrefix("run-") && f.hasSuffix(".json") {
            try Data().write(to: out.appendingPathComponent("done-\(f.dropFirst(4).dropLast(5))"))
        }
    }

    /// Messages a bot and waits until that run is over. Returns the run's id.
    @discardableResult
    func runToEnd(_ botId: String, _ prompt: String) async throws -> String {
        let run = try await api("bots/\(botId)/run", method: "POST", body: ["prompt": prompt]) as? [String: Any]
        let runId = run?["id"] as? String ?? ""
        for _ in 0..<200 {
            let r = try await api("runs/\(runId)") as? [String: Any]
            if let status = r?["status"] as? String, status != "running" { return runId }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw NSError(domain: "TestServer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Run \(runId) didn't end"])
    }

    /// A Chief chat with these messages, as the server stores one (what a look or a bot's report
    /// leaves there, which the API can't make directly).
    func writeChat(_ id: String, _ messages: [[String: Any]]) throws {
        let dir = data.appendingPathComponent("chief")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let chat: [String: Any] = ["id": id, "title": id, "sessionId": NSNull(), "createdAt": "2026-10-01T09:00:00.000Z", "updatedAt": "2026-10-01T10:00:00.000Z", "costUsd": 0, "messages": messages]
        try JSONSerialization.data(withJSONObject: chat).write(to: dir.appendingPathComponent("\(id).json"))
    }

    /// A bot, made the way the Chief makes one.
    func makeBot(_ name: String, color: String = "#378add", group: String = "") async throws -> String {
        let bot = try await api("bots", method: "POST", body: ["name": name, "emoji": "🧪", "prompt": "Do the test task.", "color": color, "group": group])
        return (bot as? [String: Any])?["id"] as? String ?? ""
    }
}

/// A stand-in for a connected app (Gmail through Composio), for a test botdot server: the Node tests'
/// own (test/helpers.js fakeConnectedApp), stopped when the test is done. Start the server with its
/// `env`, then `connect` it.
final class ConnectedApp: @unchecked Sendable {
    /// Where botdot finds it (COMPOSIO_API_URL).
    let env: [String: String]
    private let process: Process
    private let stdin: Pipe

    init() throws {
        process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "-e", "require('./test/helpers').fakeConnectedApp().then((app) => { console.log(JSON.stringify(app.env)); process.stdin.on('end', () => process.exit(0)); process.stdin.resume(); })"]
        process.currentDirectoryURL = TestServer.repo
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        process.environment = env
        stdin = Pipe()
        let stdout = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        try process.run()
        var line = Data()
        while true {
            let byte = stdout.fileHandleForReading.readData(ofLength: 1)
            if byte.isEmpty || byte == Data("\n".utf8) { break }
            line.append(byte)
        }
        guard let said = try? JSONDecoder().decode([String: String].self, from: line) else {
            throw NSError(domain: "ConnectedApp", code: 1, userInfo: [NSLocalizedDescriptionKey: "The stand-in connected app didn't start: \(String(decoding: line, as: UTF8.self))"])
        }
        self.env = said
    }

    deinit {
        guard process.isRunning else { return }
        try? stdin.fileHandleForWriting.close()
        process.waitUntilExit()
    }

    /// Connects the app on that server, as the owner does with a key in Settings.
    func connect(_ server: TestServer) async throws {
        try await server.api("connectors/key", method: "PUT", body: ["key": "fixture-key"])
    }
}

/// Waits until `condition` holds, checking every 50 ms, up to `seconds`.
@MainActor
func eventually(_ what: String, seconds: Double = 10, _ condition: () -> Bool) async throws {
    let end = Date().addingTimeInterval(seconds)
    while !condition() {
        if Date() > end { throw NSError(domain: "eventually", code: 1, userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for \(what)"]) }
        try await Task.sleep(for: .milliseconds(50))
    }
}

/// Waits until an async `condition` holds, checking every 100 ms, up to `seconds`.
@MainActor
func eventuallyAsync(_ what: String, seconds: Double = 10, _ condition: () async throws -> Bool) async throws {
    let end = Date().addingTimeInterval(seconds)
    while !(try await condition()) {
        if Date() > end { throw NSError(domain: "eventually", code: 1, userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for \(what)"]) }
        try await Task.sleep(for: .milliseconds(100))
    }
}
