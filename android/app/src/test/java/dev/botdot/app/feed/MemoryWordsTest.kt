package dev.botdot.app.feed

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What the notification of a waiting memory change says (docs/api.md, "A waiting memory change"): the card's own
 * words, the botdot server's, and for a guarded change no button at all. From a server that sends none, as before.
 */
class MemoryWordsTest {
    private val now = listOf("memory-chips", "memory-cards")
    private val before = listOf("memory", "staged-changes")
    private fun words(json: String, features: List<String>?) = memoryWords(Json.parseToJsonElement(json).jsonObject, features)
        .let { listOf(it.text, it.detail, answerButtons(it.yes, it.decline, it.no)) }

    private val add = """{"id":"m1","action":"add","botId":"b1","botName":"Coder","text":"The owner flies from Brussels.","title":"Add to the shared memory","meta":"after reading outside content","yes":"Approve","no":"Decline"}"""
    private val changeSaid = """{"id":"m4","action":"edit","botId":"b1","text":"Use npm.","guarded":true,"title":"Change what you said","meta":"in a run you did not start","yes":"Change it","no":"Keep it"}"""
    private val forget = """{"id":"m6","action":"erase","botId":"b1","text":"Use pnpm. · and 2 chats","guarded":true,"title":"Forget for good","meta":"in a run you did not start","yes":"Forget for good","no":"Keep"}"""

    @Test fun itSaysTheCardsWords() {
        assertEquals(listOf("Add to the shared memory", "The owner flies from Brussels.\nafter reading outside content", listOf("Decline" to false, "Approve" to true)), words(add, now))
        // The buttons are the server's, whatever they read.
        assertEquals(listOf("Change in the shared memory", "Lives in Kraków.\nfrom its memory review", listOf("Leave it" to false, "Change" to true)),
            words("""{"id":"m2","action":"edit","text":"Lives in Kraków.","title":"Change in the shared memory","meta":"from its memory review","yes":"Change","no":"Leave it"}""", now))
        assertEquals("the same while the features are not known", words(add, now), words(add, null))
    }

    @Test fun aGuardedChangeOffersNoYesAndNoNo() {
        assertEquals(listOf("Change what you said", "Use npm.\nin a run you did not start", emptyList<Pair<String, Boolean>>()), words(changeSaid, now))
        assertEquals(listOf("Forget for good", "Use pnpm. · and 2 chats\nin a run you did not start", emptyList<Pair<String, Boolean>>()), words(forget, now))
        // Without the card's words nothing says what a yes would do: no button either, and never "Add to the shared memory".
        assertEquals(listOf("Needs your OK", null, emptyList<Pair<String, Boolean>>()), words("""{"id":"m6","action":"erase","text":"Use pnpm.","guarded":true}""", now))
        assertEquals(listOf("Needs your OK", null, emptyList<Pair<String, Boolean>>()), words(forget, before))
    }

    @Test fun fromAServerThatDoesNotAnnounceTheCardsItReadsAsToday() {
        val old = listOf("Decline" to false, "Approve" to true)
        assertEquals(listOf("Add to the shared memory", "The owner flies from Brussels.", old), words("""{"id":"m1","action":"add","text":"The owner flies from Brussels."}""", before))
        assertEquals(listOf("Change in the shared memory", "Lives in Kraków.", old), words("""{"id":"m2","action":"edit","text":"Lives in Kraków."}""", before))
        assertEquals(listOf("Remove from the shared memory", null, old), words("""{"id":"m3","action":"remove","text":" "}""", before))
        assertEquals("its words are not read", listOf("Add to the shared memory", "The owner flies from Brussels.", old), words(add, before))
        // A word that is missing or no text leaves today's notification.
        assertEquals(listOf("Add to the shared memory", "The owner flies from Brussels.", old), words(add.replace("\"yes\":\"Approve\"", "\"yes\":[\"Approve\"]"), now))
    }

    @Test fun aChangeThatBecameGuardedWhileItWaitedIsDrawnAgainWithoutItsButtons() {
        val showing = setOf("memory:m1", "memory:m2", "bot:b1")
        assertEquals("it rang with buttons and still shows", listOf("memory:m1"), redrawn(listOf("memory:m1", "memory:m9"), setOf("memory:m1", "memory:m2"), showing))
        assertEquals("one that rings now is drawn once", emptyList<String>(), redrawn(listOf("memory:m9"), setOf("memory:m1"), showing + "memory:m9"))
        assertEquals("one the owner swiped away stays away", emptyList<String>(), redrawn(listOf("memory:m3"), setOf("memory:m3"), showing))
        assertEquals(emptyList<String>(), redrawn(emptyList(), setOf("memory:m1"), showing))
    }
}
