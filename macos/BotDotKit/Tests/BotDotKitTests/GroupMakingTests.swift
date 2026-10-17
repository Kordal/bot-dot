import Foundation
import Testing
@testable import BotDotKit

/// Making, changing and removing a group in the Mac app (Milestone 10), as the Android app does it
/// (ui/BotChatScreen.kt, ui/GroupSettingsScreen.kt and their tests GroupWordsTest, GroupsTest),
/// against a real botdot server: what it refuses is said in its own words.
@MainActor
@Suite(.serialized) struct GroupMaking {
    func connected(_ server: TestServer) async throws -> Store {
        let store = Store()
        try await store.connect(to: server.base.absoluteString)
        return store
    }

    /// The server's sentence for what it refused, or nil when it took it.
    func refusal(_ call: () async throws -> Void) async -> String? {
        do { try await call(); return nil } catch { return error.localizedDescription }
    }

    func bot(_ id: String, _ name: String, category: String = "") -> Bot {
        try! JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: ["id": id, "name": name, "group": category]))
    }

    // MARK: The words and the rules, without a server

    @Test func theWordsOfThePickers() {
        #expect(GroupWords.addABot == "Add a bot to this chat")
        #expect(GroupWords.makeHint(0, "Coder") == "Pick one to five bots to join Coder. Its own chat stays as it is.")
        #expect(GroupWords.makeHint(2, "Coder") == "3 bots in the group, with Coder.")
        #expect(GroupWords.addHint(0, members: 3, name: "Dev") == "A group has two to six bots.")
        #expect(GroupWords.addHint(1, members: 3, name: "Dev") == "4 bots in Dev.")
    }

    @Test func aTypedNameIsSavedAsOneLineWithoutTheBlanksAroundIt() {
        #expect(GroupWords.name(typed: "  Dev \n team  ") == "Dev team")
        #expect(GroupWords.name(typed: "   ") == "", "an emptied box")
    }

    @Test func theSmallPlusIsOfferedOnlyWhereAGroupCanBeMade() {
        let store = Store()
        store.bots = [bot("1", "Coder"), bot("2", "Reviewer")]
        #expect(!store.canMakeGroup(with: "1"), "its features are not known yet")
        store.features = ["unread", "message-waits"]
        #expect(!store.canMakeGroup(with: "1"), "a botdot server without groups")
        store.features = ["unread", "groups"]
        #expect(store.canMakeGroup(with: "1"))
        store.bots = [bot("1", "Coder")]
        #expect(!store.canMakeGroup(with: "1"), "no other bot to add")
    }

    @Test func theBotsThatCanBeAddedAreThoseNotInItAndNoneWhenItIsFull() {
        let bots = [bot("1", "Coder"), bot("2", "Reviewer"), bot("3", "Cook")]
        #expect(Groups.addable(BotGroup(id: "g1", members: ["1", "2"]), bots).map(\.name) == ["Cook"])
        #expect(Groups.addable(BotGroup(id: "g1", members: ["1", "2", "3", "4", "5", "6"]), bots + [bot("7", "Seventh")]).isEmpty, "a group of six is full")
        #expect(Groups.most == 6)
    }

    @Test func thePickerListsTheBotsCategoryFirstThenAToZ() {
        let coder = bot("1", "Coder", category: "Work")
        let bots = [coder, bot("2", "zoe", category: "Home"), bot("3", "Reviewer", category: "Work"), bot("4", "Anna", category: "Home"), bot("5", "alex", category: "Work")]
        #expect(Groups.toJoin(coder, bots).map(\.name) == ["alex", "Reviewer", "Anna", "zoe"])
    }

    // MARK: Against a botdot server

    @Test func aGroupIsMadeWithTheBotAndThosePickedAndIsInTheList() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let coder = try await server.makeBot("Make Coder", group: "Work")
        let reviewer = try await server.makeBot("Make Reviewer")
        let store = try await connected(server)
        defer { store.disconnect() }
        #expect(store.canMakeGroup(with: coder))

        let made = try await store.makeGroup(name: "Dev", members: [coder, reviewer])
        #expect(made.name == "Dev" && made.members == [coder, reviewer])
        // It is in the list before anything else is asked: its chat can open at once, in the first bot's category.
        #expect(store.group(made.id)?.members == [coder, reviewer])
        #expect(store.group(made.id)?.category == "Work")
        #expect(store.sidebar.groups.first { $0.name == "Work" }?.groupChats.map(\.name) == ["Dev"])

        // What the server refuses is said in its words, and nothing is made.
        #expect(await refusal { _ = try await store.makeGroup(name: "", members: [coder, reviewer]) } == "Give the group a name.")
        #expect(await refusal { _ = try await store.makeGroup(name: "Alone", members: [coder]) } == "A group has at least two bots.")
        var seven = [coder, reviewer]
        for i in 3...7 { seven.append(try await server.makeBot("Make Bot \(i)")) }
        #expect(await refusal { _ = try await store.makeGroup(name: "Crowd", members: seven) } == "A group has at most six bots.")
        #expect(store.groups.map(\.name) == ["Dev"])
        let theirs = try await server.api("group-chats") as? [[String: Any]]
        #expect(theirs?.count == 1)
    }

    @Test func aGroupsNameAndMembersChangeAndARefusalIsTheServersSentence() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let coder = try await server.makeBot("Change Coder")
        let reviewer = try await server.makeBot("Change Reviewer")
        let writer = try await server.makeBot("Change Writer")
        let store = try await connected(server)
        defer { store.disconnect() }
        let id = try await store.makeGroup(name: "Dev", members: [coder, reviewer]).id

        // A name typed is saved as one line; an emptied box and the name it has send nothing.
        try await store.nameGroup(id, typed: "  Dev \n team ")
        #expect(store.group(id)?.name == "Dev team")
        try await store.nameGroup(id, typed: "   ")
        try await store.nameGroup(id, typed: "Dev team")
        #expect(store.group(id)?.name == "Dev team")
        let named = try await server.api("group-chats/\(id)") as? [String: Any]
        #expect(named?["name"] as? String == "Dev team")

        // A member is added, at the end, and one is taken out.
        try await store.setMembers(of: id, [coder, reviewer, writer])
        #expect(store.group(id)?.members == [coder, reviewer, writer])
        try await store.setMembers(of: id, [coder, writer])
        #expect(store.group(id)?.members == [coder, writer])

        // Out of a group of two: refused in the server's words, and the group is as it was.
        #expect(await refusal { try await store.setMembers(of: id, [coder]) } == "A group has at least two bots. Add another, or delete the group.")
        #expect(store.group(id)?.members == [coder, writer])
        var seven = [coder, writer, reviewer]
        for i in 4...7 { seven.append(try await server.makeBot("Change Bot \(i)")) }
        #expect(await refusal { try await store.setMembers(of: id, seven) } == "A group has at most six bots.")
        #expect(store.group(id)?.members == [coder, writer])
    }

    @Test func aRemovedGroupLeavesTheListAndNoBotIsDeleted() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let coder = try await server.makeBot("Gone Coder")
        let reviewer = try await server.makeBot("Gone Reviewer")
        let store = try await connected(server)
        defer { store.disconnect() }
        let id = try await store.makeGroup(name: "Dev", members: [coder, reviewer]).id
        let other = try await store.makeGroup(name: "Ops", members: [reviewer, coder]).id
        store.openGroup(id)
        try await eventually("its chat") { store.groupChat.loaded }

        try await store.deleteGroup(id)
        #expect(store.groups.map(\.id) == [other], "its row leaves the list")
        #expect(store.groupChat.groupId == nil, "and its chat is no longer held")
        #expect(Set(store.bots.map(\.id)) == [coder, reviewer])
        let theirs = try await server.api("group-chats") as? [[String: Any]]
        #expect(theirs?.compactMap { $0["id"] as? String } == [other])
        let bots = try await server.api("bots") as? [[String: Any]]
        #expect(bots?.count == 2)

        // The panel closes after it with a name still in its box: the group is not in the list, and nothing is sent.
        try await store.nameGroup(id, typed: "Too late")
        // Removed once more (from another app meanwhile): the server says so in its words.
        #expect(await refusal { try await store.deleteGroup(id) } == "Group not found")
    }

    @Test func noGroupIsOfferedOnAServerWithoutGroups() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let coder = try await server.makeBot("Old Coder")
        let store = try await connected(server)
        defer { store.disconnect() }
        #expect(!store.canMakeGroup(with: coder), "no other bot to add")
        _ = try await server.makeBot("Old Reviewer")
        try await store.loadBots()
        #expect(store.canMakeGroup(with: coder))
        // A botdot server from before groups.
        store.features.remove(Feature.groups.rawValue)
        #expect(!store.canMakeGroup(with: coder))
    }

    // MARK: The sent message is in the group's chat at once

    @Test func aMessageToAGroupIsInItsChatAtOnceAndTheServersTakesItsPlace() async throws {
        let server = try TestServer()
        defer { server.stop() }
        let coder = try await server.makeBot("Sent Coder")
        let reviewer = try await server.makeBot("Sent Reviewer")
        let store = try await connected(server)
        defer { store.disconnect() }
        let id = try await store.makeGroup(name: "Dev", members: [coder, reviewer]).id
        store.openGroup(id)
        try await eventually("the chat to load") { store.groupChat.loaded }
        #expect(store.sent(toGroup: id) == nil)

        // Every look between Send and the end: the message is there, as the app's own or as the server's, never both and never neither.
        var seen: [String] = []
        let send = Task { await store.deliverToGroup("All clear?") }
        while !store.outbox(Groups.key(id)).sending { await Task.yield() }
        while store.outbox(Groups.key(id)).sending {
            let local = store.sent(toGroup: id), theirs = store.groupChat.messages.filter { $0.text == "All clear?" }
            #expect((local == nil) != theirs.isEmpty, "the message is drawn once")
            seen.append(local != nil ? "sent" : "message")
            await Task.yield()
        }
        #expect(await send.value)
        #expect(seen.first == "sent") // before botdot answered
        #expect(store.sent(toGroup: id) == nil)
        #expect(store.groupChat.messages.map(\.text) == ["All clear?"])
        #expect(store.sent(toGroup: "another") == nil, "only in the open group's chat")
    }
}
