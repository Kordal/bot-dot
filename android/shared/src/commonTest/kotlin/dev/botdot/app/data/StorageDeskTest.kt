package dev.botdot.app.data

import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Settings → Storage for both phones (StorageDesk): the groups, a folder opened, Delete and Clear, and a check that runs. */
class StorageDeskTest {
    private val answer = """{"checkedAt":"2026-11-15T09:00:00Z","total":3000000,
        "groups":[{"id":"bots","bytes":2000000,"kids":[{"name":"Ada","bytes":2000000,"place":{"bot":"b1"},"path":"","kids":[{"name":"reports","bytes":1500000,"files":3},{"name":"a.txt","bytes":500000,"dir":false}]}]},
                  {"id":"caches","bytes":1000000},{"id":"chats","bytes":0}],
        "largest":[{"name":"big.zip","path":"reports/big.zip","bytes":900000,"place":{"bot":"b1"},"owner":"Ada"}]}"""

    @Test fun theGroupsOpenToTheirFoldersAndAFolderDeletesAfterItsQuestion() = runTest {
        val server = FakeServer { t ->
            when {
                t.method == "DELETE" -> 200 to "{}"
                t.path.endsWith("/clear-caches") -> 200 to """{"checkedAt":"x","total":2000000,"freed":1000000,"groups":[]}"""
                else -> 200 to answer
            }
        }
        val desk = StorageDesk(backgroundScope, server.api, emptyList())
        desk.load()
        with(desk.state.value) {
            assertEquals("Storage", title)
            assertEquals(Storage.size(3000000), total)
            assertEquals(listOf("bots", "caches"), groups.map { it.id }, "a group with nothing in it is left out")
            assertEquals("big.zip", largest.single().name)
            assertTrue(largest.single().deletable)
        }
        assertFalse(desk.back(), "at the groups: the screen goes")
        desk.open("bots")
        assertEquals(listOf("Ada"), desk.state.value.rows.map { it.name })
        assertFalse(desk.state.value.rows.single().deletable, "a whole bot's folder is never deleted from here")
        desk.open("Ada")
        val reports = desk.state.value.rows.first()
        assertEquals("Delete reports? ${Storage.size(1500000)}, 3 files.", desk.deleteWords(reports))
        assertEquals("reports", desk.filesFolder(reports))
        assertEquals("What is reports (${Storage.size(1500000)}) in Ada’s files, and can it go?", desk.askWords(reports, desk.whose(reports) { if (it == "b1") "Ada" else null }))
        assertTrue(desk.delete(reports))
        assertEquals("DELETE", server.posts().single().method)
        assertEquals("Deleted", desk.state.value.notice)
        assertTrue(desk.back())
        assertTrue(desk.back())
        assertTrue(desk.clearCaches())
        assertEquals("Cleared ${Storage.size(1000000)}", desk.state.value.notice)
    }

    @Test fun aCheckIsReadAgainUntilItIsDoneAndAFailedReadSaysWhy() = runTest {
        var reads = 0
        val server = FakeServer { t ->
            if (t.method == "POST") 200 to """{"checking":true}"""
            else { reads++; if (reads < 3) 200 to """{"checking":true}""" else 200 to answer }
        }
        val desk = StorageDesk(backgroundScope, server.api, emptyList())
        desk.check()
        assertFalse(desk.state.value.checking)
        assertEquals(3, reads, "read again while botdot measures")
        val down = StorageDesk(backgroundScope, FakeServer { 503 to """{"error":"botdot is restarting"}""" }.api, emptyList())
        down.load()
        assertNull(down.state.value.answer)
        assertEquals("botdot is restarting", down.state.value.error)
        runCurrent()
    }
    @Test fun aDeskGivenTheKeptFolderOpensThereOnceItIsRead() = runTest {
        val desk = StorageDesk(backgroundScope, FakeServer { 200 to answer }.api, listOf("bots", "Ada"))
        desk.load()
        assertEquals("Ada", desk.state.value.title)
        assertEquals(listOf("bots", "Ada"), desk.state.value.trail)
        assertEquals(listOf("reports", "a.txt"), desk.state.value.rows.map { it.name })
        assertTrue(desk.back())
        assertEquals(listOf("bots"), desk.state.value.trail)
        val gone = StorageDesk(backgroundScope, FakeServer { 200 to answer }.api, listOf("bots", "Nobody"))
        gone.load()
        assertEquals(emptyList(), gone.state.value.trail, "a folder that is no longer there: the groups")
    }
}
