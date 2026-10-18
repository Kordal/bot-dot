package dev.botdot.app.feed

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** What an ask's notification says under its bot's name, from an entry of the feed's `asks` (docs/api.md). */
class AskWordsTest {
    private fun words(json: String) = askWords(Json.parseToJsonElement(json).jsonObject).let { it.text to it.yes }
    /** The buttons the notification gets, in their order. */
    private fun buttons(json: String) = askWords(Json.parseToJsonElement(json).jsonObject).let { answerButtons(it.yes, it.decline).map { b -> b.first } }

    @Test fun aToolsNotificationSaysTheServersLine() {
        val gh = """{"id":"a1","kind":"tool","botId":"coder","botName":"Coder","botColor":"#7f77dd","what":null,"skill":null,"tool":"gh","text":"Asks to install gh","at":"2026-10-03T09:00:00.000Z"}"""
        assertEquals("Asks to install gh" to "Install", words(gh))
        assertFalse("skill" in words(gh).first)
        // Whatever the server writes there is shown as it is.
        assertEquals("Wants gh installed" to "Install", words("""{"id":"a1","kind":"tool","tool":"gh","text":"Wants gh installed"}"""))
        // An entry without the line: the app writes none of its own, and offers no Install from the notification.
        assertEquals("" to null, words("""{"id":"a1","kind":"tool","tool":"gh"}"""))
        assertEquals("" to null, words("""{"id":"a1","kind":"tool","tool":"gh","text":"  "}"""))
    }

    @Test fun theOtherAsksSayWhatTheySaid() {
        assertEquals("Asks to install the skill “pdf”" to "Install", words("""{"id":"s1","kind":"skill","what":null,"skill":"pdf"}"""))
        assertEquals("Asks to browse the web" to "Allow", words("""{"id":"p1","kind":"permission","what":"browse the web","skill":null}"""))
        assertEquals(listOf("Decline", "Install"), buttons("""{"id":"s1","kind":"skill","what":null,"skill":"pdf"}"""))
        assertEquals(listOf("Decline", "Allow"), buttons("""{"id":"p1","kind":"permission","what":"browse the web","skill":null}"""))
    }

    @Test fun anAskThatSaysWhoCarriesOnHasTheSameNotification() {
        // The feed's entry of a permission, without and with `then` (docs/api.md, "What follows a yes"): the same
        // line and the same two buttons. What follows the Allow arrives as the bot's next notification.
        val plain = """{"id":"p1","kind":"permission","botId":"doctor","botName":"Fleet Doctor","what":"run commands","skill":null,"text":"Wants to run commands, to read last night's backup log"}"""
        val then = plain.dropLast(1) + ""","then":{"who":"bot","text":"It carries on with “Check why the backup failed last night.” when you allow it."}}"""
        assertEquals("Wants to run commands, to read last night's backup log" to "Allow", words(plain))
        assertEquals(words(plain), words(then))
        assertEquals(listOf("Decline", "Allow"), buttons(then))
        // A changed bot and a connected-app action keep Decline alone, with the fields their cards now draw.
        assertEquals(listOf("Decline"), buttons("""{"id":"c1","kind":"bot-change","botName":"News Watcher","text":"The Chief wants to let it browse the web","yesOn":"card","by":"chief","then":{"who":"chief","text":"The Chief carries on"}}"""))
        assertEquals(listOf("Decline"), buttons("""{"id":"k1","kind":"connector-action","botName":"Mail Writer","text":"Wants to send email with Gmail","yesOn":"card","held":true}"""))
    }

    @Test fun aToolFromALinkSaysSoAndHasDeclineButNoInstall() {
        // The entry of a tool from a link, as the feed sends it: the yes is given on its card.
        val stripe = """{"id":"a2","kind":"tool","botId":"coder","botName":"Coder","botColor":"#7f77dd","what":null,"skill":null,"tool":"stripe","text":"Asks to install stripe from a link","yesOn":"card","at":"2026-10-03T09:00:00.000Z"}"""
        assertEquals("Asks to install stripe from a link" to null, words(stripe))
        assertEquals(listOf("Decline"), buttons(stripe))
        // The value is read as the card's fields are, without the blanks around it; the Mac reads it the same way.
        assertEquals(listOf("Decline"), buttons(stripe.replace("\"yesOn\":\"card\"", "\"yesOn\":\" card \"")))
        // Decline answers no, and nothing on such a notification answers yes.
        assertEquals(listOf("Decline" to false), askWords(Json.parseToJsonElement(stripe).jsonObject).let { answerButtons(it.yes, it.decline) })
        assertEquals(listOf("Decline" to false, "Install" to true), answerButtons("Install", true))
        assertEquals(emptyList<Pair<String, Boolean>>(), answerButtons(null, false))
        // A registry tool keeps both, Install last.
        val gh = """{"id":"a1","kind":"tool","botId":"coder","botName":"Coder","what":null,"skill":null,"tool":"gh","text":"Asks to install gh"}"""
        assertEquals(listOf("Decline", "Install"), buttons(gh))
    }

    @Test fun anEntryWithoutTheFieldIsAsBefore() {
        // A server from before `yesOn` names a tool from a link like any tool: Install and Decline, as it was.
        val old = """{"id":"a2","kind":"tool","tool":"stripe","text":"Asks to install stripe"}"""
        assertEquals("Asks to install stripe" to "Install", words(old))
        assertEquals(listOf("Decline", "Install"), buttons(old))
        // A value this app does not know, or one that is no text, changes nothing.
        for (odd in listOf("\"app\"", "\"\"", "null", "true", "[\"card\"]", "{\"on\":\"card\"}")) {
            assertEquals(odd, listOf("Decline", "Install"), buttons("""{"id":"a2","kind":"tool","tool":"stripe","text":"Asks to install stripe","yesOn":$odd}"""))
        }
        // A tool's entry without its line had no button, and has none.
        assertEquals(emptyList<String>(), buttons("""{"id":"a1","kind":"tool","tool":"gh"}"""))
        assertEquals(emptyList<String>(), buttons("""{"id":"a1","kind":"tool","tool":"gh","yesOn":"card"}"""))
    }

    @Test fun theFieldHoldsForAnAskOfAnyKind() {
        // Not a tool's alone (docs/api.md): the server may send it with another ask later.
        val permission = """{"id":"p1","kind":"permission","what":"run commands","skill":null,"yesOn":"card"}"""
        assertEquals("Asks to run commands" to null, words(permission))
        assertEquals(listOf("Decline"), buttons(permission))
        assertEquals(listOf("Decline"), buttons("""{"id":"s1","kind":"skill","skill":"pdf","yesOn":"card"}"""))
    }

    @Test fun aVaultSwitchIsAnsweredOnItsCardOnly() {
        // A bot asks to turn on a switch of a saved login: the server's line, and Decline alone (`yesOn: "card"`).
        val tls = """{"id":"v1","kind":"vault-switch","botId":"pve","botName":"Proxmox Admin","text":"Asks to turn on “Accept self-signed certificate” for “Proxmox read-only API token”","yesOn":"card"}"""
        assertEquals("Asks to turn on “Accept self-signed certificate” for “Proxmox read-only API token”", words(tls).first)
        assertEquals(listOf("Decline"), buttons(tls))
    }
}
