package dev.botdot.app.ui

import dev.botdot.app.answerview.ViewForm
import dev.botdot.app.data.ChiefMessage
import dev.botdot.app.data.GroupItem
import dev.botdot.app.data.GroupMessage
import dev.botdot.app.data.Run
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Which message of a chat an answer view may answer, and what the owner said after it (#1628, ADR 265), in each kind of chat. */
class ViewChatsTest {
    private fun run(id: String, prompt: String = "", status: String = "success", startedAt: String = "2026-11-24T10:0${id.last()}:00Z") =
        Run(id = id, botId = "doctor", prompt = prompt, customPrompt = prompt.isNotEmpty(), status = status, startedAt = startedAt)

    @Test fun inABotsChatTheNewestReplyThatIsWholeMayBeAnsweredAndTheNextMessageOfTheOwnerIsWhatWasSent() {
        val runs = listOf(run("r1", "Plan the trip"), run("r2", "Budget: 500"), run("r3", "More", status = "error"))
        val b = botBubbles(runs, later = listOf("on its way"))
        assertEquals("r2", ViewForm.newest(b)) // r3 failed
        assertEquals(listOf("Budget: 500"), ViewForm.ownersAfter(b, "r1"))
        assertEquals(listOf("More"), ViewForm.ownersAfter(b, "r2"))
        assertEquals(listOf("on its way"), ViewForm.ownersAfter(b, "r3"))
    }

    @Test fun aRunStillAtWorkIsNoMessageToAnswer() {
        val b = botBubbles(listOf(run("r1", "Hi"), run("r2", "Again", status = "running")), later = emptyList())
        assertEquals("r1", ViewForm.newest(b))
    }

    @Test fun inTheChiefsChatEachReplyIsNamedByItsPlaceInTheWholeChat() {
        val messages = listOf(ChiefMessage(role = "user", text = "Hi"), ChiefMessage(role = "chief", text = "A"), ChiefMessage(role = "user", text = "Budget: 500"), ChiefMessage(role = "chief", text = "B", pending = true))
        val b = chiefBubbles("c1", messages, first = 10, later = emptyList())
        assertEquals("c1:11", ViewForm.newest(b)) // c1:13 is still being written
        assertEquals(listOf("Budget: 500"), ViewForm.ownersAfter(b, "c1:11"))
        assertEquals(emptyList<String>(), ViewForm.ownersAfter(b, "c1:13"))
        assertEquals(setOf("c1:11"), setOf(chiefViewId("c1", 11))) // another chat's message 11 is another view
        assertEquals(false, chiefViewId("c2", 11) == chiefViewId("c1", 11))
    }

    @Test fun inAGroupTheOwnersMessagesAndTheMembersRepliesStandInTheOrderOfTheChat() {
        val rows = listOf<GroupItem>(
            GroupItem.Message(GroupMessage("m1", "Plan it", "2026-11-24T10:00:00Z")),
            GroupItem.Reply("t1", "2026-11-24T10:01:00Z", run("r1")),
            GroupItem.Message(GroupMessage("m2", "Name: Ada", "2026-11-24T10:02:00Z")),
            GroupItem.Reply("t2", "2026-11-24T10:03:00Z", run("r2")),
        )
        val b = groupBubbles(rows, later = emptyList())
        assertEquals("t2", ViewForm.newest(b))
        assertEquals(listOf("Name: Ada"), ViewForm.ownersAfter(b, "t1"))
    }
}
