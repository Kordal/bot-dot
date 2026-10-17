package dev.botdot.app.feed

import dev.botdot.app.data.isReplayOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotifierTextTest {
    @Test fun markdownBecomesPlainText() {
        assertEquals(
            "This week\n• Done: two things\nA link, italic and code",
            plainText("## This week\n\n- **Done**: two things\n---\nA [link](https://x.y), *italic* and `code`"),
        )
        assertEquals("bold and italic", plainText("__bold__ and *italic*"))
        assertEquals("", plainText("|---|---|"))
    }

    @Test fun replayedEventsAreThoseUpToHello() {
        assertTrue(isReplayOf("boot1.5", "boot1.7"))
        assertTrue(isReplayOf("boot1.7", "boot1.7"))
        assertFalse(isReplayOf("boot1.8", "boot1.7"))
        assertFalse("another run of botdot", isReplayOf("boot2.1", "boot1.7"))
        assertFalse("not connected yet", isReplayOf("boot1.1", null))
        assertFalse(isReplayOf(null, "boot1.7"))
    }

    @Test fun aTilesScriptWaitsOnYourBoard() {
        assertEquals("Waiting for your OK: “Lights” on your Board (a script)", tileWaits("Lights"))
    }
}
