package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * A bot's chat (BotChat) talking to a fake botdot (Ktor's MockEngine, as NeedsDeskTest): what it asks botdot for and
 * what it then shows, for Take back, Stop, the feed, older runs, a waiting message's turn, and a send with a file.
 */
class BotChatTalkTest {
    private data class Asked(val method: String, val path: String, val query: String, val body: String)

    /** A botdot that answers each request with [answer] (status, JSON) and keeps what it was asked. */
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

    private fun TestScope.chat(fake: FakeBotdot): Pair<Store, BotChat> {
        val store = Store(backgroundScope, MutableStateFlow(fake.api))
        store.version.set(VersionInfo(features = emptyList()))
        return store to BotChat(backgroundScope, fake.api, store, events, "b1")
    }

    /** Waits (the chat's own timers on the test's clock, botdot's answers on real threads) until [done]. */
    private suspend fun TestScope.until(what: String, done: suspend () -> Boolean) {
        repeat(400) {
            if (done()) return
            advanceTimeBy(50)
            runCurrent()
            withContext(Dispatchers.Default) { delay(5) }
        }
        fail("never: $what")
    }

    private fun run(id: String, status: String = "success", prompt: String = "hi", result: String = "ok") =
        """{"id":"$id","botId":"b1","status":"$status","prompt":"$prompt","result":"$result","startedAt":"2026-11-14T09:00:00Z"}"""

    private fun bot(queued: String = "[]") = Api.JSON.decodeFromString(Bot.serializer(), """{"id":"b1","name":"Ops","queued":$queued}""")

    @Test fun takeBackTakesAWaitingMessageOffBotdotAndPutsItBackInTheBox() = runTest {
        var waits = """[{"id":"q1","text":"Later please"}]"""
        val fake = FakeBotdot { a ->
            when {
                a.method == "DELETE" && a.path == "/bots/b1/queued/q1" -> { waits = "[]"; 200 to """{"text":"Later please","attachments":[]}""" }
                a.path == "/bots" -> 200 to """[{"id":"b1","name":"Ops","queued":$waits}]"""
                else -> 200 to "[]"
            }
        }
        val (store, chat) = chat(fake)
        store.bots.set(listOf(bot(waits)))
        chat.start()
        until("the message waits") { chat.state.value.queued.map { it.id } == listOf("q1") }
        chat.takeBack(chat.state.value.queued.single())
        until("it is taken back") { fake.asked().any { it.method == "DELETE" && it.path == "/bots/b1/queued/q1" } && chat.state.value.queued.isEmpty() }
        assertEquals("Later please", chat.takeFailed(), "its words come back into the box")
    }

    @Test fun stopAsksBotdotToStopTheRunThatGoesOn() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/runs/r1/stop" -> 200 to "{}"
                a.path == "/runs" -> 200 to "[${run("r1", status = "running", result = "")}]"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("the run is at work") { chat.state.value.running }
        chat.stopRun()
        until("stop is asked") { fake.asked().any { it.method == "POST" && it.path == "/runs/r1/stop" } }
        until("the notice says so") { chat.state.value.notice == "Stopping…" }
    }

    @Test fun aRunEventOfThisBotReadsItsNewestRunsAgain() = runTest {
        var newer = false
        val fake = FakeBotdot { a ->
            if (a.path == "/runs") 200 to if (newer) "[${run("r2", result = "Done")},${run("r1")}]" else "[${run("r1")}]" else 404 to "{}"
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("its first page") { chat.state.value.runs.map { it.run.id } == listOf("r1") }
        newer = true
        events.emit(FeedEvent(null, "run_end", buildJsonObject { put("botId", "b1") }))
        until("the new run is in") { chat.state.value.runs.map { it.run.id } == listOf("r2", "r1") }
        events.emit(FeedEvent(null, "run_end", buildJsonObject { put("botId", "other") }))
        val asks = fake.asked().size
        advanceTimeBy(1_000); runCurrent()
        assertEquals(asks, fake.asked().size, "another bot's run asks nothing")
    }

    @Test fun scrolledToTheTopTheRunsBeforeAreRead() = runTest {
        val page = (40 downTo 1).joinToString(",") { run("n$it") }
        val fake = FakeBotdot { a ->
            when {
                a.path == "/runs" && "before=n1" in a.query -> 200 to "[${run("o1")}]"
                a.path == "/runs" -> 200 to "[$page]"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("its first page") { chat.state.value.runs.size == 40 }
        chat.loadOlder()
        until("the page before") { chat.state.value.runs.lastOrNull()?.run?.id == "o1" }
        assertEquals(41, chat.state.value.runs.size)
    }

    @Test fun aWaitingMessageWhoseTurnCameIsShownUntilItsRunIsIn() = runTest {
        var waits = """[{"id":"q1","text":"Later please"}]"""
        val fake = FakeBotdot { a ->
            when {
                a.path == "/runs/q1" -> 200 to run("q1", status = "running", prompt = "Later please", result = "")
                a.path == "/runs" -> 200 to "[]" // the list has not caught up yet: the run is found by its id
                a.path == "/bots" -> 200 to """[{"id":"b1","name":"Ops","queued":$waits}]"""
                else -> 404 to "{}"
            }
        }
        val (store, chat) = chat(fake)
        store.bots.set(listOf(bot(waits)))
        chat.start()
        until("the message waits") { chat.state.value.queued.isNotEmpty() }
        waits = "[]"
        store.bots.set(listOf(bot())) // its turn came: it left the list without being taken back
        until("its run is in the chat") { chat.state.value.runs.any { it.run.id == "q1" } }
        assertTrue(chat.state.value.started.isEmpty(), "drawn once: as its run, not also as the message on its way")
        assertTrue(chat.state.value.queued.isEmpty())
    }

    @Test fun aSentMessageCarriesItsFileAndLeavesTheBoxEmpty() = runTest {
        var sent = false
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/bots/b1/run" -> { sent = true; 200 to run("r9", status = "running", prompt = "Look at this", result = "") }
                a.path == "/runs" -> 200 to if (sent) "[${run("r9", status = "running", prompt = "Look at this", result = "")}]" else "[]"
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        val file = Attachment("photo.jpeg", "f1")
        chat.pick(file)
        assertTrue(chat.send("Look at this"))
        val post = fake.asked().single { it.method == "POST" && it.path == "/bots/b1/run" }
        assertTrue("\"prompt\":\"Look at this\"" in post.body, post.body)
        assertTrue("\"file\":\"f1\"" in post.body, post.body)
        assertEquals(emptyList(), chat.state.value.files)
        until("its run is in the chat") { chat.state.value.runs.any { it.run.id == "r9" } }
    }

    @Test fun aSendThatEndsAfterTheChatWasLeftFollowsNoRun() = runTest {
        val answer = kotlinx.coroutines.CompletableDeferred<Unit>()
        var sent = false
        val going = run("r9", status = "running", prompt = "Look", result = "")
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/bots/b1/run" -> { answer.await(); sent = true; 200 to going }
                a.path == "/runs" -> 200 to if (sent) "[$going]" else "[]" // botdot lists the run that goes on
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        val sending = backgroundScope.async { chat.send("Look") }
        until("the message is on its way") { fake.asked().any { it.method == "POST" } }
        chat.stop() // the owner went back while it was sent
        answer.complete(Unit)
        assertTrue(sending.await(), "the send goes on")
        advanceTimeBy(1_000); runCurrent()
        withContext(Dispatchers.Default) { delay(100) }
        assertTrue(fake.asked().none { it.path.endsWith("/stream") }, "no run's stream is opened for a chat that was left: ${fake.asked().map { it.path }}")
    }

    private val steps = """{"steps":[{"text":"Read the brief","status":"done"},{"text":"Draft it","status":"doing","doing":"Writing the intro"},{"text":"Send it","status":"todo"}]}"""

    /** A plan memory kept in a map, as the phone keeps it in its defaults. */
    private class Kept : PlanMemory.Keep {
        val map = HashMap<String, String>()
        override fun read(key: String) = map[key]
        override fun write(key: String, value: String) { map[key] = value }
    }

    @Test fun theRunAtWorksPlanIsDockedFoldedAndItsFoldIsKept() = runTest {
        val fake = FakeBotdot { a ->
            if (a.path == "/runs") 200 to """[{"id":"r1","botId":"b1","status":"running","prompt":"hi","startedAt":"2026-11-14T09:00:00Z","plan":$steps}]"""
            else 404 to "{}"
        }
        val keep = Kept()
        val store = Store(backgroundScope, MutableStateFlow(fake.api))
        store.version.set(VersionInfo(features = emptyList()))
        val chat = BotChat(backgroundScope, fake.api, store, events, "b1", PlanMemory(keep))
        chat.start()
        until("the plan") { chat.state.value.plan != null }
        val dock = chat.state.value.plan!!
        assertFalse(dock.stopped)
        assertTrue(dock.folded, "folded by default: the phone's one line")
        assertEquals("step 2 of 3", dock.stepLine)
        assertEquals("1 of 3", dock.doneLine)
        assertEquals("Writing the intro", dock.now)
        chat.foldPlan(false)
        assertFalse(chat.state.value.plan!!.folded)
        assertFalse(PlanMemory(keep).folded("bot:b1"), "kept: open again next time")
        chat.stop()
    }

    @Test fun aPlanStoppedBeforeItWasDoneSaysWhereAndIsDismissedForGood() = runTest {
        val fake = FakeBotdot { a ->
            if (a.path == "/runs") 200 to """[{"id":"r2","botId":"b1","status":"error","prompt":"hi","startedAt":"2026-11-14T09:00:00Z","plan":$steps}]"""
            else 404 to "{}"
        }
        val keep = Kept()
        val store = Store(backgroundScope, MutableStateFlow(fake.api))
        store.version.set(VersionInfo(features = emptyList()))
        val chat = BotChat(backgroundScope, fake.api, store, events, "b1", PlanMemory(keep))
        chat.start()
        until("the plan") { chat.state.value.plan != null }
        val dock = chat.state.value.plan!!
        assertTrue(dock.stopped)
        assertEquals("Stopped at step 2 of 3", dock.stoppedLine)
        assertEquals("1 step done", dock.doneSteps)
        assertEquals("Draft it", dock.stoppedAt)
        assertEquals("1 step not started", dock.notStarted)
        chat.dismissPlan()
        assertNull(chat.state.value.plan)
        assertTrue(PlanMemory(keep).dismissed("r2"), "kept: gone next time too")
        chat.stop()
    }
}
