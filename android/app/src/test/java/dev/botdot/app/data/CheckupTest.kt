package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The Chief's checkup in the Android app (docs/api.md "The Chief's checkup"): its setting as the server sends it,
 * the words under its switch, when Web search can be used, the two calls, the feed event, and its message in a
 * Chief chat, which has answer buttons and no 👍 and 👎.
 */
class CheckupTest {
    private fun obj(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject
    private fun chat(json: String) = Api.JSON.decodeFromString(ChiefChat.serializer(), json)

    private val setting = """{"on":true,"days":[1,2,3,4,5],"time":"08:00","webSearch":false,"when":"Weekdays at 08:00","timeZone":"Europe/Brussels","lastRanAt":null}"""

    @Test fun theSettingIsReadFromAnAnswer() {
        val c = Checkup.answer("""{"checkup":$setting}""")!!
        assertTrue(c.on)
        assertFalse(c.webSearch)
        assertEquals("Weekdays at 08:00", c.whenWords)
    }

    @Test fun fieldsThisAppDoesNotKnowAreIgnored() {
        val c = Checkup.answer("""{"checkup":{"on":false,"webSearch":true,"when":"Mondays at 07:30","mood":{"x":1},"later":[1,2]},"newThing":true}""")!!
        assertEquals(Checkup(on = false, webSearch = true, whenWords = "Mondays at 07:30"), c)
    }

    @Test fun anAnswerWithoutTheSettingIsNone() {
        assertNull(Checkup.answer("""{"settings":{"chiefRules":""}}""")) // an older server's settings
        assertNull(Checkup.answer("""{"checkup":null}"""))
        assertNull(Checkup.answer("""{"checkup":{"webSearch":true}}""")) // no `on`: not a setting this app can show
        assertNull(Checkup.answer("""{"checkup":{"on":"yes"}}"""))
        assertNull(Checkup.answer("""{"checkup":{"on":true,"when":{"x":1}}}"""))
        assertNull(Checkup.answer("not json"))
    }

    @Test fun theSwitchesAreShownOnlyByAServerThatHasTheCheckup() {
        assertTrue(Checkup.shows(listOf("ratings", "groups", "checkup")))
        assertFalse(Checkup.shows(listOf("ratings", "groups")))
        assertFalse(Checkup.shows(emptyList()))
        assertFalse(Checkup.shows(null)) // its features are not known yet
    }

    @Test fun theLineUnderTheSwitchIsTheServersWordsThenWhoChangesIt() {
        assertEquals("Weekdays at 08:00. Ask the Chief to change it.", Checkup(on = true, whenWords = "Weekdays at 08:00").caption)
        assertEquals("Mondays and Thursdays at 07:30. Ask the Chief to change it.", Checkup(whenWords = "Mondays and Thursdays at 07:30").caption)
        assertEquals("Ask the Chief to change it.", Checkup(on = true).caption) // a server that sent no words
        assertEquals("Checkup", Checkup.LABEL)
        assertEquals("Web search", Checkup.WEB_SEARCH)
        assertEquals("Lets a checkup search the web to check a proposal. It never opens a page.", Checkup.WEB_SEARCH_HINT)
    }

    @Test fun webSearchCannotBeUsedWhileCheckupsAreOff() {
        assertTrue(Checkup(on = true, webSearch = false).webSearchUsable)
        assertTrue(Checkup(on = true, webSearch = true).webSearchUsable)
        assertFalse(Checkup(on = false, webSearch = true).webSearchUsable) // shown as it is, and not usable
        assertFalse(Checkup(on = false, webSearch = false).webSearchUsable)
    }

    @Test fun theFeedEventCarriesTheSettingAsItNowIs() {
        val c = Checkup.event(FeedEvent("41", "checkup", obj("""{"on":false,"days":[1,4],"time":"07:30","webSearch":true,"when":"Mondays and Thursdays at 07:30","timeZone":"UTC","lastRanAt":"2026-10-12T06:00:00Z","next":"x"}""")))
        assertEquals(Checkup(on = false, webSearch = true, whenWords = "Mondays and Thursdays at 07:30"), c)
        assertNull(Checkup.event(FeedEvent("42", "chief_reply", obj("""{"chatId":"c1","checkup":true,"on":true}"""))))
        assertNull(Checkup.event(FeedEvent("43", "checkup", obj("""{}"""))))
    }

    @Test fun theCallsAskAndChangeOneSwitchAndARefusalSaysWhy() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            val ok = { body: String -> MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build() }
            server.enqueue(ok("""{"checkup":$setting}"""))
            assertEquals(Checkup(on = true, webSearch = false, whenWords = "Weekdays at 08:00"), api.checkup())
            val asked = server.takeRequest()
            assertEquals("GET", asked.method)
            assertEquals("/api/settings/checkup", asked.target)

            server.enqueue(ok("""{"checkup":{"on":false,"webSearch":false,"when":"Weekdays at 08:00"}}"""))
            assertEquals(false, api.setCheckup("on", false)?.on)
            val off = server.takeRequest()
            assertEquals("PUT", off.method)
            assertEquals("/api/settings/checkup", off.target)
            assertEquals("""{"on":false}""", off.body?.utf8())

            server.enqueue(ok("""{"checkup":{"on":true,"webSearch":true,"when":"Weekdays at 08:00"}}"""))
            assertEquals(true, api.setCheckup("webSearch", true)?.webSearch)
            assertEquals("""{"webSearch":true}""", server.takeRequest().body?.utf8())

            server.enqueue(MockResponse.Builder().code(400).addHeader("Content-Type", "application/json").body("""{"error":"on must be true or false"}""").build())
            try {
                api.setCheckup("on", true)
                fail("a refusal must throw")
            } catch (e: ApiException) {
                assertEquals("on must be true or false", e.message)
                assertEquals(400, e.status)
            }
        } finally {
            server.close()
        }
    }

    @Test fun aCheckupsMessageHasItsAnswerButtonsAndNoThumbs() {
        val c = chat("""{"id":"c1","title":"Checkup, 12 Oct","messages":[
            {"role":"chief","text":"1. A rule for Mail Sorter","at":"2026-10-12T06:00:00Z","checkup":true,"choices":["Do 1","Do all","Not now"],"startedBy":"botdot"}]}""")
        val m = c.messages.single()
        assertEquals(listOf("Do 1", "Do all", "Not now"), m.choices)
        assertFalse(m.unasked)
        assertFalse(m.pending)
        assertFalse(Ratings.shows(m, listOf("chief", "ratings", "checkup"), 0))
    }
}
