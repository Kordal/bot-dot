package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class FoldPeekTest {
    // A folded reply between bots shows its first words: plain, on one line, never the whole of a long reply (#413).
    @Test fun firstWordsArePlainAndOnOneLine() {
        assertEquals("This week Two bills and a letter.", foldPeek("## This week\n\n**Two bills** and a [letter](https://x.test)."))
        assertEquals("", foldPeek(null))
        assertEquals(160, foldPeek("word ".repeat(100)).length)
    }
}
