package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * A notification's buttons against a stand-in botdot (PushNotices): Reply sends to the chat with its message key,
 * Approve and Decline answer the card, and the iPhone registers and removes its device, as docs/api.md says.
 */
class PushAnswersTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun ok(body: String = "{}") = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private fun next(): Pair<String, Map<String, String>> {
        val r = server.takeRequest()
        val body = r.body?.utf8().orEmpty().ifEmpty { "{}" }
        return "${r.method} ${r.target}" to Api.JSON.parseToJsonElement(body).jsonObject.filterValues { it is JsonPrimitive }.mapValues { it.value.jsonPrimitive.content }
    }

    @Test fun replySendsToTheBotWithItsMessageKey() = runBlocking {
        server.enqueue(ok("""{"id":"r1","botId":"b1","status":"running"}"""))
        PushNotices.reply(api, "bot:b1", "Yes, archive them", "k1")
        val (line, body) = next()
        assertEquals("POST /api/bots/b1/run", line)
        assertEquals("Yes, archive them", body["prompt"])
        assertEquals("k1", body["key"])
    }

    @Test fun approveAndDeclineAnswerTheCard() = runBlocking {
        server.enqueue(ok("""{"ok":true}"""))
        PushNotices.answer(api, "job:b1/j1", true)
        assertEquals("POST /api/bots/b1/jobs/j1/approve", next().first.substringBefore('?'))
        server.enqueue(ok("""{"ok":true}"""))
        PushNotices.answer(api, "plan:c2", false)
        assertEquals("POST /api/chief/chats/c2/dismiss", next().first)
        PushNotices.answer(api, "ask:batch:r1", true) // answered on its card: nothing is sent
        assertEquals(0, server.requestCount - 2)
    }

    @Test fun theIphoneRegistersAndRemovesItsDevice() = runBlocking {
        server.enqueue(ok("""{"ok":true}"""))
        api.addApnsDevice("AB".repeat(32), "k".repeat(43), "development", "iPhone")
        assertEquals("POST /api/push/apns" to mapOf("token" to "ab".repeat(32), "key" to "k".repeat(43), "environment" to "development", "device" to "iPhone"), next())
        server.enqueue(ok("""{"ok":true,"removed":true}"""))
        api.removeApnsDevice("AB".repeat(32))
        assertEquals("DELETE /api/push/apns" to mapOf("token" to "ab".repeat(32)), next())
    }
}
