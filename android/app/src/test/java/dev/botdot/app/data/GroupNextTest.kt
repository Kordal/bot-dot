package dev.botdot.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Who is next in a group (docs/api.md, "A group's chat"): each of the owner's messages has `next`, the members
 * whose turn has not come, in the order they will have it. One row of heads is drawn under the group's working
 * lines, and [Groups.next] says whose: the messages are a group chat's, oldest first, as the server sends them,
 * and the members at work are its `working`.
 */
class GroupNextTest {
    private fun message(id: String, next: String = "[]", more: String = "") =
        GroupMessage.of(Json.parseToJsonElement("""{"id":"$id","text":"$id","at":"2026-10-09T09:0${id.last()}:00Z","to":["coder","reviewer","writer"],"waitsFor":[],"next":$next,"canTakeBack":false$more}"""))!!
    private fun works(botId: String, messageId: String?) = GroupWorking(botId, "run-$botId", messageId)
    private fun bot(id: String) = Bot(id = id, name = id.replaceFirstChar { it.uppercase() })

    @Test fun whileAMemberWorksTheMembersToComeStandInTheServersOrder() {
        val m = message("m1", """["writer","reviewer"]""")
        assertEquals(listOf("writer", "reviewer"), Groups.next(listOf(m), listOf(works("coder", "m1"))))
    }

    @Test fun betweenTwoTurnsTheMembersToComeStillStand() {
        val m = message("m1", """["reviewer","writer"]""")
        assertEquals(listOf("reviewer", "writer"), Groups.next(listOf(m), emptyList()))
    }

    @Test fun onlyWhatTheServersNextHoldsIsDrawn() {
        // The writer passed, is paused or was deleted: the server's `next` no longer has it, whoever the message was for.
        val m = message("m1", """["reviewer"]""")
        assertEquals(listOf("reviewer"), Groups.next(listOf(m), listOf(works("coder", "m1"))))
        // A member a reply handed the work on to is there once the server lists it, also one that replied already.
        val handed = message("m1", """["reviewer","coder"]""")
        assertEquals(listOf("reviewer", "coder"), Groups.next(listOf(handed), listOf(works("writer", "m1"))))
    }

    @Test fun ofTwoMessagesTheOneWhoseTurnsAreRunningIsShown() {
        val first = message("m1", """["reviewer","writer"]""")
        val second = message("m2", """["coder","reviewer","writer"]""")
        assertEquals("the older one runs: its row, not the newer one's", listOf("reviewer", "writer"), Groups.next(listOf(first, second), listOf(works("coder", "m1"))))
        assertEquals(listOf("coder", "reviewer", "writer"), Groups.next(listOf(first, second), listOf(works("coder", "m2"))))
        // The running one's last turn is at work: nothing is to come after that line, whatever another message waits for.
        assertEquals(emptyList<String>(), Groups.next(listOf(message("m1"), second), listOf(works("writer", "m1"))))
    }

    @Test fun ofTwoMessagesThatRunTheNewestWithMembersToComeIsShown() {
        val first = message("m1", """["writer"]""")
        val second = message("m2", """["reviewer"]""")
        val both = listOf(works("coder", "m1"), works("writer", "m2"))
        assertEquals(listOf("reviewer"), Groups.next(listOf(first, second), both))
        assertEquals("the newer one is at its last turn", listOf("writer"), Groups.next(listOf(first, message("m2")), both))
    }

    @Test fun whenNoneRunsTheNewestWithMembersToComeIsShown() {
        val first = message("m1", """["writer"]""")
        val second = message("m2", """["coder","reviewer"]""")
        assertEquals(listOf("coder", "reviewer"), Groups.next(listOf(first, second), emptyList()))
        assertEquals("the newer one is over", listOf("writer"), Groups.next(listOf(first, message("m2")), emptyList()))
    }

    @Test fun noHeadsWhenNextIsEmptyAfterTheLastTurnAndAfterStopAll() {
        assertEquals(emptyList<String>(), Groups.next(emptyList(), emptyList()))
        assertEquals("the last turn is at work", emptyList<String>(), Groups.next(listOf(message("m1")), listOf(works("writer", "m1"))))
        assertEquals("the last turn ended", emptyList<String>(), Groups.next(listOf(message("m1")), emptyList()))
        // "Stop all": the server empties the line. A stopped message is shown nothing of, whatever it still carries.
        assertEquals(emptyList<String>(), Groups.next(listOf(message("m1", more = ""","stopped":true""")), emptyList()))
        assertEquals(emptyList<String>(), Groups.next(listOf(message("m1", """["writer"]""", ""","stopped":true""")), emptyList()))
        assertEquals("an older line is not shown in its place while the stopped one's run ends",
            emptyList<String>(), Groups.next(listOf(message("m0", """["writer"]"""), message("m1", more = ""","stopped":true""")), listOf(works("coder", "m1"))))
    }

    @Test fun aMemberAtWorkWhoseMessageIsNotHeldShowsNothingOfAnother() {
        // The chat holds its newest page: a turn of a message further back is at work, and says nothing of this one.
        assertEquals(emptyList<String>(), Groups.next(listOf(message("m2", """["writer"]""")), listOf(works("coder", "m1"))))
        assertEquals(emptyList<String>(), Groups.next(listOf(message("m2", """["writer"]""")), listOf(works("coder", null))))
    }

    @Test fun theHeadsAreTheBotsTheAppKnowsInTheServersOrder() {
        val bots = listOf(bot("coder"), bot("reviewer"), bot("writer"))
        assertEquals(listOf("writer", "coder"), Groups.heads(listOf("writer", "gone", "coder"), bots).map { it.id })
        assertEquals(emptyList<Bot>(), Groups.heads(emptyList(), bots))
    }
}
