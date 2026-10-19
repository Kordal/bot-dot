package dev.botdot.app.ui

import org.junit.Assert.assertEquals
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
}
