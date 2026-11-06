package dev.botdot.app.ui

import dev.botdot.app.data.ApiException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** A reply typed in a notification (#1069): it goes with a message key, and one that did not go waits in its chat's box. */
class NotificationReplyTest {
    private val keys = listOf(MESSAGE_KEY)

    @Test fun aReplyThatWentHasAKeyAndLeavesNothingInTheBox() = runBlocking {
        var key: String? = null
        assertNull(replyFromNotification("bot:shade-ok", "Yes, go on", keys) { key = it })
        assertNotNull(key)
        assertNull(Outbox.of("bot:shade-ok").take())
    }

    @Test fun aReplyThatFailedWaitsInItsChatsBoxWithTheLineThatSaysWhy() = runBlocking {
        val tried = mutableListOf<String>()
        val note = replyFromNotification("bot:shade-away", "Book the table for 8", keys) { tried += it; throw ApiException("Can't reach botdot. Is Tailscale on? (timeout)") }
        assertEquals("Not sent: can't reach botdot. Your message is still here.", note)
        assertEquals("Book the table for 8", Outbox.of("bot:shade-away").back?.text)
        assertEquals(note, Outbox.of("bot:shade-away").note)
        // Sent again from the box as it is, it keeps its key: botdot takes it once.
        val again = Outbox.of("bot:shade-away")
        val back = again.take()!!
        var second: String? = null
        assertEquals(true, again.send(back.text, back.attachments, box = true) { second = it })
        assertEquals(tried.single(), second)
    }

    @Test fun theChiefsChatsShareOneBoxAndAGroupHasItsOwn() = runBlocking {
        replyFromNotification("chief:c7", "Remind me at 5", keys) { throw ApiException("botdot answered 502", 502) }
        assertEquals("Remind me at 5", Outbox.of("chief").take()?.text)
        replyFromNotification("group:g-shade", "Ship it", keys) { throw ApiException("botdot answered 502", 502) }
        assertEquals("Ship it", Outbox.of("group:g-shade").take()?.text)
        assertEquals("chief", outboxKey("chief:c7"))
        Outbox.of("chief").edited()
    }
}
