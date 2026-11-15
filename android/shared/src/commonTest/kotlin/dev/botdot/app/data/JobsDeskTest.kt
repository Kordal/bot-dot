package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

/** A bot's scheduled jobs (JobsDesk), as both phones draw them and as the switch and Run now talk to botdot. */
class JobsDeskTest {
    private val bot = """{"id":"b1","name":"Scout","jobs":[
        {"id":"j1","name":"News","when":"Every day at 08:00","enabled":true,"approved":true,"nextRunAt":"2026-11-16T08:00:00Z",
         "last":{"status":"error","at":"2026-11-15T08:00:00Z","failures":2}},
        {"id":"j2","name":"Tidy","kind":"script","when":"Hourly","enabled":false,"approved":true},
        {"id":"j3","name":"Mail","when":"Weekly","approved":false,"last":{"status":"missed","at":"2026-11-10T08:00:00Z","text":"Did not run at 08:00: botdot was off."}}]}"""

    @Test fun eachJobSaysItsScheduleStatusAndLastRun() = runTest {
        val server = FakeServer { 200 to "[$bot]" }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        store.bots.set(listOf(Api.JSON.decodeFromString(Bot.serializer(), bot)))
        val desk = JobsDesk(backgroundScope, server.api, store, "b1") { "T" }
        runCurrent()
        val (news, tidy, mail) = desk.state.value.jobs!!
        assertEquals("Every day at 08:00 · Next: T", news.line)
        assertEquals("Last run T: failed", news.last)
        assertEquals(Jobs.Tone.FAILED, news.tone)
        assertTrue(tidy.script && !tidy.enabled)
        assertEquals("Hourly · Paused", tidy.line)
        assertTrue(mail.waits && !mail.approved)
        assertEquals("Weekly · Waits for your OK", mail.line)
        assertEquals("Did not run at 08:00: botdot was off.", mail.last, "the server's own line as it is")
        assertEquals(Jobs.Tone.MISSED, mail.tone)
        assertNull(desk.state.value.empty)
    }

    @Test fun theSwitchPausesAtOnceAndRunNowSaysWhatBotdotDid() = runTest {
        val server = FakeServer { t ->
            when {
                t.method == "PUT" && t.path == "/api/bots/b1/jobs/j1" -> 200 to """{"id":"j1","enabled":false}"""
                t.method == "POST" && t.path == "/api/bots/b1/jobs/j1/run" -> 200 to """{"queued":true}"""
                t.method == "POST" && t.path == "/api/bots/b1/jobs/j2/run" -> 409 to """{"error":"It is paused"}"""
                else -> 200 to "[$bot]"
            }
        }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        store.bots.set(listOf(Api.JSON.decodeFromString(Bot.serializer(), bot)))
        val desk = JobsDesk(backgroundScope, server.api, store, "b1") { "T" }
        assertEquals("Paused. It won't run until you turn it back on.", desk.setOn("j1", false))
        assertTrue(server.posts().any { it.method == "PUT" && "\"enabled\":false" in it.body })
        assertEquals("It will run as soon as the bot is free", desk.run("j1"))
        assertEquals("It is paused", desk.run("j2"), "botdot's words")
    }

    @Test fun aBotWithoutJobsSaysHowToGetOne() = runTest {
        val server = FakeServer { 200 to "[]" }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        store.bots.set(listOf(Api.JSON.decodeFromString(Bot.serializer(), """{"id":"b1","name":"Scout"}""")))
        val desk = JobsDesk(backgroundScope, server.api, store, "b1")
        runCurrent()
        assertTrue(desk.state.value.jobs!!.isEmpty())
        assertTrue(desk.state.value.empty!!.startsWith("Scout has no scheduled jobs."))
        assertFalse(JobsDesk(backgroundScope, server.api, store, "gone").state.value.jobs != null, "a bot the list doesn't know: nothing yet")
    }

    @Test fun turningAdvancedOnShowsHowAJobTakesCallsAndStopFollowsNothingMore() = runTest {
        val job = """{"id":"b1","name":"Scout","jobs":[{"id":"j1","name":"Hook","call":true,"callMode":"signed","notifyUrl":"https://hooks.example.test/x"}]}"""
        val server = FakeServer { 200 to "[$job]" }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        store.bots.set(listOf(Api.JSON.decodeFromString(Bot.serializer(), job)))
        try {
            Advanced.take(listOf(Advanced.FEATURE), AppSettings(advanced = false))
            val desk = JobsDesk(backgroundScope, server.api, store, "b1") { "T" }
            runCurrent()
            assertTrue(desk.state.value.jobs!!.single().advanced.isEmpty(), "Advanced off: none")
            Advanced.take(listOf(Advanced.FEATURE), AppSettings(advanced = true))
            runCurrent()
            assertEquals(2, desk.state.value.jobs!!.single().advanced.size, "drawn again with Advanced on")
            desk.stop()
            Advanced.take(listOf(Advanced.FEATURE), AppSettings(advanced = false))
            runCurrent()
            assertEquals(2, desk.state.value.jobs!!.single().advanced.size, "stopped: it follows nothing more")
        } finally {
            Advanced.take(null, null)
        }
    }

    @Test fun aPauseThatDidNotGoPutsTheSwitchBackEvenOffline() = runTest {
        val server = FakeServer { t -> if (t.method == "PUT") 503 to """{"error":"botdot is busy"}""" else 503 to """{"error":"offline"}""" }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        store.bots.set(listOf(Api.JSON.decodeFromString(Bot.serializer(), bot)))
        val desk = JobsDesk(backgroundScope, server.api, store, "b1") { "T" }
        runCurrent()
        assertTrue(desk.state.value.jobs!!.first().enabled)
        assertEquals("botdot is busy", desk.setOn("j1", false))
        runCurrent()
        val news = desk.state.value.jobs!!.first()
        assertTrue(news.enabled, "put back as it was, the bots not read again")
        assertEquals("Every day at 08:00 · Next: T", news.line)
    }
}
