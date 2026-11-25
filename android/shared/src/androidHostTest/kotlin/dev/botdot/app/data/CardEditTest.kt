package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The pencil on a board tile (ADR 273): which chat it opens, and what a waiting message keeps of the tile. */
class CardEditTest {
    private val running = Company(id = "p1", name = "Shop", phase = "running", chiefChat = "cc1", lead = "pm")
    private val pm = Bot("pm", "Planner")
    private val on = listOf(ManyProjects.CARD_EDIT, ManyProjects.MANAGER_BOT)

    @After fun english() = I18n.use("en", null)

    @Test fun theManagerBotsChatWhenTheProjectHasOneElseItsOwnChiefChat() {
        assertEquals(ProjectChats.Open(ProjectChats.BOT, "pm"), CardEdit.chatOf(running, on, listOf(pm)))
        assertEquals(ProjectChats.Open(ProjectChats.CHIEF, "cc1"), CardEdit.chatOf(running, on, emptyList()), "a lead the botdot does not know")
        assertEquals(ProjectChats.Open(ProjectChats.CHIEF, "cc1"), CardEdit.chatOf(running, listOf(ManyProjects.CARD_EDIT), listOf(pm)), "a botdot without manager bots")
    }

    @Test fun noPencilWithoutTheFeatureARunningProjectOrAChat() {
        assertNull(CardEdit.chatOf(running, listOf(ManyProjects.MANAGER_BOT), listOf(pm)), "an older botdot")
        assertNull(CardEdit.chatOf(running.copy(phase = "setup"), on, listOf(pm)), "not running: no board to edit")
        assertNull(CardEdit.chatOf(running.copy(lead = null, chiefChat = null), on, listOf(pm)), "no chat to open")
        assertNull(CardEdit.chatOf(running.copy(lead = null, chiefChat = ""), on, listOf(pm)))
    }

    @Test fun theChipStandsOnlyInTheChatItWasMadeFor() {
        val t = CardEdit.Target("p1", "replies", "Latest replies", ProjectChats.Open(ProjectChats.BOT, "pm"))
        assertTrue(t.isIn(ProjectChats.Open(ProjectChats.BOT, "pm")))
        assertEquals(false, t.isIn(ProjectChats.Open(ProjectChats.CHIEF, "pm")))
        assertEquals(false, t.isIn(ProjectChats.Open(ProjectChats.BOT, "other")))
        assertEquals("replies" to "p1", CardEdit.ids(t))
        assertNull(CardEdit.ids(null))
    }

    @Test fun aWaitingMessageKeepsTheTileItWasAbout() {
        val list = Queued.list(Json.parseToJsonElement("""[{"id":"q1","text":"Hide it","card":{"id":"card:k7f2","label":"Decisions"}},{"id":"q2","text":"Plain"},{"id":"q3","text":"x","card":{"id":"replies","label":""}}]"""))
        assertEquals(TileRef("card:k7f2", "Decisions"), list[0].card)
        assertNull(list[1].card)
        assertNull(list[2].card, "a tile with no name is drawn as none")
    }

    @Test fun aMessageAboutATileSendsItsIdAndProjectToTheBotAndToTheChief() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            val json = { body: String -> MockResponse.Builder().code(201).addHeader("Content-Type", "application/json").body(body).build() }
            val t = CardEdit.Target("p1", "card:k7f2", "Decisions", ProjectChats.Open(ProjectChats.BOT, "pm"))
            server.enqueue(json("""{"id":"r1","botId":"pm","status":"running","prompt":"Newest first","card":{"id":"card:k7f2","label":"Decisions"}}"""))
            val run = api.runBot("pm", "Newest first", emptyList(), "k1", card = t)
            assertEquals(TileRef("card:k7f2", "Decisions"), run.card)
            val bot = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
            assertEquals("card:k7f2", bot["card"]!!.jsonPrimitive.content)
            assertEquals("p1", bot["project"]!!.jsonPrimitive.content)
            server.enqueue(json("""{"id":"cc1","busy":true,"messages":[{"role":"user","text":"Hide it","card":{"id":"replies","label":"Latest replies"}}]}"""))
            val chat = api.sendToChief("cc1", "Hide it", emptyList(), "k2", CardEdit.Target("p1", "replies", "Latest replies", ProjectChats.Open(ProjectChats.CHIEF, "cc1")))!!
            assertEquals(TileRef("replies", "Latest replies"), chat.messages.first().card)
            val chief = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
            assertEquals("replies", chief["card"]!!.jsonPrimitive.content)
            assertEquals("p1", chief["project"]!!.jsonPrimitive.content)
            // A plain message names no tile.
            server.enqueue(json("""{"id":"r2","botId":"pm","status":"running","prompt":"Plain"}"""))
            api.runBot("pm", "Plain", emptyList(), "k3")
            val plain = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
            assertEquals(false, "card" in plain || "project" in plain)
        } finally { server.close() }
    }

    @Test fun aFixedTilesNameIsDrawnInTheOwnersLanguageByItsIdAndACardKeepsItsTitle() {
        val pl = JsonObject(listOf("Latest replies" to "Ostatnie odpowiedzi", "Current work" to "Bieżąca praca", "Blockers" to "Przeszkody", "Calendar" to "Kalendarz", "To-do" to "Do zrobienia", "Files" to "Pliki").associate { it.first to JsonPrimitive(it.second) })
        I18n.use("pl", pl)
        // The server stores the English name; the id says which piece it is.
        assertEquals("Ostatnie odpowiedzi", CardEdit.nameOf(TileRef("replies", "Latest replies")))
        assertEquals(listOf("Bieżąca praca", "Przeszkody", "Ostatnie odpowiedzi", "Kalendarz", "Do zrobienia", "Pliki"), CardEdit.PIECES.map { CardEdit.nameOf(TileRef(it, "English")) })
        assertEquals("Decisions", CardEdit.nameOf(TileRef("card:k7f2", "Decisions")), "a card made by Claude has a title of its own")
        I18n.use("en", null)
        assertEquals("Latest replies", CardEdit.nameOf(TileRef("replies", "Latest replies")))
    }
}
