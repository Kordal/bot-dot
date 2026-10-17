import Foundation
import os
import Testing
@testable import BotDotKit

/// A group's chat in the Mac app (Milestone 10), against a real botdot server and the stand-in
/// Claude, which answers, passes and is held for one bot by its name (test/fixtures/fake-claude.js).
@MainActor
@Suite(.serialized) struct GroupChats {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    /// The store once its live feed listens.
    func listening(_ server: TestServer) async throws -> Store {
        let store = try await connected(server)
        var heard = false
        store.onEvent = { name, _ in if name == "hello" { heard = true } }
        try await eventually("the live feed") { heard }
        store.onEvent = nil
        return store
    }

    /// Bots, and a group of them, made as the web page makes one. Returns the group's id and the bots' ids.
    func team(_ server: TestServer, _ name: String, _ names: [String], category: String = "") async throws -> (String, [String]) {
        var bots: [String] = []
        for n in names { bots.append(try await server.makeBot(n)) }
        let made = try await server.api("group-chats", method: "POST", body: ["name": name, "members": bots]) as? [String: Any]
        let id = try #require(made?["id"] as? String)
        if !category.isEmpty { try await server.api("group-chats/\(id)", method: "PUT", body: ["category": category]) }
        return (id, bots)
    }

    /// What the stand-in does for one bot, told apart by its name without spaces.
    func file(_ server: TestServer, _ kind: String, _ bot: String, _ ext: String = "") -> URL {
        server.out.appendingPathComponent("\(kind)-\(bot.filter { $0.isLetter || $0.isNumber })\(ext)")
    }
    func reply(_ server: TestServer, _ bot: String, _ text: String) throws { try text.write(to: file(server, "result", bot, ".txt"), atomically: true, encoding: .utf8) }
    func hold(_ server: TestServer, _ bot: String) throws { try Data().write(to: file(server, "hold", bot)) }
    func letGo(_ server: TestServer, _ bot: String) { try? FileManager.default.removeItem(at: file(server, "hold", bot)) }

    /// The open group's chat once nobody works in it and no turn is to come.
    func settled(_ store: Store, replies: Int) async throws {
        try await eventually("the group's line to end") {
            store.groupChat.loaded && store.groupChat.working.isEmpty && store.groupNext.isEmpty && store.groupChat.rows.filter { $0.message == nil }.count >= replies
        }
    }

    func replies(_ store: Store) -> [RunSummary] {
        store.groupChat.rows.compactMap { if case .reply(_, _, let run) = $0 { run } else { nil } }
    }

    // What was left after the catch-up (#379): a match in a group's chat opens in the group.
    @Test func aReplyInAGroupIsFoundAndOpensInItsGroup() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let store = try await listening(server)
        defer { store.disconnect() }
        let (id, _) = try await team(server, "Dev", ["Find Coder", "Find Reviewer"])
        try reply(server, "Find Coder", "The marmalade build is green.")
        try reply(server, "Find Reviewer", "Agreed.")
        try await server.api("group-chats/\(id)/messages", method: "POST", body: ["text": "How is it going?"])
        var hits: [SearchHit] = []
        try await eventuallyAsync("the turn to be indexed") { hits = try await store.search("marmalade"); return !hits.isEmpty }
        #expect(hits.first?.group == SearchHit.InGroup(id: id, name: "Dev") && hits.first?.bot?.name == "Find Coder" && hits.first?.runId != nil)
        // The chat holds the reply: there is nothing further back to read for it.
        store.openGroup(id)
        try await eventually("the chat") { store.groupChat.loaded }
        let run = try #require(hits.first?.runId)
        #expect(store.groupChat.rows.contains { $0.id == run } && !store.reachGroupReply(run))
    }

    // A group's row is dragged as a bot's: pinned, put in order, moved to a category.
    @Test func aGroupsRowIsPinnedOrderedAndMovedToACategory() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let store = try await listening(server)
        defer { store.disconnect() }
        let (a, _) = try await team(server, "Alpha", ["Drag One", "Drag Two"], category: "Work")
        let (b, _) = try await team(server, "Beta", ["Drag Three", "Drag Four"], category: "Work")
        func work() -> [String] { Groups.inCategory(store.groups, "Work").map(\.id) }
        func pinned() -> [String] { Groups.pinned(store.groups).map(\.id) }
        try await eventually("both groups, A to Z") { work() == [a, b] }
        #expect(pinned().isEmpty)

        try await store.dropGroup(a, at: .group("Work", 3)) // below Beta
        #expect(work() == [b, a])
        try await store.dropGroup(a, at: .group("Work", 3)) // the gap under itself: it stays
        #expect(work() == [b, a])
        try await store.dropGroup(a, at: .pinned(1))
        try await store.dropGroup(b, at: .pinned(1))
        #expect(pinned() == [b, a] && work().isEmpty)
        try await store.dropGroup(b, at: .pinned(3))
        #expect(pinned() == [a, b])
        try await store.dropGroup(a, at: .group("", 1)) // out of the pinned ones, to no category
        #expect(pinned() == [b] && Groups.inCategory(store.groups, "").map(\.id) == [a])
    }

    @Test func aGroupMadeElsewhereIsOneRowWithItsNewRepliesCounted() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let store = try await listening(server)
        defer { store.disconnect() }
        #expect(store.has(.groups) && store.groups.isEmpty)

        // Made on the web page: the feed says `groups`, and the list has it.
        let (id, bots) = try await team(server, "Dev", ["Row Coder", "Row Reviewer"], category: "Work")
        try await eventually("the group in the list") { store.groups.map(\.id) == [id] && store.group(id)?.category == "Work" }
        let work = try #require(store.sidebar.groups.first { $0.name == "Work" })
        #expect(work.groupChats.map(\.name) == ["Dev"] && work.bots.isEmpty, "one row, in its category")
        #expect(store.group(id)?.members == bots)
        #expect(GroupWords.line(store.groups[0], store.bots, store.turnLines).text == "No messages yet")

        // The owner writes in another app: each reply is new here.
        try reply(server, "Row Coder", "The code is in.")
        try reply(server, "Row Reviewer", "It reads well.")
        try await server.api("group-chats/\(id)/messages", method: "POST", body: ["text": "How is it going?"])
        try await eventually("two new replies on the row") { store.group(id)?.unread == 2 && store.group(id)?.working.isEmpty == true }
        let line = GroupWords.line(try #require(store.group(id)), store.bots, store.turnLines)
        #expect(line.who == "Row Reviewer" && line.text == "It reads well.")

        // The owner opens it, the window in front: the "New" line stands above the first new reply, and it is read.
        store.openGroup(id)
        try await settled(store, replies: 2)
        await store.show(chat: Groups.key(id), inFront: true)
        let first = try #require(replies(store).first?.id)
        #expect(store.newLine == NewLine(chat: Groups.key(id), first: .run(first)))
        try await eventually("the row's dots to go") { store.group(id)?.unread == 0 }
        let onServer = try await server.api("group-chats/\(id)") as? [String: Any]
        #expect(onServer?["unread"] as? Int == 0)
    }

    @Test func theOwnerWritesOnceAndEveryReplyStandsUnderItsBotAndAPassShowsNothing() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, bots) = try await team(server, "Trio", ["Once Writer", "Once Passer", "Once Coder"])
        try reply(server, "Once Writer", "Here is the issue.")
        try reply(server, "Once Passer", "PASS")
        try reply(server, "Once Coder", "Here is the code.")
        let store = try await listening(server)
        defer { store.disconnect() }
        store.openGroup(id)
        try await eventually("the empty chat") { store.groupChat.loaded }
        #expect(store.groupChat.rows.isEmpty)

        #expect(await store.deliverToGroup("Build the sign-in page."))
        #expect(store.groupChat.messages.map(\.text) == ["Build the sign-in page."], "the message is in the chat from the server's answer")
        try await settled(store, replies: 2)
        #expect(store.groupChat.messages.count == 1, "written once")
        #expect(store.groupChat.messages.first?.to == bots)
        let said = replies(store)
        #expect(said.map(\.botId) == [bots[0], bots[2]], "the member that passed has no row")
        #expect(said.map(\.botName) == ["Once Writer", "Once Coder"])
        #expect(said.map(\.result) == ["Here is the issue.", "Here is the code."])
        #expect(store.recentRuns.isEmpty, "a turn is no run of the bot's own chat")
    }

    @Test func theChatShowsWhoWorksAndWhoIsNextAndOneStopEndsThemAll() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, bots) = try await team(server, "Line", ["Next Writer", "Next Coder", "Next Reviewer"])
        try hold(server, "Next Writer")
        defer { letGo(server, "Next Writer") }
        let store = try await listening(server)
        defer { store.disconnect() }
        store.openGroup(id)
        try await eventually("the chat") { store.groupChat.loaded }

        #expect(await store.deliverToGroup("Ship it."))
        try await eventually("the first member at work") { store.groupChat.working.map(\.botId) == [bots[0]] }
        #expect(store.groupNext == [bots[1], bots[2]], "the others are next, in their order")
        #expect(Groups.members(store.groupNext, store.bots).map(\.name) == ["Next Coder", "Next Reviewer"])
        try await eventually("the row to say who works") { store.group(id)?.working == [bots[0]] }
        #expect(GroupWords.line(try #require(store.group(id)), store.bots, store.turnLines).who == "Next Writer")

        // "Stop all": the run ends, and the turns that would have followed never start.
        await store.stopGroup(id)
        try await eventually("nobody at work") { store.groupChat.working.isEmpty && !self.replies(store).isEmpty }
        #expect(store.groupNext.isEmpty)
        #expect(store.groupChat.messages.first?.stopped == true)
        let ended = replies(store)
        #expect(ended.map(\.botId) == [bots[0]] && ended.first?.status == "stopped")
        #expect(ended.first?.endedBy == "owner")
        try await Task.sleep(for: .milliseconds(400))
        await store.reloadAll()
        #expect(replies(store).map(\.botId) == [bots[0]], "no later turn started")
        #expect(store.group(id)?.working.isEmpty == true)
    }

    @Test func theChatIsReadAgainAfterAMessageSentFromAnotherApp() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, bots) = try await team(server, "Elsewhere", ["Else Writer", "Else Coder"])
        try reply(server, "Else Writer", "Noted.")
        try reply(server, "Else Coder", "PASS")
        let store = try await listening(server)
        defer { store.disconnect() }
        store.openGroup(id)
        try await eventually("the chat") { store.groupChat.loaded }

        try await server.api("group-chats/\(id)/messages", method: "POST", body: ["text": "From the phone."])
        try await eventually("the message from the other app") { store.groupChat.messages.map(\.text) == ["From the phone."] }
        try await settled(store, replies: 1)
        #expect(replies(store).map(\.botId) == [bots[0]])

        // And one that was taken back there goes here.
        try hold(server, "Else Writer")
        defer { letGo(server, "Else Writer") }
        try await server.api("group-chats/\(id)/messages", method: "POST", body: ["text": "First."])
        try await eventually("a member at work") { store.groupChat.working.count == 1 }
        let waits = try await server.api("group-chats/\(id)/messages", method: "POST", body: ["text": "@ElseWriter second."]) as? [String: Any]
        let waiting = try #require(waits?["id"] as? String)
        try await eventually("the waiting message") { store.groupChat.messages.last?.id == waiting }
        let message = try #require(store.groupChat.messages.last)
        #expect(message.canTakeBack && GroupWords.waitsLine(message, store.bots) == "Waits until Else Writer is free")
        #expect(GroupWords.waitsWhole(message, store.bots))
        try await server.api("group-chats/\(id)/messages/\(waiting)", method: "DELETE")
        try await eventually("it to go") { !store.groupChat.messages.contains { $0.id == waiting } }
    }

    @Test func aWaitingMessageIsTakenBackIntoTheMessageBox() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, _) = try await team(server, "Back", ["Back Writer", "Back Coder"])
        try hold(server, "Back Writer")
        defer { letGo(server, "Back Writer") }
        let store = try await listening(server)
        defer { store.disconnect() }
        store.openGroup(id)
        try await eventually("the chat") { store.groupChat.loaded }
        #expect(await store.deliverToGroup("First."))
        try await eventually("a member at work") { store.groupChat.working.count == 1 }
        #expect(await store.deliverToGroup("@BackWriter not yet."))
        let message = try #require(store.groupChat.messages.last)
        #expect(message.text == "@BackWriter not yet." && message.canTakeBack)

        #expect(await store.takeBack(message, fromGroup: id))
        #expect(store.groupChat.messages.map(\.text) == ["First."])
        #expect(store.outbox(Groups.key(id)).back?.text == "@BackWriter not yet.", "its text waits for the message box")
        let onServer = try await server.api("group-chats/\(id)/chat") as? [String: Any]
        #expect((onServer?["items"] as? [[String: Any]])?.filter { $0["type"] as? String == "message" }.count == 1)
    }

    @Test func aNotificationComesOnlyForAQuestion() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, _) = try await team(server, "Ringing", ["Ring Asker", "Ring Other"])
        try reply(server, "Ring Asker", "All good.")
        try reply(server, "Ring Other", "PASS")
        let store = try await listening(server)
        defer { store.disconnect() }
        var steps: [NotificationStep] = []
        var ended = 0
        store.onEvent = { [weak store] name, data in
            if name == "group_run_finished" { ended += 1 }
            if name.hasPrefix("group_"), let step = store?.notificationStep(name, data) { steps.append(step) }
        }

        // A reply, new in the group: it is counted and rings for nobody.
        try await server.api("group-chats/\(id)/messages", method: "POST", body: ["text": "How is it?"])
        try await eventually("both turns to end") { ended == 2 }
        try await eventually("the new reply on the row") { store.group(id)?.unread == 1 }
        #expect(steps.isEmpty)

        // A reply that asks the owner something: one notification, under the group's name.
        try reply(server, "Ring Asker", "Two ways to build it.\nWhich one?\n\n[[choices: The quick one | The clean one]]")
        try await server.api("group-chats/\(id)/messages", method: "POST", body: ["text": "@RingAsker how would you build it?"])
        try await eventually("the question") { ended == 3 }
        #expect(steps == [.post(ReplyNotification(chat: Groups.key(id), id: Groups.key(id), title: "Ringing · Ring Asker asks", body: "Which one?"))])
        try await eventually("the row to say it asks") { store.group(id)?.asks != nil }
        let line = GroupWords.line(try #require(store.group(id)), store.bots, store.turnLines)
        #expect(line.asks && line.text == "Ring Asker asks: Which one?")

        // The owner reads the group: the notification goes.
        store.openGroup(id)
        try await eventually("the chat") { store.groupChat.loaded }
        #expect(store.groupChat.asks?.runId == replies(store).last?.id, "the answer buttons stand under the reply that asked")
        await store.show(chat: Groups.key(id), inFront: true)
        try await eventually("the notification to go") { steps.last == .remove(chat: Groups.key(id)) }

        // While the group is in front, a question is before the owner: it does not ring.
        steps = []
        try await server.api("group-chats/\(id)/messages", method: "POST", body: ["text": "@RingAsker and the other page?"])
        try await eventually("the next question") { ended == 4 }
        #expect(!steps.contains { if case .post = $0 { true } else { false } })
    }

    @Test func aMentionInAGroupIsOfItsMembersAndGivesThemTheTurn() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, bots) = try await team(server, "Mention", ["Men Writer", "Men Coder"])
        _ = try await server.makeBot("Men Stranger")
        try reply(server, "Men Writer", "I would not.")
        try reply(server, "Men Coder", "Mine.")
        let store = try await listening(server)
        defer { store.disconnect() }

        let world = store.mentions(in: Groups.key(id))
        #expect(world.suggest("@Men").map(\.text) == ["@MenWriter", "@MenCoder"], "its members, in its order, and no other bot")
        #expect(world.find(in: "@MenCoder take this, not @MenStranger").map(\.text) == ["@MenCoder"])
        #expect(world.suggest("/").isEmpty, "no skill in a group")
        #expect(store.mentions(in: bots[0]).suggest("@Men").map(\.text).contains("@MenStranger"), "a bot's own chat is as before")

        store.openGroup(id)
        try await eventually("the chat") { store.groupChat.loaded }
        #expect(await store.deliverToGroup("@MenCoder take this."))
        try await settled(store, replies: 1)
        #expect(store.groupChat.messages.first?.to == [bots[1]])
        #expect(replies(store).map(\.botId) == [bots[1]], "only the member that was mentioned had the turn")
    }

    static let bash: [String: Any] = ["tool_name": "Bash", "tool_use_id": "t1", "tool_input": ["command": "gh pr list", "description": "List open pull requests"]]

    @Test func aCardAskedInATurnBelongsToTheGroupAndNotToItsBotsOwnChat() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, bots) = try await team(server, "Cards", ["Card Coder", "Card Reviewer"])
        try await server.api("bots/\(bots[0])", method: "PUT", body: ["allowedTools": ["Read"]])
        try reply(server, "Card Coder", "I cannot list the pull requests without running commands.")
        let store = try await listening(server)
        defer { store.disconnect() }
        store.openGroup(id)
        try await eventually("the chat") { store.groupChat.loaded }

        // The member's turn ends refused a command: its card waits.
        try server.refuse([Self.bash])
        #expect(await store.deliverToGroup("@CardCoder list the open pull requests"))
        try await settled(store, replies: 1)
        try server.refuse([])
        try await eventually("the card") { store.needs.contains { $0.kind == .permission } }
        let card = try #require(store.needs.first { $0.kind == .permission })
        #expect(card.ask?.groupId?.text == id, "the server says the group")

        // At the end of the group's chat, with its bot's name; in Needs you with the bot's and the group's; in no bot's own chat.
        #expect(card.group == GroupRef(id: id, name: "Cards") && card.chat == .group(id))
        #expect(store.chatNeeds(.group(id)).map(\.key) == [card.key])
        #expect(store.chatNeeds(.bot(bots[0])).isEmpty && store.chatNeeds(.chief).isEmpty)
        #expect(card.asker() == "Card Coder in Cards" && card.asker(in: .group(id)) == "Card Coder")
        // Its notification names both, and opens the group.
        #expect(store.needNotices.first { $0.key == card.key }?.body.hasPrefix("Card Coder in Cards: ") == true)

        // The group is renamed in another app: its name as it is now.
        try await server.api("group-chats/\(id)", method: "PUT", body: ["name": "Reviews"])
        try await eventually("the new name") { store.group(id)?.name == "Reviews" }
        #expect(store.needs.first { $0.key == card.key }?.asker() == "Card Coder in Reviews")

        // A card of a bot's own chat is as before.
        let loner = try await server.makeBot("Card Loner")
        try await server.api("bots/\(loner)", method: "PUT", body: ["allowedTools": ["Read"]])
        try server.refuse([Self.bash])
        try await server.runToEnd(loner, "Check the PRs")
        try server.refuse([])
        try await eventually("the loner's card") { !store.chatNeeds(.bot(loner)).isEmpty }
        let own = try #require(store.chatNeeds(.bot(loner)).first)
        #expect(own.group == nil && own.chat == .bot(loner) && own.asker() == "Card Loner")
        #expect(store.chatNeeds(.group(id)).map(\.key) == [card.key])

        // The owner's yes is given on the card, with the route every card has: it leaves the group's chat.
        try await store.decide(try #require(store.chatNeeds(.group(id)).first), yes: true)
        #expect(store.chatNeeds(.group(id)).isEmpty)
    }

    @Test func aNoteKeptInAGroupShowsNothingUnderTheReply() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, bots) = try await team(server, "Chips", ["Chip Keeper", "Chip Other"])
        try reply(server, "Chip Keeper", "Noted: pnpm.")
        try reply(server, "Chip Other", "PASS")
        try hold(server, "Chip Keeper")
        defer { letGo(server, "Chip Keeper") }
        let store = try await listening(server)
        defer { store.disconnect() }
        #expect(store.has(.memoryChips))
        store.openGroup(id)
        try await eventually("the chat") { store.groupChat.loaded }

        // The member keeps a note in its turn: the reply arrives with no row under it (ADR 024).
        #expect(await store.deliverToGroup("@ChipKeeper I always use pnpm."))
        try await eventually("the member at work") { store.groupChat.working.map(\.botId) == [bots[0]] }
        let saved = try await server.selfTool("memory", ["action": "add", "text": "pnpm for JavaScript", "topic": "Package manager"])
        #expect(saved["result"] as? String == "saved")
        letGo(server, "Chip Keeper")
        try await settled(store, replies: 1)
        let said = try #require(replies(store).first)
        #expect(store.under(said, answers: false).chips.isEmpty)
        #expect(Arrivals.replyIds(store.groupChat.rows) == [said.id], "and it is the reply that arrives")
    }

    @Test func aGroupDeletedInAnotherAppIsGoneAndAFailedReadSaysNothing() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, _) = try await team(server, "Leaving", ["Leave Writer", "Leave Coder"])
        let store = try await listening(server)
        defer { store.disconnect() }
        store.openGroup(id)
        try await eventually("the chat") { store.groupChat.loaded }
        #expect(await store.groupIsGone(id) == false, "it is there")

        // The list cannot be read: nothing is known of the group, and its chat stays.
        let api = store.api
        store.api = API(base: URL(string: "http://127.0.0.1:9")!)
        store.groups = []
        #expect(await store.groupIsGone(id) == false)
        #expect(store.groupChat.groupId == id)
        store.api = api

        // Deleted in another app: there is no chat to show.
        try await server.api("group-chats/\(id)", method: "DELETE")
        try await eventually("the row to go") { store.group(id) == nil }
        #expect(await store.groupIsGone(id))
        #expect(store.groupChat.groupId == nil, "its chat is closed")
    }

    @Test func featuresThatCannotBeReadAreAFailedReadAndAServerWithoutGroupsShowsNone() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let (id, _) = try await team(server, "Gate", ["Gate Writer", "Gate Coder"])
        let store = try await connected(server)
        defer { store.disconnect() }
        #expect(store.groups.map(\.id) == [id])
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Version.self]
        store.api = API(base: server.base, session: URLSession(configuration: config))
        defer { Version.answer(nil) }

        // `features` cannot be read: nothing is known of the server, and its groups stay.
        Version.answer(.fails)
        await store.loadFigure()
        await store.reloadAll()
        #expect(Version.asked("/api/version") > 0)
        #expect(store.has(.groups) && store.groups.map(\.id) == [id])

        // A server without `groups` (one from before, or put back): no groups, and nothing is asked of it.
        Version.answer(.says(#"{"app":"bot-dot","version":"0.1.0","apiVersion":1,"features":["unread","message-key"]}"#))
        let before = Version.asked("/api/group-chats")
        await store.loadFigure()
        await store.reloadAll()
        #expect(!store.has(.groups) && store.groups.isEmpty && store.sidebar.pinnedGroupChats.isEmpty)
        #expect(Version.asked("/api/group-chats") == before, "a server without groups is not asked for them")

        // It is updated: its groups are there again.
        Version.answer(nil)
        await store.loadFigure()
        await store.reloadAll()
        #expect(store.groups.map(\.id) == [id])
    }
}

/// Stands in for `GET /api/version`: it fails, or answers with what a test says; and counts the
/// requests for every path. Everything else goes to the server.
private final class Version: URLProtocol, @unchecked Sendable {
    enum Answer { case fails, says(String) }
    private static let state = OSAllocatedUnfairLock(initialState: (answer: Answer?.none, asked: [String: Int]()))
    static func answer(_ a: Answer?) { state.withLock { $0.answer = a } }
    static func asked(_ path: String) -> Int { state.withLock { $0.asked[path] ?? 0 } }

    override class func canInit(with request: URLRequest) -> Bool {
        guard let path = request.url?.path else { return false }
        return state.withLock { s in
            s.asked[path, default: 0] += 1
            return path == "/api/version" && s.answer != nil
        }
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard case .says(let body)? = Self.state.withLock({ $0.answer }), let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else {
            client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
