package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A Chief chat's messages as the server sends them (docs/api.md): `error` is words in the Chief's own failed reply
 * and `true` in a bot's report that didn't finish. A chat with either one loads.
 */
class ChiefMessageTest {
    private fun chat(json: String) = Api.JSON.decodeFromString(ChiefChat.serializer(), json)

    @Test fun aChatWithAFailedReportLoadsAndTheReportIsFailed() {
        val c = chat("""{"id":"c1","messages":[
            {"role":"report","from":{"id":"b1","name":"News"},"text":"It timed out.","runId":"r1","error":true},
            {"role":"chief","text":"","error":"Claude stopped"},
            {"role":"chief","text":"A tip for you","unasked":true},
            {"role":"report","from":{"id":"b1","name":"News"},"text":"Done.","runId":"r2"}]}""")
        val (report, reply, tip, fine) = c.messages
        assertEquals("It timed out.", report.text)
        assertTrue(report.failed)
        assertNull(report.error) // no words: its text says why
        assertTrue(reply.failed)
        assertEquals("Claude stopped", reply.error)
        assertTrue(tip.unasked)
        assertFalse(tip.failed)
        assertNull(tip.error)
        assertFalse(fine.failed)
    }

    @Test fun aMessageAboutATeamLoadsItsTeamAndProject() {
        val (own, other, none) = chat("""{"id":"c1","messages":[
            {"role":"chief","text":"Prices are in.","about":{"team":{"id":"t1","name":"Strona","color":"#3b82f6"}}},
            {"role":"user","text":"49 and 55","about":{"team":{"id":"t1","name":"Strona"},"project":{"id":"p1","name":"Mug shop"}}},
            {"role":"chief","text":"Hi"}]}""").messages
        assertEquals("Strona", own.about?.team?.name)
        assertEquals("#3b82f6", own.about?.team?.color)
        assertNull(own.about?.project) // the project's own chat names no project
        assertEquals("Mug shop", other.about?.project?.name)
        assertNull(none.about)
    }

    @Test fun errorAsWordsLoadsAsBefore() {
        val m = chat("""{"id":"c1","messages":[{"role":"chief","text":"","error":"This reply was cut off because botdot was restarted."}]}""").messages.single()
        assertEquals("This reply was cut off because botdot was restarted.", m.error)
        assertTrue(m.failed)
    }

    @Test fun errorFalseOrNullIsNoError() {
        val (a, b) = chat("""{"id":"c1","messages":[{"role":"report","text":"Ok","error":false},{"role":"chief","text":"Hi","error":null}]}""").messages
        assertFalse(a.failed)
        assertFalse(b.failed)
        assertNull(a.error)
        assertNull(b.error)
    }
}
