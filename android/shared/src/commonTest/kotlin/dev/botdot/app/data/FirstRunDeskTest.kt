package dev.botdot.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Home's first reads on the iPhone (FirstRunDesk, #1372) against a fake botdot: the Chief's name is asked before What's
 * new shows, a refused name keeps the question, and a front door not reached is asked again after 30 seconds.
 */
class FirstRunDeskTest {
    private val features = listOf(ChiefName.FEATURE, WhatsNew.FEATURE, "accounts")
    private val notes = """{"entries":[{"id":"n2","title":"Board on iPhone","points":["Tiles"]}]}"""

    private fun botdot(name: Pair<Int, String> = 200 to """{"chiefName":"Ada"}""", door: () -> Pair<Int, String> = { 200 to """{"account":"ann","feedback":true}""" }) = FakeServer { t ->
        when {
            t.path == "/front-door/session" -> door()
            t.path == "/api/whats-new" -> 200 to notes
            t.path == "/api/setup" && t.method == "GET" -> 200 to """{"done":false,"chiefNameAsked":false,"savedTimezone":"UTC"}"""
            t.path == "/api/setup" -> name
            else -> 200 to "{}"
        }
    }

    private suspend fun TestScope.until(what: String, done: () -> Boolean) {
        repeat(400) {
            if (done()) return
            runCurrent()
            withContext(Dispatchers.Default) { delay(5) }
        }
        fail("never: $what")
    }

    @Test fun theChiefsNameIsAskedBeforeWhatsNewShows() = runTest {
        val desk = FirstRunDesk(botdot().api, backgroundScope, "Europe/Warsaw")
        desk.saw(features)
        until("the first reads are in") { desk.state.value.whatsNew.isNotEmpty() }
        val s = desk.state.value
        assertTrue(s.askName, "the name's question first")
        assertFalse(s.showsWhatsNew, "What's new waits for the name")
        assertNull(desk.nameChief("Ada"))
        assertFalse(desk.state.value.askName)
        assertTrue(desk.state.value.showsWhatsNew, "answered: What's new shows")
    }

    @Test fun aRefusedNameKeepsTheQuestion() = runTest {
        val desk = FirstRunDesk(botdot(name = 400 to """{"error":"Ops is a bot's name."}""").api, backgroundScope, "Europe/Warsaw")
        desk.saw(features)
        until("the first reads are in") { desk.state.value.askName }
        assertEquals("Ops is a bot's name.", desk.nameChief("Ops"))
        assertTrue(desk.state.value.askName, "the question stays, saying why")
        assertFalse(desk.state.value.showsWhatsNew)
    }

    @Test fun aFrontDoorNotReachedIsAskedAgainAfterThirtySeconds() = runTest {
        var clock = 1_000L
        var reached = false
        val f = botdot(door = { if (reached) 200 to """{"account":"ann","feedback":true}""" else 502 to "" })
        val desk = FirstRunDesk(f.api, backgroundScope, "Europe/Warsaw") { clock }
        desk.saw(features)
        until("the first reads are in") { desk.state.value.whatsNew.isNotEmpty() }
        assertNull(desk.state.value.offers, "not reached: unknown")
        suspend fun doorAsks() = f.sent().count { it.path == "/front-door/session" }
        assertEquals(1, doorAsks())
        reached = true
        clock += 10_000
        desk.saw(features) // Home changed, too soon
        runCurrent()
        assertEquals(1, doorAsks(), "not again before 30 seconds")
        clock += 21_000
        desk.saw(features)
        until("asked again") { desk.state.value.offers != null }
        assertEquals(2, doorAsks())
        assertTrue(desk.state.value.offers?.feedback == true, "Feedback shows once the front door answers")
        clock += 60_000
        desk.saw(features)
        runCurrent()
        assertEquals(2, doorAsks(), "read: not asked again")
    }
}
