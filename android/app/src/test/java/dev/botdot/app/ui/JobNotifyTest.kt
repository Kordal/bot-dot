package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.Job
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A job's notify address (`job-notify`, #37): read from the job, shown under it, never edited in the app. */
class JobNotifyTest {
    private fun job(json: String): Job = Api.JSON.decodeFromString(Job.serializer(), json)

    @Test fun theAddressIsReadAndSaidUnderTheJob() {
        val j = job("""{"id":"j1","name":"Gate","notifyUrl":"https://hooks.example.com/gate"}""")
        assertEquals("https://hooks.example.com/gate", j.notifyUrl)
        assertEquals("Tells https://hooks.example.com/gate when a run ends, signed with the secret in the Vault.", notifyLine(j.notifyUrl!!))
    }

    @Test fun aJobWithoutOneHasNone() {
        assertNull(job("""{"id":"j1","name":"Gate"}""").notifyUrl)
    }
}
