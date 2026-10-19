package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.Job
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A job that takes signed calls (`job-call-signed`, #37): read from the job, said under it, never edited in the app. */
class JobCallModeTest {
    private fun job(json: String): Job = Api.JSON.decodeFromString(Job.serializer(), json)

    @Test fun aSignedCallIsSaidUnderTheJob() {
        val j = job("""{"id":"j1","name":"Gate","call":true,"callMode":"signed"}""")
        assertEquals("Takes signed calls: each one is signed with the secret in the Vault, and runs once.", callModeLine(j))
    }

    @Test fun aKeyedCallAJobWithoutCallsAndAnOlderServerSayNothing() {
        assertNull(callModeLine(job("""{"id":"j1","name":"Gate","call":true}""")))
        assertNull(callModeLine(job("""{"id":"j1","name":"Gate","call":false,"callMode":"signed"}""")))
        assertNull(callModeLine(job("""{"id":"j1","name":"Gate"}""")))
    }
}
