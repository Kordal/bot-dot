package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.Attachment
import dev.botdot.app.data.ChiefChat
import dev.botdot.app.data.ChiefMessage
import dev.botdot.app.data.GroupItem
import dev.botdot.app.data.GroupMessage
import dev.botdot.app.data.GroupSent
import dev.botdot.app.data.Queued
import dev.botdot.app.data.Run
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The sent message is there at once (ALV-006): from Send until the botdot server answered, the chat draws the
 * owner's own words and files and "Working…" under them; the server's version then takes their place, once; a send
 * that failed takes them away and the box has them again. In a bot's chat, a Chief chat and a group, and for a quick
 * answer as for a typed message. `FailedSendTest` and `MessageWaitsTest` hold what a failed send and a waiting
 * message did before, which stays as it was.
 */
class SentAtOnceTest {
    private val file = Attachment(name = "a.pdf", file = "u1/a.pdf", size = 10)
    private fun mine(id: String, prompt: String, status: String = "success", files: List<Attachment>? = null) =
        Run(id = id, botId = "doctor", prompt = prompt, customPrompt = true, status = status, attachments = files)

    /** A send whose request waits for [answer]: what the chat holds between Send and the answer is looked at meanwhile. */
    private fun during(box: Outbox, text: String, files: List<Attachment> = emptyList(), fromBox: Boolean = true, key: String? = null, known: Set<String> = emptySet(), then: suspend () -> Unit = {}, look: () -> Unit): Boolean = runBlocking {
        val answer = CompletableDeferred<Unit>()
        // As the chats start it: in the tap itself.
        val went = async(start = CoroutineStart.UNDISPATCHED) { box.send(text, files, fromBox, key, known = known) { answer.await(); then() } }
        look()
        answer.complete(Unit)
        went.await()
    }

    @Test fun onSendTheMessageAndWorkingAreThereBeforeTheAnswer() {
        val box = Outbox()
        var runs = listOf(mine("r1", "Earlier"))
        val went = during(box, "Check the backup", listOf(file), known = setOf("r1"), then = { runs = withAnswer(runs, mine("r2", "Check the backup", "running", listOf(file))) }) {
            // Nothing has answered yet: the owner's words and files stand in the chat, and "Working…" under them.
            val sent = box.sent!!.unlessIn(ownWords(runs, emptyList()))!!
            assertEquals("Check the backup" to listOf(file), sent.text to sent.attachments)
            assertEquals("Working…", lineWith("", sent))
            assertTrue(box.sending)
        }
        assertTrue(went)
        // The answer came: one message stands, the server's, and the line is the run's own.
        assertNull(box.sent)
        assertEquals(listOf("r2", "r1"), runs.map { it.id })
        assertEquals("", lineWith("", box.sent))
    }

    @Test fun theLineKeepsItsOwnWordsAndSaysWorkingOnlyWhileAMessageIsOnItsWay() {
        val sent = SentMessage("k1", "hi")
        assertEquals("Working…", lineWith("", sent))
        assertEquals("the bot's own line wins", "Checking the disk…", lineWith("Checking the disk…", sent))
        assertEquals("", lineWith("", null))
        assertEquals("Thinking…", lineWith("Thinking…", null))
    }

    @Test fun theSameSendAgainMakesNoSecondMessage() {
        val box = Outbox()
        var runs = emptyList<Run>()
        val keys = ArrayList<String>()
        // The first try's answer is lost: nothing stays in the chat, and the box has the message again with the line.
        assertFalse(during(box, "Check the backup", then = { throw ApiException("dropped", sent = true) }) { keys += box.sent!!.key })
        assertNull(box.sent)
        assertEquals(FailedSend("Check the backup", emptyList()), box.take())
        // Sent again as it is: the same key, so botdot answers the run it started the first time.
        assertTrue(during(box, "Check the backup", then = { runs = withAnswer(runs, mine("r1", "Check the backup", "running")) }) { keys += box.sent!!.key })
        assertEquals(1, keys.distinct().size)
        // And once more, answered with that same run (`again`): still one.
        runs = withAnswer(runs, mine("r1", "Check the backup", "running"))
        assertEquals(listOf("r1"), runs.map { it.id })
        // A run the feed brought, further on than the answer, stays as it is.
        val done = listOf(mine("r1", "Check the backup", "success"))
        assertEquals("success", withAnswer(done, mine("r1", "Check the backup", "running")).single().status)
    }

    @Test fun theServersVersionBroughtByTheFeedBeforeTheAnswerIsNotDrawnTwice() {
        val box = Outbox()
        val had = listOf(mine("r1", "Check the backup")) // the same words, sent before: not this message
        during(box, "Check the backup ", listOf(file), known = setOf("r1")) {
            assertEquals("an older message with the same words hides nothing", "Check the backup ", box.sent!!.unlessIn(ownWords(had, emptyList()))?.text)
            // The feed's refresh brings the run before the request answers: the local one gives way to it.
            val now = listOf(mine("r2", "Check the backup", "running", listOf(file))) + had
            assertNull(box.sent!!.unlessIn(ownWords(now, emptyList())))
            // Not for other words, other files, or a run the owner did not start.
            assertEquals(box.sent, box.sent!!.unlessIn(ownWords(listOf(mine("r2", "Check the disk", "running", listOf(file))), emptyList())))
            assertEquals(box.sent, box.sent!!.unlessIn(ownWords(listOf(mine("r2", "Check the backup", "running")), emptyList())))
            assertEquals(box.sent, box.sent!!.unlessIn(ownWords(listOf(Run(id = "r2", prompt = "Check the backup", jobName = "Nightly", status = "running", attachments = listOf(file))), emptyList())))
            // Nor twice when it came as a message that waits.
            assertNull(box.sent!!.unlessIn(ownWords(had, listOf(Queued("r2", "Check the backup", listOf(file))))))
        }
    }

    @Test fun aMessageToAWorkingBotBecomesTheWaitingMessageTheServerReports() {
        val box = Outbox()
        var queued = listOf(Queued("q1", "Also tonight's"))
        // The answer is a run that waits (QueuedAnswerTest): its id is what "Take back" names.
        val answer = Api.JSON.decodeFromString(Run.serializer(), """{"id":"r2","botId":"doctor","status":"queued","prompt":"And the disk","attachments":[],"queuedAt":"2026-10-09T09:01:00.000Z"}""")
        assertTrue(answer.isQueued)
        during(box, "And the disk", listOf(file), known = setOf("q1"), then = { queued = withWaiting(queued, Queued(answer.id, "And the disk", listOf(file))) }) {
            assertEquals("And the disk", box.sent!!.unlessIn(ownWords(emptyList(), queued))?.text)
        }
        assertNull(box.sent)
        assertEquals(listOf(Queued("q1", "Also tonight's"), Queued("r2", "And the disk", listOf(file))), queued)
        // The same answer again (a repeat), and the feed's own list: one entry.
        assertEquals(2, withWaiting(queued, Queued("r2", "And the disk", listOf(file))).size)
        // The list the app keeps of the bot, as the server sent it, has it too, oldest first.
        val kept = Json.parseToJsonElement("""[{"id":"q1","text":"Also tonight's","attachments":[]}]""")
        val now = withWaiting(kept, Queued("r2", "And the disk", listOf(file), "2026-10-09T09:01:00.000Z"))
        assertEquals(listOf(Queued("q1", "Also tonight's"), Queued("r2", "And the disk", listOf(file), "2026-10-09T09:01:00.000Z")), Queued.list(now))
        assertEquals(2, Queued.list(withWaiting(now, Queued("r2", "And the disk"))).size)
        assertEquals("a bot that had no list", listOf("r2"), Queued.list(withWaiting(null, Queued("r2", "And the disk"))).map { it.id })
    }

    @Test fun aFailedSendLeavesNoMessageInTheChatAndTheBoxAsToday() {
        val box = Outbox()
        val refused = ApiException("This bot is paused.", 409, said = true)
        assertFalse(during(box, "Do the thing", listOf(file), then = { throw refused }) { assertEquals("Do the thing", box.sent?.text) })
        assertNull("nothing of it stays in the chat", box.sent)
        assertEquals("", lineWith("", box.sent))
        assertEquals("Not sent: This bot is paused. Your message is still here.", box.note)
        assertEquals(FailedSend("Do the thing", listOf(file)), box.take())
        assertFalse(box.sending)
    }

    @Test fun aQuickAnswerIsThereAtOnceLikeATypedMessage() {
        val box = Outbox()
        // Tapped: it comes with its own key and is drawn as a typed message is.
        assertTrue(during(box, "Yes", fromBox = false, key = "answer-key-1") {
            assertEquals(SentMessage("answer-key-1", "Yes"), box.sent)
            assertEquals("Working…", lineWith("", box.sent))
        })
        assertNull(box.sent)
        // One that failed leaves the chat, and stays where it was tapped: nothing goes to the box.
        assertFalse(during(box, "Yes", fromBox = false, key = "answer-key-1", then = { throw ApiException("down") }) { assertEquals("Yes", box.sent?.text) })
        assertNull(box.sent)
        assertNull(box.back)
    }

    @Test fun onlyOneMessageIsOnItsWayAndASecondChangesNothingOfIt() = runBlocking {
        val box = Outbox()
        val answer = CompletableDeferred<Unit>()
        val first = async(start = CoroutineStart.UNDISPATCHED) { box.send("first", emptyList(), box = true) { answer.await() } }
        assertFalse(box.send("second", emptyList(), box = true) { })
        assertEquals("first", box.sent?.text)
        answer.complete(Unit)
        assertTrue(first.await())
        assertNull(box.sent)
        assertEquals("second", box.take()?.text)
    }

    @Test fun inAChiefChatTheAnswerIsTheChatWithTheMessageInIt() {
        val box = Outbox()
        val user = ChiefMessage(role = "user", text = "Find a flight")
        val reply = ChiefMessage(role = "chief", text = "Here it is")
        // A long chat, read from its message 10 on, with a new reply the app knows of.
        var chat: ChiefChat? = ChiefChat(id = "c1", messages = listOf(user, reply), offset = 10, total = 12, unread = 1, firstUnread = 11)
        val whole = List(10) { ChiefMessage(role = "user", text = "old $it") } + user + reply
        val answer = ChiefChat(id = "c1", messages = whole + ChiefMessage(role = "user", text = "And a hotel", attachments = listOf(file)) + ChiefMessage(role = "chief", pending = true), busy = true)
        val known = ownWords(chat).mapTo(HashSet()) { it.id }
        assertEquals(setOf("at:10"), known)
        during(box, "And a hotel", listOf(file), known = known, then = { chat = withAnswer(chat, answer) }) {
            val sent = box.sent!!.unlessIn(ownWords(chat))!!
            assertEquals("And a hotel" to listOf(file), sent.text to sent.attachments)
            assertEquals("Working…", lineWith("", sent))
        }
        assertNull(box.sent)
        // The loaded part goes on from where it started, with the message once and the Chief replying.
        val now = chat!!
        assertEquals(listOf("Find a flight", "Here it is", "And a hotel", ""), now.messages.map { it.text })
        assertEquals(listOf(10, 14, 1, 11), listOf(now.offset, now.total, now.unread, now.firstUnread))
        assertTrue(now.busy)
        // The same message sent again answers the chat as it is: nothing is added.
        assertEquals(now, withAnswer(now, answer))
        // The server's message brought by a refresh before the answer: the local one gives way.
        assertNull(SentMessage("k", "And a hotel", listOf(file), known = known).unlessIn(ownWords(now)))
        assertEquals("the same words from before Send hide nothing", "Find a flight", SentMessage("k", "Find a flight", known = known).unlessIn(ownWords(now))?.text)
    }

    @Test fun aFirstMessageStandsInItsNewChiefChatAndInNoOther() {
        val box = Outbox()
        var chat: ChiefChat? = null
        val answer = ChiefChat(id = "c9", messages = listOf(ChiefMessage(role = "user", text = "Hello"), ChiefMessage(role = "chief", pending = true)), busy = true)
        during(box, "Hello", then = { box.sentIn("c9"); chat = withAnswer(chat, answer) }) {
            // No chat yet: it belongs to the new one (null), not to another the owner opens meanwhile.
            assertNull(box.sent!!.chat)
            box.sentIn("c9") // its chat was made
            assertEquals("c9", box.sent!!.chat)
        }
        assertEquals(listOf("Hello", ""), chat!!.messages.map { it.text })
        assertEquals("all of it, as a botdot from before parts sends a chat: the next look reads its page", -1, chat!!.total)
        // An answer with nothing to draw leaves a chat that is not loaded as it was.
        assertNull(withAnswer(null, ChiefChat(id = "c9")))
    }

    @Test fun toAReplyingChiefTheMessageIsAmongThoseThatWait() {
        val had = ChiefChat(id = "c1", messages = listOf(ChiefMessage(role = "user", text = "Find a flight"), ChiefMessage(role = "chief", pending = true)), busy = true, total = 2)
        val answer = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","busy":true,"messages":[{"role":"user","text":"Find a flight"},{"role":"chief","pending":true}],"queued":[{"id":"q1","text":"And a hotel","attachments":[]}]}""")
        val sent = SentMessage("k1", "And a hotel", known = ownWords(had).mapTo(HashSet()) { it.id })
        assertEquals(sent, sent.unlessIn(ownWords(had)))
        val now = withAnswer(had, answer)!!
        assertEquals(listOf("q1"), now.queued.map { it.id })
        assertEquals(2, now.messages.size)
        assertNull("the waiting message is the server's now", sent.unlessIn(ownWords(now)))
        // An answer that is no whole chat (fewer messages than are loaded) changes only what waits.
        val part = withAnswer(had.copy(offset = 5, total = 7), answer)!!
        assertEquals(2 to 5, part.messages.size to part.offset)
        assertEquals(listOf("q1"), part.queued.map { it.id })
    }

    @Test fun inAGroupTheAnswerOrTheFeedPutsTheServersMessageInItsPlace() {
        val box = Outbox()
        val before = GroupItem.Message(GroupMessage("m1", "Who can look at this?", "2026-10-09T09:00:00.000Z"))
        var rows: List<GroupItem> = listOf(before)
        val known = ownWords(rows).mapTo(HashSet()) { it.id }
        val taken = GroupSent.of("""{"id":"m2","text":"Who can look at this?","at":"2026-10-09T09:05:00.000Z","attachments":[{"name":"a.pdf","file":"u1/a.pdf","size":10}],"to":["coder"],"next":["coder"],"canTakeBack":true}""")
        during(box, "Who can look at this?", listOf(file), known = known, then = { rows = rows + taken.held.map(GroupItem::Message) }) {
            val sent = box.sent!!.unlessIn(ownWords(rows))!!
            assertEquals("the same words written before are another message", listOf(file), sent.attachments)
            assertEquals("Working…", lineWith("", sent))
            // The feed's `group_message` brings it before the request answers: drawn once.
            assertNull(box.sent!!.unlessIn(ownWords(rows + taken.held.map(GroupItem::Message))))
        }
        assertNull(box.sent)
        assertEquals(listOf("m1", "m2"), ownWords(rows).map { it.id })
    }

    @Test fun goOnTypedInAStoppedGroupIsNoMessageAndIsNotDrawn() {
        for (words in listOf("Go on", "go on", " GO  ON! ", "**Go on**", "\"go on.\"")) assertTrue(words, isGoOn(words))
        for (words in listOf("Go on with the report", "Goon", "on", "")) assertFalse(words, isGoOn(words))
        val box = Outbox()
        runBlocking {
            val answer = CompletableDeferred<Unit>()
            val went = async(start = CoroutineStart.UNDISPATCHED) { box.send("Go on", emptyList(), box = true, draw = false) { answer.await() } }
            assertNull(box.sent)
            assertTrue(box.sending)
            answer.complete(Unit)
            assertTrue(went.await())
        }
    }
}
