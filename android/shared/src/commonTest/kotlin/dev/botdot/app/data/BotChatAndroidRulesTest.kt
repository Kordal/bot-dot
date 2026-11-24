package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * What Android's bot chat did before it moved onto BotChat (#1391), now the shared chat's: the notes and watches that
 * come with the runs, the plan from the feed, Steer, "Run now", the "New" line, older pages until a run is in, and a
 * send with the box's own files.
 */
class BotChatAndroidRulesTest {
    private data class Asked(val method: String, val path: String, val query: String, val body: String)

    private class FakeBotdot(answer: suspend (Asked) -> Pair<Int, String>) {
        private val lock = Mutex()
        private val took = mutableListOf<Asked>()
        val api = Api("https://botdot.test", MockEngine { req ->
            val asked = Asked(req.method.value, req.url.encodedPath.removePrefix("/api"), req.url.encodedQuery, (req.body as? TextContent)?.text.orEmpty())
            lock.withLock { took += asked }
            val (status, body) = answer(asked)
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        suspend fun asked(): List<Asked> = lock.withLock { took.toList() }
    }

    private val events = MutableSharedFlow<FeedEvent>(extraBufferCapacity = 8)

    private fun TestScope.chat(fake: FakeBotdot, features: List<String> = emptyList()): Pair<Store, BotChat> {
        val store = Store(backgroundScope, MutableStateFlow(fake.api))
        runCurrent() // the store reads its botdot afresh once it runs: what is set comes after
        store.version.set(VersionInfo(features = features))
        return store to BotChat(backgroundScope, fake.api, store, events, "b1")
    }

    private suspend fun TestScope.until(what: String, done: suspend () -> Boolean) {
        repeat(400) {
            if (done()) return
            advanceTimeBy(50)
            runCurrent()
            withContext(Dispatchers.Default) { delay(5) }
        }
        fail("never: $what")
    }

    private fun run(id: String, status: String = "success", prompt: String = "hi", extra: String = "") =
        """{"id":"$id","botId":"b1","status":"$status","prompt":"$prompt","result":"ok","startedAt":"2026-11-14T09:00:00Z"$extra}"""

    private fun bot(queued: String = "[]", extra: String = "") = Api.JSON.decodeFromString(Bot.serializer(), """{"id":"b1","name":"Ops","queued":$queued$extra}""")

    @Test fun theNotesThatWaitAndWhatItWatchesComeWithTheRuns() = runTest {
        val fake = FakeBotdot { a ->
            when (a.path) {
                "/runs" -> 200 to "[${run("r1")}]"
                "/bots/b1/inbox" -> 200 to """[{"from":"Mail","text":"Look at this"}]"""
                "/bots/b1/watches" -> 200 to """[{"id":"w1","name":"Price","until":"2026-12-01T00:00:00Z","state":"on"}]"""
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake, features = listOf("watches"))
        chat.start()
        until("the notes and watches are in") { chat.state.value.waiting.size == 1 && chat.state.value.watches.size == 1 }
        assertEquals("Look at this", chat.state.value.waiting.single().text)
        assertEquals("w1", chat.state.value.watches.single().id)
    }

    @Test fun anOlderBotdotWithNoInboxAndNoWatchesStillShowsItsRuns() = runTest {
        val fake = FakeBotdot { a -> if (a.path == "/runs") 200 to "[${run("r1")}]" else 404 to "{}" }
        val (_, chat) = chat(fake)
        chat.start()
        until("its runs") { chat.state.value.runs.size == 1 }
        assertEquals(emptyList(), chat.state.value.waiting)
        assertTrue(fake.asked().none { it.path.endsWith("/watches") }, "no watches are asked of a botdot that has none")
        assertNull(chat.state.value.notice, "an inbox it lacks is not an error")
    }

    @Test fun aWatchThatIsStoppedGoesAtOnceAndIsAskedOfBotdot() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.path == "/runs" -> 200 to "[]"
                a.path == "/bots/b1/watches" -> 200 to """[{"id":"w1","name":"Price","state":"on"}]"""
                a.method == "DELETE" && a.path == "/bots/b1/watches/w1" -> 200 to "{}"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake, features = listOf("watches"))
        chat.start()
        until("it watches") { chat.state.value.watches.isNotEmpty() }
        chat.stopWatch("w1")
        assertEquals(emptyList(), chat.state.value.watches, "gone before botdot answered")
        until("botdot is told") { fake.asked().any { it.method == "DELETE" && it.path == "/bots/b1/watches/w1" } }
    }

    @Test fun theFeedsPlanLandsOnTheRunAtWorkWithoutAskingBotdotAgain() = runTest {
        val fake = FakeBotdot { a -> if (a.path == "/runs") 200 to "[${run("r1", status = "running")}]" else 404 to "{}" }
        val (_, chat) = chat(fake)
        chat.start()
        until("the run is at work") { chat.state.value.running }
        suspend fun reads() = fake.asked().count { it.path == "/runs" }
        val asked = reads()
        events.emit(FeedEvent(null, "run_plan", buildJsonObject {
            put("botId", "b1"); put("runId", "r1")
            put("plan", Api.JSON.parseToJsonElement("""{"steps":[{"text":"Read the mail","state":"doing"},{"text":"Answer it"}]}"""))
        }))
        until("its plan is on the run") { chat.state.value.shown.single().plan != null }
        assertEquals(asked, reads(), "no run is read again")
    }

    @Test fun aRunEventOfAnotherBotLeavesThePlanAlone() = runTest {
        val fake = FakeBotdot { a -> if (a.path == "/runs") 200 to "[${run("r1", status = "running")}]" else 404 to "{}" }
        val (_, chat) = chat(fake)
        chat.start()
        until("the run is at work") { chat.state.value.running }
        events.emit(FeedEvent(null, "run_plan", buildJsonObject {
            put("botId", "other"); put("runId", "r1")
            put("plan", Api.JSON.parseToJsonElement("""{"steps":[{"text":"Read the mail"}]}"""))
        }))
        advanceTimeBy(1_000); runCurrent()
        assertNull(chat.state.value.shown.single().plan)
    }

    @Test fun steerAsksBotdotAndAFailureIsSaidInTheBoxLine() = runTest {
        var refuse = false
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/bots/b1/queued/q1/steer" -> if (refuse) 409 to """{"error":"It has started."}""" else 200 to """{"queued":[{"id":"q1","text":"Later","steering":true}]}"""
                a.path == "/runs" -> 200 to "[]"
                a.path == "/bots" -> 200 to """[{"id":"b1","name":"Ops","queued":[{"id":"q1","text":"Later"}]}]"""
                else -> 404 to "{}"
            }
        }
        val (store, chat) = chat(fake)
        store.bots.set(listOf(bot("""[{"id":"q1","text":"Later"}]""")))
        chat.start()
        until("the message waits") { chat.state.value.queued.isNotEmpty() }
        chat.steer(chat.state.value.queued.single())
        until("botdot is asked") { fake.asked().any { it.method == "POST" && it.path == "/bots/b1/queued/q1/steer" } }
        refuse = true
        chat.steer(Queued("q1", "Later"))
        until("the box says why") { chat.state.value.note != null }
    }

    @Test fun runNowOnABusyBotSaysItReadsThemOnceItIsFree() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/bots/b1/inbox/run" -> 200 to """{"status":"queued"}"""
                a.path == "/runs" -> 200 to "[]"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("loaded") { chat.state.value.loaded }
        chat.runNotes()
        until("it says so") { chat.state.value.notice == "It's busy: it reads them once it's free." }
    }

    @Test fun theNewLineGoesWhereBotdotSaysTheNewRepliesBeginAndIsKeptUntilTheChatIsLeft() = runTest {
        val fake = FakeBotdot { a ->
            when (a.path) {
                "/bots/b1" -> 200 to """{"id":"b1","name":"Ops","unread":2,"firstUnread":"r2"}"""
                "/runs" -> 200 to "[${run("r2")},${run("r1")}]"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        assertTrue(withContext(Dispatchers.Default) { chat.arrive() }, "the line is placed") // botdot answers on a real thread: a real clock for its wait
        assertEquals("r2", chat.state.value.newFirst)
        assertFalse(withContext(Dispatchers.Default) { chat.arrive() }, "asked again with nothing new: it stays where it is")
        chat.clearNew()
        assertNull(chat.state.value.newFirst)
    }

    @Test fun olderPagesAreReadUntilTheRunAMatchIsInIsThere() = runTest {
        val page = (40 downTo 1).joinToString(",") { run("n$it") }
        val fake = FakeBotdot { a ->
            when {
                a.path == "/runs" && "before=n1" in a.query -> 200 to "[${run("o2")},${run("o1")}]"
                a.path == "/runs" -> 200 to "[$page]"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("its first page") { chat.state.value.runs.size == 40 }
        assertTrue(chat.reach("o1"))
        assertEquals("o1", chat.state.value.shown.last().id)
        assertFalse(chat.reach("never-was"), "no older page is left to read")
    }

    @Test fun aPageOfOlderRunsThatFailsSaysNothing() = runTest {
        val page = (40 downTo 1).joinToString(",") { run("n$it") }
        val fake = FakeBotdot { a ->
            when {
                a.path == "/runs" && "before=n1" in a.query -> 500 to """{"error":"down"}"""
                a.path == "/runs" -> 200 to "[$page]"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("its first page") { chat.state.value.runs.size == 40 }
        chat.loadOlder()
        until("the page was asked") { fake.asked().any { "before=n1" in it.query } }
        advanceTimeBy(500); runCurrent()
        assertNull(chat.state.value.notice, "scrolling back up asks again, with nothing said")
    }

    @Test fun aSendWithTheBoxsOwnFilesCarriesThemAndTheReplyItAnswers() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/bots/b1/run" -> 200 to run("r9", status = "running", prompt = "Yes")
                a.path == "/runs" -> 200 to "[]"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        assertTrue(chat.submit("Yes", listOf(Attachment("a.pdf", "f1")), box = false, key = "k1", replyTo = "r1", answers = "r2"))
        val body = fake.asked().single { it.method == "POST" && it.path == "/bots/b1/run" }.body
        assertTrue("\"file\":\"f1\"" in body, body)
        assertTrue("r1" in body && "r2" in body, body)
        assertEquals(emptyList(), chat.state.value.files, "the chat's own files are not the box's")
    }

    @Test fun stopOnARunNamedByItsBlockAsksBotdotEvenWhenTheChatNoLongerHasItAtWork() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/runs/r1/stop" -> 200 to "{}"
                a.path == "/runs" -> 200 to "[${run("r1")}]"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("its run") { chat.state.value.runs.size == 1 }
        chat.stopRun("r1")
        until("stop is asked") { fake.asked().any { it.path == "/runs/r1/stop" } }
        assertNotNull(chat.state.value.notice)
    }

    @Test fun aTimeInAChatAndTheTimeOfDayOfAStepAreOneFunction() {
        val iso = "2020-03-05T13:52:00Z"
        val clock = chatClock(iso)
        assertTrue(clock.contains(", "), "an old day says its date: $clock")
        assertEquals(clock.substringAfterLast(", "), stepClock(iso))
        assertFalse(stepClock(iso).contains(","))
        assertEquals("", chatClock(null))
        assertEquals("", chatClock("nonsense"))
        assertEquals("", stepClock(null))
    }
}
