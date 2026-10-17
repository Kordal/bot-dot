package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Job
import dev.botdot.app.data.MemoryChange
import dev.botdot.app.data.Tile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * "Approve all" approves no script (Milestone 8, C1 and C2): it approves the waiting AI jobs and shared-memory
 * changes, counts them on its label, and names what it leaves in one line. `test/` holds the web page's side (SURE-003).
 */
class ApproveAllTest {
    private fun job(json: String): Job = Api.JSON.decodeFromString(json)
    private val news = Bot(id = "news", name = "News Watcher")
    private val doctor = Bot(id = "doctor", name = "Fleet Doctor")
    private val morning = news to job("""{"id":"j1","name":"Morning news","kind":"ai","approved":false}""")
    private val price = news to job("""{"id":"j2","name":"Price watch","kind":"ai","approved":false}""")
    private val disk = doctor to job("""{"id":"j3","name":"Disk check","kind":"script","approved":false,"script":"df -h"}""")
    private val note = MemoryChange(id = "m1", text = "The owner flies from Brussels.")

    @Test fun itApprovesWhatACardShowsInWordsAndLeavesTheScript() {
        val all = approveAll(listOf(morning, price, disk), listOf(note), emptyList())
        assertEquals("Approve 3", all.label)
        assertEquals(listOf("j1", "j2"), all.jobs.map { it.second.id })
        assertEquals(listOf("m1"), all.memory.map { it.id })
        assertEquals("Disk check runs a script: approve it on its card.", all.line)
    }

    @Test fun aChangeThatTouchesAScriptIsLeftOutTheSameWay() {
        val retimed = doctor to job("""{"id":"j4","name":"Backup","kind":"script","approved":true,"script":"tar c /srv","change":{"when":"Hourly"}}""")
        val becomes = news to job("""{"id":"j5","name":"Feeds","kind":"ai","approved":true,"change":{"kind":"script","script":"curl example.org"}}""")
        val words = news to job("""{"id":"j6","name":"Evening news","kind":"ai","approved":true,"prompt":"Three.","change":{"prompt":"Five."}}""")
        val all = approveAll(listOf(morning, retimed, becomes, words), emptyList(), emptyList())
        assertEquals("a change of words is approved like a new AI job", listOf("j1", "j6"), all.jobs.map { it.second.id })
        assertEquals("Approve 2", all.label)
        assertEquals("Backup and Feeds run scripts: approve them on their cards.", all.line)
    }

    @Test fun aTileIsNeverApprovedByIt() {
        val all = approveAll(listOf(morning, price, disk), emptyList(), listOf(Tile(id = "t1", title = "Lights"), Tile(id = "t2", title = "Disk")))
        assertEquals("Approve 2", all.label)
        assertEquals("Disk check, “Lights” and “Disk” run scripts: approve them on their cards.", all.line)
    }

    @Test fun withFewerThanTwoToApproveThereIsNoButtonAndNoLine() {
        // Only scripts wait (C2), one thing and a script, one thing alone, nothing.
        for (waits in listOf(listOf(disk, disk), listOf(morning, disk), listOf(morning), emptyList())) {
            val all = approveAll(waits, emptyList(), listOf(Tile(id = "t1", title = "Lights")))
            assertNull(all.label)
            assertNull(all.line)
        }
        val one = approveAll(emptyList(), listOf(note), emptyList())
        assertNull(one.label)
    }

    // A guarded change, as `GET /api/memory/pending?guarded=1` lists it (docs/api.md, "A guarded change").
    private fun guarded(id: String, action: String = "edit"): MemoryChange = Api.JSON.decodeFromString("""{"id":"$id","action":"$action","text":"Use npm.","guarded":true,"title":"Change what you said","yes":"Change it","no":"Keep it"}""")

    @Test fun aGuardedChangeIsNeitherTakenNorCounted() {
        val all = approveAll(listOf(morning, price, disk), listOf(note, guarded("g1"), guarded("g2", "erase")), emptyList())
        assertEquals("Approve 3", all.label)
        assertEquals(listOf("m1"), all.memory.map { it.id })
        assertEquals("no line names it: its card says what it is", "Disk check runs a script: approve it on its card.", all.line)
        // One job and two guarded changes: one thing to approve, so no button.
        assertNull(approveAll(listOf(morning), listOf(guarded("g1"), guarded("g2")), emptyList()).label)
    }

    @Test fun withOnlyGuardedChangesAndScriptsThereIsNoApproveAll() {
        val all = approveAll(listOf(disk, disk), listOf(guarded("g1"), guarded("g2", "remove"), guarded("g3", "erase")), listOf(Tile(id = "t1", title = "Lights")))
        assertNull(all.label)
        assertNull(all.line)
        assertEquals(emptyList<MemoryChange>(), all.memory)
        assertNull(approveAll(emptyList(), listOf(guarded("g1"), guarded("g2")), emptyList()).label)
    }

    @Test fun withNothingLeftThereIsNoLine() {
        val all = approveAll(listOf(morning, price), listOf(note), emptyList())
        assertEquals("Approve 3", all.label)
        assertNull(all.line)
        assertNull(scriptsLeft(emptyList()))
    }
}
