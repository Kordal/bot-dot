package dev.botdot.app.ui

import dev.botdot.app.data.BotNames
import dev.botdot.app.data.Mentions
import org.junit.Assert.assertEquals
import org.junit.Test

class BotLinksTest {
    private val bots = listOf(BotNames.Bot("qa", "QA Tester"), BotNames.Bot("al", "Mail"))

    @Test fun theChiefIsLinkedByTheNameTheOwnerGaveItNotByItsRole() {
        assertEquals(listOf("qa", "al"), botLinkNames(bots, "Chief of Staff", "Chief of Staff", null).map { it.id })
        assertEquals(listOf(Mentions.CHIEF, "qa", "al"), botLinkNames(bots, "Alfred", "Chief of Staff", null).map { it.id })
    }

    @Test fun theBotWhoseChatItIsIsNotLinked() {
        assertEquals(listOf(Mentions.CHIEF, "al"), botLinkNames(bots, "Alfred", "Chief of Staff", "qa").map { it.id })
        // In the Chief's own chat: not the Chief.
        assertEquals(listOf("qa", "al"), botLinkNames(bots, "Alfred", "Chief of Staff", Mentions.CHIEF).map { it.id })
    }
}
