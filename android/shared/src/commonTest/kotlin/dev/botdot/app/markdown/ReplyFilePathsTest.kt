package dev.botdot.app.markdown

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** A file path in a bot's reply is a link the chat opens in the viewer (#251), on both phones (FilePaths). */
class ReplyFilePathsTest {
    private fun links(s: String, paths: Boolean = true) = inlineRuns(s, paths = paths).mapNotNull { it.link }

    @Test fun aPathInAReplyIsAViewerLink() {
        val runs = inlineRuns("I saved it to reports/week.md for you.", paths = true)
        assertEquals("reports/week.md", runs.single { it.link != null }.text)
        assertEquals(listOf("botdot-file:reports/week.md"), links("I saved it to reports/week.md for you."))
        assertEquals("I saved it to reports/week.md for you.", runs.joinToString("") { it.text }, "the words are kept")
    }

    @Test fun withoutPathsItStaysText() = assertEquals(emptyList(), links("I saved it to reports/week.md.", paths = false))

    @Test fun aPathInCodeOrBoldIsHandledAsAndroidDoes() {
        assertEquals(emptyList(), links("Run `cat notes.txt` first."), "code is code")
        assertEquals(listOf("botdot-file:notes.txt"), links("See **notes.txt** now."), "a bold path still opens")
    }

    @Test fun aWebAddressStaysAWebLink() {
        assertEquals(listOf("https://example.com/a.pdf"), links("Get https://example.com/a.pdf here."))
    }

    @Test fun theLinkGivesItsPathBack() {
        assertEquals("reports/week.md", filePathOf("botdot-file:reports/week.md"))
        assertNull(filePathOf("https://example.com/a.pdf"))
        assertNull(filePathOf("botdot-file:"))
    }
}
