import Foundation
import Testing
@testable import BotDotKit

/// Groups as the botdot server hands them out (Milestone 10; docs/api.md, "Groups"): the list, a
/// group's chat, what the feed says of a group, and what the app says of one. The cases are the
/// Android app's (GroupsTest, GroupNextTest, GroupWordsTest, GroupWorkingLineTest, GroupNotifierTest).
@Suite struct GroupsTests {
    static func json(_ text: String) -> Any { (try? JSONSerialization.jsonObject(with: Data(text.utf8), options: .fragmentsAllowed)) ?? NSNull() }
    static func groups(_ text: String) -> [BotGroup] { BotGroup.list(Data(text.utf8)) }

    static let dev = """
        {"id":"g1","name":"Dev","members":["coder","reviewer","writer"],"category":"Programming","pinned":0,"order":1,"createdAt":"2026-10-08T09:00:00Z",
        "unread":2,"firstUnread":"r1","last":{"runId":"r2","botId":"reviewer","botName":"Reviewer","status":"success","at":"2026-10-08T09:02:00Z","text":"I will review it."},
        "working":["coder"],"asks":{"botId":"coder","botName":"Coder","text":"Which one?","runId":"r3","at":"2026-10-08T09:03:00Z"},
        "limit":{"at":"2026-10-08T09:04:00Z","replies":12,"waits":["reviewer"],"messages":["m1"],"text":"The group stopped after 12 replies without you."}}
        """

    static func bots(_ text: String) -> [Bot] { (try? JSONDecoder().decode([Bot].self, from: Data(text.utf8))) ?? [] }
    static let team = bots("""
        [{"id":"coder","name":"Coder","color":"#3b82f6","group":"Programming","order":1},{"id":"reviewer","name":"Reviewer","color":"#16a34a","group":"Programming","order":2},
        {"id":"writer","name":"Issue Writer","color":"#d97706","group":"Programming"},{"id":"cook","name":"Cook","group":"Home","order":1},
        {"id":"fleet","name":"Fleet Doctor","pinned":1},{"id":"news","name":"News","pinned":2}]
        """)
    static func group(_ more: String = "") -> BotGroup {
        groups(#"[{"id":"g1","name":"Dev","members":["coder","reviewer","writer"],"category":"Programming","order":1\#(more)}]"#)[0]
    }
    static func message(_ fields: String) -> GroupMessage {
        GroupMessage(json: json(#"{"id":"m1","text":"Fix it.","at":"2026-10-08T09:00:00Z",\#(fields)}"#))!
    }

    // MARK: the feature

    @MainActor @Test func groupsAreOfferedOnlyAgainstAServerThatAnnouncesThem() {
        let store = Store()
        #expect(!store.has(.groups), "its features are not known yet: nothing is offered")
        store.features = ["events", "unread", "message-waits", "memory-cards"]
        #expect(!store.has(.groups), "a botdot server of Milestone 9")
        store.features = ["events", "unread", "groups"]
        #expect(store.has(.groups))
        #expect(Feature.groups.rawValue == "groups")
        #expect(Groups.key("g1") == "group:g1")
        #expect(Groups.of(chat: "group:g1") == "g1")
        for other in ["bot:g1", "chief:c1", "chief", "group:", "g1", nil] { #expect(Groups.of(chat: other) == nil, "\(other ?? "nil")") }
    }

    // MARK: the list

    @Test func aGroupCarriesItsMembersItsPlaceAndWhatItsChatHolds() throws {
        let g = try #require(Self.groups("[\(Self.dev)]").first)
        #expect(g.members == ["coder", "reviewer", "writer"])
        #expect(g.name == "Dev" && g.category == "Programming" && g.pinned == 0 && g.order == 1 && g.unread == 2 && g.firstUnread == "r1")
        #expect(g.last == GroupLast(runId: "r2", botId: "reviewer", botName: "Reviewer", status: "success", at: "2026-10-08T09:02:00Z", text: "I will review it."))
        #expect(g.working == ["coder"])
        #expect(g.asks == GroupAsks(botId: "coder", botName: "Coder", text: "Which one?", runId: "r3", at: "2026-10-08T09:03:00Z"))
        #expect(g.limit == GroupLimit(text: "The group stopped after 12 replies without you.", messages: ["m1"], waits: ["reviewer"]))
    }

    @Test func aNewGroupHasNoneOfItAndAFieldOfAnotherKindLeavesTheGroupsReadable() {
        let fresh = Self.groups(#"[{"id":"g2","name":"Pair","members":["a","b"],"last":null,"working":[],"asks":null,"limit":null}]"#)[0]
        #expect(fresh.last == nil && fresh.working.isEmpty && fresh.asks == nil && fresh.limit == nil)
        for odd in ["7", "\"x\"", "[]", "true", "{}", #"{"text":7}"#] {
            let g = Self.groups(#"[{"id":"g2","name":"Pair","members":\#(odd),"last":\#(odd),"working":\#(odd),"asks":\#(odd),"limit":\#(odd == "{}" ? "7" : odd)}]"#).first
            #expect(g?.name == "Pair", "\(odd)")
            #expect(g?.members == [] && g?.last == nil && g?.working == [] && g?.asks == nil, "\(odd)")
        }
        // One entry this app cannot read is left out, and the others are still there.
        #expect(Self.groups(#"[{"id":"g1","name":"A"},{"name":"no id"},7,{"id":"g3","name":"C"}]"#).map(\.id) == ["g1", "g3"])
        #expect(Self.groups(#"{"error":"Not found"}"#).isEmpty, "an answer that is no list")
        #expect(Self.groups(#"[{"id":"g1","limit":{"replies":12}}]"#)[0].limit?.text == GroupLimit.stopped)
    }

    @Test func theListPutsAGroupAmongTheGroups() {
        let all = Self.groups("""
            [{"id":"b","name":"B","category":"Work","order":2},{"id":"a","name":"A","category":"Work","order":1},{"id":"h","name":"H","category":"Home","order":1},
            {"id":"p2","name":"P2","pinned":2},{"id":"p1","name":"P1","pinned":1},{"id":"z","name":"Zed","category":"Work"},{"id":"y","name":"alpha","category":"Work"}]
            """)
        #expect(Groups.pinned(all).map(\.id) == ["p1", "p2"])
        #expect(Groups.inCategory(all, "Work").map(\.id) == ["a", "b", "y", "z"], "by their order; one never placed after them, A to Z")
        #expect(Groups.inCategory(all, "Home").map(\.id) == ["h"])
        #expect(Groups.inCategory(all, "").isEmpty, "a pinned group is in no category's rows")
    }

    @Test func aCategorysGroupsStandAfterItsBotsAndThePinnedGroupsAfterThePinnedBots() {
        let groups = Self.groups("""
            [{"id":"g2","name":"Pair","members":["coder","reviewer"],"category":"Programming","order":2},{"id":"g1","name":"Dev","members":["coder","reviewer","writer"],"category":"Programming","order":1},
            {"id":"g3","name":"Kitchen","members":["cook","coder"],"category":"Home","order":1},{"id":"g4","name":"Loose","members":["cook","coder"],"category":"Later","order":1},{"id":"g5","name":"Top","members":["cook","coder"],"pinned":1}]
            """)
        let s = SidebarSections(Self.team).with(groups)
        #expect(s.pinned.map(\.id) == ["fleet", "news"] && s.pinnedGroupChats.map(\.id) == ["g5"])
        // A category is one of the bots' or of the groups': it can hold groups and no bot.
        #expect(s.groups.map(\.name) == ["Home", "Later", "Programming"])
        #expect(s.groups.map { $0.bots.map(\.id) } == [["cook"], [], ["coder", "reviewer", "writer"]])
        #expect(s.groups.map { $0.groupChats.map(\.id) } == [["g3"], ["g4"], ["g1", "g2"]])
        // Against a server without groups the list is as it was.
        let plain = SidebarSections(Self.team).with([])
        #expect(plain.pinnedGroupChats.isEmpty && plain.groups.map(\.name) == ["Home", "Programming"] && plain.groups.allSatisfy { $0.groupChats.isEmpty })
        // Bots that are in no category, with a group among them: the group stands after them.
        let loose = SidebarSections(Self.bots(#"[{"id":"b","name":"Beta"},{"id":"a","name":"alpha"}]"#)).with(Self.groups(#"[{"id":"g9","name":"Both","members":["a","b"]}]"#))
        #expect(loose.groups.map(\.name) == [""] && loose.groups[0].bots.map(\.id) == ["a", "b"] && loose.groups[0].groupChats.map(\.id) == ["g9"])
    }

    @Test func itsMembersAreTheBotsThatExistInTheGroupsOrder() {
        let bots = Self.bots(#"[{"id":"writer","name":"Issue Writer"},{"id":"coder","name":"Coder"},{"id":"cook","name":"Cook"}]"#)
        let g = Self.groups(#"[{"id":"g1","members":["coder","gone","writer"]}]"#)[0]
        #expect(Groups.members(g, bots).map(\.name) == ["Coder", "Issue Writer"], "without a bot that was deleted")
    }

    // MARK: the feed

    static func on(_ groups: [BotGroup], _ event: String, _ data: String) -> [BotGroup] { Groups.on(groups, event: event, data: Data(data.utf8)) }

    @Test func theFeedSaysWhoWorksAndTheNewestReplyAndNeverAPass() {
        let before = Self.groups(#"[{"id":"g1","name":"Dev","members":["coder","reviewer"]},{"id":"g2","name":"Pair","members":["coder","cook"]}]"#)
        let started = Self.on(before, "group_run_started", #"{"id":"r1","botId":"coder","botName":"Coder","groupId":"g1","groupMessageId":"m1","chat":"group:g1","status":"running"}"#)
        #expect(started[0].working == ["coder"])
        #expect(started[1].working.isEmpty, "the other group is as it was")
        #expect(Self.on(started, "group_run_started", #"{"id":"r1","botId":"coder","groupId":"g1"}"#)[0].working == ["coder"], "said twice, it works once")
        let replied = Self.on(started, "group_run_finished", #"{"id":"r1","botId":"coder","botName":"Coder","groupId":"g1","status":"success","result":"Done, on the branch.","endedAt":"2026-10-08T09:01:00Z","notify":false,"new":true}"#)
        #expect(replied[0].working.isEmpty)
        #expect(replied[0].last == GroupLast(runId: "r1", botId: "coder", botName: "Coder", status: "success", at: "2026-10-08T09:01:00Z", text: "Done, on the branch."))
        // A pass is in no preview: its member no longer works, and the newest reply stays.
        let working = Self.on(replied, "group_run_started", #"{"id":"r2","botId":"reviewer","groupId":"g1"}"#)
        let passed = Self.on(working, "group_run_finished", #"{"id":"r2","botId":"reviewer","botName":"Reviewer","groupId":"g1","status":"success","result":"","passed":true,"quiet":true}"#)
        #expect(passed[0].working.isEmpty && passed[0].last?.runId == "r1")
        // One that failed says its problem.
        let failed = Self.on(passed, "group_run_finished", #"{"id":"r3","botId":"reviewer","botName":"Reviewer","groupId":"g1","status":"error","result":"","problem":"Claude is not signed in.","startedAt":"2026-10-08T09:02:00Z"}"#)
        #expect(failed[0].last == GroupLast(runId: "r3", botId: "reviewer", botName: "Reviewer", status: "error", at: "2026-10-08T09:02:00Z", text: "Claude is not signed in."))
    }

    @Test func theFeedSetsAndEndsItsQuestionItsStoppedLineAndItsNewReplies() {
        let before = Self.groups(#"[{"id":"g1","name":"Dev"}]"#)
        let asked = Self.on(before, "group_asks", #"{"chat":"group:g1","groupId":"g1","asks":{"botId":"coder","botName":"Coder","text":"Which one?","runId":"r3"}}"#)
        #expect(asked[0].asks?.text == "Which one?")
        #expect(Self.on(asked, "group_asks", #"{"groupId":"g1","asks":null}"#)[0].asks == nil)
        let stopped = Self.on(before, "group_limit", #"{"groupId":"g1","limit":{"replies":12,"text":"The group stopped after 12 replies without you.","messages":["m1"],"waits":["coder"]}}"#)
        #expect(stopped[0].limit?.text == "The group stopped after 12 replies without you.")
        #expect(Self.on(stopped, "group_limit", #"{"groupId":"g1","limit":null}"#)[0].limit == nil)
        let new = Self.on(before, "group_unread", #"{"chat":"group:g1","groupId":"g1","unread":3,"firstUnread":"r1"}"#)
        #expect(new[0].unread == 3 && new[0].firstUnread == "r1")
        let read = Self.on(new, "group_unread", #"{"chat":"group:g1","groupId":"g1","unread":0,"firstUnread":null,"readAt":"2026-10-08T10:00:00Z"}"#)
        #expect(read[0].unread == 0 && read[0].firstUnread == nil, "read in any app: its dots go here too")
    }

    @Test func eventsOfABotsOwnChatAndOfAGroupThisAppDoesNotHaveChangeNothing() {
        let had = Self.groups("[\(Self.dev)]")
        // A bot's own run, its new replies and its question are not a group's, whatever they carry.
        #expect(Self.on(had, "run_finished", #"{"id":"r9","botId":"coder","groupId":"g1","status":"success","result":"x"}"#) == had)
        #expect(Self.on(had, "unread", #"{"chat":"bot:coder","groupId":"g1","unread":0}"#) == had)
        #expect(Self.on(had, "asks", #"{"botId":"coder","groupId":"g1","asks":null}"#) == had)
        #expect(Self.on(had, "group_unread", #"{"groupId":"gone","unread":0}"#) == had)
        #expect(Self.on(had, "group_run_finished", #"{"id":"r9","botId":"coder","status":"success"}"#) == had)
        #expect(Self.on(had, "group_renamed", #"{"groupId":"g1"}"#) == had, "an event of a group that a later app would know")
    }

    // MARK: the chat

    @Test func aGroupsChatIsItsMessagesAndItsRepliesEachWithItsBot() throws {
        let page = GroupChatPage(Data("""
            {"items":[
            {"type":"message","id":"m1","text":"The settings page needs a dark mode switch.","at":"2026-10-08T09:00:00Z","to":["writer","coder"],"waitsFor":[],"next":[],"canTakeBack":false},
            {"type":"reply","id":"r1","at":"2026-10-08T09:00:01Z","run":{"id":"r1","botId":"writer","botName":"Issue Writer","botColor":"#3b82f6","status":"success","result":"I will write the issue.","endedAt":"2026-10-08T09:00:05Z","groupId":"g1","groupMessageId":"m1"}},
            {"type":"reply","id":"r2","at":"2026-10-08T09:00:06Z","run":{"id":"r2","botId":"coder","botName":"Coder","status":"stopped","problem":"You stopped this run before it finished.","endedBy":"owner"}},
            {"type":"message","id":"m2","text":"","at":"2026-10-08T09:01:00Z","attachments":[{"name":"spec.pdf","file":"groups/g1/spec.pdf","size":2048}],"to":["writer","coder"],"waitsFor":["coder"],"next":["coder"],"canTakeBack":true},
            {"type":"note","id":"n1","at":"2026-10-08T09:02:00Z"},{"type":"reply","id":"r9","at":"2026-10-08T09:02:00Z"}],
            "more":true,"working":[{"botId":"writer","runId":"r4","messageId":"m2","startedAt":"2026-10-08T09:01:01Z","openingLine":"Reading the spec"},{"botId":"coder"}],
            "asks":{"botId":"writer","botName":"Issue Writer","text":"Which one?","runId":"r1"},"limit":null,"cards":[{"kind":"ask","id":"a1","botId":"coder","runId":"r2"}],"unread":1,"firstUnread":"r1","readAt":null}
            """.utf8))
        #expect(page.items.map(\.id) == ["m1", "r1", "r2", "m2"], "what is no message and no reply with its run is left out")
        guard case .message(let m1) = page.items[0], case .reply(_, _, let r1) = page.items[1], case .reply(_, _, let r2) = page.items[2], case .message(let m2) = page.items[3] else {
            Issue.record("the items are two messages and two replies"); return
        }
        #expect(m1.to == ["writer", "coder"] && !m1.canTakeBack)
        #expect(r1.botId == "writer" && r1.botName == "Issue Writer" && r1.botColor == "#3b82f6" && r1.status == "success" && r1.result == "I will write the issue.")
        #expect(r2.status == "stopped" && r2.endedBy == "owner")
        #expect(r2.botColor == nil, "a run without the colour")
        #expect(m2.text == "", "files alone: a message with no text")
        #expect(m2.attachments == [FileRef(name: "spec.pdf", file: "groups/g1/spec.pdf", size: 2048)])
        #expect(m2.waitsFor == ["coder"] && m2.canTakeBack)
        #expect(page.more)
        #expect(page.working == [GroupWorking(botId: "writer", runId: "r4", messageId: "m2", startedAt: "2026-10-08T09:01:01Z", openingLine: "Reading the spec")], "a member at work without its run is none")
        #expect(page.asks?.runId == "r1" && page.limit == nil)
        #expect(page.unread == 1 && page.firstUnread == "r1")
        #expect(GroupChatPage(Data(#"["x"]"#.utf8)) == GroupChatPage(), "an answer that is no chat")
    }

    @Test func whatTheOwnerSendsIsDrawnFromTheAnswerAndTypedGoOnIsNoMessage() {
        let sent = GroupSent(Data(#"{"id":"m3","text":"@Coder go on","at":"2026-10-08T09:05:00Z","to":["coder"],"waitsFor":[],"next":[],"canTakeBack":false}"#.utf8))
        #expect(!sent.wentOn && sent.held.map(\.id) == ["m3"])
        // "Go on", typed while the group is stopped at the limit: no id, nothing to add, and the lines that go on.
        let went = GroupSent(Data(#"{"ok":true,"wentOn":true,"messages":[{"id":"m1","text":"Fix it.","at":"2026-10-08T09:00:00Z","to":["coder"],"next":["coder"]}]}"#.utf8))
        #expect(went.wentOn && went.message == nil && went.held.map(\.id) == ["m1"])
        #expect(GroupSent(Data("not json".utf8)).held.isEmpty, "an answer this app cannot read: the message went all the same")
    }

    static func messageItem(_ id: String, _ at: String, waitsFor: String = "[]") -> String {
        #"{"type":"message","id":"\#(id)","text":"\#(id)","at":"\#(at)","to":["coder"],"waitsFor":\#(waitsFor),"next":[],"canTakeBack":\#(waitsFor != "[]")}"#
    }
    static func replyItem(_ id: String, _ at: String) -> String {
        #"{"type":"reply","id":"\#(id)","at":"\#(at)","run":{"id":"\#(id)","botId":"coder","botName":"Coder","status":"success","result":"\#(id)"}}"#
    }
    static func page(_ items: String..., more: Bool = false) -> GroupChatPage {
        GroupChatPage(Data(#"{"items":[\#(items.joined(separator: ","))],"more":\#(more)}"#.utf8))
    }

    @Test func theNewestPageSaysWhatIsThereNowAndAnOlderPageOnlyAdds() {
        var chat = GroupChatItems()
        chat.take(Self.page(Self.messageItem("m2", "2026-10-08T10:00:00Z"), Self.replyItem("r2", "2026-10-08T10:00:01Z"), Self.messageItem("m3", "2026-10-08T10:05:00Z", waitsFor: #"["coder"]"#), more: true))
        #expect(chat.rows.map(\.id) == ["m2", "r2", "m3"] && chat.more)
        // The page before the oldest item held.
        chat.take(Self.page(Self.messageItem("m1", "2026-10-08T09:00:00Z"), Self.replyItem("r1", "2026-10-08T09:00:01Z")), older: true)
        #expect(chat.rows.map(\.id) == ["m1", "r1", "m2", "r2", "m3"])
        #expect(!chat.more, "the older page says that nothing older is left")
        // Read again: m3 was taken back in another app, and a reply came. What stands before the page begins stays.
        chat.take(Self.page(Self.messageItem("m2", "2026-10-08T10:00:00Z"), Self.replyItem("r2", "2026-10-08T10:00:01Z"), Self.replyItem("r3", "2026-10-08T10:06:00Z"), more: true))
        #expect(chat.rows.map(\.id) == ["m1", "r1", "m2", "r2", "r3"])
        #expect(!chat.more, "the older pages that are held say whether more is left, not the newest page")
        #expect(chat.has("r3") && chat.oldest?.id == "m1")
    }

    @Test func aMessageTheFeedHandsOverIsKeptWhenItBelongsToWhatIsHeld() {
        var chat = GroupChatItems()
        chat.take(Self.page(Self.messageItem("m2", "2026-10-08T10:00:00Z"), Self.replyItem("r2", "2026-10-08T10:00:01Z"), more: true))
        let of = { (id: String, at: String, waits: String) in GroupMessage(json: Self.json(Self.messageItem(id, at, waitsFor: waits)))! }
        let new = chat.hold(of("m3", "2026-10-08T10:05:00Z", #"["coder"]"#))
        #expect(new, "a new message")
        let again = chat.hold(of("m3", "2026-10-08T10:05:00Z", "[]"))
        #expect(again, "the same message as it is now: it no longer waits")
        if case .message(let m)? = chat.rows.last { #expect(m.waitsFor.isEmpty) } else { Issue.record("the last row is the message") }
        // One from further back than the page holds is left to the page that reads it.
        let early = chat.hold(of("m0", "2026-10-08T08:00:00Z", "[]"))
        #expect(!early)
        #expect(chat.rows.map(\.id) == ["m2", "r2", "m3"])
        let gone = chat.remove("m3"), twice = chat.remove("m3")
        #expect(gone, "taken back")
        #expect(!twice)
        // With nothing older left, it belongs to the chat wherever it stands.
        var whole = GroupChatItems()
        whole.take(Self.page(Self.replyItem("r2", "2026-10-08T10:00:01Z")))
        let kept = whole.hold(of("m0", "2026-10-08T08:00:00Z", "[]"))
        #expect(kept)
        #expect(whole.rows.map(\.id) == ["m0", "r2"])
    }

    // MARK: who is next

    static func next(_ id: String, _ next: String = "[]", _ more: String = "") -> GroupMessage {
        GroupMessage(json: json(#"{"id":"\#(id)","text":"\#(id)","at":"2026-10-09T09:0\#(id.last!):00Z","to":["coder","reviewer","writer"],"waitsFor":[],"next":\#(next),"canTakeBack":false\#(more)}"#))!
    }
    static func works(_ botId: String, _ messageId: String?) -> GroupWorking { GroupWorking(botId: botId, runId: "run-\(botId)", messageId: messageId) }

    @Test func whoIsNextIsTheServersNextOfTheOneMessageThatIsShownThemOf() {
        // While a member works, and between two turns, the members to come stand in the server's order.
        #expect(Groups.next([Self.next("m1", #"["writer","reviewer"]"#)], [Self.works("coder", "m1")]) == ["writer", "reviewer"])
        #expect(Groups.next([Self.next("m1", #"["reviewer","writer"]"#)], []) == ["reviewer", "writer"])
        // Only what the server's `next` holds: a member that passed is gone, one handed the work on to is there.
        #expect(Groups.next([Self.next("m1", #"["reviewer"]"#)], [Self.works("coder", "m1")]) == ["reviewer"])
        #expect(Groups.next([Self.next("m1", #"["reviewer","coder"]"#)], [Self.works("writer", "m1")]) == ["reviewer", "coder"])
    }

    @Test func ofTwoMessagesTheOneWhoseTurnsAreRunningIsShown() {
        let first = Self.next("m1", #"["reviewer","writer"]"#), second = Self.next("m2", #"["coder","reviewer","writer"]"#)
        #expect(Groups.next([first, second], [Self.works("coder", "m1")]) == ["reviewer", "writer"], "the older one runs: its row, not the newer one's")
        #expect(Groups.next([first, second], [Self.works("coder", "m2")]) == ["coder", "reviewer", "writer"])
        // The running one's last turn is at work: nothing is to come after that line, whatever another message waits for.
        #expect(Groups.next([Self.next("m1"), second], [Self.works("writer", "m1")]).isEmpty)
        // Of two that run, the newest with members to come.
        let both = [Self.works("coder", "m1"), Self.works("writer", "m2")]
        #expect(Groups.next([Self.next("m1", #"["writer"]"#), Self.next("m2", #"["reviewer"]"#)], both) == ["reviewer"])
        #expect(Groups.next([Self.next("m1", #"["writer"]"#), Self.next("m2")], both) == ["writer"], "the newer one is at its last turn")
        // When none runs, the newest with members to come.
        #expect(Groups.next([Self.next("m1", #"["writer"]"#), Self.next("m2", #"["coder","reviewer"]"#)], []) == ["coder", "reviewer"])
        #expect(Groups.next([Self.next("m1", #"["writer"]"#), Self.next("m2")], []) == ["writer"], "the newer one is over")
    }

    @Test func nobodyIsNextAfterTheLastTurnAndAfterStopAll() {
        #expect(Groups.next([], []).isEmpty)
        #expect(Groups.next([Self.next("m1")], [Self.works("writer", "m1")]).isEmpty, "the last turn is at work")
        #expect(Groups.next([Self.next("m1")], []).isEmpty, "the last turn ended")
        // "Stop all": a stopped message is shown nothing of, whatever it still carries.
        #expect(Groups.next([Self.next("m1", "[]", #","stopped":true"#)], []).isEmpty)
        #expect(Groups.next([Self.next("m1", #"["writer"]"#, #","stopped":true"#)], []).isEmpty)
        #expect(Groups.next([Self.next("m0", #"["writer"]"#), Self.next("m1", "[]", #","stopped":true"#)], [Self.works("coder", "m1")]).isEmpty,
                "an older line is not shown in its place while the stopped one's run ends")
        // A turn of a message further back than the chat holds is at work, and says nothing of this one.
        #expect(Groups.next([Self.next("m2", #"["writer"]"#)], [Self.works("coder", "m1")]).isEmpty)
        #expect(Groups.next([Self.next("m2", #"["writer"]"#)], [Self.works("coder", nil)]).isEmpty)
        // The heads are the bots the app knows, in the server's order.
        #expect(Groups.members(["writer", "gone", "coder"], Self.team).map(\.id) == ["writer", "coder"])
    }

    // MARK: a member's line

    static let with = true, without = false
    static func said(_ lines: inout TurnLines, _ event: String, _ text: String, run: String = "r1", bot: String = "coder", follows: Bool = true) {
        lines.handle(event, Data(#"{"chat":"group:g1","groupId":"g1","botId":"\#(bot)","runId":"\#(run)","text":"\#(text)"}"#.utf8), follows: follows)
    }
    static func heard(_ lines: inout TurnLines, _ event: String, _ data: String, follows: Bool = true) { lines.handle(event, Data(data.utf8), follows: follows) }
    static func working(_ text: String) -> [GroupWorking] { GroupChatPage(Data(#"{"items":[],"working":\#(text)}"#.utf8)).working }
    static func under(_ lines: TurnLines, _ w: GroupWorking, follows: Bool = true) -> String {
        GroupWords.working(GroupWords.memberName(team, w.botId), lines[w.runId], TurnLines.ofRun(w, follows: follows))
    }
    static func row(_ lines: TurnLines, _ at: String) -> GroupLine {
        GroupWords.line(groups(#"[{"id":"g1","name":"Dev","members":["coder","reviewer"],"working":["\#(at)"]}]"#)[0], team, lines)
    }
    static let coder = GroupWorking(botId: "coder", runId: "r1"), reviewer = GroupWorking(botId: "reviewer", runId: "r2")

    @Test func aMembersLineFollowsItsTurnsWork() {
        var l = TurnLines()
        #expect(Self.under(l, Self.coder) == "Coder · Working…")
        Self.said(&l, "group_opening_line", "Reading the issue")
        #expect(Self.under(l, Self.coder) == "Coder · Reading the issue…", "its opening line, until the turn has a working line")
        Self.said(&l, "group_working_line", "Reading the issue")
        Self.said(&l, "group_working_line", " Reading nytimes.com ")
        #expect(Self.under(l, Self.coder) == "Coder · Reading nytimes.com…")
        #expect(Self.row(l, "coder") == GroupLine(who: "Coder", text: "Reading nytimes.com…", working: true, color: "#3b82f6"))
        Self.said(&l, "group_working_line", "Running a command")
        #expect(Self.under(l, Self.coder) == "Coder · Running a command…", "each text takes the place of the last")
    }

    @Test func twoMembersOneAfterAnotherEachReadItsOwnWords() {
        var l = TurnLines()
        Self.heard(&l, "group_run_started", #"{"id":"r1","groupId":"g1","botId":"coder"}"#)
        Self.said(&l, "group_working_line", "Reading the issue")
        Self.heard(&l, "group_run_finished", #"{"id":"r1","groupId":"g1","botId":"coder","status":"success"}"#)
        #expect(l["r1"] == nil, "the line goes with its turn")
        Self.heard(&l, "group_run_started", #"{"id":"r2","groupId":"g1","botId":"reviewer"}"#)
        #expect(Self.under(l, Self.reviewer) == "Reviewer · Working…", "never the first member's last words")
        #expect(Self.row(l, "reviewer").text == "Working…")
        Self.said(&l, "group_working_line", "Reading the diff", run: "r2", bot: "reviewer")
        #expect(Self.under(l, Self.reviewer) == "Reviewer · Reading the diff…")
        // "Stop all", a failure: any end takes the line.
        Self.heard(&l, "group_run_finished", #"{"id":"r2","groupId":"g1","botId":"reviewer","status":"stopped"}"#)
        #expect(l.value.isEmpty)
    }

    @Test func onceATurnHasAWorkingLineItsOpeningLineIsNotDrawnInItsPlace() {
        var l = TurnLines()
        Self.said(&l, "group_working_line", "Reading nytimes.com")
        Self.said(&l, "group_opening_line", "Checking the news") // sent as before, for an app that knows no working line
        #expect(Self.under(l, Self.coder) == "Coder · Reading nytimes.com…")
        l.read("g1", Self.working(#"[{"botId":"coder","runId":"r1","openingLine":"Checking the news"}]"#), follows: true)
        #expect(Self.under(l, Self.coder) == "Coder · Reading nytimes.com…", "nor when the chat is read")
        Self.said(&l, "group_opening_line", "Reading the diff", run: "r2", bot: "reviewer")
        #expect(Self.under(l, Self.reviewer) == "Reviewer · Reading the diff…")
    }

    @Test func aTurnsLineIsKeptByItsRunUntilItEnds() {
        var lines = TurnLines()
        Self.said(&lines, "group_opening_line", " Reading the issue ")
        #expect(lines.of("g1", "coder") == "Reading the issue")
        #expect(lines.of("g2", "coder") + lines.of("g1", "reviewer") == "", "another group, another member")
        Self.heard(&lines, "group_run_waits", #"{"chat":"group:g1","groupId":"g1","botId":"coder","runId":"r1","waitingFor":"ok"}"#)
        #expect(lines["r1"] == TurnLine(groupId: "g1", botId: "coder", text: "Reading the issue", held: true))
        #expect(Self.under(lines, Self.coder) == "Coder · Waiting for your OK")
        Self.heard(&lines, "group_run_waits", #"{"chat":"group:g1","groupId":"g1","botId":"coder","runId":"r1"}"#)
        #expect(lines["r1"]?.held == false, "it no longer waits for the owner's OK")
        // Its next turn in that group takes the earlier line away; its end takes its own.
        Self.heard(&lines, "group_run_started", #"{"id":"r2","groupId":"g1","botId":"coder"}"#)
        #expect(lines.value.isEmpty)
        // A bot's own line is not a group's, and a line says nothing without its run or its words.
        Self.heard(&lines, "opening_line", #"{"chat":"bot:coder","botId":"coder","runId":"r5","text":"Checking"}"#)
        Self.heard(&lines, "working_line", #"{"chat":"bot:coder","botId":"coder","runId":"r1","text":"A bot's own line is not a group's"}"#)
        Self.said(&lines, "group_opening_line", "  ", run: "r6")
        Self.said(&lines, "group_working_line", "Reading", run: "")
        #expect(lines.value.isEmpty)
        Self.said(&lines, "group_opening_line", "x", run: "r7")
        Self.heard(&lines, "reset", "{}")
        #expect(lines.value.isEmpty)
    }

    @Test func aChatThatIsReadBringsEachMembersLineAsItReadsNow() {
        let page = Self.working("""
            [{"botId":"coder","runId":"r1","messageId":"m1","startedAt":"2026-10-09T09:00:00Z","openingLine":"Checking the news","workingLine":"Reading nytimes.com"},
            {"botId":"reviewer","runId":"r2","openingLine":"Reading the diff"},{"botId":"writer","runId":"r3","workingLine":7}]
            """)
        #expect(page[0] == GroupWorking(botId: "coder", runId: "r1", messageId: "m1", startedAt: "2026-10-09T09:00:00Z", openingLine: "Checking the news", workingLine: "Reading nytimes.com"))
        #expect(page[1].workingLine == nil && page[2].workingLine == nil, "a turn that has no line yet, and what is no text")
        var l = TurnLines()
        l.read("g1", page, follows: true)
        #expect(Self.under(l, page[0]) == "Coder · Reading nytimes.com…")
        #expect(Self.under(l, page[1]) == "Reviewer · Reading the diff…", "a turn without a working line: its opening line")
        Self.said(&l, "group_working_line", "Running a command")
        #expect(Self.under(l, page[0]) == "Coder · Running a command…")
        l.read("g1", page, follows: true)
        #expect(Self.under(l, page[0]) == "Coder · Reading nytimes.com…", "the chat as it is read is the line now")
        // Before the feed or the chat said anything, the screen draws the entry itself the same way.
        #expect(Self.under(TurnLines(), page[0]) == "Coder · Reading nytimes.com…")
    }

    @Test func againstAServerWithoutTheWorkingLineAMembersLineIsItsOpeningLineAsBefore() {
        var l = TurnLines()
        Self.said(&l, "group_opening_line", "Checking the news", follows: false)
        Self.said(&l, "group_working_line", "Reading nytimes.com", follows: false) // nothing such a server sends; not drawn if it did
        #expect(Self.under(l, Self.coder, follows: false) == "Coder · Checking the news…")
        #expect(l["r1"] == TurnLine(groupId: "g1", botId: "coder", text: "Checking the news"))
        let page = Self.working(#"[{"botId":"coder","runId":"r1","openingLine":"Checking the news","workingLine":"Reading nytimes.com"}]"#)
        l.read("g1", page, follows: false)
        #expect(Self.under(l, page[0], follows: false) == "Coder · Checking the news…")
        #expect(Self.under(TurnLines(), page[0], follows: false) == "Coder · Checking the news…")
        #expect(Self.row(l, "coder").text == "Checking the news…")
    }

    // MARK: the words

    @Test func namesAreListedAsASentenceDoes() {
        #expect([[], ["Coder"], ["Coder", "Reviewer"], ["Coder", "Reviewer", "Issue Writer"]].map(GroupWords.names) == ["", "Coder", "Coder and Reviewer", "Coder, Reviewer and Issue Writer"])
        // The heads of who is next carry no words: VoiceOver is told their names.
        #expect(GroupWords.next(["Reviewer"]) == "Next: Reviewer")
        #expect(GroupWords.next(["Coder", "Reviewer", "Issue Writer"]) == "Next: Coder, Reviewer and Issue Writer")
        #expect(GroupWords.next([]) == "")
    }

    @Test func aGroupsRowSaysItsNewestReplyWithTheBotsNameBeforeIt() {
        let none = TurnLines()
        let line = GroupWords.line(Self.group(#","last":{"runId":"r2","botId":"reviewer","botName":"Reviewer","status":"success","at":"2026-10-08T09:02:00Z","text":"**Looks good.**\nMerge it."}"#), Self.team, none)
        #expect(line == GroupLine(who: "Reviewer", text: "Looks good. Merge it.", color: "#16a34a"))
        // A bot that was renamed since is named as it is now; one that is gone, as the server said it.
        #expect(GroupWords.line(Self.group(#","last":{"botId":"reviewer","botName":"Old name","status":"success","text":"x"}"#), Self.team, none).who == "Reviewer")
        #expect(GroupWords.line(Self.group(#","last":{"botId":"gone","botName":"Tester","status":"success","text":"x"}"#), Self.team, none).who == "Tester")
        #expect(GroupWords.line(Self.group(#","last":{"botId":"coder","status":"success","text":""}"#), Self.team, none).text == "Done.")
        #expect(GroupWords.line(Self.group(#","last":{"botId":"coder","status":"error","text":null}"#), Self.team, none).text == "Couldn't finish")
        #expect(GroupWords.line(Self.group(#","last":{"botId":"coder","status":"error","text":"Claude is not signed in."}"#), Self.team, none).text == "Claude is not signed in.", "a failed reply says its problem")
        #expect(GroupWords.line(Self.group(), Self.team, none) == GroupLine(who: "", text: "No messages yet", color: "#3b82f6"))
    }

    @Test func whileAMemberWorksTheRowSaysWhoAndWhenAMemberAsksTheRowSaysAsks() {
        let g = Self.group(#","working":["gone","reviewer","coder"],"asks":{"botId":"coder","text":"Which one?"},"last":{"botId":"coder","status":"success","text":"x"}"#)
        #expect(GroupWords.line(g, Self.team, TurnLines()) == GroupLine(who: "Reviewer", text: "Working…", working: true, color: "#3b82f6"))
        var lines = TurnLines()
        Self.said(&lines, "group_opening_line", "Reading the diff", bot: "reviewer")
        lines.handle("group_opening_line", Data(#"{"groupId":"g2","botId":"reviewer","runId":"r2","text":"In another group"}"#.utf8), follows: true)
        #expect(GroupWords.line(g, Self.team, lines).text == "Reading the diff…")
        let asks = GroupWords.line(Self.group(#","asks":{"botId":"coder","botName":"Coder","text":"Two ways to do it.\nWhich one?","runId":"r3"},"last":{"botId":"reviewer","status":"success","text":"I wait."}"#), Self.team, TurnLines())
        #expect(asks == GroupLine(who: "", text: "Coder asks: Two ways to do it. Which one?", asks: true, color: "#3b82f6"))
        #expect(GroupWords.line(Self.group(#","asks":{"botId":"coder","text":""}"#), Self.team, TurnLines()).text == "Coder asks")
    }

    @Test func theSearchBoxFindsAGroupByItsNameItsCategoryAndItsMembers() {
        let text = GroupWords.searchText(Self.group(), Self.team)
        for q in ["dev", "programming", "issue writer", "coder"] { #expect(text.contains(q), "\(q)") }
        #expect(!text.contains("cook"))
    }

    @Test func aMessageThatWaitsSaysForWhom() {
        #expect(GroupWords.waitsLine(Self.message(#""waitsFor":["coder"],"canTakeBack":true"#), Self.team) == "Waits until Coder is free")
        #expect(GroupWords.waitsLine(Self.message(#""waitsFor":["coder","reviewer"]"#), Self.team) == "Waits until Coder and Reviewer are free")
        #expect(GroupWords.waitsLine(Self.message(#""waitsFor":[],"next":["coder"]"#), Self.team) == "")
        // None of its turns has started and it waits: at the end of the chat, with "Take back".
        #expect(GroupWords.waitsWhole(Self.message(#""waitsFor":["coder"],"canTakeBack":true"#), Self.team))
        #expect(!GroupWords.waitsWhole(Self.message(#""waitsFor":["coder"],"canTakeBack":false"#), Self.team), "its first turns went: it stays in its place, and says for whom it still waits")
        #expect(!GroupWords.waitsWhole(Self.message(#""waitsFor":[],"next":["coder"],"canTakeBack":true"#), Self.team), "its first turn is about to start")
        // A line stopped at the limit waits for "Go on", not for a member.
        #expect(!GroupWords.waitsWhole(Self.message(#""waitsFor":[],"next":["coder"],"atLimit":true,"canTakeBack":false"#), Self.team))
    }

    @Test func theWordsOfTheEmptyChat() {
        #expect(GroupWords.empty(["Coder", "Reviewer", "Issue Writer"]) == "Coder, Reviewer and Issue Writer. What you write here, all of them read.")
        #expect(GroupWords.empty([]) == "Its bots are all gone. Add one, or delete the group.")
    }

    // MARK: mentions

    @Test func typingAnAtInAGroupSuggestsItsMembersAndNoOtherBot() {
        let world = Mentions(group: Self.group(), bots: Self.team)
        #expect(world.suggest("@").map(\.text) == ["@Coder", "@Reviewer", "@IssueWriter"])
        #expect(world.suggest("Ask @co").map(\.text) == ["@Coder"], "Cook is no member")
        #expect(world.suggest("@chief").isEmpty, "the Chief of Staff is no member")
        var withSkills = world
        withSkills.library = ["release-notes"]
        #expect(withSkills.suggest("@release").isEmpty, "no skill is offered in a group")
    }

    @Test func aMemberNamedInTheOwnersMessageIsDrawnAsAMentionAndNoOtherBot() {
        let world = Mentions(group: Self.group(), bots: Self.team)
        let found = world.find(in: "@Coder and @issuewriter, not @Cook or @ChiefOfStaff")
        #expect(found.map(\.text) == ["@Coder", "@issuewriter"])
        #expect(found.map { $0.bot?.id } == ["coder", "writer"])
    }

    // MARK: notifications

    static func step(_ event: String, _ data: String, watching: String? = nil) -> NotificationStep? {
        ReplyNotifications.step(event: event, data: Data(data.utf8), followsUnread: true, watching: watching)
    }
    static func ended(_ more: String) -> String {
        ##"{"id":"r1","botId":"coder","botName":"Coder","botColor":"#3b82f6","groupId":"g1","groupMessageId":"m1","chat":"group:g1","status":"success","result":"Done, on the branch."\##(more)}"##
    }

    @Test func aReplyInAGroupMakesNoNotification() {
        #expect(Self.step("group_run_finished", Self.ended(#","notify":false,"new":true"#)) == nil, "a new reply")
        #expect(Self.step("group_run_finished", #"{"id":"r2","botId":"coder","groupId":"g1","status":"error","problem":"It broke.","notify":false,"new":true}"#) == nil, "one that failed")
        #expect(Self.step("group_run_finished", Self.ended(#","notify":false,"passed":true,"quiet":true"#)) == nil, "a pass")
        #expect(Self.step("group_run_finished", Self.ended(#","new":true"#)) == nil, "a server that says nothing of it")
        #expect(Self.step("group_run_finished", Self.ended(#","notify":"true","new":true"#)) == nil, "notify must be true")
        // Nor on a server from before new replies, whatever the event carries.
        #expect(ReplyNotifications.step(event: "group_run_finished", data: Data(Self.ended(#","new":true"#).utf8), followsUnread: false) == nil)
    }

    @Test func aQuestionAskedInAGroupMakesOneUnlessTheGroupIsOnScreen() {
        let asks = Self.ended(#","notify":true,"asks":true,"title":"Coder asks","question":"Which one?","new":true"#)
        let posted = NotificationStep.post(ReplyNotification(chat: "group:g1", id: "group:g1", title: "A group · Coder asks", body: "Which one?"))
        #expect(Self.step("group_run_finished", asks) == posted)
        #expect(Self.step("group_run_finished", asks, watching: "bot:coder") == posted, "another chat is on screen")
        #expect(Self.step("group_run_finished", asks, watching: "group:g1") == nil, "the owner is looking at the group")
        // It is titled with the group's name as it is now, when the app knows it.
        let named = ReplyNotifications.step(event: "group_run_finished", data: Data(asks.utf8), followsUnread: true, groupName: { $0 == "g1" ? "Dev" : nil })
        #expect(named == .post(ReplyNotification(chat: "group:g1", id: "group:g1", title: "Dev · Coder asks", body: "Which one?")))
        // A server that sends no title and no question: the bot's name, and the reply.
        let bare = Self.step("group_run_finished", Self.ended(#","notify":true,"asks":true"#))
        #expect(bare == .post(ReplyNotification(chat: "group:g1", id: "group:g1", title: "A group · Coder asks", body: "Done, on the branch.")))
    }

    @Test func itGoesWhenTheGroupIsReadOrTheQuestionEnds() {
        #expect(Self.step("group_unread", #"{"chat":"group:g1","groupId":"g1","unread":0,"firstUnread":null}"#) == .remove(chat: "group:g1"))
        #expect(Self.step("group_unread", #"{"chat":"group:g1","groupId":"g1","unread":2,"firstUnread":"r1"}"#) == nil, "a new reply came: nothing goes")
        #expect(Self.step("group_asks", #"{"chat":"group:g1","groupId":"g1","asks":null}"#) == .remove(chat: "group:g1"), "the owner answered, here or in another app")
        #expect(Self.step("group_asks", #"{"groupId":"g1","asks":{"botId":"coder","text":"Which one?","runId":"r1"}}"#) == nil)
        #expect(Self.step("group_asks", #"{"groupId":"g1"}"#) == nil, "an event without the field says nothing")
        // A bot's own chat being read takes no group's notification away.
        #expect(Self.step("unread", #"{"chat":"bot:coder","groupId":"g1","unread":0}"#) == .remove(chat: "bot:coder"))
    }

    // MARK: a card asked in a group

    static func decoded<T: Decodable>(_ text: String) -> [T] { (try? JSON.decoder.decode([T].self, from: Data(text.utf8))) ?? [] }

    @Test func aCardSaysTheGroupItWasAskedIn() {
        let asks: [Ask] = Self.decoded(#"[{"id":"a1","kind":"permission","groupId":"g1","groupName":"Dev"},{"id":"a2","kind":"permission"},{"id":"a3","kind":"permission","groupId":{},"groupName":["x"]},{"id":"a4","kind":"permission","groupId":"g2"}]"#)
        #expect(asks.map(\.group) == [GroupRef(id: "g1", name: "Dev"), nil, nil, GroupRef(id: "g2", name: "a group")], "a field of another kind costs the group, and not the card")
        let logins: [LoginRequest] = Self.decoded(#"[{"id":"l1","site":"github.com","groupId":"g1","groupName":"Dev"},{"id":"l2","site":"github.com"},{"id":"l3","site":"github.com","groupId":{}}]"#)
        #expect(logins.map(\.group) == [GroupRef(id: "g1", name: "Dev"), nil, nil])
        let changes: [MemoryChange] = Self.decoded(#"[{"id":"m1","action":"add","groupId":"g1","groupName":"Dev"},{"id":"m2","action":"add"},{"id":"m3","action":"add","groupId":7}]"#)
        #expect(changes.map(\.group) == [GroupRef(id: "g1", name: "Dev"), nil, nil])
    }

    @Test func theFeedSaysTheGroupOfAJobAndATileThatWait() {
        let said = CardGroups.of(Self.json(#"{"jobs":[{"botId":"coder","jobId":"j1","groupId":"g1","groupName":"Dev"},{"botId":"coder","jobId":"j2"}],"tiles":[{"tileId":"t1","groupId":"g1","groupName":"Dev"},{"tileId":"t2"}],"memory":0}"#))
        #expect(said == [CardGroups.jobKey("coder", "j1"): GroupRef(id: "g1", name: "Dev"), CardGroups.tileKey("t1"): GroupRef(id: "g1", name: "Dev")])
        for odd in ["7", "[]", "null", #"{"jobs":7,"tiles":"x"}"#] { #expect(CardGroups.of(Self.json(odd)).isEmpty, "\(odd)") }
        // What the feed replays from before its first message is older than that message.
        #expect(CardGroups.isReplay("boot.4", hello: "boot.5") && CardGroups.isReplay("boot.5", hello: "boot.5"))
        #expect(!CardGroups.isReplay("boot.6", hello: "boot.5"))
        #expect(!CardGroups.isReplay("other.2", hello: "boot.5"), "another run of botdot")
        #expect(!CardGroups.isReplay(nil, hello: "boot.5") && !CardGroups.isReplay("boot.4", hello: nil))
    }

    /// A store that holds what a botdot server with groups would have handed it: a login, a job, a
    /// memory change, a permission and a tool that wait, asked in the group "g1", and a permission of
    /// the bot's own chat.
    @MainActor static func withCards() -> Store {
        let store = Store()
        store.features = [Feature.groups.rawValue, Feature.memoryCards.rawValue]
        store.bots = bots(##"[{"id":"coder","name":"Coder","color":"#3b82f6","jobs":[{"id":"j1","name":"Nightly","cron":"0 2 * * *","approved":false,"changedBy":"bot"}]},{"id":"cook","name":"Cook"}]"##)
        store.groups = groups(#"[{"id":"g1","name":"Dev team","members":["coder","cook"]}]"#)
        store.loginRequests = decoded(#"[{"id":"l1","site":"github.com","botId":"coder","bot":{"id":"coder","name":"Coder"},"groupId":"g1","groupName":"Dev"}]"#)
        store.memoryPending = decoded(#"[{"id":"m1","action":"add","text":"Uses main.","botId":"coder","bot":{"id":"coder","name":"Coder"},"title":"Save a note?","yes":"Approve","no":"Decline","groupId":"g1","groupName":"Dev"}]"#)
        store.asks = decoded(#"""
            [{"id":"a1","kind":"permission","botId":"coder","bot":{"id":"coder","name":"Coder"},"permission":"commands","what":{"label":"run commands"},"groupId":"g1","groupName":"Dev"},
            {"id":"a2","kind":"permission","botId":"coder","bot":{"id":"coder","name":"Coder"},"permission":"commands","what":{"label":"run commands"}},
            {"id":"a3","kind":"tool","botId":"coder","bot":{"id":"coder","name":"Coder"},"title":"Install gh for Coder?","groupId":"g1","groupName":"Dev"}]
            """#)
        store.heardCards("hello", id: nil, Data(#"{"lastEventId":"boot.5","approvals":{"jobs":[{"botId":"coder","jobId":"j1","groupId":"g1","groupName":"Dev"}],"tiles":[]}}"#.utf8))
        return store
    }

    @MainActor @Test func aCardAskedInAGroupStandsInThatGroupsChatAndInNoBotsOwn() throws {
        let store = Self.withCards()
        let keys = { (scope: ChatScope) in store.chatNeeds(scope).map(\.key) }
        #expect(keys(.group("g1")) == ["req:l1", "job:j1", "mem:m1", "ask:a1", "ask:a3"], "the cards of the group, whatever kind, at the end of its chat")
        #expect(keys(.bot("coder")) == ["ask:a2"], "the bot's own chat has only its own")
        #expect(keys(.group("g2")).isEmpty && keys(.chief).isEmpty, "a tool asked in a group is not in the Chief's chat either")
        #expect(store.needs.map(\.key) == ["req:l1", "job:j1", "mem:m1", "ask:a1", "ask:a2", "ask:a3"], "all of them are in Needs you")
        #expect(ChatScope.group("g1").namesWho && ChatScope.chief.namesWho && !ChatScope.bot("coder").namesWho, "a group's chat says which member asked")

        // Needs you names the bot and the group, by the group's name as it is now; the group's chat the bot.
        let card = try #require(store.needs.first { $0.key == "ask:a1" })
        #expect(card.group == GroupRef(id: "g1", name: "Dev team") && card.chat == .group("g1"))
        #expect(card.asker() == "Coder in Dev team" && card.asker(in: .group("g1")) == "Coder")
        let own = try #require(store.needs.first { $0.key == "ask:a2" })
        #expect(own.group == nil && own.chat == .bot("coder") && own.asker() == "Coder")
        // So does its notification, which opens the group (`group`).
        let notices = store.needNotices
        #expect(notices.first { $0.key == "ask:a1" }?.body == "Coder in Dev team: Let it run commands?")
        #expect(notices.first { $0.key == "ask:a2" }?.body == "Coder: Let it run commands?")
        #expect(notices.first { $0.key == "mem:m1" }?.title == "Coder in Dev team")
        #expect(notices.first { $0.key == "job:j1" }?.body == "Coder in Dev team: Nightly")

        // A group this app does not hold (deleted a moment ago): the server's name for it.
        store.groups = []
        #expect(store.needs.first { $0.key == "ask:a1" }?.asker() == "Coder in Dev")
    }

    @MainActor @Test func theFeedsLaterWordOfAJobsGroupCountsAndAReplayedOneDoesNot() {
        let store = Self.withCards()
        let none = Data(#"{"jobs":[{"botId":"coder","jobId":"j1"}],"tiles":[]}"#.utf8)
        store.heardCards("approvals", id: "boot.3", none)
        #expect(store.chatNeeds(.group("g1")).contains { $0.key == "job:j1" }, "replayed from before the feed's first message")
        store.heardCards("approvals", id: "boot.6", none)
        #expect(!store.chatNeeds(.group("g1")).contains { $0.key == "job:j1" })
        #expect(store.chatNeeds(.bot("coder")).map(\.key) == ["job:j1", "ask:a2"])
    }

    @MainActor @Test func againstAServerWithoutGroupsEveryCardIsItsBotsOwn() {
        let store = Self.withCards()
        store.features = [Feature.memoryCards.rawValue]
        #expect(store.needs.allSatisfy { $0.group == nil })
        #expect(store.chatNeeds(.bot("coder")).map(\.key) == ["req:l1", "job:j1", "mem:m1", "ask:a1", "ask:a2", "ask:a3"])
        #expect(store.chatNeeds(.chief).map(\.key) == ["ask:a3"], "a tool is in the Chief's chat too, as before")
        #expect(store.chatNeeds(.group("g1")).isEmpty)
        #expect(store.needs.first { $0.key == "ask:a1" }?.asker() == "Coder")
    }

    // MARK: a group's row, and a reply in its chat

    @Test func theRowOfAGroupThatAsksHasTheMarkAndSaysWhoAsks() {
        let asking = GroupWords.line(Self.group(#","asks":{"botId":"coder","botName":"Coder","text":"Which one?","runId":"r3"},"last":{"botId":"reviewer","botName":"Reviewer","status":"success","text":"I will review it."}"#), Self.team, TurnLines())
        #expect(asking.asks && asking.preview == "Coder asks: Which one?")
        let said = GroupWords.line(Self.group(#","last":{"botId":"reviewer","botName":"Reviewer","status":"success","text":"I will review it."}"#), Self.team, TurnLines())
        #expect(!said.asks && said.preview == "Reviewer: I will review it.")
        // While a member works the row says what it does, and has no mark.
        let working = GroupWords.line(Self.group(#","working":["coder"],"asks":{"botId":"reviewer","text":"Which one?","runId":"r3"}"#), Self.team, TurnLines())
        #expect(!working.asks && working.working && working.preview == "Coder: Working…")
        #expect(GroupWords.line(Self.group(), Self.team, TurnLines()).preview == "No messages yet")
    }

    @MainActor @Test func aNewReplyInAnOpenGroupArrivesOnceAndTheOwnersMessageDoesNot() {
        func rows(_ items: String) -> [GroupItem] { GroupChatPage(Data(#"{"items":[\#(items)]}"#.utf8)).items }
        let message = #"{"type":"message","id":"m1","text":"Fix it.","at":"2026-10-08T09:00:00Z"}"#
        let reply = { (id: String) in #"{"type":"reply","id":"\#(id)","at":"2026-10-08T09:01:00Z","run":{"id":"\#(id)","botId":"coder","status":"success","result":"Done."}}"# }
        #expect(Arrivals.replyIds(rows("\(message),\(reply("r1"))")) == ["r1"], "the owner's message is no reply")
        let arrivals = Arrivals()
        #expect(arrivals.draw("group:g1", loaded: true, replies: Arrivals.replyIds(rows("\(message),\(reply("r1"))"))).isEmpty, "the chat opens: what is there stands still")
        let second = #"{"type":"message","id":"m2","text":"And this.","at":"2026-10-08T09:02:00Z"}"#
        #expect(arrivals.draw("group:g1", loaded: true, replies: Arrivals.replyIds(rows("\(message),\(reply("r1")),\(second),\(reply("r2"))"))) == ["r2"])
        #expect(arrivals.since("r2") != nil && arrivals.since("r1") == nil && arrivals.since("m2") == nil)
    }

    @Test func aChatNamesEachDayAboveItsFirstMessage() {
        #expect(Format.day("2026-10-08T12:00:00Z") == Format.day("2026-10-08T12:10:00.000Z"))
        #expect(Format.day("2026-10-08T12:00:00Z") != Format.day("2026-10-10T12:00:00Z"))
        #expect(Format.day(nil) == nil && Format.dayTitle(nil) == "" && !Format.dayTitle("2026-10-08T12:00:00Z").isEmpty)
    }

    @MainActor @Test func underAReplyStandItsChipsAndTheAnswersOfTheOneThatAsks() throws {
        let store = Store()
        store.features = [Feature.memoryChips.rawValue]
        func run(_ status: String) throws -> RunSummary {
            try JSON.decoder.decode(RunSummary.self, from: Data(#"{"id":"r1","botId":"coder","status":"\#(status)","result":"Which one?","choices":["Quick","Clean"],"questions":["Which branch?"],"learned":[{"kind":"memory","text":"Uses main.","chip":"Remembered: Uses main."}]}"#.utf8))
        }
        let asks = store.under(try run("success"), answers: true)
        #expect(asks.chips.map(\.text) == ["🧠 Remembered: Uses main."] && asks.choices == ["Quick", "Clean"] && asks.questions == ["Which branch?"])
        // A reply that is not the one that asks keeps its chips and has no answers; nor has one that did not finish.
        let other = store.under(try run("success"), answers: false)
        #expect(other.chips == asks.chips && other.choices.isEmpty && other.questions.isEmpty)
        let failed = store.under(try run("error"), answers: true)
        #expect(failed.chips == asks.chips && failed.choices.isEmpty && failed.questions.isEmpty)
    }
}
