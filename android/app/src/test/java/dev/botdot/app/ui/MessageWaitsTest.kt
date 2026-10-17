package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.Attachment
import dev.botdot.app.data.Bot
import dev.botdot.app.data.ChiefChat
import dev.botdot.app.data.FeedEvent
import dev.botdot.app.data.Queued
import dev.botdot.app.data.TakenBack
import dev.botdot.app.data.queuedOn
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A message of the owner that waits its turn (`message-waits`; "The contract" of BUSY-001 and BUSY-002): which
 * message box a chat has, the list of what waits as the server hands it out and as the feed changes it, and
 * "Take back". `test/message-waits-web.test.js` holds the web page's side.
 */
class MessageWaitsTest {
    private fun event(type: String, data: String) = FeedEvent("boot.4", type, Json.parseToJsonElement(data).jsonObject)
    private val file = Attachment(name = "log.txt", file = "u1/log.txt", size = 10)
    private val fileJson = """{"name":"log.txt","file":"u1/log.txt","size":10}"""
    private val second = """{"id":"q1","text":"Also check tonight's backup.","attachments":[$fileJson],"at":"2026-10-06T09:00:00.000Z"}"""
    private val third = """{"id":"q2","text":"And the disk.","attachments":[],"at":"2026-10-06T09:01:00.000Z"}"""

    @Test fun sendStaysOnlyWhereTheServerLetsAMessageWait() {
        val now = listOf("events", "message-key", "message-waits")
        val before = listOf("events", "message-key", "ask-continues", "connector-waits") // Milestone 6
        assertTrue(sendStays(now))
        assertFalse(sendStays(before))
        assertFalse("not known yet: the box as it was", sendStays(null))
        // The box shows Stop in Send's place only against a botdot from before, while something works.
        assertFalse(boxStops(busy = true, features = now))
        assertFalse(boxStops(busy = false, features = now))
        assertTrue(boxStops(busy = true, features = before))
        assertTrue(boxStops(busy = true, features = null))
        assertFalse(boxStops(busy = false, features = before))
    }

    @Test fun aBotAndAChiefChatCarryWhatWaitsOldestFirst() {
        val bots = Api.JSON.decodeFromString(ListSerializer(Bot.serializer()), """[{"id":"doctor","name":"Fleet Doctor","queued":[$second,$third]},{"id":"news","name":"News","queued":[]},{"id":"old","name":"From Milestone 6"}]""")
        assertEquals(listOf(Queued("q1", "Also check tonight's backup.", listOf(file), "2026-10-06T09:00:00.000Z"), Queued("q2", "And the disk.", emptyList(), "2026-10-06T09:01:00.000Z")), bots[0].queued)
        assertEquals(emptyList<Queued>(), bots[1].queued)
        assertEquals("a server without the feature sends none", emptyList<Queued>(), bots[2].queued)

        val chat = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","busy":true,"messages":[{"role":"user","text":"Find a flight"},{"role":"chief","pending":true}],"queued":[$third]}""")
        assertEquals(listOf("q2"), chat.queued.map { it.id })
        assertEquals("it is not among the messages until its turn starts", 2, chat.messages.size)
        assertEquals(emptyList<Queued>(), Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","messages":[]}""").queued)
    }

    @Test fun anEntryThisAppCannotReadLeavesTheOthersAndTheBot() {
        // One without an id cannot be taken back and is left out; odd files are no files; a list that is no list is none.
        val odd = Api.JSON.decodeFromString(Bot.serializer(), """{"id":"b","name":"B","queued":[{"text":"no id"},7,{"id":"q3","text":"ok","attachments":"none"},{"id":"q4"}]}""")
        assertEquals(listOf(Queued("q3", "ok"), Queued("q4")), odd.queued)
        assertEquals(emptyList<Queued>(), Api.JSON.decodeFromString(Bot.serializer(), """{"id":"b","name":"B","queued":"soon"}""").queued)
    }

    @Test fun theFeedsEventBringsTheListOfItsChat() {
        val had = Api.JSON.decodeFromString(ListSerializer(Bot.serializer()), """[{"id":"doctor","name":"Fleet Doctor","queued":[$second]},{"id":"news","name":"News","queued":[$third]}]""")
        fun after(ev: FeedEvent) = queuedOn(had, ev).map { b -> b.id to b.queued.map { it.id } }
        // A message was taken: the bot's list as it stands now; the other bot's as it was.
        val taken = event("queued", """{"type":"queued","chat":"bot:doctor","botId":"doctor","queued":[$second,$third]}""")
        assertEquals(listOf("doctor" to listOf("q1", "q2"), "news" to listOf("q2")), after(taken))
        // It started, or was taken back: gone from the list.
        assertEquals(listOf("doctor" to emptyList(), "news" to listOf("q2")), after(event("queued", """{"chat":"bot:doctor","botId":"doctor","queued":[]}""")))
        // Another kind of event, one without a list, and one about a bot the app does not have change nothing.
        assertSame(had, queuedOn(had, event("run_started", """{"botId":"doctor","chat":"bot:doctor","queued":[]}""")))
        assertSame(had, queuedOn(had, event("queued", """{"chat":"bot:doctor","botId":"doctor"}""")))
        assertEquals(had, queuedOn(had, event("queued", """{"chat":"bot:gone","botId":"gone","queued":[$third]}""")))
        // A Chief chat's event names its chat the same way: its chat takes the list, the bots stay as they are.
        val chief = event("queued", """{"type":"queued","chat":"chief:c1","chatId":"c1","queued":[$third]}""")
        assertSame(had, queuedOn(had, chief))
        val (chat, list) = Queued.event(chief)!!
        assertEquals("chief:c1" to listOf("q2"), chat to Queued.list(list).map { it.id })
        val open = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","busy":true,"messages":[],"queued":[]}""")
        assertEquals(listOf("q2"), open.copy(queuedValue = list).queued.map { it.id })
        assertNull(Queued.event(event("unread", """{"chat":"chief:c1","unread":0}""")))
    }

    @Test fun whatWaitsSaysWhatItWaitsFor() {
        assertEquals("Waits until Fleet Doctor is free", waitsUntil("Fleet Doctor"))
        assertEquals("Waits until the Chief is free", waitsUntil("the Chief"))
    }

    @Test fun takeBackPutsTheTextAndFilesInTheBoxAsAFailedSendDoes() = runBlocking {
        val box = Outbox()
        assertTrue(box.takeBack { TakenBack("Also check tonight's backup.", listOf(file)) })
        assertNull("no line", box.note)
        assertEquals(FailedSend("Also check tonight's backup.", listOf(file)), box.take())
        assertNull(box.take())
        // In front of a failed message that still waits for the box.
        box.send("typed later", emptyList(), box = true) { throw ApiException("down") }
        box.takeBack { TakenBack("taken back", listOf(file)) }
        assertEquals(FailedSend("taken back\ntyped later", listOf(file)), box.take())
        // The line of a take back that came too late goes with the next one that works: the box holds another message now.
        box.takeBack { throw ApiException("It has already started.", 409, said = true) }
        assertEquals("It has already started.", box.note)
        assertTrue(box.takeBack { TakenBack("the next one", emptyList()) })
        assertNull(box.note)
    }

    @Test fun takenBackTooLateTheLineSaysItHasStarted() = runBlocking {
        val box = Outbox()
        assertFalse(box.takeBack { throw ApiException("It has already started.", 409, said = true) })
        assertEquals("It has already started.", box.note)
        assertNull("nothing comes back: its run has it", box.back)
        // Also when the answer carried no sentence this app could read.
        assertEquals("It has already started.", takeBackNote(ApiException("botdot answered 409", 409)))
        // Any other refusal in botdot's words; not reached: it still waits.
        assertEquals("Only the owner can do that.", takeBackNote(ApiException("Only the owner can do that.", 403, said = true)))
        assertEquals("It is no longer waiting.", takeBackNote(ApiException("botdot answered 404", 404)))
        assertEquals("Not taken back: can't reach botdot.", takeBackNote(ApiException("Can't reach botdot. Is Tailscale on? (timeout)")))
        assertEquals("Not taken back: can't reach botdot.", takeBackNote(ApiException("botdot answered 502", 502)))
        assertEquals("botdot answered, without a sentence", "Not taken back: botdot couldn't do that (500).", takeBackNote(ApiException("botdot answered 500", 500)))
        // The line goes when the owner edits, as a failed send's does.
        box.edited()
        assertNull(box.note)
    }

    @Test fun takenBackHereItLeavesTheListBeforeTheServerSaysSo() {
        val list = Json.parseToJsonElement("[$second,$third]")
        assertEquals(listOf("q2"), Queued.list(without(list, "q1")).map { it.id })
        assertEquals(listOf("q1", "q2"), Queued.list(without(list, "q9")).map { it.id })
        assertNull(without(null, "q1"))
    }

    @Test fun theEleventhMessageStaysInTheBoxWithTheServersSentence() = runBlocking {
        val box = Outbox()
        val refused = ApiException("Fleet Doctor already has 10 of your messages waiting. Take one back, or wait.", 429, said = true)
        assertFalse(box.send("one more", listOf(file), box = true, once = true) { throw refused })
        assertEquals("Not sent: Fleet Doctor already has 10 of your messages waiting. Take one back, or wait. Your message is still here.", box.note)
        assertEquals(FailedSend("one more", listOf(file)), box.take())
    }

    @Test fun aQueuedAnswerIsAMessageThatWent() = runBlocking {
        // The request answered: whatever its shape, the box keeps nothing and says nothing.
        val box = Outbox()
        assertTrue(box.send("while it works", emptyList(), box = true) { })
        assertNull(box.note)
        assertNull(box.back)
    }
}
