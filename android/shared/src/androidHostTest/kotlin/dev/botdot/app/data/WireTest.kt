package dev.botdot.app.data

import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * What the app's requests look like on the wire since Ktor sends them (ADR 242): as OkHttp sent them, so botdot sees
 * the same app (lib/activity.js tells the Android app by `okhttp/` in its User-Agent).
 */
class WireTest {
    private lateinit var botdot: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        botdot = MockWebServer().apply { start() }
        api = Api(botdot.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = botdot.close()

    private fun json(body: String) = MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build()

    @Test fun aRequestNamesOkHttpAsItsClientAsBefore() = runBlocking {
        botdot.enqueue(json("[]"))
        api.bots()
        val req = botdot.takeRequest()
        assertTrue(req.headers["User-Agent"].orEmpty(), req.headers["User-Agent"].orEmpty().startsWith("okhttp/"))
        assertEquals("application/json", req.headers["Accept"])
        assertNull("the mark of a request that went out stays in the app", req.headers["X-Botdot-Went"])
    }

    @Test fun aChangeIsJsonInUtf8() = runBlocking {
        botdot.enqueue(json("""{"settings":{}}"""))
        api.setLanguage("pl")
        val req = botdot.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("application/json; charset=utf-8", req.headers["Content-Type"])
        assertEquals("1", req.headers["X-Bot-Dot"])
        assertEquals(buildJsonObject { put("language", "pl") }.toString(), req.body?.utf8())
    }

    @Test fun aLiveStreamAsksForEventsAndReadsThemAsOkHttpSseDid() = runBlocking {
        botdot.enqueue(MockResponse.Builder().addHeader("Content-Type", "text/event-stream")
            .body(": a comment\nid: 7\nevent: hello\ndata: {\"a\":1}\n\nevent: ping\n\ndata:{\"b\":\ndata: 2}\n\n").build())
        val events = api.feed(null).toList()
        assertEquals("text/event-stream", botdot.takeRequest().headers["Accept"])
        // An event without data is never handed on; the last id stays for the events after it.
        assertEquals(listOf("7" to "hello", "7" to "message"), events.map { it.id to it.type })
        assertEquals("1", events[0].data["a"].toString())
        // Data lines are one text, joined by a newline; one space after the colon is dropped, and none is needed.
        assertEquals("2", events[1].data["b"].toString())
    }

    @Test fun aLiveStreamsLinesEndAtCrlfLfOrCr() = runBlocking {
        botdot.enqueue(MockResponse.Builder().addHeader("Content-Type", "text/event-stream")
            .body("id: 1\r\nevent: a\r\ndata: {\"x\":1}\r\n\r\nevent: b\rdata: {\"y\":2}\r\rdata: {\"z\":3}\n\n").build())
        val events = api.feed(null).toList()
        assertEquals(listOf("1" to "a", "1" to "b", "1" to "message"), events.map { it.id to it.type })
        assertEquals(listOf("1", "2", "3"), events.map { it.data.values.single().toString() })
    }
}
