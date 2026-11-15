package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/** A project's Overview as both phones read and word it (OverviewDesk, Overviews). */
class OverviewDeskTest {
    private val overview = """{"projectId":"p1","at":"2026-11-15T09:00:00Z","work":[{"id":"w1","botId":"b1","name":"Coder","state":"working","text":"Writing the page"}],
        "blockers":[],"replies":[{"id":"r1","chatId":"c9","name":"Chief","state":"reply","text":""}]}"""

    @Test fun whatBotdotRecordedIsReadAndWorded() = runTest {
        val server = FakeServer { t -> if (t.path.contains("overview")) 200 to overview else 200 to """{"state":"on","files":[{"name":"a.md","path":"docs/a.md","at":0}]}""" }
        val desk = OverviewDesk(server.api, "p1")
        desk.read()
        val s = desk.state.value
        assertTrue(s.status.startsWith("Updated"), s.status)
        assertNull(s.problem)
        assertNull(s.filesLine, "there are files")
        val (work) = s.snapshot!!.work
        assertEquals("Working", Overviews.label(work.state))
        assertEquals("Writing the page", Overviews.text(work))
        assertEquals("Reply", Overviews.text(s.snapshot!!.replies.single()), "no words: its state")
        assertEquals(Overviews.Open.Bot("b1"), Overviews.open("bot/b1"))
        assertEquals(Overviews.Open.ChiefChat("c9"), Overviews.open("chief/c9"))
        assertEquals(Overviews.Open.Chief, Overviews.open(Spaces.CHIEF))
        assertEquals(Overviews.Open.Team("g1"), Overviews.open("group/g1"))
        assertEquals(Overviews.Open.ProjectChief, Overviews.open(Spaces.PROJECT_CHIEF + "p1"))
        assertNull(Overviews.open(null))
    }

    @Test fun aReadThatFailsKeepsWhatWasReadAndSaysSo() = runTest {
        var fail = false
        val server = FakeServer { t ->
            when {
                fail -> 503 to """{"error":"botdot is restarting"}"""
                t.path.contains("overview") -> 200 to overview
                else -> 200 to """{"state":"off","files":[]}"""
            }
        }
        val desk = OverviewDesk(server.api, "p1")
        desk.read()
        assertEquals("Files are unavailable while the computer is off.", desk.state.value.filesLine)
        fail = true
        desk.read()
        val s = desk.state.value
        assertEquals("p1", s.snapshot?.projectId, "the saved one stays")
        assertEquals("Couldn't refresh: botdot is restarting · Showing saved information", s.problem)
        assertTrue(s.filesProblem!!.endsWith("Showing saved information"))
        val fresh = OverviewDesk(server.api, "p1")
        fresh.read()
        assertEquals("Information unavailable", fresh.state.value.status)
        assertEquals("Information unavailable", fresh.state.value.filesLine)
    }
}
