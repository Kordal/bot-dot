package dev.botdot.app.ui

import dev.botdot.app.data.ApiException
import dev.botdot.app.data.Attachment
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A message that could not be sent: the line above the box, what goes back into the box, and what stays where it was tapped. */
class FailedSendTest {
    private val kept = "Your message is still here."
    private val file = Attachment(name = "a.pdf", file = "u1/a.pdf", size = 10)
    private val later = Attachment(name = "b.pdf", file = "u2/b.pdf", size = 20)

    @Test fun theLineSaysWhyInTheWebPagesWords() {
        // No answer, the request never left: botdot was not reached.
        assertEquals("Not sent: can't reach botdot. $kept", sendNote(ApiException("Can't reach botdot. Is Tailscale on? (timeout)")))
        assertEquals("Not sent: can't reach botdot. $kept", sendNote(ApiException("Not connected to botdot")))
        // A gateway in front of botdot answered that it is not there.
        assertEquals("Not sent: can't reach botdot. $kept", sendNote(ApiException("botdot answered 502", 502)))
        assertEquals("Not sent: can't reach botdot. $kept", sendNote(ApiException("botdot answered 503", 503)))
        // A refusal: the server's sentence, with its own full stop or one added.
        assertEquals("Not sent: This bot is paused. $kept", sendNote(ApiException("This bot is paused.", 409, said = true)))
        assertEquals("Not sent: Bot not found. $kept", sendNote(ApiException(" Bot not found ", 404, said = true)))
        assertEquals("Not sent: Really? $kept", sendNote(ApiException("Really?", 400, said = true)))
        // botdot's own sentence counts with a 502 or a 503 too: it was reached.
        assertEquals("Not sent: The Chief is restarting. $kept", sendNote(ApiException("The Chief is restarting.", 503, said = true)))
        // An answer without a sentence that is no gateway's: what the app can say of it.
        assertEquals("Not sent: botdot couldn't do that (404). $kept", sendNote(ApiException("botdot answered 404", 404)))
        // Also when that answer broke off: no "can't reach" inside a refusal.
        assertEquals("Not sent: botdot couldn't do that (403). $kept", sendNote(ApiException("Can't reach botdot. Is Tailscale on? (reset)", 403, sent = true)))
    }

    @Test fun whereNobodyCanTellItSaysItMayHaveBeenSent() {
        val unsure = "It may have been sent: check the chat. $kept"
        // A gateway gave up waiting, or another answer of the 500s without botdot's sentence: also for a botdot that
        // takes a key once, in the web page's words.
        for (once in listOf(false, true)) {
            assertEquals(unsure, sendNote(ApiException("botdot answered 504", 504), once))
            assertEquals(unsure, sendNote(ApiException("botdot answered 500", 500), once))
            assertEquals(unsure, sendNote(IllegalStateException("something else"), once))
        }
        // Against a botdot from before (no "message-key"): the connection dropped after the request went out.
        assertEquals(unsure, sendNote(ApiException("Can't reach botdot. Is Tailscale on? (unexpected end of stream)", sent = true)))
    }

    @Test fun aSendThatGotNoAnswerReadsNotSentWhereBotdotTakesAKeyOnce() {
        val notSent = "Not sent: can't reach botdot. $kept"
        // Also where the app knows the request left: sending it again is safe, botdot takes its key once.
        assertEquals(notSent, sendNote(ApiException("Can't reach botdot. Is Tailscale on? (unexpected end of stream)", sent = true), once = true))
        assertEquals(notSent, sendNote(ApiException("Can't reach botdot. Is Tailscale on? (timeout)"), once = true))
        assertEquals(notSent, sendNote(ApiException("botdot answered 502", 502), once = true))
        assertEquals(notSent, sendNote(ApiException("botdot answered 503", 503), once = true))
        // A refusal is a refusal.
        assertEquals("Not sent: The Chief is still replying. $kept", sendNote(ApiException("The Chief is still replying", 400, said = true), once = true))
        // The outbox words its line by what it is told of the server.
        runBlocking {
            val dropped = ApiException("dropped", sent = true)
            val box = Outbox()
            box.send("a", emptyList(), box = true, once = true) { throw dropped }
            assertEquals(notSent, box.note)
            box.send("a", emptyList(), box = true) { throw dropped }
            assertEquals("It may have been sent: check the chat. $kept", box.note)
        }
    }

    @Test fun anAnswerThatSaidYesIsDeliveredEvenWhenReadingItFailed() {
        assertTrue(delivered(ApiException("Can't reach botdot. Is Tailscale on? (reset)", 200, sent = true)))
        assertTrue(delivered(SerializationException("unexpected field")))
        assertFalse(delivered(ApiException("botdot answered 500", 500)))
        assertFalse(delivered(ApiException("Can't reach botdot.", sent = true)))
        assertFalse(delivered(IllegalStateException("x")))
    }

    @Test fun aChatThatCouldNotBeMadeMeansNotSent() {
        // Whatever happened to the request that makes the chat, the message itself never left: never "may have been sent".
        for (once in listOf(false, true)) {
            // A gateway answered that botdot is not there.
            assertEquals("Not sent: can't reach botdot. $kept", sendNote(notSent(ApiException("botdot answered 502", 502)), once))
            assertEquals("Not sent: can't reach botdot. $kept", sendNote(notSent(ApiException("botdot answered 503", 503)), once))
            // Another answer of the 500s without botdot's sentence: its status, as the web page says it.
            assertEquals("Not sent: botdot couldn't do that (500). $kept", sendNote(notSent(ApiException("botdot answered 500", 500)), once))
            assertEquals("Not sent: botdot couldn't do that (504). $kept", sendNote(notSent(ApiException("botdot answered 504", 504)), once))
            assertEquals("Not sent: botdot couldn't do that (500). $kept", sendNote(notSent(ApiException("Can't reach botdot. (reset)", 500, sent = true)), once))
        }
        assertEquals("Not sent: The Chief is restarting. $kept", sendNote(notSent(ApiException("The Chief is restarting.", 503, said = true))))
        assertEquals("Not sent: can't reach botdot. $kept", sendNote(notSent(ApiException("dropped", sent = true))))
        assertEquals("Not sent: can't reach botdot. $kept", sendNote(notSent(SerializationException("odd answer"))))
        assertEquals("Not sent: No more chats. $kept", sendNote(notSent(ApiException("No more chats.", 400, said = true))))
        // botdot answered that it could not, without a sentence: its status, as the web page says it.
        assertEquals("Not sent: botdot couldn't do that (404). $kept", sendNote(notSent(ApiException("botdot answered 404", 404))))
    }

    @Test fun theFailedTextGoesInFrontOfWhatWasTypedSince() {
        assertEquals("first", withFailed("first", ""))
        assertEquals("first", withFailed("first", "  "))
        assertEquals("first\nsecond", withFailed("first", "second"))
        assertEquals("second", withFailed("", "second"))
        assertEquals("", withFailed("", ""))
    }

    @Test fun aFailedSendFromTheBoxComesBackWithItsFilesAndTheLine() = runBlocking {
        val box = Outbox()
        var requests = 0
        val went = box.send("Do the thing", listOf(file), box = true) { requests++; throw ApiException("This bot is paused.", 409, said = true) }
        assertFalse(went)
        assertFalse(box.sending)
        assertEquals("Not sent: This bot is paused. $kept", box.note)
        // The box takes it back, once: in front of what was typed and attached meanwhile.
        val back = box.take()!!
        assertEquals(FailedSend("Do the thing", listOf(file)), back)
        assertEquals("Do the thing\nand this", withFailed(back.text, "and this"))
        assertNull(box.take())
        // The line stays until the owner edits.
        assertEquals("Not sent: This bot is paused. $kept", box.note)
        box.edited()
        assertNull(box.note)
        // Sending again delivers it once, and the line is gone.
        assertTrue(box.send("Do the thing\nand this", listOf(file), box = true) { requests++ })
        assertEquals(2, requests)
        assertNull(box.note)
        assertNull(box.back)
    }

    @Test fun aSendThatWentLeavesNothingBehind() = runBlocking {
        val box = Outbox()
        assertTrue(box.send("Hello", listOf(file), box = true) {})
        assertNull(box.note)
        assertNull(box.back)
        assertFalse(box.sending)
        // botdot took it and only its answer was lost: delivered, not put back.
        assertTrue(box.send("Hello", emptyList(), box = true) { throw ApiException("reset", 200, sent = true) })
        assertNull(box.note)
        assertNull(box.back)
    }

    @Test fun aNewTryTakesTheOldLineAway() = runBlocking {
        val box = Outbox()
        box.send("a", emptyList(), box = true) { throw ApiException("Can't reach botdot.") }
        assertEquals("Not sent: can't reach botdot. $kept", box.note)
        val gate = CompletableDeferred<Unit>()
        val second = async { box.send("a", emptyList(), box = true) { gate.await() } }
        kotlinx.coroutines.yield()
        assertTrue(box.sending)
        assertNull(box.note)
        gate.complete(Unit)
        assertTrue(second.await())
    }

    @Test fun oneMessageAtATime() = runBlocking {
        val box = Outbox()
        val gate = CompletableDeferred<Unit>()
        var requests = 0
        val first = async { box.send("one", emptyList(), box = true) { requests++; gate.await() } }
        kotlinx.coroutines.yield()
        // A second tap while the first is on its way sends nothing; from the box its text is not lost.
        assertFalse(box.send("Yes", emptyList(), box = false) { requests++ })
        assertNull(box.back)
        assertFalse(box.send("two", listOf(later), box = true) { requests++ })
        assertEquals(FailedSend("two", listOf(later)), box.back)
        gate.complete(Unit)
        assertTrue(first.await())
        assertEquals(1, requests)
    }

    @Test fun aQuickAnswerThatFailedStaysAndTheLineShows() = runBlocking {
        val box = Outbox()
        // What the quick answers and the question card do with the result: they go only when it went.
        var used = false
        if (box.send("Yes", emptyList(), box = false) { throw ApiException("Can't reach botdot.") }) used = true
        assertFalse(used)
        assertEquals("Not sent: can't reach botdot. $kept", box.note)
        assertNull("nothing goes into the message box", box.back)
        if (box.send("Yes", emptyList(), box = false) {}) used = true
        assertTrue(used)
        assertNull(box.note)
    }

    @Test fun twoFailedMessagesWaitTogetherForTheBox() = runBlocking {
        // The chat was left: the box took nothing back between them.
        val box = Outbox()
        box.send("first", listOf(file), box = true) { throw ApiException("Can't reach botdot.") }
        box.send("second", listOf(later), box = true) { throw ApiException("botdot answered 504", 504) }
        assertEquals(FailedSend("second\nfirst", listOf(later, file)), box.back)
        assertEquals("It may have been sent: check the chat. $kept", box.note)
    }

    // ---------- a message's key (QW-008) ----------

    private val keyForm = Regex("^[A-Za-z0-9_-]{8,64}$")
    private val down = ApiException("Can't reach botdot.")

    @Test fun everyMessageGoesWithAKeyTheServerTakes() = runBlocking {
        val box = Outbox()
        val keys = mutableListOf<String>()
        for (text in listOf("One", "Two", "One")) assertTrue(box.send(text, emptyList(), box = true) { keys += it })
        assertTrue(keys.all { keyForm.matches(it) })
        assertEquals("the same words sent later are another message", 3, keys.toSet().size)
        assertTrue(keyForm.matches(messageKey()))
    }

    @Test fun aMessageFromTheBoxKeepsItsKeyUntilItWent() = runBlocking {
        val box = Outbox()
        val keys = mutableListOf<String>()
        var up = false
        val request: suspend (String) -> Unit = { keys += it; if (!up) throw down }
        assertFalse(box.send("Do the thing", listOf(file), box = true, request = request))
        assertEquals(FailedSend("Do the thing", listOf(file)), box.take()) // back in the box, untouched
        assertFalse(box.send("Do the thing", listOf(file), box = true, request = request))
        box.take()
        up = true
        assertTrue(box.send("Do the thing", listOf(file), box = true, request = request))
        assertEquals("one message, one key, however often it is sent", 1, keys.toSet().size)
        // It went: the same words are a new message now.
        assertTrue(box.send("Do the thing", listOf(file), box = true, request = request))
        assertEquals(2, keys.toSet().size)
    }

    @Test fun aChangedMessageIsANewOneAlsoWhenChangedBack() = runBlocking {
        val box = Outbox()
        val keys = mutableListOf<String>()
        val request: suspend (String) -> Unit = { keys += it; throw down }
        box.send("Do the thing", emptyList(), box = true, request = request)
        box.send("Do the thing today", emptyList(), box = true, request = request)
        assertEquals("another text", 2, keys.toSet().size)
        // Edited away and typed again as it failed: the owner may have seen it arrive, so it is a new message.
        box.edited()
        box.send("Do the thing today", emptyList(), box = true, request = request)
        assertEquals(3, keys.toSet().size)
        // Other files under the same text.
        box.send("Do the thing today", listOf(file), box = true, request = request)
        assertEquals(4, keys.toSet().size)
        // And untouched it keeps its key.
        box.send("Do the thing today", listOf(file), box = true, request = request)
        assertEquals(4, keys.toSet().size)
        assertEquals(keys[3], keys[4])
    }

    @Test fun whatWasTypedWhileItWasSentMakesANewMessage() = runBlocking {
        val box = Outbox()
        val keys = mutableListOf<String>()
        val request: suspend (String) -> Unit = { keys += it; throw down }
        box.send("first", emptyList(), box = true, request = request)
        val back = box.take()!!
        box.send(withFailed(back.text, "second"), back.attachments, box = true, request = request)
        assertEquals(2, keys.toSet().size)
    }

    @Test fun aQuickAnswerGoesWithItsOwnKeyAndLeavesTheBoxesAlone() = runBlocking {
        val box = Outbox()
        val keys = mutableListOf<String>()
        val request: suspend (String) -> Unit = { keys += it; throw down }
        box.send("Do the thing", emptyList(), box = true, request = request)
        // A quick answer with the very words of the failed message is not that message.
        box.send("Do the thing", emptyList(), box = false, key = "the-answers-key", request = request)
        box.send("Do the thing", emptyList(), box = false, key = "the-answers-key", request = request)
        assertEquals(listOf("the-answers-key", "the-answers-key"), keys.drop(1))
        // And the message in the box still has its key.
        box.send("Do the thing", emptyList(), box = true, request = request)
        assertEquals(keys[0], keys[3])
        // A tap that brings no key gets one.
        box.send("Yes", emptyList(), box = false, request = request)
        assertTrue(keyForm.matches(keys[4]))
    }

    @Test fun aQuestionCardKeepsItsKeyUntilAnAnswerChanges() {
        val card = CardKey()
        val first = card.of("Which inbox?\n→ Work")
        assertTrue(keyForm.matches(first))
        assertEquals(first, card.of("Which inbox?\n→ Work"))
        val changed = card.of("Which inbox?\n→ Private")
        assertFalse(first == changed)
        assertFalse("changed back, it is a new message", first == card.of("Which inbox?\n→ Work"))
    }

    @Test fun onlyABotdotThatNamesTheFeatureTakesAKeyOnce() {
        assertTrue(takesOnce(listOf("chief", "message-key")))
        assertFalse("a botdot from before: the app words a dropped send as it did", takesOnce(listOf("chief", "needs-text")))
        assertFalse("not asked yet", takesOnce(null))
    }

    @Test fun aChatHasOneOutbox() {
        assertTrue(Outbox.of("bot:b1") === Outbox.of("bot:b1"))
        assertFalse(Outbox.of("bot:b1") === Outbox.of("chief"))
    }
}
