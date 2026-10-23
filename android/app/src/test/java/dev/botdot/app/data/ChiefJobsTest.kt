package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Chief's own jobs (#408) in its settings: shown from a server that has them, with when they run, and their list from the feed. */
class ChiefJobsTest {
    private fun event(type: String, body: String) = FeedEvent("1", type, Api.JSON.decodeFromString(body))

    @Test fun shownOnlyFromAServerThatHasThem() {
        assertTrue(ChiefJobs.shows(listOf("chief", "chief-jobs")))
        assertFalse(ChiefJobs.shows(listOf("chief")))
        assertFalse(ChiefJobs.shows(null))
    }

    @Test fun aJobSaysWhenItRunsAndWhenItIsPaused() {
        val list = Api.JSON.decodeFromString<ChiefJobList>("""{"jobs":[{"id":"cj1","name":"News","task":"x","cron":"0 8 * * 1-5","on":true,"when":"Every weekday at 08:00","lastRunAt":null,"extra":1},{"id":"cj2","name":"Once","task":"y","at":"2026-11-01T08:00:00.000Z","on":false,"when":"Once, 1 Nov 2026"}]}""").jobs
        assertEquals("Every weekday at 08:00", ChiefJobs.line(list[0]))
        assertEquals("Once, 1 Nov 2026 · paused", ChiefJobs.line(list[1]))
        assertEquals("2026-11-01T08:00:00.000Z", list[1].at)
    }

    @Test fun theFeedCarriesTheWholeList() {
        assertEquals(listOf("cj1"), ChiefJobs.event(event("chief_jobs", """{"jobs":[{"id":"cj1","name":"News","when":"Every day at 08:00"}]}"""))?.map { it.id })
        assertEquals(emptyList<ChiefJob>(), ChiefJobs.event(event("chief_jobs", """{"jobs":[]}""")))
        assertNull(ChiefJobs.event(event("chief_reply", """{"jobs":[]}""")))
        assertNull(ChiefJobs.event(event("chief_jobs", """{"jobs":"nope"}""")))
    }
}
