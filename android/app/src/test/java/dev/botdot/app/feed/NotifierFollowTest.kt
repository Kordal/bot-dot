package dev.botdot.app.feed

import dev.botdot.app.data.FeedEvent
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Notifications follow the botdot server's unread state (ADR 005, docs/api.md "New replies"): the events are those
 * the server sends, as lib/bots.js and lib/chief.js make them.
 */
class NotifierFollowTest {
    private fun event(type: String, data: String, id: String = "boot.9") = FeedEvent(id, type, Json.parseToJsonElement(data).jsonObject)
    private val now = Standing(follows = true)
    private val before = Standing(follows = false)
    private fun run(more: String) = event("run_finished", """{"id":"r1","botId":"news","botName":"News","botColor":"#3b82f6","status":"success","result":"Found 3 articles."$more}""")
    private fun notifies(ev: FeedEvent, s: Standing = now) = replyNotifies(ev, if (ev.type == "run_finished") "bot:news" else "chief:c1", s)

    @Test fun `a reply the server counts as new notifies, and no other`() {
        assertTrue(notifies(run(""","notificationAudience":"owner","new":true""")))
        assertTrue("a run that didn't finish", notifies(event("run_finished", """{"botId":"news","status":"error","error":"boom","notificationAudience":"owner","new":true}""")))
        assertTrue(notifies(event("chief_reply", """{"chatId":"c1","title":"Plans","status":"success","text":"Done.","new":true}""")))
        assertTrue("a bot's reply posted in a Chief chat", notifies(event("chief_reply", """{"chatId":"c1","from":{"id":"news","name":"News"},"text":"Here.","new":true}""")))
        // Without `new` the reply doesn't count, or was read at once because an app shows its chat.
        assertFalse("read at once: its chat is on screen in some app", notifies(run(""","notificationAudience":"owner"""")))
        assertFalse(notifies(event("chief_reply", """{"chatId":"c1","status":"success","text":"Done."}""")))
        assertFalse("new must be true", notifies(run(""","new":false""")))
    }

    @Test fun `a quiet run and a bot-to-bot exchange never notify`() {
        assertFalse(notifies(run(""","trigger":"schedule","quiet":true,"notificationAudience":"owner"""")))
        assertFalse(notifies(run(""","trigger":"bot","fromBot":{"id":"peer","name":"Peer"},"notificationAudience":"internal"""")))
        assertFalse("a task the Chief handed over", notifies(run(""","startedBy":"chief","passedOn":true,"notificationAudience":"internal"""")))
    }

    @Test fun `the server decides, not what this phone or the web page shows`() {
        val new = run(""","notificationAudience":"owner","new":true""")
        // The server would have left `new` out if the chat were on screen: the phone does not second-guess it.
        assertTrue(notifies(new, Standing(follows = true, watching = "bot:news")))
        assertTrue("webActive is for apps from before", notifies(new, Standing(follows = true, webActive = true)))
    }

    @Test fun `reading the chat in any app removes its notification`() {
        assertEquals("bot:news", chatRead(event("unread", """{"chat":"bot:news","unread":0,"firstUnread":null,"readAt":"2026-10-02T10:00:00.000Z"}"""), now))
        assertEquals("chief:c1", chatRead(event("unread", """{"chat":"chief:c1","unread":0,"firstUnread":null}"""), now))
        assertNull("a new reply came: nothing goes", chatRead(event("unread", """{"chat":"bot:news","unread":2,"firstUnread":"r1"}"""), now))
        assertNull("no count is not a count of 0", chatRead(event("unread", """{"chat":"bot:news"}"""), now))
        assertNull("not a chat", chatRead(event("unread", """{"chat":"needs","unread":0}"""), now))
        assertNull("chat_seen is for apps from before", chatRead(event("chat_seen", """{"chat":"bot:news"}"""), now))
    }

    @Test fun `after a reconnect, a chat read meanwhile loses its notification and nothing is made again`() {
        val plan = catchUpOf(showing = setOf("bot:news", "chief:c1"), unread = setOf("chief:c1", "bot:mail"), rebuild = false, watching = null)
        assertEquals(setOf("bot:news"), plan.remove)
        assertEquals("what was missed is replayed, and notifies by itself", emptySet<String>(), plan.rebuild)
        // The replay is followed in order: a reply, the chat read on the web page, another reply. The first is
        // taken away by the read, the second stays.
        val replayed = listOf(
            run(""","new":true"""),
            event("unread", """{"chat":"bot:news","unread":0}"""),
            run(""","new":true"""),
        )
        var shows = 0
        for (ev in replayed) {
            if (ev.type == "run_finished" && replyNotifies(ev, "bot:news", now)) shows++
            if (chatRead(ev, now) == "bot:news") shows = 0
        }
        assertEquals(1, shows)
    }

    @Test fun `after the app restarts, or when nothing could be replayed, notifications match the server's unread state`() {
        val plan = catchUpOf(showing = setOf("bot:news", "chief:c1"), unread = setOf("chief:c1", "bot:mail", "bot:todo"), rebuild = true, watching = "bot:todo")
        assertEquals("none for read chats", setOf("bot:news"), plan.remove)
        assertEquals("one for each unread chat that has none, except the one on screen", setOf("bot:mail"), plan.rebuild)
        assertEquals(emptySet<String>(), catchUpOf(emptySet(), emptySet(), rebuild = true, watching = null).rebuild)
        // An event that arrived while the server was being asked is newer than its answer: its chat is left alone.
        val raced = catchUpOf(showing = setOf("bot:news"), unread = setOf("bot:mail"), rebuild = true, watching = null, touched = setOf("bot:news", "bot:mail"))
        assertEquals("a reply just notified for a chat the answer calls read", emptySet<String>(), raced.remove)
        assertEquals("a reply just notified by itself, or the chat was just read", emptySet<String>(), raced.rebuild)
    }

    @Test fun `the opening line never notifies`() {
        val line = event("opening_line", """{"chat":"bot:news","botId":"news","runId":"r1","text":"Checking the news"}""")
        assertFalse(replyNotifies(line, "bot:news", now))
        assertFalse("nor for a scheduled run", replyNotifies(event("opening_line", """{"chat":"bot:news","botId":"news","runId":"r2","text":"Reading the papers","trigger":"schedule"}"""), "bot:news", now))
        assertNull(chatRead(line, now))
    }

    @Test fun `against a server without unread state, notifications behave as before`() {
        val owner = run(""","notificationAudience":"owner"""")
        assertTrue("no `new` from such a server: the reply notifies", notifies(owner, before))
        assertTrue(notifies(event("chief_reply", """{"chatId":"c1","status":"success","text":"Done."}"""), before))
        assertFalse("the chat is on screen here", notifies(owner, Standing(follows = false, watching = "bot:news")))
        assertTrue("another chat is", notifies(owner, Standing(follows = false, watching = "bot:mail")))
        assertFalse("the web page is in use", notifies(owner, Standing(follows = false, webActive = true)))
        assertFalse(notifies(run(""","quiet":true"""), before))
        assertFalse(notifies(run(""","trigger":"bot","fromBot":{"id":"peer"}"""), before))
        assertFalse(notifies(event("chief_reply", """{"chatId":"c1","status":"stopped"}"""), before))
        assertEquals("bot:news", chatRead(event("chat_seen", """{"chat":"bot:news"}"""), before))
        assertNull("it sends no unread; one would be ignored", chatRead(event("unread", """{"chat":"bot:news","unread":0}"""), before))
    }

    @Test fun `what a finished run says`() {
        assertEquals("Found 3 articles.", runText("success", "Found 3 articles.", "", "", ""))
        assertEquals("Morning paper\nDone.", runText("success", "", "", "", "Morning paper"))
        assertEquals("It ran out of time.", runText("error", "", "It ran out of time.", "timeout", ""))
        assertEquals("Didn't finish: stopped", runText("stopped", "", "", "", ""))
    }
}
