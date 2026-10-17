package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Groups as the botdot server hands them out (Milestone 10; docs/api.md, "Groups"): the list, a group's chat, what
 * the feed says of a group, and the routes the app calls. The answers are those of `GET /api/group-chats` and
 * `GET /api/group-chats/:id/chat` as test/groups.test.js and test/group-chat.test.js read them.
 */
class GroupsTest {
    private fun event(type: String, data: String, id: String = "boot.9") = FeedEvent(id, type, Json.parseToJsonElement(data).jsonObject)
    private val dev = """{"id":"g1","name":"Dev","members":["coder","reviewer","writer"],"category":"Programming","pinned":0,"order":1,"createdAt":"2026-10-08T09:00:00Z",
        "unread":2,"firstUnread":"r1","last":{"runId":"r2","botId":"reviewer","botName":"Reviewer","status":"success","at":"2026-10-08T09:02:00Z","text":"I will review it."},
        "working":["coder"],"asks":{"botId":"coder","botName":"Coder","text":"Which one?","runId":"r3","at":"2026-10-08T09:03:00Z"},
        "limit":{"at":"2026-10-08T09:04:00Z","replies":12,"waits":["reviewer"],"messages":["m1"],"text":"The group stopped after 12 replies without you."}}"""
    private fun groups(json: String) = Group.list(json)

    @Test fun groupsAreOfferedOnlyAgainstAServerThatAnnouncesThem() {
        assertTrue(hasGroups(listOf("events", "unread", "groups")))
        assertFalse("a botdot server of Milestone 9", hasGroups(listOf("events", "unread", "message-waits", "memory-cards")))
        assertFalse("its features are not known yet: nothing is offered", hasGroups(null))
        assertEquals("group:g1", groupKey("g1"))
        assertEquals("g1", groupOfChat("group:g1"))
        for (other in listOf("bot:g1", "chief:c1", "chief", "group:", "g1", null)) assertNull("$other", groupOfChat(other))
    }

    @Test fun aGroupCarriesItsMembersItsPlaceAndWhatItsChatHolds() {
        val g = groups("[$dev]").single()
        assertEquals(listOf("coder", "reviewer", "writer"), g.members)
        assertEquals(listOf("Dev", "Programming", 0, 1, 2, "r1"), listOf(g.name, g.category, g.pinned, g.order, g.unread, g.firstUnread))
        assertEquals(GroupLast("r2", "reviewer", "Reviewer", "success", "2026-10-08T09:02:00Z", "I will review it."), g.last)
        assertEquals(listOf("coder"), g.working)
        assertEquals(GroupAsks("coder", "Coder", "Which one?", "r3", "2026-10-08T09:03:00Z"), g.asks)
        assertEquals(GroupLimit("The group stopped after 12 replies without you.", listOf("m1"), listOf("reviewer")), g.limit)
    }

    @Test fun aNewGroupHasNoneOfItAndAFieldOfAnotherKindLeavesTheGroupsReadable() {
        val fresh = groups("""[{"id":"g2","name":"Pair","members":["a","b"],"last":null,"working":[],"asks":null,"limit":null}]""").single()
        assertEquals(listOf(null, emptyList<String>(), null, null), listOf(fresh.last, fresh.working, fresh.asks, fresh.limit))
        for (odd in listOf("7", "\"x\"", "[]", "true", "{}", """{"text":7}""")) {
            val g = groups("""[{"id":"g2","name":"Pair","members":$odd,"last":$odd,"working":$odd,"asks":$odd,"limit":${if (odd == "{}") "7" else odd}}]""").single()
            assertEquals(odd, "Pair", g.name)
            assertEquals(odd, listOf(emptyList<String>(), null, emptyList<String>(), null), listOf(g.members, g.last, g.working, g.asks))
        }
        // One entry this app cannot read is left out, and the others are still there.
        assertEquals(listOf("g1", "g3"), groups("""[{"id":"g1","name":"A"},{"name":"no id"},7,{"id":"g3","name":"C"}]""").map { it.id })
        assertEquals("an answer that is no list", emptyList<Group>(), groups("""{"error":"Not found"}"""))
        assertEquals(GroupLimit.STOPPED, groups("""[{"id":"g1","limit":{"replies":12}}]""").single().limit?.text)
    }

    @Test fun theListPutsAGroupAmongTheGroups() {
        val all = groups("""[{"id":"b","name":"B","category":"Work","order":2},{"id":"a","name":"A","category":"Work","order":1},{"id":"h","name":"H","category":"Home","order":1},
            {"id":"p2","name":"P2","pinned":2},{"id":"p1","name":"P1","pinned":1},{"id":"z","name":"Zed","category":"Work"},{"id":"y","name":"alpha","category":"Work"}]""")
        assertEquals(listOf("p1", "p2"), Groups.pinned(all).map { it.id })
        assertEquals("by their order; one never placed after them, A to Z", listOf("a", "b", "y", "z"), Groups.inCategory(all, "Work").map { it.id })
        assertEquals(listOf("h"), Groups.inCategory(all, "Home").map { it.id })
        assertEquals("a pinned group is in no category's rows", emptyList<String>(), Groups.inCategory(all, "").map { it.id })
    }

    @Test fun itsMembersAreTheBotsThatExistAndABotCanBeAddedWhileThereIsRoom() {
        val bots: List<Bot> = Api.JSON.decodeFromString("""[{"id":"writer","name":"Issue Writer"},{"id":"coder","name":"Coder"},{"id":"cook","name":"Cook"}]""")
        val g = groups("""[{"id":"g1","members":["coder","gone","writer"]}]""").single()
        assertEquals("in the group's order, without a bot that was deleted", listOf("Coder", "Issue Writer"), Groups.members(g, bots).map { it.name })
        assertEquals(listOf("Cook"), Groups.addable(g, bots).map { it.name })
        assertEquals("a group of six is full", emptyList<Bot>(), Groups.addable(groups("""[{"id":"g1","members":["1","2","3","4","5","6"]}]""").single(), bots))
    }

    @Test fun theFeedSaysWhoWorksAndTheNewestReplyAndNeverAPass() {
        val before = groups("""[{"id":"g1","name":"Dev","members":["coder","reviewer"]},{"id":"g2","name":"Pair","members":["coder","cook"]}]""")
        val started = Groups.on(before, event("group_run_started", """{"id":"r1","botId":"coder","botName":"Coder","groupId":"g1","groupMessageId":"m1","chat":"group:g1","status":"running"}"""))
        assertEquals(listOf("coder"), started[0].working)
        assertEquals("the other group is as it was", emptyList<String>(), started[1].working)
        assertEquals("said twice, it works once", listOf("coder"), Groups.on(started, event("group_run_started", """{"id":"r1","botId":"coder","groupId":"g1"}"""))[0].working)
        val replied = Groups.on(started, event("group_run_finished", """{"id":"r1","botId":"coder","botName":"Coder","groupId":"g1","status":"success","result":"Done, on the branch.","endedAt":"2026-10-08T09:01:00Z","notify":false,"new":true}"""))
        assertEquals(emptyList<String>(), replied[0].working)
        assertEquals(GroupLast("r1", "coder", "Coder", "success", "2026-10-08T09:01:00Z", "Done, on the branch."), replied[0].last)
        // A pass is in no preview: its member no longer works, and the newest reply stays.
        val working = Groups.on(replied, event("group_run_started", """{"id":"r2","botId":"reviewer","groupId":"g1"}"""))
        val passed = Groups.on(working, event("group_run_finished", """{"id":"r2","botId":"reviewer","botName":"Reviewer","groupId":"g1","status":"success","result":"","passed":true,"quiet":true}"""))
        assertEquals(emptyList<String>(), passed[0].working)
        assertEquals("r1", passed[0].last?.runId)
        // One that failed says its problem.
        val failed = Groups.on(passed, event("group_run_finished", """{"id":"r3","botId":"reviewer","botName":"Reviewer","groupId":"g1","status":"error","result":"","problem":"Claude is not signed in.","startedAt":"2026-10-08T09:02:00Z"}"""))
        assertEquals(GroupLast("r3", "reviewer", "Reviewer", "error", "2026-10-08T09:02:00Z", "Claude is not signed in."), failed[0].last)
    }

    @Test fun theFeedSetsAndEndsItsQuestionItsStoppedLineAndItsNewReplies() {
        val before = groups("""[{"id":"g1","name":"Dev"}]""")
        val asked = Groups.on(before, event("group_asks", """{"chat":"group:g1","groupId":"g1","asks":{"botId":"coder","botName":"Coder","text":"Which one?","runId":"r3"}}"""))
        assertEquals("Which one?", asked[0].asks?.text)
        assertNull(Groups.on(asked, event("group_asks", """{"groupId":"g1","asks":null}"""))[0].asks)
        val stopped = Groups.on(before, event("group_limit", """{"groupId":"g1","limit":{"replies":12,"text":"The group stopped after 12 replies without you.","messages":["m1"],"waits":["coder"]}}"""))
        assertEquals("The group stopped after 12 replies without you.", stopped[0].limit?.text)
        assertNull(Groups.on(stopped, event("group_limit", """{"groupId":"g1","limit":null}"""))[0].limit)
        val new = Groups.on(before, event("group_unread", """{"chat":"group:g1","groupId":"g1","unread":3,"firstUnread":"r1"}"""))
        assertEquals(3 to "r1", new[0].unread to new[0].firstUnread)
        val read = Groups.on(new, event("group_unread", """{"chat":"group:g1","groupId":"g1","unread":0,"firstUnread":null,"readAt":"2026-10-08T10:00:00Z"}"""))
        assertEquals("read in any app: its dots go here too", 0 to null, read[0].unread to read[0].firstUnread)
        assertSame("nothing changed", read, Groups.setUnread(read, "g1", 0, null))
    }

    @Test fun eventsOfABotsOwnChatAndOfAGroupThisAppDoesNotHaveChangeNothing() {
        val had = groups("[$dev]")
        // A bot's own run, its new replies and its question are not a group's, whatever they carry.
        assertSame(had, Groups.on(had, event("run_finished", """{"id":"r9","botId":"coder","groupId":"g1","status":"success","result":"x"}""")))
        assertSame(had, Groups.on(had, event("unread", """{"chat":"bot:coder","groupId":"g1","unread":0}""")))
        assertSame(had, Groups.on(had, event("asks", """{"botId":"coder","groupId":"g1","asks":null}""")))
        assertSame(had, Groups.on(had, event("group_unread", """{"groupId":"gone","unread":0}""")))
        assertSame(had, Groups.on(had, event("group_run_finished", """{"id":"r9","botId":"coder","status":"success"}""")))
        assertSame("an event of a group that a later app would know", had, Groups.on(had, event("group_renamed", """{"groupId":"g1"}""")))
    }

    @Test fun aGroupsChatIsItsMessagesAndItsRepliesEachWithItsBot() {
        val page = GroupChatPage.of("""{"items":[
            {"type":"message","id":"m1","text":"The settings page needs a dark mode switch.","at":"2026-10-08T09:00:00Z","to":["writer","coder"],"waitsFor":[],"next":[],"canTakeBack":false},
            {"type":"reply","id":"r1","at":"2026-10-08T09:00:01Z","run":{"id":"r1","botId":"writer","botName":"Issue Writer","botColor":"#3b82f6","status":"success","result":"I will write the issue.","endedAt":"2026-10-08T09:00:05Z","groupId":"g1","groupMessageId":"m1"}},
            {"type":"reply","id":"r2","at":"2026-10-08T09:00:06Z","run":{"id":"r2","botId":"coder","botName":"Coder","status":"stopped","problem":"You stopped this run before it finished.","endedBy":"owner"}},
            {"type":"message","id":"m2","text":"","at":"2026-10-08T09:01:00Z","attachments":[{"name":"spec.pdf","file":"groups/g1/spec.pdf","size":2048}],"to":["writer","coder"],"waitsFor":["coder"],"next":["coder"],"canTakeBack":true},
            {"type":"note","id":"n1","at":"2026-10-08T09:02:00Z"},{"type":"reply","id":"r9","at":"2026-10-08T09:02:00Z"}],
            "more":true,"working":[{"botId":"writer","runId":"r4","messageId":"m2","startedAt":"2026-10-08T09:01:01Z","openingLine":"Reading the spec"},{"botId":"coder"}],
            "asks":{"botId":"writer","botName":"Issue Writer","text":"Which one?","runId":"r1"},"limit":null,"cards":[{"kind":"ask","id":"a1","botId":"coder","runId":"r2"}],"unread":1,"firstUnread":"r1","readAt":null}""")
        assertEquals("what is no message and no reply with its run is left out", listOf("m1", "r1", "r2", "m2"), page.items.map { it.id })
        val (m1, r1, r2, m2) = page.items
        m1 as GroupItem.Message; r1 as GroupItem.Reply; r2 as GroupItem.Reply; m2 as GroupItem.Message
        assertEquals(listOf("writer", "coder"), m1.message.to)
        assertFalse(m1.message.canTakeBack)
        assertEquals(listOf("writer", "Issue Writer", "#3b82f6", "success", "I will write the issue."), listOf(r1.run.botId, r1.run.botName, r1.run.botColor, r1.run.status, r1.run.result))
        assertEquals("stopped" to "owner", r2.run.status to r2.run.endedBy)
        assertNull("a run without the colour", r2.run.botColor)
        assertEquals("files alone: a message with no text", "", m2.message.text)
        assertEquals(listOf(Attachment("spec.pdf", "groups/g1/spec.pdf", 2048)), m2.message.attachments)
        assertEquals(listOf("coder") to true, m2.message.waitsFor to m2.message.canTakeBack)
        assertTrue(page.more)
        assertEquals("a member at work without its run is none", listOf(GroupWorking("writer", "r4", "m2", "2026-10-08T09:01:01Z", "Reading the spec")), page.working)
        assertEquals("r1", page.asks?.runId)
        assertNull(page.limit)
        assertEquals(1 to "r1", page.unread to page.firstUnread)
        assertEquals("an answer that is no chat", GroupChatPage(), GroupChatPage.of("""["x"]"""))
    }

    @Test fun whatTheOwnerSendsIsDrawnFromTheAnswerAndTypedGoOnIsNoMessage() {
        val sent = GroupSent.of("""{"id":"m3","text":"@Coder go on","at":"2026-10-08T09:05:00Z","to":["coder"],"waitsFor":[],"next":[],"canTakeBack":false}""")
        assertFalse(sent.wentOn)
        assertEquals(listOf("m3"), sent.held.map { it.id })
        // "Go on", typed while the group is stopped at the limit: no id, nothing to add, and the lines that go on.
        val went = GroupSent.of("""{"ok":true,"wentOn":true,"messages":[{"id":"m1","text":"Fix it.","at":"2026-10-08T09:00:00Z","to":["coder"],"next":["coder"]}]}""")
        assertTrue(went.wentOn)
        assertNull(went.message)
        assertEquals(listOf("m1"), went.held.map { it.id })
        assertEquals("an answer this app cannot read: the message went all the same", emptyList<GroupMessage>(), GroupSent.of("not json").held)
    }

    private fun message(id: String, at: String, waitsFor: String = "[]") = """{"type":"message","id":"$id","text":"$id","at":"$at","to":["coder"],"waitsFor":$waitsFor,"next":[],"canTakeBack":${waitsFor != "[]"}}"""
    private fun reply(id: String, at: String) = """{"type":"reply","id":"$id","at":"$at","run":{"id":"$id","botId":"coder","botName":"Coder","status":"success","result":"$id"}}"""
    private fun page(vararg items: String, more: Boolean = false) = GroupChatPage.of("""{"items":[${items.joinToString(",")}],"more":$more}""")

    @Test fun theNewestPageSaysWhatIsThereNowAndAnOlderPageOnlyAdds() {
        val chat = GroupChatItems()
        chat.take(page(message("m2", "2026-10-08T10:00:00Z"), reply("r2", "2026-10-08T10:00:01Z"), message("m3", "2026-10-08T10:05:00Z", """["coder"]"""), more = true))
        assertEquals(listOf("m2", "r2", "m3"), chat.rows().map { it.id })
        assertTrue(chat.more)
        // The page before the oldest item held.
        chat.take(page(message("m1", "2026-10-08T09:00:00Z"), reply("r1", "2026-10-08T09:00:01Z")), older = true)
        assertEquals(listOf("m1", "r1", "m2", "r2", "m3"), chat.rows().map { it.id })
        assertFalse("the older page says that nothing older is left", chat.more)
        // Read again: m3 was taken back in another app, and a reply came. What stands before the page begins stays.
        chat.take(page(message("m2", "2026-10-08T10:00:00Z"), reply("r2", "2026-10-08T10:00:01Z"), reply("r3", "2026-10-08T10:06:00Z"), more = true))
        assertEquals(listOf("m1", "r1", "m2", "r2", "r3"), chat.rows().map { it.id })
        assertFalse("the older pages that are held say whether more is left, not the newest page", chat.more)
        assertTrue(chat.has("r3"))
        assertEquals("m1", chat.oldest?.id)
    }

    @Test fun aMessageTheFeedHandsOverIsKeptWhenItBelongsToWhatIsHeld() {
        val chat = GroupChatItems()
        chat.take(page(message("m2", "2026-10-08T10:00:00Z"), reply("r2", "2026-10-08T10:00:01Z"), more = true))
        val of = { id: String, at: String, waits: String -> (GroupItem.of(Json.parseToJsonElement(message(id, at, waits))) as GroupItem.Message).message }
        assertTrue("a new message", chat.hold(of("m3", "2026-10-08T10:05:00Z", """["coder"]""")))
        assertTrue("the same message as it is now: it no longer waits", chat.hold(of("m3", "2026-10-08T10:05:00Z", "[]")))
        assertEquals(emptyList<String>(), (chat.rows().last() as GroupItem.Message).message.waitsFor)
        // One from further back than the page holds is left to the page that reads it.
        assertFalse(chat.hold(of("m0", "2026-10-08T08:00:00Z", "[]")))
        assertEquals(listOf("m2", "r2", "m3"), chat.rows().map { it.id })
        assertTrue("taken back", chat.remove("m3"))
        assertFalse(chat.remove("m3"))
        // With nothing older left, it belongs to the chat wherever it stands.
        val whole = GroupChatItems().also { it.take(page(reply("r2", "2026-10-08T10:00:01Z"))) }
        assertTrue(whole.hold(of("m0", "2026-10-08T08:00:00Z", "[]")))
        assertEquals("a message stands before a reply of the same moment", listOf("m0", "r2"), whole.rows().map { it.id })
    }

    @Test fun aTurnsLineIsKeptByItsRunUntilItEnds() {
        val lines = TurnLines()
        lines.handle(event("group_opening_line", """{"chat":"group:g1","groupId":"g1","botId":"coder","runId":"r1","text":" Reading the issue "}"""))
        assertEquals("Reading the issue", TurnLines.of(lines.value.value, "g1", "coder"))
        assertEquals("another group, another member", "", TurnLines.of(lines.value.value, "g2", "coder") + TurnLines.of(lines.value.value, "g1", "reviewer"))
        lines.handle(event("group_run_waits", """{"chat":"group:g1","groupId":"g1","botId":"coder","runId":"r1","waitingFor":"ok"}"""))
        assertEquals(TurnLine("g1", "coder", "Reading the issue", held = true), lines.value.value["r1"])
        lines.handle(event("group_run_waits", """{"chat":"group:g1","groupId":"g1","botId":"coder","runId":"r1"}"""))
        assertFalse("it no longer waits for the owner's OK", lines.value.value.getValue("r1").held)
        // Its next turn in that group takes the earlier line away; its end takes its own.
        lines.handle(event("group_run_started", """{"id":"r2","groupId":"g1","botId":"coder"}"""))
        assertEquals(emptyMap<String, TurnLine>(), lines.value.value)
        lines.say("r2", "g1", "coder") { it.copy(text = "Writing the fix") } // as the chat's `working` says it
        lines.handle(event("group_run_finished", """{"id":"r2","groupId":"g1","botId":"coder","status":"success"}"""))
        assertEquals(emptyMap<String, TurnLine>(), lines.value.value)
        // A bot's own line is not a group's.
        lines.handle(event("opening_line", """{"chat":"bot:coder","botId":"coder","runId":"r5","text":"Checking"}"""))
        lines.handle(event("group_opening_line", """{"groupId":"g1","botId":"coder","runId":"r6","text":"  "}"""))
        assertEquals(emptyMap<String, TurnLine>(), lines.value.value)
        lines.say("r7", "g1", "coder") { it.copy(text = "x") }
        lines.handle(event("reset", "{}"))
        assertEquals(emptyMap<String, TurnLine>(), lines.value.value)
    }

    @Test fun aCardAskedInAGroupSaysWhichAndStandsInThatGroupsChatAlone() {
        val ask = Ask.list("""[{"id":"a1","kind":"permission","permission":"Bash","bot":{"id":"coder","name":"Coder"},"groupId":"g1","groupName":"Dev"},
            {"id":"a2","kind":"permission","permission":"Bash","bot":{"id":"coder","name":"Coder"}},{"id":"a3","kind":"skill","groupId":7,"groupName":"Dev"}]""")
        assertEquals(GroupRef("g1", "Dev"), ask[0].group)
        assertNull("a card of the bot's own chat", ask[1].group)
        assertNull("a field of another kind is none, and the ask is still read", ask[2].group)
        assertEquals(listOf(true, false, false), listOf("group:g1", "coder", "chief").map { ask[0].standsInChat(it) })
        assertFalse("another group's chat", ask[0].standsInChat("group:g2"))
        assertEquals("the bot's own ask is in its own chat, and in no group's", listOf(false, true, false), listOf("group:g1", "coder", "chief").map { ask[1].standsInChat(it) })
        val login: LoginRequest = Api.JSON.decodeFromString("""{"id":"l1","site":"github.com","bot":{"id":"coder","name":"Coder"},"groupId":"g1","groupName":"Dev"}""")
        assertEquals(GroupRef("g1", "Dev"), login.group)
        assertNull(Api.JSON.decodeFromString<LoginRequest>("""{"id":"l2","site":"github.com"}""").group)
        val memory: MemoryChange = Api.JSON.decodeFromString("""{"id":"p1","action":"add","text":"Use pnpm.","botId":"coder","groupId":"g1"}""")
        assertEquals("a group whose name the server left out", GroupRef("g1", "a group"), memory.group)
    }

    // The Chief made a group (GRP-007): its reply has an action of a kind this app has no mark for, with a field it
    // does not know. The chip prints the server's text whole, and opens nothing: it names no bot and no run.
    @Test fun aChipOfAKindTheAppDoesNotKnowPrintsItsTextAndOpensNothing() {
        val message: ChiefMessage = Api.JSON.decodeFromString("""{"role":"chief","text":"Done.","at":"2026-10-08T09:00:00Z",
            "actions":[{"kind":"group","text":"Made the group Dev: Coder, Reviewer and Issue Writer","groupId":"g1"},{"kind":"created","text":"Created Cook","botId":"cook"}]}""")
        val chip = message.actions.orEmpty()[0]
        assertEquals("Made the group Dev: Coder, Reviewer and Issue Writer", chip.label)
        assertEquals(listOf(null, null, null), listOf(chip.botId, chip.runId, chip.waits))
        assertEquals("a kind it knows keeps its mark", "✨ Created Cook", message.actions.orEmpty()[1].label)
    }

    @Test fun theFeedSaysWhichGroupAWaitingJobOrTileWasAskedIn() {
        val kept = CardGroups()
        kept.handle(event("hello", """{"lastEventId":"boot.20","approvals":{"jobs":[{"botId":"coder","jobId":"j1","jobName":"Nightly","groupId":"g1","groupName":"Dev"},{"botId":"coder","jobId":"j2"}],
            "tiles":[{"tileId":"t1","title":"Builds","groupId":"g1","groupName":"Dev"},{"tileId":"t2"}],"memory":0}}""", id = ""))
        assertEquals(mapOf("job:coder/j1" to GroupRef("g1", "Dev"), "tile:t1" to GroupRef("g1", "Dev")), kept.value.value)
        assertEquals(CardGroups.jobKey("coder", "j1") to CardGroups.tileKey("t1"), "job:coder/j1" to "tile:t1")
        // An event the feed replays from before "hello" is older than what "hello" said.
        kept.handle(event("approvals", """{"jobs":[],"tiles":[]}""", id = "boot.19"))
        assertEquals(2, kept.value.value.size)
        kept.handle(event("approvals", """{"jobs":[],"tiles":[]}""", id = "boot.21"))
        assertEquals(emptyMap<String, GroupRef>(), kept.value.value)
    }

    @Test fun aServerWithoutGroupsIsAskedNothingAboutThemAndHasNone() = runBlocking {
        val server = MockWebServer().also { it.start() }
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            assertEquals(emptyList<Group>(), api.groupsOf(listOf("unread", "asks-you")))
            assertEquals("its features are not known yet", emptyList<Group>(), api.groupsOf(null))
            assertEquals("no request was made", 0, server.requestCount)
            server.enqueue(MockResponse.Builder().body("[$dev]").build())
            assertEquals(listOf("g1"), api.groupsOf(listOf("unread", "groups")).map { it.id })
            assertEquals("/api/group-chats", server.takeRequest().url.encodedPath)
        } finally { server.close() }
    }

    @Test fun theAppCallsTheGroupsRoutes() = runBlocking {
        val server = MockWebServer().also { it.start() }
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            val json = { body: String, code: Int -> MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build() }
            fun asked() = server.takeRequest().let { Triple(it.method, it.target, it.body?.utf8().orEmpty()) }

            server.enqueue(json("[$dev]", 200))
            assertEquals("Dev", api.groups().single().name)
            assertEquals(Triple("GET", "/api/group-chats", ""), asked())

            server.enqueue(json("""{"id":"g9","name":"Dev","members":["coder","reviewer"],"category":"Programming"}""", 201))
            assertEquals("g9", api.makeGroup("Dev", listOf("coder", "reviewer")).id)
            assertEquals(Triple("POST", "/api/group-chats", """{"name":"Dev","members":["coder","reviewer"]}"""), asked())

            // A refusal is the server's sentence, to show as it is.
            server.enqueue(json("""{"error":"Give the group a name."}""", 400))
            val refused = runCatching { api.makeGroup("", listOf("coder", "reviewer")) }.exceptionOrNull() as ApiException
            assertEquals(Triple("Give the group a name.", 400, true), Triple(refused.message, refused.status, refused.said))
            asked()

            server.enqueue(json(dev, 200))
            api.updateGroup("g1", api.membersOf(listOf("coder", "writer")))
            assertEquals(Triple("PUT", "/api/group-chats/g1", """{"members":["coder","writer"]}"""), asked())

            server.enqueue(json("""{"ok":true,"name":"Dev"}""", 200))
            api.deleteGroup("g1")
            assertEquals(Triple("DELETE", "/api/group-chats/g1", "{}"), asked())

            server.enqueue(json("""{"items":[],"more":false,"working":[],"asks":null,"limit":null,"cards":[],"unread":0,"firstUnread":null}""", 200))
            api.groupChat("g1", 50)
            assertEquals("/api/group-chats/g1/chat?limit=50", asked().second)
            server.enqueue(json("""{"items":[]}""", 200))
            api.groupChat("g1", 50, before = "m 1")
            assertEquals("/api/group-chats/g1/chat?limit=50&before=m%201", asked().second)

            server.enqueue(json("""{"id":"m1","text":"hi","at":"2026-10-08T09:00:00Z","to":["coder"],"waitsFor":[],"next":[],"canTakeBack":false}""", 201))
            assertEquals("m1", api.sendToGroup("g1", "hi", listOf(Attachment("a.txt", "groups/g1/a.txt", 3)), "typed-key").message?.id)
            assertEquals(Triple("POST", "/api/group-chats/g1/messages", """{"text":"hi","attachments":[{"name":"a.txt","file":"groups/g1/a.txt","size":3}],"key":"typed-key"}"""), asked())

            server.enqueue(json("""{"text":"hi","attachments":[]}""", 200))
            assertEquals("hi", api.takeBackFromGroup("g1", "m1").text)
            assertEquals("DELETE" to "/api/group-chats/g1/messages/m1", asked().let { it.first to it.second })
            server.enqueue(json("""{"error":"It has already started."}""", 409))
            assertEquals(409, (runCatching { api.takeBackFromGroup("g1", "m1") }.exceptionOrNull() as ApiException).status)
            asked()

            server.enqueue(json("""{"ok":true,"stopped":2,"dropped":1}""", 200))
            api.stopGroup("g1")
            assertEquals("POST" to "/api/group-chats/g1/stop", asked().let { it.first to it.second })

            server.enqueue(json("""{"ok":true,"wentOn":true,"messages":[]}""", 200))
            assertTrue(api.goOn("g1").wentOn)
            assertEquals("POST" to "/api/group-chats/g1/go-on", asked().let { it.first to it.second })
            server.enqueue(json("""{"error":"The group is not stopped."}""", 409))
            assertEquals("The group is not stopped.", runCatching { api.goOn("g1") }.exceptionOrNull()?.message)
        } finally {
            server.close()
        }
    }
}
