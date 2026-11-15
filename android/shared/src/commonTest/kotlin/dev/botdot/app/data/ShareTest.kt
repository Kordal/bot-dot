package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.runTest
import kotlinx.io.Buffer
import kotlinx.io.writeString
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Sharing from another app (Share, #1373): the picker as Android's, and what a share sends to a bot or the Chief. */
class ShareTest {
    private data class Asked(val method: String, val path: String, val query: String, val body: String)

    private class FakeBotdot(answer: (Asked) -> Pair<Int, String>) {
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

    private fun bot(id: String, name: String) = Api.JSON.decodeFromString(Bot.serializer(), """{"id":"$id","name":"$name","description":"$name's work"}""")
    private fun file(name: String) = OutgoingFile(name, 3) { Buffer().apply { writeString("abc") } }
    private val uploaded = """{"name":"menu.pdf","file":"u1.pdf","size":3}"""

    @Test fun thePickerHasTheChiefFirstThenTheBotsByName() {
        val picks = Share.picks(listOf(bot("b2", "zed"), bot("b1", "Ada")), "Chief of Staff")
        assertEquals(listOf(Share.CHIEF, "b1", "b2"), picks.map { it.id })
        assertEquals("It can pass it on to the right bot", picks.first().line)
        assertEquals("Send the text to…", Share.title(0))
        assertEquals("Send the file to…", Share.title(1))
        assertEquals("Send 3 files to…", Share.title(3))
    }

    @Test fun aFileAndALinkGoToTheBotsChatInOneMessage() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.path.startsWith("/uploads") -> 200 to uploaded
                a.path == "/bots/b1/run" -> 200 to """{"id":"r1"}"""
                else -> 404 to "{}"
            }
        }
        assertNull(Share.send(fake.api, "b1", " https://kitchen.example ", listOf(file("menu.pdf")), key = "k1"))
        val up = fake.asked().first()
        assertEquals("to=b1", up.query, "uploaded for the bot it goes to")
        val run = Api.JSON.parseToJsonElement(fake.asked().last().body).jsonObject
        assertTrue(run.toString().contains("https://kitchen.example"))
        assertTrue(run.toString().contains("k1"), "its message key")
        assertTrue(run.toString().contains("u1.pdf"), "the file goes with it")
    }

    @Test fun theChiefGetsItInANewConversation() = runTest {
        val fake = FakeBotdot { a ->
            when {
                a.method == "POST" && a.path == "/chief/chats" -> 200 to """{"id":"c9"}"""
                a.path == "/chief/chats/c9/messages" -> 200 to """{"id":"c9"}"""
                else -> 404 to "{}"
            }
        }
        assertNull(Share.send(fake.api, Share.CHIEF, "Look at this", emptyList()))
        assertEquals(listOf("/chief/chats", "/chief/chats/c9/messages"), fake.asked().map { it.path })
    }

    @Test fun aChiefShareTriedAgainMakesOneConversationAndUploadsOnce() = runTest {
        var refuse = true
        val fake = FakeBotdot { a ->
            when {
                a.path.startsWith("/uploads") -> 200 to uploaded
                a.method == "POST" && a.path == "/chief/chats" -> 200 to """{"id":"c9"}"""
                a.path == "/chief/chats/c9/messages" -> if (refuse) 504 to """{"error":"It took too long."}""" else 200 to """{"id":"c9"}"""
                else -> 404 to "{}"
            }
        }
        val pending = Share.Pending()
        assertEquals("It took too long.", Share.send(fake.api, Share.CHIEF, "Look", listOf(file("menu.pdf")), key = "k1", pending = pending))
        refuse = false
        assertNull(Share.send(fake.api, Share.CHIEF, "Look", listOf(file("menu.pdf")), key = "k1", pending = pending))
        val asked = fake.asked()
        assertEquals(1, asked.count { it.path.startsWith("/uploads") }, "uploaded once")
        assertEquals(1, asked.count { it.method == "POST" && it.path == "/chief/chats" }, "one conversation")
        val sent = asked.filter { it.path == "/chief/chats/c9/messages" }
        assertEquals(2, sent.size)
        assertTrue(sent.all { "k1" in it.body }, "the same key, so botdot takes it once")
    }

    @Test fun nothingIsSentWithoutWordsOrFilesAndARefusalSaysWhy() = runTest {
        val fake = FakeBotdot { 409 to """{"error":"The bot is paused."}""" }
        assertEquals("Nothing to send", Share.send(fake.api, "b1", "  ", emptyList()))
        assertTrue(fake.asked().isEmpty())
        assertEquals("The bot is paused.", Share.send(fake.api, "b1", "Hi", emptyList()))
    }
}
