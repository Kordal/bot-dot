package dev.botdot.app.ui

import dev.botdot.app.data.ChiefChat
import dev.botdot.app.data.ChiefMessage
import dev.botdot.app.data.GroupItem
import dev.botdot.app.data.GroupMessage
import dev.botdot.app.data.Run
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A reply arrives, visibly (ALV-008): which replies of an open chat count as new, and so move once. A reply is told
 * by its id (the run's; the message's place in a Chief chat; the turn's in a group). Nothing is new when the chat
 * opens, when its lists are read again, or when older messages are loaded. The owner's own message moves once, on
 * Send, and not again when the server's version takes its place. With animations off nothing moves.
 */
class ArrivalsTest {
    private var clock = 1_000L
    private fun arrivals() = Arrivals { clock }
    private val none = emptySet<String>()

    // ---------- which replies are new ----------

    @Test fun openingAChatMarksNoneOfItsReplies() {
        val a = arrivals()
        assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2", "r3")))
        assertNull(a.since("r3"))
    }

    @Test fun aReplyWhoseIdIsNewInTheOpenChatArrivesOnce() {
        val a = arrivals()
        a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2"))
        clock = 5_000
        assertEquals(setOf("r3"), a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2", "r3")))
        assertEquals("when it came, for the movement", 5_000L, a.since("r3"))
        assertNull("the ones before it stand still", a.since("r2"))
        // Drawn again, as it is on every change of the screen: it is not new a second time.
        clock = 5_100
        assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2", "r3")))
        assertEquals("its one movement is not started again", 5_000L, a.since("r3"))
    }

    @Test fun aRefreshOfTheListsMarksNoneAgain() {
        val a = arrivals()
        a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2"))
        a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2", "r3"))
        // The newest runs are read again and put in place of those the chat had: the same ids.
        repeat(3) { assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2", "r3"))) }
    }

    @Test fun olderMessagesLoadedAboveDoNotArrive() {
        val a = arrivals()
        a.draw("bot:doctor", loaded = true, replies = listOf("r5", "r6"))
        assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2", "r3", "r4", "r5", "r6")))
        // And a reply that then comes at the end still does.
        assertEquals(setOf("r7"), a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2", "r3", "r4", "r5", "r6", "r7")))
    }

    @Test fun nothingIsNewWhileTheChatIsStillBeingRead() {
        val a = arrivals()
        assertEquals(none, a.draw("bot:doctor", loaded = false, replies = emptyList()))
        // What the first read brings is what was there when the chat opened.
        assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2")))
    }

    @Test fun theFirstReplyOfAChatThatOpenedEmptyArrives() {
        val a = arrivals()
        a.draw("bot:doctor", loaded = true, replies = emptyList())
        assertEquals(setOf("r1"), a.draw("bot:doctor", loaded = true, replies = listOf("r1")))
    }

    @Test fun severalRepliesThatCameTogetherAllArrive() {
        val a = arrivals()
        a.draw("group:g1", loaded = true, replies = listOf("t1"))
        assertEquals(setOf("t2", "t3"), a.draw("group:g1", loaded = true, replies = listOf("t1", "t2", "t3")))
    }

    @Test fun aChatReadFromScratchMarksNone() {
        val a = arrivals()
        a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2"))
        // More came than one look brings, and the chat started over: none of what it drew is among them.
        assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r20", "r21", "r22")))
        assertEquals(setOf("r23"), a.draw("bot:doctor", loaded = true, replies = listOf("r20", "r21", "r22", "r23")))
    }

    @Test fun aReplyThatLeftAndCameBackDoesNotArriveAgain() {
        val a = arrivals()
        a.draw("bot:doctor", loaded = true, replies = listOf("r1"))
        a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2"))
        a.draw("bot:doctor", loaded = true, replies = listOf("r1"))
        assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2")))
    }

    // ---------- the owner's own message ----------

    @Test fun theOwnersMessageArrivesOnSendAndNotAgainWhenTheServersTakesItsPlace() {
        val a = arrivals()
        a.draw("bot:doctor", loaded = true, replies = listOf("r1"))
        clock = 2_000
        assertEquals(setOf(Arrivals.sent("k1")), a.draw("bot:doctor", loaded = true, replies = listOf("r1"), sent = "k1"))
        assertEquals(2_000L, a.since(Arrivals.sent("k1")))
        // Still on its way: the same message, not new again.
        assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r1"), sent = "k1"))
        // The server answered: its run r2 is in the chat, at work, and the local message is gone. Nothing arrives:
        // the run's own row is the message that already stood there.
        assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r1")))
        // The run ended: its reply arrives.
        assertEquals(setOf("r2"), a.draw("bot:doctor", loaded = true, replies = listOf("r1", "r2")))
    }

    @Test fun aMessageThatWasOnItsWayWhenTheChatOpenedStandsStill() {
        val a = arrivals()
        assertEquals(none, a.draw("bot:doctor", loaded = true, replies = listOf("r1"), sent = "k1"))
        assertNull(a.since(Arrivals.sent("k1")))
    }

    @Test fun aFailedMessageSentAgainArrivesAgain() {
        val a = arrivals()
        a.draw("bot:doctor", loaded = true, replies = emptyList())
        a.draw("bot:doctor", loaded = true, replies = emptyList(), sent = "k1")
        a.draw("bot:doctor", loaded = true, replies = emptyList()) // it did not go, and is back in the message box
        clock = 9_000
        // Sent again as it is: it has the same key, and comes into the chat once more.
        assertEquals(setOf(Arrivals.sent("k1")), a.draw("bot:doctor", loaded = true, replies = emptyList(), sent = "k1"))
        assertEquals(9_000L, a.since(Arrivals.sent("k1")))
    }

    // ---------- the Chief's chats, which share one screen ----------

    @Test fun aNewChiefChatThatGotItsIdIsTheSameChat() {
        val a = arrivals()
        a.draw(null, loaded = true, replies = emptyList()) // a new chat: it has no id until the first message
        assertEquals(setOf(Arrivals.sent("k1")), a.draw(null, loaded = true, replies = emptyList(), sent = "k1"))
        // The chat was made and is read: the message keeps its one movement, and nothing is new.
        assertEquals(none, a.draw("c1", loaded = false, replies = emptyList(), sent = "k1"))
        assertEquals(1_000L, a.since(Arrivals.sent("k1")))
        assertEquals(none, a.draw("c1", loaded = true, replies = emptyList()))
        // The Chief's reply, the chat's second message, arrives.
        assertEquals(setOf("1"), a.draw("c1", loaded = true, replies = listOf("1")))
    }

    @Test fun anotherChatOnTheSameScreenOpensWithNothingNew() {
        val a = arrivals()
        a.draw("c1", loaded = true, replies = listOf("1", "3"))
        // The plus: a new chat. Then an older chat, read from the server.
        assertEquals(none, a.draw(null, loaded = true, replies = emptyList()))
        assertEquals(none, a.draw("c2", loaded = false, replies = emptyList()))
        assertEquals(none, a.draw("c2", loaded = true, replies = listOf("1", "3", "5")))
        assertEquals(setOf("7"), a.draw("c2", loaded = true, replies = listOf("1", "3", "5", "7")))
    }

    // ---------- reduced motion, and one movement only ----------

    @Test fun nothingMovesWithAnimationsOff() {
        assertTrue(arrivalMoves(since = 1_000, now = 1_000, still = false))
        assertFalse("the system's animation scale is 0", arrivalMoves(since = 1_000, now = 1_000, still = true))
    }

    @Test fun aReplyMovesOnlyWhileItsMovementLasts() {
        assertFalse("it was there already", arrivalMoves(since = null, now = 1_000, still = false))
        assertTrue(arrivalMoves(since = 1_000, now = 1_000 + ARRIVAL_MS - 1, still = false))
        // Scrolled away and back later, or drawn again: it stands.
        assertFalse(arrivalMoves(since = 1_000, now = 1_000 + ARRIVAL_MS, still = false))
    }

    // ---------- what a reply is, in each chat ----------

    @Test fun aBotsRepliesAreItsRunsThatEnded() {
        // Newest first, as the chat holds them. The run at work has no reply yet: its working line stands for it.
        val runs = listOf(Run(id = "r3", status = "running"), Run(id = "r2", status = "error"), Run(id = "r1", status = "success"))
        assertEquals(listOf("r1", "r2"), replyIds(runs))
        assertEquals("its reply came", listOf("r1", "r2", "r3"), replyIds(listOf(Run(id = "r3", status = "success")) + runs.drop(1)))
    }

    @Test fun aChiefChatsRepliesAreByTheirPlaceAndNeverTheOwnersOrOneStillWritten() {
        val chat = ChiefChat(id = "c1", offset = 10, messages = listOf(
            ChiefMessage(role = "user", text = "hi"),
            ChiefMessage(role = "chief", text = "Hello."),
            ChiefMessage(role = "report", text = "Done."),
            ChiefMessage(role = "user", text = "and now?"),
            ChiefMessage(role = "chief", pending = true),
        ))
        assertEquals(listOf("11", "12"), replyIds(chat))
        val done = chat.copy(messages = chat.messages.dropLast(1) + ChiefMessage(role = "chief", text = "Now this."))
        assertEquals(listOf("11", "12", "14"), replyIds(done))
        assertEquals(emptyList<String>(), replyIds(null as ChiefChat?))
    }

    @Test fun aGroupsRepliesAreItsTurnsAndNeverTheOwnersMessages() {
        val rows = listOf(
            GroupItem.Message(GroupMessage(id = "m1", text = "hi all", at = "2026-10-09T10:00:00Z")),
            GroupItem.Reply("t1", "2026-10-09T10:00:05Z", Run(id = "r1", status = "success")),
            GroupItem.Reply("t2", "2026-10-09T10:00:09Z", Run(id = "r2", status = "stopped")),
        )
        assertEquals(listOf("t1", "t2"), groupReplyIds(rows))
    }
}
