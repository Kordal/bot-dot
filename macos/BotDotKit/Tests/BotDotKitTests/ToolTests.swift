import Foundation
import Testing
@testable import BotDotKit

/// A botdot test server that can install tools, as the server's own tests set one up (test/tools.test.js):
/// a stand-in for the registry's API and the stand-in micromamba (test/fixtures/fake-micromamba.js,
/// tools-registry.json), run as the tests' own user.
final class ToolServer: @unchecked Sendable {
    let server: TestServer
    private let registry: Process
    private let registryIn = Pipe()
    private let dir: URL

    /// The registry's API as botdot reads it: one package's record by its name.
    private static let registryScript = """
    const http = require('http');
    const R = require('./test/fixtures/tools-registry.json');
    const s = http.createServer((req, res) => {
      const m = /^\\/package\\/conda-forge\\/([^/?]+)/.exec(req.url);
      const t = m && R.tools[m[1]];
      res.writeHead(t ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(t ? { name: m[1], owner: 'conda-forge', summary: t.summary, latest_version: t.latest, conda_platforms: t.platforms, files: [] } : { error: 'not found' }));
    });
    s.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: 'http://127.0.0.1:' + s.address().port, node: process.execPath })));
    process.stdin.on('end', () => process.exit(0));
    process.stdin.resume();
    """

    init() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("botdot-mac-tools-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        registry = Process()
        registry.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        registry.arguments = ["node", "-e", Self.registryScript]
        registry.currentDirectoryURL = TestServer.repo
        registry.environment = env
        let out = Pipe()
        registry.standardInput = registryIn
        registry.standardOutput = out
        try registry.run()
        var line = Data()
        while true {
            let byte = out.fileHandleForReading.readData(ofLength: 1)
            if byte.isEmpty || byte == Data("\n".utf8) { break }
            line.append(byte)
        }
        struct Where: Decodable { let url: String; let node: String }
        guard let w = try? JSONDecoder().decode(Where.self, from: line) else {
            throw NSError(domain: "ToolServer", code: 1, userInfo: [NSLocalizedDescriptionKey: "The stand-in registry didn't start: \(String(decoding: line, as: UTF8.self))"])
        }
        // micromamba is one program: the stand-in is started through a script, as the installer's own PATH has no node.
        let micromamba = dir.appendingPathComponent("micromamba")
        let fake = TestServer.repo.appendingPathComponent("test/fixtures/fake-micromamba.js").path
        try "#!/bin/sh\nexec \"\(w.node)\" \"\(fake)\" \"$@\"\n".write(to: micromamba, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: micromamba.path)
        server = try TestServer(env: [
            "BOT_DOT_TOOLS_UNPRIVILEGED": "1", "MICROMAMBA_BIN": micromamba.path,
            "BOT_DOT_TOOLS_CACHE": dir.appendingPathComponent("tools-cache").path, "BOT_DOT_TOOL_REGISTRY_URL": w.url,
        ])
    }

    deinit {
        server.stop()
        try? registryIn.fileHandleForWriting.close()
        registry.waitUntilExit()
        try? FileManager.default.removeItem(at: dir)
    }

    /// A bot that may run commands: only such a bot can be given a tool.
    func makeBot(_ name: String) async throws -> String {
        let id = try await server.makeBot(name)
        try await server.api("bots/\(id)", method: "PUT", body: ["allowedTools": ["Read", "Bash"]])
        return id
    }

    /// The Chief asks for a tool from the registry for one bot (its `ask_install_tool`).
    @discardableResult
    func ask(_ name: String, for bot: String, reason: String = "It needs it to open the pull request.") async throws -> [String: Any] {
        let made = try await server.api("asks", method: "POST", body: ["kind": "tool", "bot": bot, "name": name, "reason": reason], asChief: true)
        return made as? [String: Any] ?? [:]
    }
}

/// A tool the Chief asks to install for a bot (docs/api.md "A tool to install"): the ask as the server
/// hands it out, the card built from it, where it shows, what its notification says, and what
/// Install and Decline send.
@MainActor
@Suite struct ToolAsks {
    // As GET /api/asks hands them out.
    static let gh = ##"""
    { "id": "a1", "kind": "tool", "botId": "coder", "botName": "Coder", "bot": { "id": "coder", "name": "Coder", "color": "#7f77dd" }, "forBots": [],
      "reason": "Coder needs it to open the pull request.", "at": "2026-10-03T09:00:00.000Z", "askedBy": "chief", "chatId": null,
      "title": "Install gh for Coder?", "meta": "asked by the Chief", "body": "Github CLI.\n\nWhy: Coder needs it to open the pull request.",
      "facts": [{ "label": "Version", "value": "2.101.0" }, { "label": "Source", "value": "botdot's registry (conda-forge), checksum verified" }, { "label": "Size", "value": "14 MB" }, { "label": "Runs as", "value": "Coder only" }, { "label": "Stays", "value": "across botdot updates" }],
      "tool": { "name": "gh", "version": "2.101.0", "summary": "Github CLI.", "source": { "type": "registry", "registry": "conda-forge" }, "platform": "linux-aarch64", "size": 13600000, "packages": 1 } }
    """##
    static let warning = "Not from botdot's registry: not checked."
    static let stripe = ##"""
    { "id": "a2", "kind": "tool", "botId": "coder", "botName": "Coder", "bot": { "id": "coder", "name": "Coder", "color": "#7f77dd" }, "forBots": [],
      "reason": "Coder needs it to replay test payments.", "at": "2026-10-03T09:05:00.000Z", "askedBy": { "bot": "coder", "runId": "r1" }, "chatId": "c1",
      "title": "Install stripe for Coder?", "meta": "from a link you gave · Coder asked the Chief",
      "body": "Stripe CLI, as described on its page. botdot has not checked what this program does.\n\nWhy: Coder needs it to replay test payments.",
      "warning": "Not from botdot's registry: not checked.", "yesOn": "card",
      "facts": [{ "label": "Version", "value": "1.31.0" }, { "label": "Source", "value": "github.com/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux_arm64.tar.gz" }, { "label": "File", "value": "stripe_1.31.0_linux_arm64.tar.gz" }, { "label": "Checksum", "value": "sha256 3f9a…c2e1" }, { "label": "Size", "value": "12 MB" }, { "label": "Runs as", "value": "Coder only" }],
      "tool": { "name": "stripe", "version": "1.31.0", "summary": "Stripe CLI", "platform": "linux-aarch64", "size": 12000000,
                "source": { "type": "link", "url": "https://github.com/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux_arm64.tar.gz", "sha256": "3f9a0c5d1e7b4a6f8c2d9e0b1a3c5d7f9e1b3a5c7d9f0e2b4a6c8d0e2f4ac2e1", "command": "stripe", "from": "owner" } } }
    """##
    /// The same from a server before `yesOn`, or with another value there.
    static func stripe(yesOn: String?) -> String {
        stripe.replacingOccurrences(of: ##" "yesOn": "card","##, with: yesOn.map { ##" "yesOn": \##($0),"## } ?? "")
    }
    /// What the feed says of it under the bot's name.
    static let stripeLine = "Asks to install stripe from a link"
    /// An ask from before the card's fields, or from a server that left them out.
    static let bare = ##"{ "id": "a3", "kind": "tool", "botId": "coder", "bot": { "id": "coder", "name": "Coder", "color": "#7f77dd" }, "reason": "" }"##
    /// Fields this app never saw, and known ones that are not what it expects.
    static let odd = ##"""
    { "id": "a4", "kind": "tool", "botId": "coder", "bot": { "id": "coder", "name": "Coder", "color": "#7f77dd" },
      "title": "Install jq for Coder?", "meta": "  5 MB  ", "size": 5, "body": { "text": "an object" }, "warning": ["a", "list"],
      "badge": { "text": "new" }, "risk": "low", "links": [{ "label": "Home page", "url": "https://jqlang.org" }],
      "facts": [{ "label": "Licence", "value": "MIT", "url": "https://jqlang.org/licence" }, { "label": "Stars", "value": 1200 }, { "label": "Ratio", "value": 2.5 },
                { "label": "Only a label" }, { "value": "only a value" }, { "label": ["x"], "value": { "a": 1 } }, "text", null, 7, true, [],
                { "label": "After", "value": "the rows that are none" }] }
    """##
    static let skill = ##"{ "id": "a5", "kind": "skill", "botId": null, "bot": null, "url": "https://github.com/acme/skills/tree/main/pdf", "skill": { "name": "pdf", "description": "Reads PDFs.", "files": 2, "exists": false }, "forBots": [{ "id": "coder", "name": "Coder", "color": "#7f77dd" }], "reason": "" }"##

    func asks(_ json: String...) throws -> [Ask] {
        try JSONDecoder().decode([Ask].self, from: Data("[\(json.joined(separator: ","))]".utf8))
    }
    /// A store that holds these asks, as after `GET /api/asks`.
    func store(_ json: String...) throws -> Store {
        let store = Store()
        store.asks = try JSONDecoder().decode([Ask].self, from: Data("[\(json.joined(separator: ","))]".utf8))
        return store
    }
    func rows(_ item: NeedItem) -> [[String]] { item.facts.map { [$0.label, $0.value] } }

    @Test func aToolFromTheRegistryIsTheServersCardWithDeclineAndInstall() throws {
        let ask = try #require(try asks(Self.gh).first)
        #expect(ask.title == "Install gh for Coder?")
        #expect(ask.meta?.text == "asked by the Chief")
        #expect(ask.body?.text == "Github CLI.\n\nWhy: Coder needs it to open the pull request.")
        #expect(ask.warning == nil)
        #expect(ask.facts?.rows.count == 5)

        let item = try #require(try store(Self.gh).needs.first)
        #expect(item.kind == .tool)
        #expect(item.key == "ask:a1")
        #expect(item.who == Who(id: "coder", name: "Coder", color: "#7f77dd"))
        #expect(item.title == "Install gh for Coder?")
        #expect(item.meta == "asked by the Chief")
        #expect(item.body == ["Github CLI.\n\nWhy: Coder needs it to open the pull request."])
        #expect(item.warning == nil)
        #expect(rows(item) == [["Version", "2.101.0"], ["Source", "botdot's registry (conda-forge), checksum verified"], ["Size", "14 MB"], ["Runs as", "Coder only"], ["Stays", "across botdot updates"]])
        #expect(item.no == "Decline")
        #expect(item.yes == "Install")
        #expect(!item.always)
    }

    @Test func aToolFromALinkHasItsWarningAndTheRowsALinkHas() throws {
        let item = try #require(try store(Self.stripe).needs.first)
        #expect(item.kind == .tool)
        #expect(item.meta == "from a link you gave · Coder asked the Chief")
        #expect(item.body == ["Stripe CLI, as described on its page. botdot has not checked what this program does.\n\nWhy: Coder needs it to replay test payments."])
        // As the server wrote it, with no mark of its own: the app marks it.
        #expect(item.warning == Self.warning)
        #expect(item.facts.map(\.label) == ["Version", "Source", "File", "Checksum", "Size", "Runs as"]) // no "Stays" for a link
        #expect(rows(item)[1] == ["Source", "github.com/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux_arm64.tar.gz"])
        #expect(rows(item)[3] == ["Checksum", "sha256 3f9a…c2e1"])
        #expect(item.no == "Decline")
        #expect(item.yes == "Install")
    }

    @Test func anAskWithoutTheCardsFieldsIsDrawnWithoutThem() throws {
        let item = try #require(try store(Self.bare).needs.first)
        #expect(item.kind == .tool) // a tool's card, never a skill's
        #expect(item.title == "")
        #expect(item.meta == "")
        #expect(item.body.isEmpty)
        #expect(item.warning == nil)
        #expect(item.facts.isEmpty)
        #expect(item.no == "Decline")
        #expect(item.yes == "Install")
    }

    @Test func fieldsThisAppDoesNotKnowOrCannotReadCostOnlyThemselves() throws {
        // One ask this app can't read whole must not take the others with it.
        let store = try store(Self.odd, Self.gh, Self.skill)
        #expect(store.needs.map(\.kind) == [.tool, .tool, .skill])
        let item = store.needs[0]
        #expect(item.title == "Install jq for Coder?")
        #expect(item.meta == "5 MB")
        #expect(item.body.isEmpty) // an object is no text
        #expect(item.warning == nil) // nor is a list
        // Every row that has a label or a value, also labels this app never saw, a number as it is written;
        // what is no row is left out.
        #expect(rows(item) == [["Licence", "MIT"], ["Stars", "1200"], ["Ratio", "2.5"], ["Only a label", ""], ["", "only a value"], ["After", "the rows that are none"]])
        #expect(store.needs[1].title == "Install gh for Coder?")
        #expect(store.needs[2].title == "Install the skill \"pdf\"?")

        // Facts that are no list at all: the card without them.
        let none = try #require(try self.store(##"{ "id": "a6", "kind": "tool", "title": "Install jq for Coder?", "facts": "none" }"##).needs.first)
        #expect(none.title == "Install jq for Coder?")
        #expect(none.facts.isEmpty)
    }

    @Test func theCardIsInItsBotsChatAndInTheChiefsAndCountsInNeedsYou() throws {
        let store = try store(Self.gh, Self.stripe, Self.skill)
        // One card each in Needs you: the banner's small heads are these, the bot's for a tool.
        #expect(store.needs.map(\.key) == ["ask:a1", "ask:a2", "ask:a5"])
        #expect(store.needs.map { $0.who?.name } == ["Coder", "Coder", "Chief of Staff"])
        // The bot the tool is for, and the Chief who asked for it.
        #expect(store.chatNeeds(.bot("coder")).map(\.key) == ["ask:a1", "ask:a2"])
        #expect(store.chatNeeds(.chief).map(\.key) == ["ask:a1", "ask:a2", "ask:a5"])
        #expect(store.chatNeeds(.bot("writer")).isEmpty)
    }

    @Test func aDecidedToolCardSaysInstallingNotInstalled() throws {
        let store = try store(Self.gh, Self.skill)
        let tool = store.needs[0], skill = store.needs[1]
        // The install goes on by itself after the answer: its result arrives as a Chief message.
        #expect(tool.decided(yes: true) == "Installing")
        #expect(tool.decided(yes: false) == "Declined")
        #expect(skill.decided(yes: true) == "Installed")
        #expect(skill.decided(yes: false) == "Declined")
    }

    @Test func theNotificationReadsTheServersLineUnderTheBotsName() throws {
        let store = try store(Self.gh, Self.skill)
        // Until the feed has named the ask, the tool's notification waits for its line.
        #expect(store.needNotices == [NeedNotice(key: "ask:a5", title: "Waiting for your OK", body: "Chief of Staff: Install the skill \"pdf\"?", actions: .install)])

        // The `asks` event: each tool ask with `text`.
        store.heardAsks(Data(##"{ "waiting": 2, "list": [{ "id": "a1", "kind": "tool", "botId": "coder", "botName": "Coder", "botColor": "#7f77dd", "what": null, "skill": null, "tool": "gh", "text": "Asks to install gh", "at": "2026-10-03T09:00:00.000Z" }, { "id": "a5", "kind": "skill", "botId": null, "botName": "Chief of Staff", "skill": "pdf" }] }"##.utf8))
        let notice = try #require(store.needNotices.first)
        #expect(notice == NeedNotice(key: "ask:a1", title: "Coder", body: "Asks to install gh", actions: .install))
        #expect(!"\(notice.title) \(notice.body)".lowercased().contains("skill"))
        #expect(store.needNotices.count == 2)

        // `hello` has the same entries as a plain list.
        let late = try self.store(Self.stripe)
        late.heardAsks(Data(##"{ "lastEventId": 7, "asks": [{ "id": "a2", "kind": "tool", "botId": "coder", "botName": "Coder", "tool": "stripe", "text": "Asks to install stripe from a link" }] }"##.utf8), hello: true)
        #expect(late.needNotices == [NeedNotice(key: "ask:a2", title: "Coder", body: "Asks to install stripe from a link", actions: .decline)])
    }

    @Test func aToolFromALinkSaysSoAndHasDeclineButNoInstall() throws {
        // The owner's decision: a tool from a link is installed on its card, where the warning, whose
        // link it is, the address and the checksum are. Its notification says it is from a link.
        let store = try store(Self.gh, Self.stripe)
        store.heardAsks(Data(##"{ "waiting": 2, "list": [{ "id": "a1", "kind": "tool", "tool": "gh", "text": "Asks to install gh" }, { "id": "a2", "kind": "tool", "botId": "coder", "botName": "Coder", "tool": "stripe", "text": "Asks to install stripe from a link", "yesOn": "card" }] }"##.utf8))
        #expect(store.needNotices == [
            NeedNotice(key: "ask:a1", title: "Coder", body: "Asks to install gh", actions: .install),
            NeedNotice(key: "ask:a2", title: "Coder", body: Self.stripeLine, actions: .decline),
        ])
        // The names of the Mac's notification categories: "decline" has Decline alone.
        #expect(store.needNotices.map(\.actions.rawValue) == ["install", "decline"])
        // The card itself keeps both buttons, and the warning.
        let card = try #require(store.needs.last)
        #expect([card.no, card.yes] == ["Decline", "Install"])
        #expect(card.warning == Self.warning)

        // Announced by its title, because the feed did not name it: still no Install.
        let silent = try self.store(Self.stripe)
        silent.noteUnnamedAsks(now: Date())
        silent.noteUnnamedAsks(now: Date().addingTimeInterval(60))
        #expect(silent.needNotices == [NeedNotice(key: "ask:a2", title: "Waiting for your OK", body: "Coder: Install stripe for Coder?", actions: .decline)])
    }

    @Test func anAskWithoutTheFieldIsAnsweredFromItsNotificationAsBefore() throws {
        // A server from before `yesOn`: a tool from a link has Install and Decline, as it had.
        let before = try store(Self.stripe(yesOn: nil))
        before.heardAsks(Data(##"{ "asks": [{ "id": "a2", "kind": "tool", "text": "Asks to install stripe" }] }"##.utf8), hello: true)
        #expect(before.needNotices == [NeedNotice(key: "ask:a2", title: "Coder", body: "Asks to install stripe", actions: .install)])

        // A value this app does not know, or one that is no text, changes nothing and costs no ask.
        let blanks = try store(Self.stripe(yesOn: ##"" card ""##))
        blanks.heardAsks(Data(##"{ "asks": [{ "id": "a2", "text": "Asks to install stripe from a link" }] }"##.utf8), hello: true)
        // Read without the blanks around it, as the card's fields are and as the Android app reads it.
        #expect(blanks.needNotices.map(\.actions) == [.decline])
        for odd in [##""app""##, ##""""##, "null", "true", "7", ##"["card"]"##, ##"{ "on": "card" }"##] {
            let store = try store(Self.gh, Self.stripe(yesOn: odd))
            #expect(store.asks.count == 2, "\(odd)")
            store.heardAsks(Data(##"{ "asks": [{ "id": "a2", "text": "Asks to install stripe from a link" }] }"##.utf8), hello: true)
            #expect(store.needNotices.last?.actions == .install, "\(odd)")
        }
    }

    @Test func theFieldHoldsForAnAskOfAnyKind() throws {
        // Not a tool's alone (docs/api.md): the server may send it with another ask later.
        let skill = Self.skill.replacingOccurrences(of: ##""reason": """##, with: ##""reason": "", "yesOn": "card""##)
        let permission = ##"{ "id": "a6", "kind": "permission", "botId": "coder", "bot": { "id": "coder", "name": "Coder", "color": "#7f77dd" }, "permission": "commands", "what": { "label": "run commands", "hint": "any shell command in its folder" }, "reason": "", "yesOn": "card" }"##
        let store = try store(skill, permission, Self.skill.replacingOccurrences(of: ##""id": "a5""##, with: ##""id": "a7""##))
        #expect(store.needNotices.map(\.actions) == [.decline, .decline, .install])
    }

    @Test func olderListsTheFeedReplaysTakeNoLineAway() throws {
        // After `hello` the server replays the events this app missed, older lists among them.
        let store = try store(Self.gh, Self.stripe)
        store.heardAsks(Data(##"{ "asks": [{ "id": "a1", "text": "Asks to install gh" }, { "id": "a2", "text": "Asks to install stripe from a link" }] }"##.utf8), hello: true)
        let both = store.needNotices
        #expect(both.map(\.body) == ["Asks to install gh", "Asks to install stripe from a link"])
        store.heardAsks(Data(##"{ "waiting": 1, "list": [{ "id": "a1", "text": "Asks to install gh" }] }"##.utf8))
        #expect(store.needNotices == both)
        store.heardAsks(Data(##"{ "waiting": 0, "list": [] }"##.utf8))
        #expect(store.needNotices == both)
        // The line of an ask that was answered goes with the next list.
        store.asks.removeFirst()
        store.heardAsks(Data(##"{ "waiting": 1, "list": [{ "id": "a2", "text": "Asks to install stripe from a link" }] }"##.utf8))
        #expect(store.askLines == ["a2": "Asks to install stripe from a link"])
    }

    @Test func aToolTheFeedHasNoLineForIsAnnouncedByItsTitle() throws {
        let title = [NeedNotice(key: "ask:a1", title: "Waiting for your OK", body: "Coder: Install gh for Coder?", actions: .install)]
        // Named by the feed, without a line.
        let store = try store(Self.gh)
        store.heardAsks(Data(##"{ "waiting": 1, "list": [{ "id": "a1", "kind": "tool" }] }"##.utf8))
        #expect(store.needNotices == title)

        // Not named: its card was read before its event, or the feed is down, stuck, or can't be read.
        let early = try self.store(Self.gh)
        early.heardAsks(Data(##"{ "asks": [{ "id": "a5", "kind": "skill" }] }"##.utf8), hello: true)
        early.heardAsks(Data("[]".utf8))
        let read = Date()
        early.noteUnnamedAsks(now: read)
        #expect(early.needNotices.isEmpty)
        // The asks read again a moment later (another event's reload): it still waits for its line.
        early.noteUnnamedAsks(now: read.addingTimeInterval(2))
        #expect(early.needNotices.isEmpty)
        // Read again a minute later, and still not named: it waits no longer.
        early.noteUnnamedAsks(now: read.addingTimeInterval(60))
        #expect(early.needNotices == title)
        // The feed names it after all: the line replaces the title.
        early.heardAsks(Data(##"{ "asks": [{ "id": "a1", "kind": "tool", "text": "Asks to install gh" }] }"##.utf8), hello: true)
        early.noteUnnamedAsks(now: read.addingTimeInterval(61))
        #expect(early.needNotices == [NeedNotice(key: "ask:a1", title: "Coder", body: "Asks to install gh", actions: .install)])
        #expect(early.asksOverdue.isEmpty)
    }
}

/// The same against a real botdot server that can install tools.
@MainActor
@Suite struct ToolAsksOnAServer {
    func connected(_ tools: ToolServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: tools.server.base.absoluteString)
        return store
    }
    /// The tools on the server, installed or still being installed: "gh", "gh (installing)".
    func installed(_ tools: ToolServer) async throws -> [String] {
        let list = try await tools.server.api("tools", asChief: true) as? [String: Any]
        return ((list?["tools"] as? [[String: Any]]) ?? []).compactMap { t in
            (t["name"] as? String).map { t["installing"] as? Bool == true ? "\($0) (installing)" : $0 }
        }
    }

    @Test func aToolTheChiefAsksForWaitsAsItsCardAndInstallAnswersIt() async throws {
        let tools = try ToolServer()
        let id = try await tools.makeBot("Coder")
        let store = try await connected(tools)
        try await tools.ask("gh", for: id)

        try await eventually("the card") { store.needs.contains { $0.kind == .tool } }
        let item = try #require(store.needs.first)
        #expect(store.needs.count == 1)
        #expect(item.who?.name == "Coder")
        #expect(item.title == "Install gh for Coder?")
        #expect(item.meta == "asked by the Chief")
        #expect(item.body == ["Github CLI.\n\nWhy: It needs it to open the pull request."])
        #expect(item.warning == nil)
        #expect(item.facts.map(\.label) == ["Version", "Source", "Size", "Runs as", "Stays"])
        #expect(item.facts.first?.value == "2.101.0")
        #expect(store.chatNeeds(.bot(id)).map(\.key) == [item.key])
        #expect(store.chatNeeds(.chief).map(\.key) == [item.key])
        // Its notification is the feed's line under the bot's name, and at no moment another text.
        let notice = NeedNotice(key: item.key, title: "Coder", body: "Asks to install gh", actions: .install)
        var others: [NeedNotice] = []
        try await eventually("the feed's line") {
            others += store.needNotices.filter { $0 != notice }
            return store.needNotices == [notice]
        }
        #expect(others.isEmpty)

        try await store.decide(item, yes: true)
        #expect(store.needs.isEmpty) // answered at once; the install goes on by itself
        try await eventuallyAsync("gh to be installed for Coder") { try await installed(tools) == ["gh"] }
    }

    @Test func declineAnswersItAndInstallsNothing() async throws {
        let tools = try ToolServer()
        let id = try await tools.makeBot("Coder")
        let store = try await connected(tools)
        try await tools.ask("gh", for: id)
        try await eventually("the card") { store.needs.contains { $0.kind == .tool } }

        try await store.decide(try #require(store.needs.first), yes: false)
        #expect(store.needs.isEmpty)
        #expect(try await installed(tools).isEmpty)
        // The server took it as the owner's no: the Chief can't ask for it again this week.
        let again = try await tools.ask("gh", for: id)
        #expect((again["error"] as? String)?.contains("declined gh for Coder") == true)
        #expect(store.needs.isEmpty)
    }

    @Test func anAnswerTheServerRefusesOrNeverGetsLeavesTheCard() async throws {
        let tools = try ToolServer()
        let id = try await tools.makeBot("Coder")
        try await tools.ask("gh", for: id)
        let store = try await connected(tools)
        let item = try #require(store.needs.first)

        // Answered in another app meanwhile: the server says so, and this app passes that on.
        let other = try await connected(tools)
        try await other.decide(try #require(other.needs.first), yes: false)
        let refused = await #expect(throws: API.Failure.self) { try await store.decide(item, yes: true) }
        #expect(refused?.message == "That request was already answered.")
        #expect(try await installed(tools).isEmpty)

        // A server that can't be reached: the answer fails and the card stays.
        let jq = try await tools.makeBot("Runner")
        try await tools.ask("jq", for: jq)
        try await eventually("the second card") { store.needs.contains { $0.title == "Install jq for Runner?" } }
        let waiting = try #require(store.needs.first { $0.title == "Install jq for Runner?" })
        store.stopFeed()
        tools.server.stop()
        await #expect(throws: (any Error).self) { try await store.decide(waiting, yes: true) }
        #expect(store.needs.contains { $0.key == waiting.key })
    }

    @Test func withoutTheFeedAToolIsAnnouncedByItsTitleOnceItsCardWasReadAgain() async throws {
        let tools = try ToolServer()
        let id = try await tools.makeBot("Coder")
        let store = try await connected(tools)
        store.stopFeed() // as a feed that is down or stuck: only the reload every minute is left
        store.askWait = 0.3
        try await tools.ask("gh", for: id)
        await store.reloadAll()
        #expect(store.needs.map(\.title) == ["Install gh for Coder?"])
        #expect(store.needNotices.isEmpty) // it waits for the feed's line
        try await Task.sleep(for: .milliseconds(400))
        await store.reloadAll()
        #expect(store.needNotices == [NeedNotice(key: "ask:\(store.asks[0].id)", title: "Waiting for your OK", body: "Coder: Install gh for Coder?", actions: .install)])
    }

    @Test func aToolThatWaitsWhenTheAppStartsIsNotifiedWithItsLineOnceTheFeedSpoke() async throws {
        let tools = try ToolServer()
        let id = try await tools.makeBot("Coder")
        try await tools.ask("gh", for: id)
        let store = try await connected(tools)
        #expect(store.needs.map(\.title) == ["Install gh for Coder?"])
        // The card is read before the feed's first word: its notification waits for the line, and is never another text.
        let notice = NeedNotice(key: "ask:\(store.asks[0].id)", title: "Coder", body: "Asks to install gh", actions: .install)
        var others: [NeedNotice] = []
        try await eventually("the feed's line") {
            others += store.needNotices.filter { $0 != notice }
            return store.needNotices == [notice]
        }
        #expect(others.isEmpty)
    }
}
