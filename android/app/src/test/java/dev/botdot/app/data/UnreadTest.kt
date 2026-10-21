package dev.botdot.app.data

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * New replies in the Android app (ADR 005): what the server sends is read as it is, the dots and the "New" line are
 * drawn from it, and the chat on screen is reported. `test/unread-web.test.js` holds the web page's side.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UnreadTest {
    private fun bots(json: String) = Api.JSON.decodeFromString(ListSerializer(Bot.serializer()), json)

    @Test fun theFieldsAreReadFromABotAndFromTheChief() {
        val (news, quiet) = bots("""[{"id":"news","name":"News","unread":4,"firstUnread":"r7"},{"id":"quiet","name":"Quiet","unread":0,"firstUnread":null}]""")
        assertEquals(4 to "r7", news.unread to news.firstUnread) // the count is the server's, not capped
        assertEquals(0 to null, quiet.unread to quiet.firstUnread)

        val chief = Api.JSON.decodeFromString(ChiefOverview.serializer(), """{"unread":3,"chats":[{"id":"c1","unread":1,"firstUnread":12},{"id":"c2","unread":2,"firstUnread":0},{"id":"c3","unread":0,"firstUnread":null}]}""")
        assertEquals(3, chief.unread)
        assertEquals(listOf(1 to 12, 2 to 0, 0 to null), chief.chats.map { it.unread to it.firstUnread })

        val chat = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","messages":[{"role":"chief","text":"Done."}],"offset":12,"total":13,"unread":1,"firstUnread":12}""")
        assertEquals(1 to 12, chat.unread to chat.firstUnread)
    }

    @Test fun aServerWithoutTheFieldsHasNothingNew() {
        val bot = bots("""[{"id":"news","name":"News"}]""").single()
        assertEquals(0 to null, bot.unread to bot.firstUnread)
        assertEquals(0, Unread.dots(bot.unread))
        val chief = Api.JSON.decodeFromString(ChiefOverview.serializer(), """{"chats":[{"id":"c1"}]}""")
        assertEquals(0, chief.unread)
        assertEquals(0 to null, chief.chats.single().let { it.unread to it.firstUnread })
        val chat = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","messages":[]}""")
        assertEquals(0 to null, chat.unread to chat.firstUnread)
        assertNull(Unread.line<String>(null, bot.unread, bot.firstUnread))
    }

    @Test fun oneDotPerNewReplyAtMostThree() {
        assertEquals(listOf(0, 1, 2, 3, 3, 3, 0), listOf(0, 1, 2, 3, 5, 40, -1).map { Unread.dots(it) })
    }

    @Test fun theLineIsPlacedWhenTheChatComesOnScreenAndStaysUntilItIsLeft() {
        assertNull(Unread.line<String>(null, 0, null)) // nothing new: no line
        assertEquals("r7", Unread.line(null, 2, "r7"))
        assertEquals("r7", Unread.line("r7", 0, null)) // read meanwhile: it stays while the chat is open
        assertEquals("r9", Unread.line("r7", 1, "r9")) // back from the background with a new reply: it moves
        assertEquals("r7", Unread.line("r7", 1, null)) // a count without a place: nothing to draw it at
        assertEquals(0, Unread.line(null, 3, 0)) // a Chief chat: the first message is place 0
    }

    @Test fun inABotsChatTheLineGoesBelowYourOwnMessageAndAboveWhatElseStartedTheRun() {
        assertTrue(Unread.mine(Run(id = "r", customPrompt = true, prompt = "What's new?")))
        assertTrue(Unread.mine(Run(id = "r", customPrompt = true, inbox = listOf(InboxNote(from = "Coder", text = "done"))))) // the notes it read are above your message
        assertFalse(Unread.mine(Run(id = "r", customPrompt = false))) // "Ran its main assignment"
        assertFalse(Unread.mine(Run(id = "r", customPrompt = true, trigger = "schedule")))
        assertFalse(Unread.mine(Run(id = "r", customPrompt = true, jobName = "Morning paper")))
        assertFalse(Unread.mine(Run(id = "r", customPrompt = true, trigger = "bot", fromBot = BotRef("b2", "Fleet Doctor"))))
        assertFalse(Unread.mine(Run(id = "r", customPrompt = true, startedBy = "chief")))
        assertFalse(Unread.mine(Run(id = "r", customPrompt = true, trigger = "replies")))
    }

    @Test fun inAChiefChatTheLineGoesAboveTheMessageTheServerNamedOrTheNextOneLoaded() {
        val loaded = listOf(40, 41, 42, 43) // a part of a long chat: its messages 40 to 43
        assertEquals(2, Unread.rowFrom(loaded, 42))
        assertEquals(0, Unread.rowFrom(loaded, 12)) // the first new one is in an older part: above the first loaded
        assertEquals(-1, Unread.rowFrom(loaded, 44)) // not loaded yet
        assertEquals(-1, Unread.rowFrom(loaded, null))
        assertEquals(-1, Unread.rowFrom(emptyList(), 0))
    }

    @Test fun theFeedSetsABotsDotsAndLeavesTheOthersAndTheOrderAlone() {
        val had = bots("""[{"id":"a","name":"A","unread":1,"firstUnread":"r1"},{"id":"b","name":"B"},{"id":"c","name":"C"}]""")
        val now = Unread.set(had, "b", 2, "r5")
        assertEquals(listOf("a" to 1, "b" to 2, "c" to 0), now.map { it.id to it.unread })
        assertEquals("r5", now[1].firstUnread)
        val read = Unread.set(now, "b", 0, "r5") // the chat was read: no dots, and no place for a line
        assertEquals(0 to null, read[1].unread to read[1].firstUnread)
        assertSame(read, Unread.set(read, "b", 0, null)) // nothing changed: the same list, so nothing is drawn again
        assertSame(read, Unread.set(read, "gone", 3, "r9")) // a bot the app doesn't have
    }

    @Test fun theAppMakesUpAnIdTheServerTakes() {
        val id = Unread.appId(Random(1))
        assertTrue(id, Regex("android-[a-z0-9]{12}").matches(id))
        assertTrue(Unread.appId(Random(1)) != Unread.appId(Random(2)))
    }

    // ---------- the report ----------

    private class Server(var answer: (String?) -> ReadAnswer? = { ReadAnswer(ok = true, chat = it, repeatMs = 10_000) }) {
        val got = mutableListOf<String?>()
        val read = mutableListOf<String>()
        suspend fun post(chat: String?): ReadAnswer? { got += chat; return answer(chat) }
    }

    @Test fun aChatOnScreenIsReportedAgainEveryRepeatAndNullTheMomentItIsNot() = runTest {
        val server = Server()
        val report = ReadReport(backgroundScope, MutableStateFlow(true), MutableStateFlow(true), server::post) { server.read += it }
        runCurrent()
        assertEquals(emptyList<String?>(), server.got) // nothing on screen, and nothing was: nothing to say

        report.show("bot:news"); runCurrent()
        assertEquals(listOf<String?>("bot:news"), server.got)
        assertEquals(listOf("bot:news"), server.read) // the server took it: its dots go
        advanceTimeBy(9_999); runCurrent()
        assertEquals(1, server.got.size)
        advanceTimeBy(1); runCurrent()
        advanceTimeBy(10_000); runCurrent()
        assertEquals(listOf<String?>("bot:news", "bot:news", "bot:news"), server.got)

        report.hide("chief:c1"); runCurrent() // another chat's screen going away changes nothing
        assertEquals(3, server.got.size)
        report.hide("bot:news"); runCurrent()
        assertEquals(null, server.got.last())
        advanceTimeBy(60_000); runCurrent()
        assertEquals(4, server.got.size) // and it is not repeated
    }

    @Test fun theReportStopsWhenTheAppIsNotInFront() = runTest {
        val server = Server()
        val front = MutableStateFlow(false)
        val report = ReadReport(backgroundScope, MutableStateFlow(true), front, server::post)
        report.show("bot:news"); runCurrent()
        advanceTimeBy(30_000); runCurrent()
        assertEquals(emptyList<String?>(), server.got) // open, but in the background or with the screen off: nobody reads

        front.value = true; runCurrent()
        assertEquals(listOf<String?>("bot:news"), server.got)
        front.value = false; runCurrent() // the screen turns off
        assertEquals(listOf("bot:news", null), server.got)
        advanceTimeBy(60_000); runCurrent()
        assertEquals(2, server.got.size)
    }

    @Test fun nothingIsReportedToAServerThatKeepsNoReadPositions() = runTest {
        val server = Server()
        val on = MutableStateFlow(false)
        val report = ReadReport(backgroundScope, on, MutableStateFlow(true), server::post)
        report.show("bot:news"); runCurrent()
        advanceTimeBy(30_000); runCurrent()
        assertEquals(emptyList<String?>(), server.got)
        on.value = true; runCurrent() // the server was updated
        assertEquals(listOf<String?>("bot:news"), server.got)
    }

    @Test fun whenTheActivityPausesTheChatIsHiddenUntilItsScreenShowsItAgain() = runTest {
        val server = Server()
        val front = MutableStateFlow(true)
        val report = ReadReport(backgroundScope, MutableStateFlow(true), front, server::post)
        report.show("bot:news"); runCurrent()
        front.value = false; report.hide(); runCurrent() // MainActivity.onPause
        front.value = true; runCurrent() // back in front: the screen places its "New" line first
        assertEquals(listOf("bot:news", null), server.got)
        report.show("bot:news"); runCurrent()
        assertEquals(listOf("bot:news", null, "bot:news"), server.got)
    }

    @Test fun whatStartedARunIsSaidInOnePlace() {
        assertEquals(Unread.Asked.MINE, Unread.asked(Run(id = "r", customPrompt = true)))
        assertEquals(Unread.Asked.USUAL, Unread.asked(Run(id = "r")))
        assertEquals(Unread.Asked.JOB, Unread.asked(Run(id = "r", trigger = "schedule", jobName = "Morning paper")))
        assertEquals(Unread.Asked.SCHEDULE, Unread.asked(Run(id = "r", trigger = "schedule")))
        assertEquals(Unread.Asked.MESSAGE, Unread.asked(Run(id = "r", customPrompt = true, startedBy = "chief")))
        assertEquals(Unread.Asked.REPLIES, Unread.asked(Run(id = "r", trigger = "replies", fromBot = BotRef("b2"))))
        // Notes that woke it (#225): only the notes it read stand above its reply, never botdot's task as the owner's.
        assertEquals(Unread.Asked.REPLIES, Unread.asked(Run(id = "r", trigger = "bot", customPrompt = true)))
        assertEquals(Unread.Asked.MESSAGE, Unread.asked(Run(id = "r", trigger = "bot", customPrompt = true, fromBot = BotRef("b2"))))
    }

    @Test fun aCalledRunSaysCalled() {
        val called = Run(id = "r", trigger = "call", jobName = "Motion")
        assertEquals(Unread.Asked.JOB, Unread.asked(called))
        assertEquals("⏰ Motion, called", Unread.jobChip(called))
        assertEquals("⏰ Motion", Unread.jobChip(Run(id = "r", trigger = "schedule", jobName = "Motion")))
        // From the feed, as the server sends it.
        val fed = Api.JSON.decodeFromString(Run.serializer(), """{"id":"r","trigger":"call","jobId":"j1","jobName":"Motion","status":"success"}""")
        assertEquals("⏰ Motion, called", Unread.jobChip(fed))
    }

    @Test fun aRunThatCarriesOnDrawsNoMessageOfTheOwner() {
        val from = JsonPrimitive("r0") // `continues`: the run that stopped for the owner's OK
        // It goes on with the owner's request, which stands above the first reply: no bubble, and not "Ran its main assignment".
        val carried = Run(id = "r", continuesValue = from, customPrompt = false, prompt = "Check why the backup failed last night.")
        assertEquals(Unread.Asked.CARRIED_ON, Unread.asked(carried))
        assertFalse("the \"New\" line goes above its reply", Unread.mine(carried))
        assertEquals("whatever its prompt is said to be", Unread.Asked.CARRIED_ON, Unread.asked(carried.copy(customPrompt = true)))
        // A job's run that is repeated and a teammate's request that carries on are drawn as the run they follow.
        assertEquals(Unread.Asked.JOB, Unread.asked(Run(id = "r", continuesValue = from, customPrompt = true, jobName = "Morning paper")))
        assertEquals(Unread.Asked.SCHEDULE, Unread.asked(Run(id = "r", continuesValue = from, trigger = "schedule")))
        assertEquals(Unread.Asked.MESSAGE, Unread.asked(Run(id = "r", continuesValue = from, customPrompt = true, trigger = "bot", fromBot = BotRef("b2", "Fleet Doctor"))))
        // Without the field, and with one this app cannot read, a run is drawn as before.
        assertEquals(Unread.Asked.USUAL, Unread.asked(Run(id = "r", continuesValue = JsonPrimitive(""))))
        assertEquals(Unread.Asked.MINE, Unread.asked(Run(id = "r", customPrompt = true, continuesValue = JsonPrimitive(7))))
    }

    @Test fun aNewBotsFirstMessageHasNothingAboveIt() {
        // #511: botdot started it right after the bot was made; the owner wrote nothing, so no bubble and no chip.
        val hello = Run(id = "r", trigger = "hello", customPrompt = true, prompt = "You were made just now…")
        assertEquals(Unread.Asked.HELLO, Unread.asked(hello))
        assertFalse("the \"New\" line goes above its reply", Unread.mine(hello))
    }

    @Test fun openingAnotherChatTakesTheReportsPlace() = runTest {
        val server = Server()
        val report = ReadReport(backgroundScope, MutableStateFlow(true), MutableStateFlow(true), server::post)
        report.show("bot:news"); runCurrent()
        report.show("chief:c1"); runCurrent()
        advanceTimeBy(10_000); runCurrent()
        assertEquals(listOf<String?>("bot:news", "chief:c1", "chief:c1"), server.got)
    }

    @Test fun aReportThatFailsIsTriedAgainAndTheServersRepeatIsFollowed() = runTest {
        val server = Server()
        var fail = true
        server.answer = { if (fail) throw java.io.IOException("offline") else ReadAnswer(ok = true, chat = it, repeatMs = 4_000) }
        val report = ReadReport(backgroundScope, MutableStateFlow(true), MutableStateFlow(true), server::post) { server.read += it }
        report.show("bot:news"); runCurrent()
        assertEquals(1, server.got.size)
        assertEquals(emptyList<String>(), server.read) // not taken: nothing is read
        fail = false
        advanceTimeBy(10_000); runCurrent()
        assertEquals(2 to listOf("bot:news"), server.got.size to server.read)
        advanceTimeBy(4_000); runCurrent() // the server named its own repeat
        assertEquals(3, server.got.size)
    }

    @Test fun sayingItAgainReportsAtOnceForTheChatOnScreenOnly() = runTest {
        val server = Server()
        val report = ReadReport(backgroundScope, MutableStateFlow(true), MutableStateFlow(true), server::post)
        report.show("bot:news"); runCurrent()
        report.again("bot:other"); runCurrent()
        assertEquals(1, server.got.size)
        report.again("bot:news"); runCurrent()
        assertEquals(listOf<String?>("bot:news", "bot:news"), server.got)
    }

    @Test fun theReportIsAPostOfTheAppAndTheChatOrNull() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            val json = { body: String -> MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build() }
            server.enqueue(json("""{"ok":true,"chat":"bot:news","readAt":"2026-10-02T10:00:00.000Z","repeatMs":10000}"""))
            assertEquals(ReadAnswer(true, "bot:news", "2026-10-02T10:00:00.000Z", 10_000), api.read("android-abc", "bot:news"))
            val sent = server.takeRequest()
            assertEquals("POST" to "/api/read", sent.method to sent.target)
            assertEquals("""{"app":"android-abc","chat":"bot:news"}""", sent.body!!.utf8())

            server.enqueue(json("""{"ok":true,"chat":null,"repeatMs":10000}"""))
            assertEquals(ReadAnswer(true, null, null, 10_000), api.read("android-abc", null))
            assertEquals("""{"app":"android-abc","chat":null}""", server.takeRequest().body!!.utf8())

            server.enqueue(json("""{"id":"news","name":"News","unread":2,"firstUnread":"r7"}"""))
            assertEquals(2 to "r7", api.bot("news").let { it.unread to it.firstUnread })
            assertEquals("/api/bots/news", server.takeRequest().target)
        } finally {
            server.close()
        }
    }
}
