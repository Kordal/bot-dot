package dev.botdot.app.data

import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
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
        val desk = DuplicateDesk(server.api, "b1", "Coder", backgroundScope)
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
        assertEquals("b9", desk.go()?.id)
        assertEquals("Coder 3 made", desk.state.value.notice)
        assertNull(desk.state.value.plan)
        assertTrue("\"name\":\"Coder 3\"" in server.posts().last().body)
    }

    @Test fun aLockedVaultWaitsAndAFailedReadSaysWhy() = runTest {
        val locked = DuplicateDesk(FakeServer { 200 to """{"name":"Coder 2","vaultLocked":true}""" }.api, "b1", "Coder", backgroundScope)
        locked.ask()
        assertFalse(locked.state.value.canGo, "Bitwarden locked: unlock it first")
        assertTrue(locked.state.value.text.contains("Bitwarden is locked"))
        val down = DuplicateDesk(FakeServer { 503 to """{"error":"botdot is restarting"}""" }.api, "b1", "Coder", backgroundScope)
        assertFalse(down.ask())
        assertEquals("botdot is restarting", down.state.value.notice)
    }
    @Test fun theCopyHasTheNameBotdotGaveIt() = runTest {
        // botdot may name the copy otherwise than typed (a name taken: Coder 3 (2)); the copy made says botdot's.
        val server = FakeServer { t -> if (t.method == "GET") 200 to """{"name":"Coder 2"}""" else 200 to """{"id":"b9","name":"Coder 3 (2)"}""" }
        val desk = DuplicateDesk(server.api, "b1", "Coder", backgroundScope)
        desk.ask()
        desk.setName("Coder 3")
        val copy = desk.go()
        assertEquals("b9", copy?.id)
        assertEquals("Coder 3 (2)", copy?.name)
        assertEquals("Coder 3 (2) made", desk.state.value.notice)
    }
    @Test fun whileTheCopyIsMadeItIsBusyAndAWatchSeesIt() = runTest {
        // botdot's answer is held, so the busy state is there to see for certain (a watch alone may see only the end:
        // a StateFlow hands over its latest value).
        val held = kotlinx.coroutines.CompletableDeferred<Unit>()
        val server = FakeServer { t -> if (t.method == "GET") 200 to """{"name":"Coder 2"}""" else { held.await(); 200 to """{"id":"b9","name":"Coder 2"}""" } }
        val desk = DuplicateDesk(server.api, "b1", "Coder", backgroundScope)
        desk.ask()
        val seen = mutableListOf<DuplicateState>()
        desk.watch { seen += it }
        runCurrent()
        val going = async { desk.go() }
        runCurrent()
        until("busy") { desk.state.value.busy }
        assertEquals("Duplicating Coder…", desk.state.value.notice)
        assertFalse(desk.state.value.canGo, "while it is made, Duplicate waits")
        runCurrent()
        assertTrue(seen.any { it.busy }, "the watch saw it busy")
        held.complete(Unit)
        assertEquals("b9", going.await()?.id)
        runCurrent()
        assertFalse(seen.last().busy)
    }

    private suspend fun kotlinx.coroutines.test.TestScope.until(what: String, done: () -> Boolean) {
        repeat(200) { if (done()) return; runCurrent(); kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { kotlinx.coroutines.delay(5) } }
        kotlin.test.fail("never: $what")
    }
}
