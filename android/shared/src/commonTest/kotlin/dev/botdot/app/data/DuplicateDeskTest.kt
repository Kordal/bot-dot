package dev.botdot.app.data

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** "Duplicate" for both phones (DuplicateDesk): what the copy gets, its name, the copy made or botdot's no. */
class DuplicateDeskTest {
    @Test fun thePlanItsNameAndTheCopyMadeOrRefused() = runTest {
        var refuse = false
        val server = FakeServer { t ->
            when {
                t.method == "GET" -> 200 to """{"name":"Coder 2","copies":["its settings","its jobs"],"notCopied":"its chats"}"""
                refuse -> 409 to """{"error":"Too many bots"}"""
                else -> 200 to """{"id":"b9","name":"Coder 3"}"""
            }
        }
        val desk = DuplicateDesk(server.api, "b1", "Coder")
        assertTrue(desk.ask())
        with(desk.state.value) {
            assertEquals("Coder 2", name)
            assertTrue(text.contains("• its jobs") && text.contains("Not copied: its chats."), text)
            assertTrue(canGo)
        }
        desk.setName("  ")
        assertFalse(desk.state.value.canGo, "no name: no Duplicate")
        assertNull(desk.go())
        desk.setName("Coder 3")
        refuse = true
        assertNull(desk.go())
        assertEquals("Too many bots", desk.state.value.notice)
        assertTrue(desk.state.value.plan != null, "refused: the confirmation stays, as it was")
        refuse = false
        assertEquals("b9", desk.go())
        assertEquals("Coder 3 made", desk.state.value.notice)
        assertNull(desk.state.value.plan)
        assertTrue("\"name\":\"Coder 3\"" in server.posts().last().body)
    }

    @Test fun aLockedVaultWaitsAndAFailedReadSaysWhy() = runTest {
        val locked = DuplicateDesk(FakeServer { 200 to """{"name":"Coder 2","vaultLocked":true}""" }.api, "b1", "Coder")
        locked.ask()
        assertFalse(locked.state.value.canGo, "Bitwarden locked: unlock it first")
        assertTrue(locked.state.value.text.contains("Bitwarden is locked"))
        val down = DuplicateDesk(FakeServer { 503 to """{"error":"botdot is restarting"}""" }.api, "b1", "Coder")
        assertFalse(down.ask())
        assertEquals("botdot is restarting", down.state.value.notice)
    }
}
