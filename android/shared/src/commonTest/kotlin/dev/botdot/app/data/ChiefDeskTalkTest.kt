package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The Chief's chat (ChiefDesk) talking to a fake botdot (Ktor's MockEngine, as BotChatTalkTest). */
class ChiefDeskTalkTest {
    private class FakeBotdot(answer: suspend (method: String, path: String) -> Pair<Int, String>) {
        private val lock = Mutex()
        private val took = mutableListOf<String>()
        private val bodies = mutableListOf<Pair<String, String>>()
        val api = Api("https://botdot.test", MockEngine { req ->
            val path = req.url.encodedPath.removePrefix("/api")
            lock.withLock { took += "${req.method.value} $path"; bodies += path to ((req.body as? TextContent)?.text.orEmpty()) }
            val (status, body) = answer(req.method.value, path)
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        suspend fun asked(): List<String> = lock.withLock { took.toList() }
        suspend fun bodiesOf(path: String): List<String> = lock.withLock { bodies.filter { it.first == path }.map { it.second } }
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

    @Test fun aSendThatEndsAfterTheChatWasLeftFollowsNoReply() = runTest {
        val answer = CompletableDeferred<Unit>()
        var sent = false
        val replying = """{"id":"c1","messages":[{"role":"user","text":"Plan my week"},{"role":"chief","text":"","pending":true}],"busy":true,"total":2}"""
        val fake = FakeBotdot { method, path ->
            when {
                path == "/chief" -> 200 to """{"chats":[{"id":"c1","title":"Week"}]}"""
                method == "POST" && path == "/chief/chats/c1/messages" -> { answer.await(); sent = true; 200 to replying }
                path == "/chief/chats/c1" -> 200 to if (sent) replying else """{"id":"c1","messages":[],"total":0}"""
                else -> 404 to "{}"
            }
        }
        val store = Store(backgroundScope, MutableStateFlow(fake.api))
        store.version.set(VersionInfo(features = emptyList()))
        val desk = ChiefDesk(backgroundScope, fake.api, store, emptyFlow())
        desk.start()
        until("the latest chat is read") { desk.state.value.chatId == "c1" && desk.state.value.loaded }
        val sending = backgroundScope.async { desk.send("Plan my week") }
        until("the message is on its way") { fake.asked().any { it.startsWith("POST") } }
        desk.stop() // the owner went back while it was sent
        answer.complete(Unit)
        assertTrue(sending.await(), "the send goes on")
        advanceTimeBy(1_000); runCurrent()
        withContext(Dispatchers.Default) { delay(100) }
        assertTrue(fake.asked().none { it.endsWith("/stream") }, "no reply's stream is opened for a chat that was left: ${fake.asked()}")
    }

    @Test fun aNotificationsConversationOpensNotTheLatest() = runTest {
        val fake = FakeBotdot { _, path ->
            when (path) {
                "/chief" -> 200 to """{"chats":[{"id":"c1","title":"Latest"},{"id":"c2","title":"Older"}]}"""
                "/chief/chats/c2" -> 200 to """{"id":"c2","messages":[{"role":"chief","text":"From the notification"}],"total":1}"""
                "/chief/chats/c1" -> 200 to """{"id":"c1","messages":[],"total":0}"""
                else -> 404 to "{}"
            }
        }
        val store = Store(backgroundScope, MutableStateFlow(fake.api))
        store.version.set(VersionInfo(features = emptyList()))
        val desk = ChiefDesk(backgroundScope, fake.api, store, emptyFlow(), startChat = "c2")
        desk.start()
        until("its conversation is read") { desk.state.value.loaded }
        assertTrue(desk.state.value.chatId == "c2", "the notification's conversation")
        assertTrue(desk.state.value.messages.single().text == "From the notification")
        assertTrue(fake.asked().none { it.endsWith("/chief/chats/c1") }, "the latest is not read: ${fake.asked()}")
    }

    private fun TestScope.desk(fake: FakeBotdot): ChiefDesk {
        val store = Store(backgroundScope, MutableStateFlow(fake.api))
        store.version.set(VersionInfo(features = emptyList()))
        return ChiefDesk(backgroundScope, fake.api, store, emptyFlow())
    }

    @Test fun theListIsItsConversationsAndNewChatOpensAnEmptyOne() = runTest {
        val fake = FakeBotdot { _, path ->
            when (path) {
                "/chief" -> 200 to """{"chats":[{"id":"c1","title":"Week"},{"id":"c2","title":"Trip"}]}"""
                "/chief/chats/c1" -> 200 to """{"id":"c1","messages":[{"role":"chief","text":"Your week"}],"total":1}"""
                "/chief/chats/c2" -> 200 to """{"id":"c2","messages":[{"role":"chief","text":"Your trip"}],"total":1}"""
                else -> 404 to "{}"
            }
        }
        val desk = desk(fake)
        desk.start()
        until("the latest is read") { desk.state.value.messages.singleOrNull()?.text == "Your week" }
        assertEquals(listOf("Week", "Trip"), desk.state.value.chats.map { it.title })
        desk.open("c2")
        until("the other conversation") { desk.state.value.chatId == "c2" && desk.state.value.messages.singleOrNull()?.text == "Your trip" }
        val asked = fake.asked().size
        desk.open(null)
        runCurrent()
        val s = desk.state.value
        assertNull(s.chatId, "New chat: none until the first message makes it")
        assertTrue(s.loaded && s.messages.isEmpty())
        assertEquals(asked, fake.asked().size, "nothing is read for a new chat")
    }

    @Test fun aSuggestionIsApprovedOnceOrDeclined() = runTest {
        var declined = false
        val fake = FakeBotdot { method, path ->
            val status = if (declined) "dismissed" else "pending"
            when {
                path == "/chief" -> 200 to """{"chats":[{"id":"c1","title":"Week"}]}"""
                method == "POST" && path == "/chief/chats/c1/dismiss" -> { declined = true; 200 to "{}" }
                method == "POST" && path == "/chief/chats/c1/messages" -> 200 to """{"id":"c1","messages":[],"total":0}"""
                path == "/chief/chats/c1" -> 200 to """{"id":"c1","messages":[{"role":"suggestion","text":"Add a cook","status":"$status","from":{"id":"b1","name":"Fleet Doctor"}}],"total":1}"""
                else -> 404 to "{}"
            }
        }
        val desk = desk(fake)
        desk.start()
        until("the suggestion") { desk.state.value.messages.singleOrNull()?.suggests == true }
        assertTrue(desk.approve(0))
        assertTrue(desk.approve(0))
        val approvals = fake.bodiesOf("/chief/chats/c1/messages")
        assertEquals(2, approvals.size)
        assertTrue(approvals.all { PLAN_APPROVAL in it }, "Approved. Go ahead.")
        assertEquals(1, approvals.map { Api.JSON.parseToJsonElement(it).jsonObject.getValue("key").jsonPrimitive.content }.toSet().size, "the same card: one key, taken once")
        desk.decline()
        until("declined") { desk.state.value.messages.single().declined }
        assertFalse(desk.state.value.messages.single().suggests)
    }

    @Test fun theNewestRepliesQuestionsAreAnsweredInOneMessage() = runTest {
        val fake = FakeBotdot { method, path ->
            when {
                path == "/chief" -> 200 to """{"chats":[{"id":"c1","title":"Week"}]}"""
                method == "POST" && path == "/chief/chats/c1/messages" -> 200 to """{"id":"c1","messages":[],"total":0}"""
                path == "/chief/chats/c1" -> 200 to """{"id":"c1","messages":[
                    {"role":"chief","text":"Earlier","questions":["Old?"]},
                    {"role":"chief","text":"Two things","questions":["When?","Where?"],"questionChoices":[["Mon","Tue"],null]}],"total":2}"""
                else -> 404 to "{}"
            }
        }
        val desk = desk(fake)
        desk.start()
        until("the questions") { desk.state.value.messages.size == 2 }
        val (older, newest) = desk.state.value.messages
        assertTrue(older.questions.isEmpty(), "only the newest reply asks")
        assertEquals(listOf("When?", "Where?"), newest.questions)
        assertEquals(listOf(listOf("Mon", "Tue"), emptyList()), newest.choices)
        assertFalse(desk.answer(newest.index, listOf(" ", "")), "every box empty: nothing sent")
        assertTrue(desk.answer(newest.index, listOf("Mon", "")))
        val sent = fake.bodiesOf("/chief/chats/c1/messages").single()
        assertEquals("When?\n→ Mon\n\nWhere?\n→ –", Api.JSON.parseToJsonElement(sent).jsonObject.getValue("text").jsonPrimitive.content)
    }

    @Test fun anotherConversationsCardsAreItsOwn() = runTest {
        val suggestion = """{"role":"suggestion","text":"Add a cook","status":"pending","from":{"id":"b1","name":"Fleet Doctor"}}"""
        val fake = FakeBotdot { method, path ->
            when {
                path == "/chief" -> 200 to """{"chats":[{"id":"c1","title":"Week"},{"id":"c2","title":"Trip"}]}"""
                method == "POST" && path.endsWith("/messages") -> 200 to """{"id":"x","messages":[],"total":0}"""
                path == "/chief/chats/c1" -> 200 to """{"id":"c1","messages":[$suggestion],"total":1}"""
                path == "/chief/chats/c2" -> 200 to """{"id":"c2","messages":[$suggestion],"total":1}"""
                else -> 404 to "{}"
            }
        }
        val desk = desk(fake)
        desk.start()
        until("c1's suggestion") { desk.state.value.chatId == "c1" && desk.state.value.messages.singleOrNull()?.suggests == true }
        assertTrue(desk.approve(0))
        desk.open("c2")
        until("c2's suggestion") { desk.state.value.chatId == "c2" && desk.state.value.messages.singleOrNull()?.suggests == true }
        assertTrue(desk.approve(0))
        fun key(b: String) = Api.JSON.parseToJsonElement(b).jsonObject.getValue("key").jsonPrimitive.content
        val k1 = key(fake.bodiesOf("/chief/chats/c1/messages").single())
        val k2 = key(fake.bodiesOf("/chief/chats/c2/messages").single())
        assertTrue(k1 != k2, "the same place in another conversation is another card: its own key")
    }

    @Test fun aMailCardsButtonIsSentOnceAndItsChipsOpenTheirBot() = runTest {
        val fake = FakeBotdot { method, path ->
            when {
                path == "/chief" -> 200 to """{"chats":[{"id":"c1","title":"Week"}]}"""
                path == "/bots" -> 200 to """[{"id":"b1","name":"Coder","computer":"linux"}]"""
                path == "/runs/r1" -> 200 to """{"id":"r1","botId":"b1","status":"success"}"""
                method == "POST" && path == "/chief/chats/c1/messages" -> 200 to """{"id":"c1","messages":[],"total":0}"""
                path == "/chief/chats/c1" -> 200 to """{"id":"c1","messages":[{"role":"chief","text":"Drafted","questions":["Send it?"],
                    "actions":[{"kind":"run","text":"Started Coder","runId":"r1"},{"kind":"created","text":"Created Gone","botId":"b9"}],
                    "draft":{"to":"ann@example.test","subject":"Dinner","text":"Friday?"}}],"total":1}"""
                else -> 404 to "{}"
            }
        }
        val desk = desk(fake)
        desk.start()
        until("the card") { desk.state.value.messages.singleOrNull()?.mail != null }
        val line = desk.state.value.messages.single()
        assertTrue(line.questions.isEmpty(), "the card's buttons in place of the answer boxes")
        assertFalse(desk.mail(line.index, "Delete it"), "only the card's own buttons")
        assertTrue(desk.mail(line.index, "Send now"))
        assertTrue(desk.mail(line.index, "Send now"))
        val sent = fake.bodiesOf("/chief/chats/c1/messages").map { Api.JSON.parseToJsonElement(it).jsonObject }
        assertEquals(listOf("Send now", "Send now"), sent.map { it.getValue("text").jsonPrimitive.content })
        assertEquals(1, sent.map { it.getValue("key").jsonPrimitive.content }.toSet().size, "one card: one key, taken once")

        val (run, gone) = line.chips
        assertEquals(ChiefDesk.ChipBot("b1", "Coder", screen = true), desk.chipBot(run), "by its run, to the screen of a Linux computer")
        val notices = desk.state.value.noticeCount
        assertNull(desk.chipBot(gone))
        assertEquals("This bot is no longer available", desk.state.value.notice)
        assertEquals(notices + 1, desk.state.value.noticeCount)
    }

    @Test fun aMailCardsBotOpensOnceReadAgainOrIsSaidToBeGone() = runTest {
        var bots = "[]"
        val fake = FakeBotdot { _, path ->
            when (path) {
                "/chief" -> 200 to """{"chats":[{"id":"c1","title":"Week"}]}"""
                "/bots" -> 200 to bots
                "/chief/chats/c1" -> 200 to """{"id":"c1","messages":[
                    {"role":"chief","text":"Drafted","draft":{"to":"a@example.test","botId":"b1","bot":"Mailer"}},
                    {"role":"chief","text":"Again","draft":{"to":"a@example.test","botId":"b9","bot":"Old"}}],"total":2}"""
                else -> 404 to "{}"
            }
        }
        val desk = desk(fake)
        desk.start()
        until("the cards") { desk.state.value.messages.size == 2 }
        val (made, gone) = desk.state.value.messages
        assertEquals("b1", made.mail!!.botId, "named even before the list knows it")
        bots = """[{"id":"b1","name":"Mailer","computer":"linux"}]"""
        assertEquals(ChiefDesk.ChipBot("b1", "Mailer", screen = true), desk.mailBot(made.index), "the list read again: it is there")
        assertNull(desk.mailBot(gone.index))
        assertEquals("This bot is no longer available", desk.state.value.notice)
    }
}
