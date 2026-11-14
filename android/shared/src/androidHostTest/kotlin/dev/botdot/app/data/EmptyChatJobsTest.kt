package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** An empty chat (#727): the jobs it offers as chips under the message box, as the web page does. */
class EmptyChatJobsTest {
    @Test fun aBotWithJobsOffersItsApprovedJobsThatAreOn() {
        val jobs = listOf(
            Job("j1", "Morning summary"),
            Job("j2", "Waits for OK", approved = false),
            Job("j3", "Paused", enabled = false),
            Job("j4", "Sort mail"),
        )
        assertEquals(listOf("j1" to "Morning summary", "j4" to "Sort mail"), EmptyChatJobs.botJobs(jobs))
    }

    @Test fun aBotWithoutJobsOffersNone() {
        assertEquals(emptyList<Pair<String, String>>(), EmptyChatJobs.botJobs(emptyList()))
    }

    @Test fun theChiefOffersItsOwnJobsThatAreOn() {
        val jobs = listOf(ChiefJob("cj1", "News"), ChiefJob("cj2", "Off", on = false))
        assertEquals(listOf("cj1" to "News"), EmptyChatJobs.chiefJobs(jobs))
    }
}
