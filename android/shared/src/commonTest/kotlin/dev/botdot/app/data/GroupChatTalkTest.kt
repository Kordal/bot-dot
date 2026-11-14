package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CompletableDeferred
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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * A group's chat (GroupChat) talking to a fake botdot (Ktor's MockEngine, as BotChatTalkTest): a send to the group,
 * each member's turn under its own name with its line, a tapped answer with its question above it, the notes, Stop
 * all, and a chat that was left following no run.
 */
class GroupChatTalkTest {
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

    private fun TestScope.chat(fake: FakeBotdot, features: List<String> = emptyList()): Pair<Store, GroupChat> {
        val store = Store(backgroundScope, MutableStateFlow(fake.api))
        runCurrent() // the Store takes its botdot first, and starts from nothing: what is set here comes after
        store.version.set(VersionInfo(features = features))
        store.bots.set(listOf(bot("b1", "Coder", "#7f77dd"), bot("b2", "Reviewer", "#d4537e")))
        store.groups.set(Group.list("""[{"id":"g1","name":"Dev","members":["b1","b2"]}]"""))
        return store to GroupChat(backgroundScope, fake.api, store, events, "g1")
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

    private fun bot(id: String, name: String, color: String) = Api.JSON.decodeFromString(Bot.serializer(), """{"id":"$id","name":"$name","color":"$color"}""")

    private fun reply(id: String, botId: String, result: String, at: String, extra: String = "") =
        """{"type":"reply","id":"$id","at":"$at","run":{"id":"$id","botId":"$botId","status":"success","result":"$result","startedAt":"$at","groupMessageId":"m1"$extra}}"""

    private fun message(id: String, text: String, at: String, extra: String = "") = """{"type":"message","id":"$id","text":"$text","at":"$at"$extra}"""

    private fun page(items: List<String>, working: String = "[]", asks: String = "null") = """{"items":[${items.joinToString(",")}],"more":false,"working":$working,"asks":$asks}"""

    @Test fun aMessageSentToTheGroupGoesToBotdotAndStandsInTheChat() = runTest {
        var sent = false
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/group-chats/g1/messages" -> { sent = true; 200 to message("m1", "Ship it?", "2026-11-14T09:00:00Z", ""","to":["b1","b2"]""") }
                a.path == "/group-chats/g1/chat" -> 200 to page(if (sent) listOf(message("m1", "Ship it?", "2026-11-14T09:00:00Z")) else emptyList())
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("the chat is read") { chat.state.value.loaded }
        assertTrue("Coder and Reviewer" in chat.state.value.empty, chat.state.value.empty)
        assertTrue(chat.state.value.showsEmpty)
        assertEquals(4, chat.state.value.room, "a group of two takes four more")
        assertTrue(chat.send("Ship it?"))
        val post = fake.asked().single { it.method == "POST" }
        assertTrue("\"text\":\"Ship it?\"" in post.body, post.body)
        until("the message is in the chat") { chat.state.value.rows.map { it.id } == listOf("m1") }
        assertNull(chat.state.value.sent, "drawn once: as the server's message, not also as the one on its way")
        assertEquals("Ship it?", chat.state.value.rows.single().message?.message?.text)
    }

    @Test fun eachMembersTurnHasItsLineAndItsReplyStandsUnderItsName() = runTest {
        var done = false
        val fake = FakeBotdot { a ->
            when {
                a.path == "/group-chats/g1/chat" -> 200 to if (done) page(listOf(message("m1", "Ship it?", "2026-11-14T09:00:00Z"), reply("r1", "b1", "Tests pass.", "2026-11-14T09:01:00Z")))
                    else page(listOf(message("m1", "Ship it?", "2026-11-14T09:00:00Z", ""","next":["b2"]""")), working = """[{"botId":"b1","runId":"r1","messageId":"m1","openingLine":"Running the tests"}]""")
                else -> 404 to "{}"
            }
        }
        val (store, chat) = chat(fake)
        chat.start()
        until("the member is at work") { chat.state.value.turns.isNotEmpty() }
        val turn = chat.state.value.turns.single()
        assertEquals("Coder · Running the tests…", turn.line)
        assertEquals("#7f77dd", turn.color)
        assertEquals(listOf("Reviewer"), chat.state.value.next.map { it.name }, "who is next, of the message at work")
        // The feed says the turn waits for the owner's OK (TurnLines): its line says so.
        store.handle(FeedEvent(null, "group_run_waits", buildJsonObject { put("groupId", "g1"); put("botId", "b1"); put("runId", "r1"); put("waitingFor", "ok") }))
        until("its line waits for the OK") { chat.state.value.turns.firstOrNull()?.held == true }
        assertEquals("Coder · Waiting for your OK", chat.state.value.turns.single().line)
        done = true
        events.emit(FeedEvent(null, "group_run_finished", buildJsonObject { put("groupId", "g1"); put("botId", "b1"); put("id", "r1") }))
        until("its reply is in") { chat.state.value.rows.any { it.reply != null } }
        val r = chat.state.value.rows.last().reply!!
        assertEquals("Coder", r.name)
        assertEquals("Tests pass.", r.reply)
        assertTrue(chat.state.value.turns.isEmpty())
        events.emit(FeedEvent(null, "group_run_finished", buildJsonObject { put("groupId", "other"); put("id", "x") }))
        val asks = fake.asked().size
        advanceTimeBy(1_000); runCurrent()
        assertEquals(asks, fake.asked().size, "another group's event asks nothing")
    }

    @Test fun aTappedAnswerShowsTheQuestionItAnswersAboveIt() = runTest {
        var answered = false
        val asking = reply("r1", "b1", "Ship it now or wait?", "2026-11-14T09:01:00Z", ""","choices":["Now","Wait"],"yes":0""")
        val other = reply("r2", "b2", "Looks fine to me.", "2026-11-14T09:02:00Z")
        val answer = message("m2", "Now", "2026-11-14T09:03:00Z", ""","question":{"runId":"r1","botId":"b1","botName":"Coder","text":"Ship it now or wait?"}""")
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/group-chats/g1/messages" -> { answered = true; 200 to answer }
                a.path == "/group-chats/g1/chat" -> 200 to if (answered) page(listOf(asking, other, answer))
                    else page(listOf(asking, other), asks = """{"botId":"b1","botName":"Coder","text":"Ship it now or wait?","runId":"r1"}""")
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("the question is open") { chat.state.value.rows.firstOrNull()?.reply?.choices == listOf("Now", "Wait") }
        assertEquals(0, chat.state.value.rows.first().reply?.yes)
        assertTrue(chat.state.value.rows[1].reply!!.choices.isEmpty(), "only the reply that asks has buttons")
        assertTrue(chat.answer("Now"))
        until("the answer is in") { chat.state.value.rows.size == 3 }
        val m = chat.state.value.rows.last().message!!
        assertEquals("Ship it now or wait?", m.question?.text, "another member's reply stands between: the question is above it")
        assertEquals("#7f77dd", m.questionColor)
        assertTrue(chat.state.value.rows.first().reply!!.choices.isEmpty(), "answered: the buttons go")
    }

    @Test fun theNotesAreReadAndANewOneIsAdded() = runTest {
        var notes = """{"items":[{"id":"n1","kind":"fact","text":"Deploys on Fridays","by":"owner","at":"2026-11-01T09:00:00Z"}]}"""
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/group-chats/g1/notes" -> {
                    notes = """{"items":[{"id":"n1","kind":"fact","text":"Deploys on Fridays","by":"owner","at":"2026-11-01T09:00:00Z"},{"id":"n2","kind":"decision","text":"Ship on Monday","by":"owner","at":"2026-11-14T09:00:00Z"}]}"""
                    200 to notes
                }
                a.path == "/group-chats/g1/notes" -> 200 to notes
                a.path == "/group-chats/g1/chat" -> 200 to page(emptyList())
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake, features = listOf(GroupNotes.FEATURE))
        chat.start()
        until("the notes are read") { chat.state.value.notes?.map { it.id } == listOf("n1") }
        chat.addNote("decision", "  Ship   on Monday ")
        until("the new note is in") { chat.state.value.notes?.map { it.id } == listOf("n2", "n1") } // decisions first
        assertTrue("\"text\":\"Ship on Monday\"" in fake.asked().single { it.method == "POST" }.body)
    }

    @Test fun stopAllAsksBotdotToStopTheGroup() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/group-chats/g1/stop" -> 200 to "{}"
                a.path == "/group-chats/g1/chat" -> 200 to page(emptyList(), working = """[{"botId":"b1","runId":"r1"}]""")
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake)
        chat.start()
        until("a member is at work") { chat.state.value.turns.isNotEmpty() }
        chat.stopAll()
        until("stop is asked") { fake.asked().any { it.method == "POST" && it.path == "/group-chats/g1/stop" } }
    }

    @Test fun aSendThatEndsAfterTheChatWasLeftFollowsNoRun() = runTest {
        val answer = CompletableDeferred<Unit>()
        var sent = false
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/group-chats/g1/messages" -> { answer.await(); sent = true; 200 to message("m1", "Look", "2026-11-14T09:00:00Z") }
                // botdot lists the member at work on it
                a.path == "/group-chats/g1/chat" -> 200 to page(if (sent) listOf(message("m1", "Look", "2026-11-14T09:00:00Z")) else emptyList(), working = if (sent) """[{"botId":"b1","runId":"r1","messageId":"m1"}]""" else "[]")
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake, features = listOf(ReplyDraft.FEATURE))
        chat.start()
        until("the chat is read") { chat.state.value.loaded }
        val sending = backgroundScope.async { chat.send("Look") }
        until("the message is on its way") { fake.asked().any { it.method == "POST" } }
        chat.stop() // the owner went back while it was sent
        answer.complete(Unit)
        assertTrue(sending.await(), "the send goes on")
        advanceTimeBy(1_000); runCurrent()
        withContext(Dispatchers.Default) { delay(100) }
        assertTrue(fake.asked().none { it.path.endsWith("/stream") }, "no run's stream is opened for a chat that was left: ${fake.asked().map { it.path }}")
    }

    @Test fun anOpenChatFollowsTheDraftOfEachMemberAtWork() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.path == "/group-chats/g1/chat" -> 200 to page(emptyList(), working = """[{"botId":"b2","runId":"r1"}]""")
                else -> 404 to "{}"
            }
        }
        val (_, chat) = chat(fake, features = listOf(ReplyDraft.FEATURE))
        chat.start()
        until("its stream is followed") { fake.asked().any { it.path == "/runs/r1/stream" } }
        chat.stop()
    }
}
