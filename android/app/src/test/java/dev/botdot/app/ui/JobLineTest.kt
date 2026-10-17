package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.Job
import dev.botdot.app.data.JobLast
import dev.botdot.app.data.RunNow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The line under a job, what "Run now" says, and a tile that asks a busy bot (`job-line`, `message-waits`; "The
 * contract" of BUSY-004 and BUSY-001). The server writes the job's line; the app draws it.
 */
class JobLineTest {
    private fun last(json: String): JobLast = Api.JSON.decodeFromString(Job.serializer(), """{"id":"j1","name":"Disk check","last":$json}""").last!!

    @Test fun theServersLineIsDrawnAsItIs() {
        for (text in listOf(
            "Last run at 14:00: done.",
            "Last run at 02:00: held till morning.",
            "Last run at 14:00: failed, 5 times in a row since 02:00. Something went wrong and I couldn't finish.",
            "Did not run at 08:00: botdot was off.",
            "Did not run at 02:00: its last run was still going.",
            "Did not run at 09:15: Fleet Doctor had 10 things waiting.",
            "Did not run at 09:15: Claude was signed out.",
        )) assertEquals(text, jobLine(last("""{"status":"error","at":"2026-10-06T12:00:00.000Z","text":"$text"}"""), "14:02"))
    }

    @Test fun withoutItTheAppWritesItsOwnLineAsBefore() {
        fun own(status: String) = jobLine(last("""{"status":"$status","at":"2026-10-06T12:00:00.000Z"}"""), "14:00")
        assertEquals("Last run 14:00: done", own("success"))
        assertEquals("Last run 14:00: nothing to report", own("quiet"))
        assertEquals("Last run 14:00: failed", own("error"))
        assertEquals("Last run 14:00: stopped", own("stopped"))
        assertEquals("Last run 14:00: cut off", own("interrupted"))
        assertEquals("Last run 14:00: held till morning", own("held"))
        assertEquals("a status this app has no word for", "Last run 14:00: missed", own("missed"))
        // A `text` that is no words is none.
        for (odd in listOf("\"\"", "\"  \"", "true", "7", "null", "[\"x\"]")) {
            val l = last("""{"status":"success","text":$odd}""")
            assertNull(odd, l.text)
            assertEquals(odd, "Last run 14:00: done", jobLine(l, "14:00"))
        }
    }

    @Test fun aFailingAndAMissedJobAreMarked() {
        assertEquals(JobTone.FAILED, jobLineTone(last("""{"status":"error","failures":5,"since":"2026-10-06T00:00:00.000Z","text":"Last run at 14:00: failed, 5 times in a row since 02:00."}""")))
        assertEquals(5, last("""{"status":"error","failures":5}""").failures)
        assertEquals(JobTone.FAILED, jobLineTone(last("""{"status":"error"}""")))
        assertEquals(JobTone.MISSED, jobLineTone(last("""{"status":"missed","at":"2026-10-06T06:00:00.000Z","text":"Did not run at 08:00: botdot was off."}""")))
        assertEquals(JobTone.FINE, jobLineTone(last("""{"status":"success"}""")))
        assertEquals(JobTone.FINE, jobLineTone(last("""{"status":"held","text":"Last run at 02:00: held till morning."}""")))
        // A count that is no number is none.
        assertEquals(0, last("""{"status":"success","failures":"many"}""").failures)
    }

    @Test fun runNowSaysWhatHappened() {
        assertEquals("Started", runNowSays(RunNow.of("""{"started":"ai","run":{"id":"r1"}}""")))
        assertEquals("Started", runNowSays(RunNow.of("""{"started":"script"}""")))
        assertEquals("It will run as soon as the bot is free", runNowSays(RunNow.of("""{"queued":true}""")))
        assertEquals("Its script is still running.", runNowSays(RunNow.of("""{"skipped":"Its script is still running."}""")))
        // An answer this app cannot read is a job that started, as before; `queued` must be true.
        assertEquals("Started", runNowSays(RunNow.of("")))
        assertEquals("Started", runNowSays(RunNow.of("""{"queued":"true","skipped":""}""")))
    }

    @Test fun aTileThatAsksABusyBotSaysSo() {
        assertEquals("Asked Home Keeper", tileAsked("Home Keeper", queued = false))
        assertEquals("Home Keeper will do it when it is free", tileAsked("Home Keeper", queued = true))
        assertEquals("Asked its bot", tileAsked(null, queued = false))
        assertEquals("Its bot will do it when it is free", tileAsked(null, queued = true))
    }
}
