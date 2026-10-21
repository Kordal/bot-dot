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
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * Feedback beside Settings (#216, ADR 048), against a stand-in front door: shown only when the front door says it goes
 * to an admin page, sent to the front door's own route with the kind and the text, and a refusal or a failed send
 * says why in words the form shows while it keeps the text.
 */
class FeedbackTest {
    private lateinit var door: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        door = MockWebServer()
        door.start()
        api = Api(door.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = door.close()

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    @Test fun showsOnlyWhenTheFrontDoorSaysFeedbackGoesToAnAdminPage() = runBlocking {
        door.enqueue(json("""{"admin":false,"feedback":true}"""))
        val session = api.frontDoorSession()
        val r = door.takeRequest()
        assertEquals("GET" to "/front-door/session", r.method to r.target)
        assertTrue(Feedback.on(listOf("accounts"), session))
        assertFalse("no front door", Feedback.on(emptyList(), session))
        assertFalse("an older front door", Feedback.on(listOf("accounts"), Api.JSON.parseToJsonElement("""{"admin":true}""").jsonObject))
        assertFalse("a machine of one account", Feedback.on(listOf("accounts"), Api.JSON.parseToJsonElement("""{"feedback":false}""").jsonObject))
        assertFalse("not a boolean", Feedback.on(listOf("accounts"), Api.JSON.parseToJsonElement("""{"feedback":"true"}""").jsonObject))
        assertFalse("no answer", Feedback.on(listOf("accounts"), null))
    }

    @Test fun sendsTheKindAndTheTextToTheFrontDoor() = runBlocking {
        for ((kind, text) in listOf(Feedback.Kind.BUG to "Approve button does nothing on my phone", Feedback.Kind.FEATURE to "Add a dark theme")) {
            door.enqueue(json("""{"ok":true,"id":"${"a".repeat(32)}"}""", 201))
            api.sendFeedback(kind, text)
            val r = door.takeRequest()
            assertEquals("POST" to "/front-door/feedback", r.method to r.target)
            assertEquals("1", r.headers["X-Bot-Dot"])
            val body = Api.JSON.parseToJsonElement(r.body!!.utf8()).jsonObject
            assertEquals(kind.wire, body["kind"]!!.jsonPrimitive.content)
            assertEquals(text, body["text"]!!.jsonPrimitive.content)
        }
        assertEquals(listOf("Bug", "Feature request"), Feedback.Kind.entries.map { it.label })
    }

    @Test fun aRefusalSaysTheFrontDoorsSentenceAndAFailedSendSaysTheTextStays() = runBlocking {
        door.enqueue(json("""{"error":"You sent 10 reports in the last hour. Try again later."}""", 429))
        try { api.sendFeedback(Feedback.Kind.BUG, "Again"); fail("refused") } catch (e: ApiException) {
            assertEquals("You sent 10 reports in the last hour. Try again later.", Feedback.failed(e))
        }
        door.close()
        try { api.sendFeedback(Feedback.Kind.BUG, "Server down"); fail("no server") } catch (e: ApiException) {
            val said = Feedback.failed(e)
            assertTrue(said, said.startsWith("Couldn't send: Can't reach botdot"))
            assertTrue(said, said.endsWith("Your text is still here."))
        }
    }
}
