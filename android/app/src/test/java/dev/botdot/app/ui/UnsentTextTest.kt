package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/** What was typed in a chat's box and not sent when the chat was left (#1068): it waits for that chat, and comes back once. */
class UnsentTextTest {
    @Test fun typedTextWaitsForItsChatAndComesBackOnce() {
        val writer = Outbox.of("bot:unsent-writer")
        val coder = Outbox.of("bot:unsent-coder")
        writer.leave("Check the invoices from")
        assertEquals("", coder.takeUnsent())
        assertEquals("Check the invoices from", Outbox.of("bot:unsent-writer").takeUnsent())
        assertEquals("", writer.takeUnsent())
    }

    @Test fun anEmptyBoxLeavesNothingAndTheLastLeaveCounts() {
        val group = Outbox.of("group:unsent-g1")
        group.leave("Plan for")
        group.leave("   ")
        assertEquals("", group.takeUnsent())
        group.leave("Plan for")
        group.leave("Plan for Monday")
        assertEquals("Plan for Monday", group.takeUnsent())
    }

    @Test fun aFailedMessageStandsInFrontOfTheTextThatWaited() {
        assertEquals("Send the report\nand the second thing", withFailed("Send the report", "and the second thing"))
    }
}
