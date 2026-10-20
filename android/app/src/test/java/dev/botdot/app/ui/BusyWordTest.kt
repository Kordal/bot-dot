package dev.botdot.app.ui

import dev.botdot.app.data.Job
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BusyWordTest {
    // A pressed card button says its answer is on its way, in the web page's words (#129).
    @Test fun eachButtonSaysWhatItIsDoing() {
        assertEquals("Approving…", busyWord("Approve"))
        assertEquals("Approving…", busyWord("Always approve"))
        assertEquals("Allowing…", busyWord("Allow once"))
        assertEquals("Declining…", busyWord("Decline"))
        assertEquals("Saving…", busyWord("Save"))
        assertEquals("Installing…", busyWord("Install"))
        assertEquals("Turn it on…", busyWord("Turn it on"))
    }

    // The yes of a card that makes a webhook says "Creating connection…", whatever the server's words on it (#154).
    @Test fun aWebhooksYesSaysItCreatesTheConnection() {
        assertEquals("Creating connection…", busyWord("Approve the change", connects = true))
        assertEquals("Creating connection…", busyWord("Approve", connects = true))
        assertEquals("Creating connection…", busyWord("Always approve", connects = true))
    }

    private val approved = Job(id = "j1", name = "Mailbox opened", approved = true)
    private fun changed(job: Job = approved, build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit) =
        job.copy(changeValue = buildJsonObject { put("name", "Mailbox opened"); put("by", "bot"); build() })

    // A change that turns calls on, switches their mode or gives a notify address makes a connection; any other does not.
    @Test fun onlyAChangeThatMakesAWebhookCreatesAConnection() {
        assertTrue(changed { put("call", true) }.createsConnection)
        assertTrue(changed { put("call", true); put("callMode", "signed") }.createsConnection)
        assertTrue("bearer to signed", changed(approved.copy(call = true)) { put("call", true); put("callMode", "signed") }.createsConnection)
        assertTrue("signed back to bearer", changed(approved.copy(call = true, callMode = "signed")) { put("call", true) }.createsConnection)
        assertTrue(changed { put("notifyUrl", "https://example.com/hook") }.createsConnection)
        // A job that takes calls already, or has its address, carries them in every change: not a new connection.
        assertFalse(changed(approved.copy(call = true)) { put("call", true); put("prompt", "Check twice") }.createsConnection)
        assertFalse(changed(approved.copy(notifyUrl = "https://example.com/hook")) { put("notifyUrl", "https://example.com/hook") }.createsConnection)
        assertFalse("a job change keeps Approving…", changed { put("prompt", "Check twice") }.createsConnection)
        assertFalse("a call that is no boolean is none", changed { put("call", JsonPrimitive("true")) }.createsConnection)
        assertFalse(approved.createsConnection)
        assertFalse("a new job makes none", approved.copy(approved = false, call = true).createsConnection)
    }
}
