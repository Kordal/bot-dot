package dev.botdot.app.data

import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A bot's live runs above its message box (#501), as `test/live-runs-web.test.js` checks the web page's. */
class LiveRunsTest {
    private fun run(id: String, botId: String = "b1", status: String = "running", kind: String? = "ai", btw: Boolean = false) =
        Run(id = id, botId = botId, status = status, kind = kind, btw = btw, startedAt = "2026-10-23T10:0${id.last()}:00Z", prompt = "Task $id", customPrompt = true)
    private fun row(id: String) = LiveRuns.Row(id, id, "", false, "2026-10-23T10:0${id.last()}:00Z")
    private fun List<LiveRuns.Row>.marks() = map { Triple(it.id, it.done, it.gone) }

    @Test fun theRunsListedAreThoseGoingNotASideQuestionOrAScriptOldestFirst() {
        val runs = listOf(run("r3"), run("r1"), run("r2", btw = true), run("r4", kind = "script"), run("r5", status = "success"), run("r6", botId = "b2"))
        assertEquals(listOf("r1", "r3"), LiveRuns.listed(runs, "b1").map { it.id })
    }

    @Test fun whatARunWasAskedIsOneLine() {
        assertEquals("Morning check", LiveRuns.ask(Run(id = "a", jobName = "Morning check", prompt = "x", customPrompt = true)))
        assertEquals("Main assignment", LiveRuns.ask(Run(id = "a", prompt = "the whole assignment", customPrompt = false)))
        assertEquals("Go on with it", LiveRuns.ask(Run(id = "a", prompt = "Go on with it", customPrompt = false, continuesValue = JsonPrimitive("r0"))))
        assertEquals("Fix the alias", LiveRuns.ask(Run(id = "a", prompt = "  Fix the alias\nand then the tests", customPrompt = true)))
        assertEquals("Scheduled run", LiveRuns.ask(Run(id = "a", customPrompt = true, trigger = "schedule")))
        assertEquals("Working", LiveRuns.ask(Run(id = "a", customPrompt = true)))
    }

    @Test fun whatARowSaysUnderItsAsk() {
        assertEquals("Using github_mcp", LiveRuns.Row("r1", "A", "Using github_mcp", false, "").doing)
        assertEquals("Working", LiveRuns.Row("r1", "A", " ", false, "").doing)
        assertEquals(OpeningLine.WAITING_FOR_OK, LiveRuns.Row("r1", "A", "x", true, "").doing)
        assertEquals("Done", LiveRuns.Row("r1", "A", "x", false, "", done = true).doing)
    }

    @Test fun aRunThatEndsShowsDoneThenFoldsThenLeaves() {
        val k = LiveRuns.Keeper()
        assertTrue("one run: no card", k.rows(listOf(row("r1")), 0).isEmpty())
        assertEquals(listOf("r1", "r2"), k.rows(listOf(row("r1"), row("r2")), 0).map { it.id })
        assertEquals(listOf(Triple("r1", true, false), Triple("r2", false, false)), k.rows(listOf(row("r2")), 100).marks())
        assertEquals(LiveRuns.DONE, k.next(100))
        assertEquals(listOf(Triple("r1", true, true), Triple("r2", false, false)), k.rows(listOf(row("r2")), 100 + LiveRuns.DONE).marks())
        assertEquals(LiveRuns.GONE, k.next(100 + LiveRuns.DONE))
        assertTrue("one left: the status line takes over", k.rows(listOf(row("r2")), 100 + LiveRuns.DONE + LiveRuns.GONE).isEmpty())
        assertNull(k.next(100 + LiveRuns.DONE + LiveRuns.GONE))
    }

    @Test fun threeRunsTwoEndAtOnce() {
        val k = LiveRuns.Keeper()
        k.rows(listOf(row("r1"), row("r2"), row("r3")), 0)
        assertEquals(listOf(Triple("r1", true, false), Triple("r2", true, false), Triple("r3", false, false)), k.rows(listOf(row("r3")), 0).marks())
        assertTrue(k.rows(listOf(row("r3")), LiveRuns.DONE + LiveRuns.GONE).isEmpty())
    }

    @Test fun aRunThatEndsWhileTheCardIsNotDrawnLeavesNoRow() {
        val k = LiveRuns.Keeper()
        k.rows(listOf(row("r1")), 0)
        assertTrue(k.rows(emptyList(), 0).isEmpty())
        assertEquals(listOf("r2", "r3"), k.rows(listOf(row("r2"), row("r3")), 0).map { it.id })
    }

    @Test fun theLinesAreKeptPerRun() {
        val lines = OpeningLines()
        lines.say("bot:b1", "Using github_mcp", "r1")
        lines.say("bot:b1", "Reading logs", "r2")
        lines.say("chief:c1", "Looking", null)
        assertEquals(mapOf("r1" to "Using github_mcp", "r2" to "Reading logs"), lines.runLines.value)
        lines.waiting("bot:b1", "r2", true)
        assertEquals(setOf("r2"), lines.heldRuns.value)
        lines.end("bot:b1", "r2")
        assertEquals(mapOf("r1" to "Using github_mcp"), lines.runLines.value)
        assertEquals(emptySet<String>(), lines.heldRuns.value)
    }
}
