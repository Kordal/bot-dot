package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** "Always allow" for one bot or all bots (ADR 201): the card's words, and what every bot may do, for the Connectors screen. */
class EveryBotTest {
    private fun ask(more: String) = Api.JSON.decodeFromString<Ask>("""{"id":"k9","kind":"connector-action","botId":"b1"$more}""")

    @Test fun theCardSaysWhomItAsksAbout() {
        val a = ask(""","everyBot":{"question":"Who may add label to email with Gmail from now on, whatever the details?","note":"Only Sorter, or every bot you have and make.","only":"Only Sorter","all":"All bots"}""")
        assertEquals(EveryBot("Who may add label to email with Gmail from now on, whatever the details?", "Only Sorter, or every bot you have and make.", "Only Sorter", "All bots"), a.everyBot)
    }

    @Test fun aCardWithoutItOrWithoutItsWordsAsksAsBefore() {
        assertNull(ask("").everyBot)
        assertNull(ask(""","everyBot":{"question":"Who?","only":"Only Sorter"}""").everyBot)
        assertNull(ask(""","everyBot":"all"""").everyBot)
    }

    @Test fun theGrantsForEveryBotAreReadInTheOwnersWords() {
        val list = Api.JSON.decodeFromString<GrantList>("""{"grants":[{"action":"gmail:GMAIL_ADD_LABEL_TO_EMAIL","label":"Add label to email with Gmail"}]}""")
        assertEquals(listOf(AlwaysAllowed("gmail:GMAIL_ADD_LABEL_TO_EMAIL", "Add label to email with Gmail")), list.grants)
    }
}
