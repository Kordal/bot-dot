package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.CarriesOn
import dev.botdot.app.data.Then
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Who carries on after the owner's OK (docs/api.md, "What follows a yes"): the line a card shows before the answer,
 * and what an answered card says. The words are the botdot server's; the app's own are the word for the answer.
 * `test/carries-on-web.test.js` holds the web page's side.
 */
class CarriesOnTest {
    private val inChat = "The Chief carries on in “Morning tech news” when you allow it."
    private val here = "The Chief carries on in this chat when you allow it."

    @Test fun aCardSaysTheServersSentence() {
        val bot = Then("It carries on with “Check why the backup failed last night.” when you allow it.")
        assertEquals("It carries on with “Check why the backup failed last night.” when you allow it.", bot.line())
        assertEquals(bot.text, bot.line("c1")) // a bot's sentence is the same wherever its card stands
    }

    @Test fun inTheChiefsOwnChatTheCardSaysInThisChat() {
        val chief = Then(inChat, chatId = "c1", here = here)
        assertEquals("the Chief chat it speaks of", here, chief.line("c1"))
        assertEquals("another Chief chat: all of them show the card", inChat, chief.line("c2"))
        assertEquals("Needs you, and the bot's chat", inChat, chief.line())
        // Without the chat it speaks of, or without the sentence for it, the one sentence there is.
        assertEquals(inChat, Then(inChat, chatId = null, here = here).line("c1"))
        assertEquals(inChat, Then(inChat, chatId = "c1", here = null).line("c1"))
    }

    @Test fun anAnsweredCardSaysWhatCarriesOnAfterItsOwnWord() {
        assertEquals("Allowed · it carries on", answeredLabel("Allowed", CarriesOn("it carries on")))
        assertEquals("Allowed · it carries on when it is free", answeredLabel("Allowed", CarriesOn("it carries on when it is free")))
        assertEquals("Approved · the Chief carries on", answeredLabel("Approved", CarriesOn("the Chief carries on")))
        assertEquals("Installed · it carries on", answeredLabel("Installed", CarriesOn("it carries on")))
        assertEquals("Always approved · the Chief carries on", answeredLabel("Always approved", CarriesOn("the Chief carries on")))
    }

    @Test fun withoutItTheWordStandsAlone() {
        for (label in listOf("Allowed", "Approved", "Installed", "Installing", "Always allowed", "Always approved", "Declined")) assertEquals(label, answeredLabel(label, null))
    }

    @Test fun theYesOfAnAskAJobAndATileReturnsWhatTheServerSaysItStarted() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            fun answer(body: String) = server.enqueue(MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build())

            answer("""{"ok":true,"carriesOn":{"who":"bot","text":"it carries on"}}""")
            assertEquals(CarriesOn("it carries on"), api.answerAsk("a1", yes = true).carriesOn)
            // What is sent is what was sent before.
            server.takeRequest().let { assertEquals(Triple("POST", "/api/asks/a1", """{"yes":true,"always":false}"""), Triple(it.method, it.target, it.body!!.utf8())) }

            answer("""{"ok":true,"carriesOn":{"who":"chief","text":"the Chief carries on"}}""")
            assertEquals(CarriesOn("the Chief carries on"), api.approveJob("news", "j1", approve = true, always = true).carriesOn)
            server.takeRequest().let { assertEquals(Triple("POST", "/api/bots/news/jobs/j1/approve", """{"approve":true,"always":true}"""), Triple(it.method, it.target, it.body!!.utf8())) }

            answer("""{"ok":true,"carriesOn":{"who":"chief","text":"the Chief carries on"}}""")
            assertEquals(CarriesOn("the Chief carries on"), api.approveTile("t1", approve = true).carriesOn)
            server.takeRequest().let { assertEquals(Triple("POST", "/api/dashboard/tiles/t1/approve", """{"approve":true}"""), Triple(it.method, it.target, it.body!!.utf8())) }

            // A server without `ask-continues`, a yes that only changed the setting, and an answer with no body: the answer went, and names nothing.
            for (body in listOf("""{"ok":true}""", """{"ok":true,"installing":true}""", "")) {
                answer(body)
                assertNull(body, api.answerAsk("a1", yes = true).carriesOn)
                server.takeRequest()
            }
            answer("""{"id":"j1","approved":true}""")
            assertNull(api.approveJob("news", "j1", approve = true).carriesOn)
            answer("""{"ok":true}""")
            assertNull(api.approveTile("t1", approve = false).carriesOn)
        } finally {
            server.close()
        }
    }
}
