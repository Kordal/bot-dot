package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the app reads of a change that waits beside an approved job or tile, of the words on a card's buttons and of
 * the server's answer (`staged-changes`, `decline-words`, `proposal-carries-on`: "The contract" of SURE-001 and
 * SURE-002, docs/api.md). Each is kept as it came: a field of a kind this app does not expect leaves the rest readable.
 */
class StagedChangeTest {
    private fun job(json: String): Job = Api.JSON.decodeFromString(json)
    private fun tile(json: String): Tile = Api.JSON.decodeFromString(json)

    private val news = """{"id":"j1","name":"Morning news","kind":"ai","when":"Daily at 08:00","approved":true,"prompt":"Three stories.",
        "change":{"name":"Morning news","kind":"ai","when":"Daily at 07:00","prompt":"Five stories.","script":"","notify":"always","aiWhen":null,"by":"bot","at":"2026-10-06T08:00:00Z"},
        "no":"Keep as it is","yes":"Approve the change","then":{"who":"bot","text":"News Watcher carries on when you approve it."}}"""

    @Test fun aJobWithAChangeStaysApprovedAndWaits() {
        val j = job(news)
        assertTrue(j.approved)
        assertTrue("it waits for the owner like a job never approved", j.waits)
        assertEquals(JobChange(name = "Morning news", kind = "ai", words = "Daily at 07:00", prompt = "Five stories.", script = "", by = "bot", notify = "always", at = "2026-10-06T08:00:00Z"), j.change)
        assertEquals("Keep as it is", j.no)
        assertEquals("Approve the change", j.yes)
        assertEquals("News Watcher carries on when you approve it.", j.then?.line())
        assertEquals("the change says who asked for it", "bot", j.askedBy)
    }

    @Test fun aJobBeforeItsFirstOkHasTheServersNo() {
        val j = job("""{"id":"j2","name":"Disk check","kind":"script","approved":false,"changedBy":"chief","no":"Decline and remove"}""")
        assertTrue(j.waits)
        assertNull(j.change)
        assertEquals("Decline and remove", j.no)
        assertNull(j.yes)
        assertEquals("chief", j.askedBy)
    }

    @Test fun aServerWithoutTheFieldsIsReadAsBefore() {
        val waiting = job("""{"id":"j2","name":"Disk check","approved":false}""")
        assertTrue(waiting.waits)
        assertNull(waiting.no); assertNull(waiting.yes); assertNull(waiting.change); assertNull(waiting.then)
        val approved = job("""{"id":"j3","name":"Morning news","approved":true}""")
        assertFalse(approved.waits)
    }

    @Test fun fieldsOfAnotherKindLeaveTheJobReadable() {
        for (odd in listOf("true", "7", "\"soon\"", "[1]", "null")) {
            val j = job("""{"id":"j1","name":"Morning news","approved":true,"change":$odd,"no":$odd,"yes":[],"then":$odd}""")
            assertEquals(odd, "Morning news", j.name)
            assertNull(odd, j.change)
            assertFalse(odd, j.waits)
            assertNull(odd, j.yes)
            assertNull(odd, j.then)
        }
        // A change whose fields are not text: it waits, and each such field reads as unchanged.
        val j = job("""{"id":"j1","approved":true,"change":{"when":7,"prompt":["a"],"script":null,"by":true}}""")
        assertEquals(JobChange(), j.change)
        assertTrue(j.waits)
    }

    @Test fun whichWaitingJobsAYesApprovesAScriptFor() {
        assertFalse(job(news).touchesScript)
        assertTrue("a script job", job("""{"id":"j","kind":"script","approved":false,"script":"df -h"}""").touchesScript)
        assertTrue("a script job whose time changes", job("""{"id":"j","kind":"script","approved":true,"script":"df -h","change":{"when":"Hourly"}}""").touchesScript)
        assertTrue("an AI job that becomes a script", job("""{"id":"j","kind":"ai","approved":true,"change":{"kind":"script","script":"df -h"}}""").touchesScript)
        assertTrue("a change that carries a script", job("""{"id":"j","kind":"ai","approved":true,"change":{"script":"df -h"}}""").touchesScript)
        assertFalse("an AI job never approved", job("""{"id":"j","kind":"ai","approved":false}""").touchesScript)
    }

    @Test fun aTileWithAChangeStaysApprovedAndIsListedOnceAmongWhatWaits() {
        val lights = """{"id":"t1","title":"Lights","bot":"b1","approved":true,"scripts":["hue on"],
            "change":{"title":"Lights","scripts":["hue on --dim"],"changedBy":"bot"},"no":"Keep as it is","yes":"Approve the change"}"""
        val t = tile(lights)
        assertEquals(TileChange("Lights", listOf("hue on --dim"), "bot"), t.change)
        assertEquals("when it was proposed", "2026-10-07T08:00:00.000Z", tile("""{"id":"t1","approved":true,"change":{"scripts":["x"],"at":"2026-10-07T08:00:00.000Z"}}""").change?.at)
        for (odd in listOf("7", "null", "{}")) assertNull(odd, tile("""{"id":"t1","approved":true,"change":{"scripts":["x"],"at":$odd}}""").change?.at)
        assertEquals("Keep as it is", t.no)
        assertEquals("Approve the change", t.yes)
        assertEquals("bot", t.askedBy)
        assertEquals("the approved scripts stay the tile's own", listOf("hue on"), t.scripts)
        assertNull("a change that lists no scripts lists none: its card shows none as proposed", tile("""{"id":"t1","approved":true,"change":{"title":"Lamps"}}""").change?.scripts)

        val fresh = tile("""{"id":"t2","title":"Disk","approved":false,"changedBy":"chief","scripts":["df -h"],"no":"Decline and remove"}""")
        assertEquals("Decline and remove", fresh.no)
        assertNull(fresh.change)
        // Among the Board's tiles, among its waiting ones, or in both: each waits once.
        assertEquals(listOf("t2", "t1"), Dashboard(tiles = listOf(t, tile("""{"id":"t3","title":"Clock"}""")), pending = listOf(fresh)).waiting.map { it.id })
        assertEquals(listOf("t2", "t1"), Dashboard(tiles = listOf(t), pending = listOf(fresh, t)).waiting.map { it.id })
        assertEquals("a server without changes: the tiles that wait, as before", listOf("t2"), Dashboard(tiles = listOf(tile("""{"id":"t3"}""")), pending = listOf(fresh)).waiting.map { it.id })
    }

    @Test fun aSuggestedTileSaysWhoCarriesOn() {
        val x: TileSuggestion = Api.JSON.decodeFromString("""{"id":"s1","bot":"b1","tile":{"title":"Flight price"},"then":{"who":"bot","text":"Web Surfer carries on when you add it."}}""")
        assertEquals("Web Surfer carries on when you add it.", x.then?.line())
        assertNull(Api.JSON.decodeFromString<TileSuggestion>("""{"id":"s1","tile":{"title":"Flight price"}}""").then)
        assertNull(Api.JSON.decodeFromString<TileSuggestion>("""{"id":"s1","then":"soon"}""").then)
    }

    @Test fun theAnswerSaysWhatTheCardReadsAfterIt() {
        assertEquals(Answered("Declined and removed"), Answered.of("""{"ok":true,"removed":true,"text":"Declined and removed"}"""))
        assertEquals(Answered("Kept as it was: Daily at 08:00", kept = true), Answered.of("""{"ok":true,"kept":true,"text":"Kept as it was: Daily at 08:00"}"""))
        assertEquals(Answered("Changed: Daily at 07:00", carriesOn = CarriesOn("it carries on")),
            Answered.of("""{"id":"j1","approved":true,"text":"Changed: Daily at 07:00","carriesOn":{"who":"bot","text":"it carries on"}}"""))
        // A server from before, an answer without a body, and fields of another kind: the answer went, and says nothing.
        for (body in listOf("""{"ok":true,"removed":true}""", """{"id":"j1","approved":true}""", "", "not json", """{"text":7,"kept":"true","carriesOn":"yes"}""", "[]")) {
            assertEquals(body, Answered(), Answered.of(body))
        }
    }

    @Test fun whatWaitsSaysAChangeIsAChange() {
        val bot = Bot(id = "b1", name = "News Watcher", jobs = listOf(job(news), job("""{"id":"j2","name":"Disk check","approved":false}"""), job("""{"id":"j3","approved":true}""")))
        val lights = tile("""{"id":"t1","title":"Lights","bot":"b1","approved":true,"change":{"scripts":["hue on --dim"]}}""")
        val waiting = waitingOf(listOf(bot), null, null, Dashboard(tiles = listOf(lights), pending = listOf(tile("""{"id":"t2","title":"Disk","bot":"b1","approved":false}"""))))
        assertEquals(
            listOf(
                "News Watcher: a change to a job waits for your OK",
                "News Watcher: a job waits for your OK",
                "News Watcher: “Disk” on the Board waits for your OK",
                "News Watcher: a change to “Lights” on the Board waits for your OK",
            ),
            waiting.map { it.text },
        )
    }

    @Test fun aRunThatAsksAndAnApprovalEventAreNotAChange() {
        // The feed's waiting entry of a change says `change: true`: that is its notification's (NeedWordsTest), not a job's.
        assertNull(JobChange.of(Json.parseToJsonElement("""{"change":true}""").jsonObject["change"]))
    }
}
