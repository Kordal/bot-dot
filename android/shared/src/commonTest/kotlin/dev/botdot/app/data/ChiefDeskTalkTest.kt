package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
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
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/** The Chief's chat (ChiefDesk) talking to a fake botdot (Ktor's MockEngine, as BotChatTalkTest). */
class ChiefDeskTalkTest {
    private class FakeBotdot(answer: suspend (method: String, path: String) -> Pair<Int, String>) {
        private val lock = Mutex()
        private val took = mutableListOf<String>()
        val api = Api("https://botdot.test", MockEngine { req ->
            val path = req.url.encodedPath.removePrefix("/api")
            lock.withLock { took += "${req.method.value} $path" }
            val (status, body) = answer(req.method.value, path)
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        suspend fun asked(): List<String> = lock.withLock { took.toList() }
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
}
