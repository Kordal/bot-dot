package dev.botdot.app.feed

import dev.botdot.app.data.FeedEvent
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * What rings for a group (Milestone 10, G12; docs/api.md, "A card and a question in a group"): no reply, a member's
 * question to the owner, and a card asked in the group; each opens the group. The events are those the botdot
 * server sends (`emitRun` in lib/events.js, and the lists of what waits in server.js).
 */
class GroupNotifierTest {
    private fun event(type: String, data: String, id: String = "boot.9") = FeedEvent(id, type, Json.parseToJsonElement(data).jsonObject)
    private fun ended(more: String) = event("group_run_finished",
        """{"id":"r1","botId":"coder","botName":"Coder","botColor":"#3b82f6","groupId":"g1","groupMessageId":"m1","chat":"group:g1","status":"success","result":"Done, on the branch."$more}""")

    @Test fun aReplyInAGroupMakesNoNotification() {
        assertFalse("a new reply", groupNotifies(ended(""","notify":false,"new":true"""), "group:g1", null))
        assertFalse("one that failed", groupNotifies(event("group_run_finished", """{"id":"r2","botId":"coder","groupId":"g1","status":"error","problem":"It broke.","notify":false,"new":true}"""), "group:g1", null))
        assertFalse("a pass", groupNotifies(ended(""","notify":false,"passed":true,"quiet":true"""), "group:g1", null))
        assertFalse("a server that says nothing of it", groupNotifies(ended(""","new":true"""), "group:g1", null))
        assertFalse("notify must be true", groupNotifies(ended(""","notify":"true","new":true"""), "group:g1", null))
    }

    @Test fun aQuestionAskedInAGroupMakesOneUnlessTheGroupIsOnScreen() {
        val asks = ended(""","notify":true,"asks":true,"title":"Coder asks","question":"Which one?","new":true""")
        assertTrue(groupNotifies(asks, "group:g1", null))
        assertTrue("another chat is on screen", groupNotifies(asks, "group:g1", "bot:coder"))
        assertFalse("the owner is looking at the group", groupNotifies(asks, "group:g1", "group:g1"))
        // It is titled as the bot's own question is, with the question in the server's one line.
        val notice = asksNotice(true, "Coder asks", "Coder", "Two ways to do it.\nWhich one?", "Which one?")
        assertEquals("Coder asks" to "Which one?", notice?.title to notice?.body)
    }

    @Test fun itGoesWhenTheGroupIsReadOrTheQuestionEnds() {
        assertEquals("group:g1", groupSettled(event("group_unread", """{"chat":"group:g1","groupId":"g1","unread":0,"firstUnread":null}""")))
        assertNull("a new reply came: nothing goes", groupSettled(event("group_unread", """{"chat":"group:g1","groupId":"g1","unread":2,"firstUnread":"r1"}""")))
        assertEquals("the owner answered, here or in another app", "group:g1", groupSettled(event("group_asks", """{"chat":"group:g1","groupId":"g1","asks":null}""")))
        assertNull(groupSettled(event("group_asks", """{"groupId":"g1","asks":{"botId":"coder","text":"Which one?","runId":"r1"}}""")))
        assertNull("an event without the field says nothing", groupSettled(event("group_asks", """{"groupId":"g1"}""")))
        // A bot's own chat being read takes no group's notification away, and the reverse.
        assertNull(groupSettled(event("unread", """{"chat":"bot:coder","groupId":"g1","unread":0}""")))
        assertNull(chatRead(event("group_unread", """{"chat":"group:g1","groupId":"g1","unread":0}"""), Standing(follows = true)))
        assertFalse("a group's tag is no chat the catch-up brings in line", isChat("group:g1"))
    }

    @Test fun aCardAskedInAGroupNamesTheBotAndTheGroupAndOpensTheGroup() {
        val ask = Json.parseToJsonElement("""{"id":"a1","kind":"permission","botId":"coder","botName":"Coder","what":"run commands","text":"Asks to run commands","groupId":"g1","groupName":"Dev"}""").jsonObject
        val place = cardPlace(ask, "Coder")
        assertEquals("Coder in Dev" to "group:g1", place.title to place.open)
        assertEquals("by the group's name as it is now", "Coder in Dev team", cardPlace(ask, "Coder") { id -> "Dev team".takeIf { id == "g1" } }.title)
        // A card of a bot's own chat, and one of a group that was deleted (the server sends neither field): Needs you.
        val own = Json.parseToJsonElement("""{"id":"a2","kind":"permission","botId":"coder","botName":"Coder","text":"Asks to run commands"}""").jsonObject
        assertEquals("Coder" to "needs", cardPlace(own, "Coder").let { it.title to it.open })
        // Its words and its buttons are those of every card.
        assertEquals("Asks to run commands" to "Allow", askWords(ask).let { it.text to it.yes })
    }

    @Test fun theNotifierFollowsTheGroupsEventsAndAReplyFromItIsAMessageToTheGroup() {
        val src = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "src/main/java/dev/botdot/app") }.first { it.exists() }
        val notifier = File(src, "feed/Notifier.kt").readText()
        assertTrue(notifier.contains("\"group_run_finished\" -> {") && notifier.contains("if (!groupNotifies(ev, chat, standing().watching)) return"))
        assertTrue(notifier.contains("\"group_unread\", \"group_asks\" -> groupSettled(ev)?.let { c -> cancelWhere { it == c } }"))
        for (need in listOf("login:", "job:", "tile:", "memory:", "ask:")) assertTrue(need, Regex("Need\\(\"$need[^\\n]*open = place\\.open\\)").containsMatchIn(notifier))
        assertTrue(File(src, "feed/Receivers.kt").readText().contains("chat.startsWith(\"group:\") -> { a.sendToGroup(chat.removePrefix(\"group:\"), text, emptyList()) }"))
        assertTrue("a tapped notification opens the group", File(src, "MainActivity.kt").readText().contains("t.startsWith(\"group:\") -> nav.navigate(\"group/\${t.removePrefix(\"group:\")}\")"))
    }
}
