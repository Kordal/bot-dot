package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.ChiefChat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A mail draft on a Chief reply (#415): what its card shows. `test/mail-draft-web.test.js` holds the web page's side. */
class MailDraftTest {
    private fun messages(json: String) = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","messages":[$json]}""").messages

    @Test fun theCardsStateButtonsAndFooter() {
        val (waits, kept, earlier, sent, plain) = messages("""
            {"role":"chief","text":"Send it before 9:00.","choices":["Send now","Not now"],"actions":[{"kind":"run","text":"Started E-mail Assistant","botId":"mail","runId":"r1"},{"kind":"run","text":"Started Coder","botId":"code"}],
             "draft":{"to":"Stefan <stefan@clinic.example>","subject":"Online?","text":"Hello","state":"draft","botId":"mail","runId":"r1","bot":"E-mail Assistant","future":1}},
            {"role":"chief","text":"","draft":{"to":"a@b.example","subject":"Hi","text":"x","state":"kept"}},
            {"role":"chief","text":"","draft":{"to":"a@b.example","subject":"Hi","text":"x","state":"draft","earlier":true}},
            {"role":"chief","text":"Sent.","draft":{"to":"a@b.example","subject":"Hi","text":"x","state":"sent","sentAt":"2026-10-23T07:31:00Z"}},
            {"role":"chief","text":"Hi"}""")
        val d = waits.draft!!
        assertEquals(listOf("Stefan <stefan@clinic.example>", "Online?", "E-mail Assistant"), listOf(d.to, d.subject, d.bot))
        assertEquals("In Drafts · not sent", MailCard.state(d))
        assertEquals(listOf("Send now", "Not now"), MailCard.actions(d))
        // The run that wrote it is in the card's footer; another bot's chip stays.
        assertEquals(listOf("Started Coder"), waits.actions!!.filterNot { MailCard.takesChip(d, it) }.map { it.text })

        assertEquals("Kept in Drafts · not sent", MailCard.state(kept.draft!!))
        assertEquals(listOf("Send now"), MailCard.actions(kept.draft!!))
        assertTrue(earlier.draft!!.earlier)
        assertEquals(emptyList<String>(), MailCard.actions(earlier.draft!!))
        assertEquals("Sent", MailCard.state(sent.draft!!))
        assertEquals(emptyList<String>(), MailCard.actions(sent.draft!!))
        assertFalse(MailCard.takesChip(kept.draft, waits.actions!![0]))
        assertNull(plain.draft)
    }

    @Test fun aLooksDraftIsInNoMailbox() {
        val (waits, kept) = messages("""
            {"role":"chief","text":"Anna waits 3 days.","unasked":true,"choices":["Send now","Not now"],"draft":{"to":"Anna <anna@example.com>","subject":"Re: Plans","text":"Hi Anna","state":"draft","unsaved":true}},
            {"role":"chief","text":"","unasked":true,"draft":{"to":"Anna <anna@example.com>","subject":"Re: Plans","text":"Hi Anna","state":"kept","unsaved":true}}""")
        assertEquals("Not sent", MailCard.state(waits.draft!!))
        assertEquals(listOf("Send now", "Not now"), MailCard.actions(waits.draft!!))
        assertEquals("Not sent", MailCard.state(kept.draft!!))
        assertEquals(listOf("Send now"), MailCard.actions(kept.draft!!))
    }
}
