package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** A reply's questions stay in the chat once its card is closed, as `public/app.js` replyText has it. */
class ReplyTextTest {
    private val asked = Run(id = "r1", botId = "reviewer", status = "success", result = "Two issues wait.", questions = listOf("#542: close it?", "#541: close it?"))

    @Test fun anOpenCardKeepsItsQuestionsOnTheCard() {
        assertEquals("Two issues wait.", replyText(asked, open = true))
    }

    @Test fun aClosedCardsQuestionsStandAtTheEndOfTheReply() {
        assertEquals("Two issues wait.\n\n- #542: close it?\n- #541: close it?", replyText(asked, open = false))
    }

    @Test fun aReplyWithoutQuestionsIsAsItWas() {
        assertEquals("Done.", replyText(Run(id = "r2", botId = "reviewer", status = "success", result = "Done."), open = false))
    }

    @Test fun anOlderChiefReplysQuestionsArePartOfItsText() {
        val m = ChiefMessage(role = "chief", text = "Two things first.", questions = listOf("Which account?", "Which day?"))
        assertEquals("Two things first.", chiefText(m, open = true))
        assertEquals("Two things first.\n\n- Which account?\n- Which day?", chiefText(m, open = false))
    }
}
