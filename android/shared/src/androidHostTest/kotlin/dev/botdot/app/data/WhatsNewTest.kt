package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * What's new after an update (#219), against a stand-in botdot: asked only from a server that announces it, the
 * notes come newest first as the server sent them, and closing the dialog marks the newest one seen.
 */
class WhatsNewTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    @Test fun askedOnlyFromAServerThatAnnouncesIt() {
        assertTrue(WhatsNew.asks(listOf("unread", "whats-new")))
        assertFalse(WhatsNew.asks(listOf("unread")))
        assertFalse(WhatsNew.asks(null))
    }

    @Test fun readsTheUnseenNotesNewestFirstAndLeavesOutOnesWithoutATitle() = runBlocking {
        server.enqueue(json("""{"entries":[
            {"id":"2026-10-21-b","title":"Newer <b>note</b>","points":["One","Two"],"later":true},
            {"id":"2026-10-20-x","title":"","points":["No title"]},
            {"id":"2026-10-19-a","title":"Older","points":["Three","Four","Five"]}]}"""))
        val entries = api.whatsNew()
        val r = server.takeRequest()
        assertEquals("GET" to "/api/whats-new", r.method to r.target)
        assertEquals(listOf("2026-10-21-b", "2026-10-19-a"), entries.map { it.id })
        assertEquals("Newer <b>note</b>", entries.first().title) // plain text: the dialog draws it as it is
        assertEquals(listOf("One", "Two"), entries.first().points)
    }

    @Test fun nothingNewIsAnEmptyList() = runBlocking {
        server.enqueue(json("""{"entries":[]}"""))
        assertTrue(api.whatsNew().isEmpty())
    }

    @Test fun closingTheDialogMarksTheNewestSeen() = runBlocking {
        server.enqueue(json("""{"ok":true}"""))
        api.whatsNewSeen(listOf(WhatsNew.Entry("2026-10-21-b", "Newer"), WhatsNew.Entry("2026-10-19-a", "Older")))
        val r = server.takeRequest()
        assertEquals("POST" to "/api/whats-new/seen", r.method to r.target)
        assertEquals("1", r.headers["X-Bot-Dot"])
        val body = Api.JSON.parseToJsonElement(r.body!!.utf8()).jsonObject
        assertEquals("2026-10-21-b", body["id"]!!.jsonPrimitive.content)
    }

    @Test fun everyNoteComesTheNewestThreeOpenTheRestAsTitles() {
        val many = (1..12).map { WhatsNew.Entry("2026-10-${30 - it}-n", "Note $it") }
        assertEquals("12 changes, newest first. Tap a title for more.", WhatsNew.countLine(many))
        assertEquals(listOf(true, true, true, false), (0..3).map { WhatsNew.openAtFirst(it) })
        assertEquals(null, WhatsNew.countLine(many.take(3)))
    }
}
