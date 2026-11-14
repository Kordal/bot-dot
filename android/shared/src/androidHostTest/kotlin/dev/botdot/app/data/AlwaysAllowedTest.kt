package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** A bot's lasting grants in connected apps (#474): read with the bot, for "Always approved" in its settings. */
class AlwaysAllowedTest {
    @Test fun aBotCarriesItsLastingGrantsInTheOwnersWords() {
        val b = Api.JSON.decodeFromString<Bot>("""{"id":"x","name":"X","alwaysAllowed":[{"action":"github:GITHUB_MERGE_A_PULL_REQUEST","label":"Merge a pull request with GitHub","extra":1}]}""")
        assertEquals(listOf(AlwaysAllowed("github:GITHUB_MERGE_A_PULL_REQUEST", "Merge a pull request with GitHub")), b.alwaysAllowed)
    }

    @Test fun aServerWithoutThemSendsNone() {
        assertEquals(emptyList<AlwaysAllowed>(), Api.JSON.decodeFromString<Bot>("""{"id":"x","name":"X"}""").alwaysAllowed)
    }
}
