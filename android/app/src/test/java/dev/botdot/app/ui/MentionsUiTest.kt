package dev.botdot.app.ui

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import dev.botdot.app.data.Mentions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Picking a mention in the message box, then "/" for the picked bot's jobs. */
class MentionsUiTest {
    private val bot = Mentions.Row(Mentions.Kind.BOT, "@FleetDoctor", "Fleet Doctor", bot = "fleet")
    private fun typed(t: String) = TextFieldValue(t, TextRange(t.length))

    @Test fun aSlashRightAfterAPickedBotTakesTheSpace() {
        val (picked, end) = pickMention(typed("Ask @fle"), bot)
        assertEquals(typed("Ask @FleetDoctor "), picked)
        val slash = slashAfterPick(picked, typed("Ask @FleetDoctor /"), end)
        assertEquals(typed("Ask @FleetDoctor/"), slash)
    }

    @Test fun anythingElseIsTypedAsIs() {
        val (picked, end) = pickMention(typed("Ask @fle"), bot)
        assertNull(slashAfterPick(picked, typed("Ask @FleetDoctor x"), end))
        assertNull(slashAfterPick(picked, typed("Ask @FleetDoctor /"), -1)) // nothing picked
    }

    @Test fun noNewSpaceNoSlashSwap() {
        val (_, end) = pickMention(TextFieldValue("Ask @fle now", TextRange(8)), bot)
        assertEquals(-1, end)
    }
}
