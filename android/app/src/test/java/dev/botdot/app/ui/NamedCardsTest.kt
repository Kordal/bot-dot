package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A card a message names stands under that message (ADR 249): under the newest of several that name it, and at the
 * end of the chat not again. `test/card-refs.test.js` holds the web page's side.
 */
class NamedCardsTest {
    @Test
    fun aCardStandsUnderTheNewestMessageThatNamesIt() {
        val shown = newestNames(listOf("r1" to listOf("aaaaaaa1", "bbbbbbb2"), "r2" to null, "r3" to listOf("aaaaaaa1", "not-an-id")))
        assertEquals(listOf("bbbbbbb2"), shown["r1"])
        assertEquals(emptyList<String>(), shown["r2"])
        assertEquals(listOf("aaaaaaa1"), shown["r3"])
    }

    @Test
    fun theEndOfTheChatLeavesNamedCardsOut() {
        assertEquals(setOf("aaaaaaa1", "bbbbbbb2"), namedCards(listOf(listOf("aaaaaaa1"), null, listOf("bbbbbbb2", "xyz"))))
    }
}
