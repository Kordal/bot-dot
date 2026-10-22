package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A bot's or the Chief's plan in the Android app (docs/api.md, "The plan"): what the server sends is read, how far a
 * plan is, which plan the dock above the message box shows, and what the owner folded and dismissed. The web page's
 * side is `test/plan-web.test.js`.
 */
class PlanTest {
    private fun obj(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject
    private fun run(json: String) = Api.JSON.decodeFromString(Run.serializer(), json)
    private fun chat(json: String) = Api.JSON.decodeFromString(ChiefChat.serializer(), json)
    private val plan = """{"steps":[{"text":"Read the prices","status":"done"},{"text":"Fetch the pages","status":"doing","doing":"Fetching the pages"},{"text":"Write the report","status":"todo"}]}"""

    @Test
    fun aRunCarriesItsPlanAndAStreamEventChangesIt() {
        val r = run("""{"id":"r1","status":"running","plan":$plan}""")
        val p = r.plan!!
        assertEquals(listOf("done", "doing", "todo"), p.steps.map { it.status })
        assertEquals("Fetching the pages", p.steps[1].doing)
        assertEquals(1, p.done)
        assertEquals(3, p.total)
        assertEquals(2, p.step)
        assertEquals(1, p.left)
        assertNull(run("""{"id":"r2","status":"running"}""").plan)
        val ev = RunEvent.of(obj("""{"type":"plan","plan":$plan}""")) as RunEvent.Planned
        assertEquals(3, ev.plan?.total)
        assertNull("a plan that was cleared", (RunEvent.of(obj("""{"type":"plan","plan":null}""")) as RunEvent.Planned).plan)
    }

    @Test
    fun whatIsNotAStepIsLeftOut() {
        val p = Plan.of(obj("""{"steps":[{"text":""},{"text":5},{"text":"Look","status":"weird","doing":"x"},"no"]}"""))!!
        assertEquals(listOf(Plan.Step("Look", "todo")), p.steps)
        assertNull(Plan.of(obj("""{"steps":[]}""")))
        assertNull(Plan.of(null))
    }

    @Test
    fun theDockShowsTheRunAtWorkElseTheNewestRunThatWasStopped() {
        val working = run("""{"id":"r2","status":"running","plan":$plan}""")
        val stopped = run("""{"id":"r1","status":"stopped","plan":$plan}""")
        val none = { _: String -> false }
        assertEquals(PlanView(working.plan!!, stopped = false, id = "r2"), PlanView.ofBot(listOf(working, stopped), none))
        assertNull("a run at work without a plan: nothing", PlanView.ofBot(listOf(run("""{"id":"r3","status":"running"}"""), stopped), none))
        assertEquals(PlanView(stopped.plan!!, stopped = true, id = "r1"), PlanView.ofBot(listOf(stopped), none))
        assertNull("dismissed", PlanView.ofBot(listOf(stopped), { it == "r1" }))
        assertNull("a reply that is done carries its plan itself", PlanView.ofBot(listOf(run("""{"id":"r1","status":"success","plan":$plan}""")), none))
        val allDone = """{"steps":[{"text":"a","status":"done"}]}"""
        assertNull("every step was done", PlanView.ofBot(listOf(run("""{"id":"r1","status":"error","plan":$allDone}""")), none))
    }

    @Test
    fun theChiefsDockShowsItsPendingReplyElseAStoppedOne() {
        val pending = chat("""{"id":"c1","messages":[{"role":"user","text":"Hi"},{"role":"chief","pending":true,"at":"t1","plan":$plan}]}""")
        val view = PlanView.ofChief("c1", pending.messages) { false }!!
        assertFalse(view.stopped)
        assertEquals("chief:c1:t1", view.id)
        val stopped = chat("""{"id":"c1","messages":[{"role":"chief","at":"t1","error":"You stopped it.","plan":$plan}]}""")
        assertTrue(PlanView.ofChief("c1", stopped.messages) { false }!!.stopped)
        assertNull(PlanView.ofChief("c1", stopped.messages) { it == "chief:c1:t1" })
        val done = chat("""{"id":"c1","messages":[{"role":"chief","at":"t1","text":"Done","plan":$plan}]}""")
        assertNull(PlanView.ofChief("c1", done.messages) { false })
    }

    @Test
    fun theFoldAndTheDismissalsAreKept() {
        val kept = mutableMapOf<String, String>()
        val keep = object : PlanMemory.Keep {
            override fun read(key: String) = kept[key]
            override fun write(key: String, value: String) { kept[key] = value }
        }
        val m = PlanMemory(keep)
        assertTrue("a phone starts folded", m.folded("bot:a"))
        m.setFolded("bot:a", false)
        m.dismiss("r1")
        val again = PlanMemory(keep)
        assertFalse(again.folded("bot:a"))
        assertTrue(again.folded("bot:b"))
        assertTrue(again.dismissed("r1"))
        assertFalse(again.dismissed("r2"))
    }
}
