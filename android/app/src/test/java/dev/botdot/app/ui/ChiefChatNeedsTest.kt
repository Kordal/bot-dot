package dev.botdot.app.ui

import dev.botdot.app.data.Ask
import dev.botdot.app.data.ChangedPart
import dev.botdot.app.data.standsInChat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which chats the card of a changed bot stands in (`by` on the ask, docs/api.md): one the Chief asked for is where
 * the owner asked, in the Chief's chat, as well as in the chat of the bot it changes and in Needs you, which shows
 * every ask. `test/bot-change-card-web.test.js` holds the web page's side.
 */
class ChiefChatNeedsTest {
    private fun asks(json: String): List<Ask> = Ask.list(json)
    private val news = """{"id":"news","name":"News Watcher","color":"#e0703a"}"""
    private val here = "The Chief carries on in this chat when you allow it."
    private val inChat = "The Chief carries on in “Morning tech news” when you allow it."
    private fun change(by: String?) = """{"id":"a1","kind":"bot-change","botId":"news","bot":$news,"reason":"The Chief set it up for you",${by?.let { "\"by\":\"$it\",\"chatId\":\"c1\"," } ?: ""}
        "title":"Let News Watcher browse the web?","details":"allowedTools: +WebSearch","parts":[{"label":"Web access","now":"allowed"}],
        "then":{"who":"chief","chatId":"c1","text":"$inChat","here":"$here"}}"""

    @Test fun theYesButtonReadsTheServersWordOrApprove() {
        // A change that only gives permissions has `yes: "Allow"` (the prototype's scene 1); any other has none.
        fun button(yes: String) = changeYes(asks("[${change("chief").replace("\"title\":", "$yes\"title\":")}]").single())
        assertEquals("Allow", button("\"yes\":\"Allow\","))
        assertEquals("Approve", button(""))
        for (odd in listOf("\"\"", "\"  \"", "true", "null", "7", "[\"Allow\"]")) assertEquals(odd, "Approve", button("\"yes\":$odd,"))
    }

    @Test fun aBotChangeByTheChiefStandsInTheChiefsChatAndInTheBots() {
        val a = asks("[${change("chief")}]").single()
        assertTrue(a.standsInChat("chief"))
        assertTrue(a.standsInChat("news"))
        assertFalse(a.standsInChat("coder"))
        // The card: the server's title, what changes in the owner's words, and who carries on, said for the chat it stands in.
        assertEquals("Let News Watcher browse the web?", a.title)
        assertEquals(listOf(ChangedPart("Web access", null, "allowed")), a.parts)
        assertEquals(here, a.then?.line("c1"))
        assertEquals(inChat, a.then?.line("c2"))
        assertEquals(inChat, a.then?.line()) // in the bot's chat and in Needs you
    }

    @Test fun aBotChangeByABotStaysInItsOwnChat() {
        val a = asks("[${change("bot")}]").single()
        assertFalse(a.standsInChat("chief"))
        assertTrue(a.standsInChat("news"))
    }

    @Test fun withoutTheFieldItIsWhereItIsToday() {
        // A botdot server from before `by`, and a `by` this app has no chat for.
        for (a in asks("[${change(null)},${change("owner")}]")) {
            assertFalse(a.standsInChat("chief"))
            assertTrue(a.standsInChat("news"))
        }
    }

    @Test fun thePartsAreDrawnInTheServersOrder() {
        // What is no text shares a box of rows while it follows one another; a changed text has its own.
        val web = ChangedPart("Web access", null, "allowed")
        val apps = ChangedPart("Apps", null, "Gmail")
        val task = ChangedPart("Main assignment", "Read the tech news.", "Read the tech news and send the three best stories.")
        val rules = ChangedPart("Rules", "", "Never post anywhere.")
        val computer = ChangedPart("Its own computer", null, "on")
        assertEquals(listOf(listOf(web, apps), listOf(task), listOf(rules), listOf(computer)), partGroups(listOf(web, apps, task, rules, computer)))
        assertEquals(listOf(listOf(task), listOf(web)), partGroups(listOf(task, web)))
        assertEquals(emptyList<List<ChangedPart>>(), partGroups(emptyList()))
    }

    @Test fun onlyAChangedBotMovesWithIt() {
        // `by` on another kind of ask changes nothing: a permission a bot asked for is the bot's, a skill the Chief asked for the Chief's.
        val (permission, skill) = asks("""[{"id":"p1","kind":"permission","bot":$news,"by":"chief","permission":"Bash"},{"id":"s1","kind":"skill","by":"chief","skill":{"name":"pdf"}}]""")
        assertFalse(permission.standsInChat("chief"))
        assertTrue(permission.standsInChat("news"))
        assertTrue(skill.standsInChat("chief"))
        assertFalse(skill.standsInChat("news"))
    }
}
