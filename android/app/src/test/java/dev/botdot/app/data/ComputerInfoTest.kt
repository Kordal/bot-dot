package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A bot's computer as the app reads `GET /api/bots/:id/computer` (#107): the server's words for a reset of the
 * account's computer, which erases it for every bot, for an update, and for the bot's old computer of its own.
 */
class ComputerInfoTest {
    private val json = Api.JSON
    private val reset = "It is erased for every bot that works on it: Coder and Scout. Lost: the files in /home/box and /workspace, the browsers' logins and every program installed on it."
    private val now = """{"state":"running","outdated":true,"diskBytes":1,"bots":[{"id":"c1","name":"Coder"},{"id":"s1","name":"Scout"}],
        "reset":{"title":"Reset the account's computer?","text":"$reset","yes":"Reset"},
        "update":{"text":"A newer desktop is available. It keeps the files in /home/box and /workspace.","yes":"Update"},
        "old":{"state":"stopped","folder":"/workspace/c1/old-computer","text":"Coder's old computer of its own is kept, stopped.","copy":"Copy its files","erase":"Erase it","confirm":"Erase Coder's old computer?"}}"""

    @Test fun aResetIsTheAccountsAndSaysWhatTheServerSays() {
        val info = json.decodeFromString<ComputerInfo>(now)
        assertTrue(info.resetsAll)
        assertEquals(listOf("Coder", "Scout"), info.bots.map { it.name })
        val words = info.resetWords("Coder")
        assertEquals("Reset the account's computer?", words.title)
        assertEquals(reset, words.text)
        assertEquals("Reset", words.yes)
        assertEquals("Update", info.update?.yes)
        assertEquals("/workspace/c1/old-computer", info.old?.folder)
        assertEquals("Erase Coder's old computer?", info.old?.confirm)
    }

    @Test fun aServerFromBeforeResetsTheBotsOwnComputer() {
        val info = json.decodeFromString<ComputerInfo>("""{"state":"running","outdated":false}""")
        assertFalse(info.resetsAll)
        assertNull(info.update)
        assertNull(info.old)
        assertEquals("Reset Coder's computer?", info.resetWords("Coder").title)
    }

    @Test fun whatAResetOrAnUpdateAnswers() {
        assertTrue(json.decodeFromString<ComputerChanged>("""{"state":"none","erased":true}""").erased)
        val failed = json.decodeFromString<ComputerChanged>("""{"state":"stopped","updated":false,"error":"Couldn't keep its files"}""")
        assertFalse(failed.updated)
        assertEquals("Couldn't keep its files", failed.error)
        assertEquals("/workspace/c1/old-computer", json.decodeFromString<OldCopied>("""{"copied":"/workspace/c1/old-computer"}""").copied)
    }
}
