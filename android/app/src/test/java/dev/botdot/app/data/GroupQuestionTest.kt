package dev.botdot.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * An owner's message that answers a member's question (docs/api.md, "question"): the question is shown above it,
 * unless it stands right under the reply that asked, as `public/groups.js` groupQuestionHTML has it.
 */
class GroupQuestionTest {
    private fun message(more: String = "") =
        (GroupItem.of(Json.parseToJsonElement("""{"type":"message","id":"m2","text":"The clean one","at":"2026-11-10T09:05:00Z"$more}""")) as GroupItem.Message).message
    private fun reply(id: String, bot: String) =
        GroupItem.Reply(id, "2026-11-10T09:01:00Z", Run(id = id, botId = bot, botName = bot, status = "success", result = "$bot says"))
    private val asked = ""","question":{"runId":"r1","botId":"coder","botName":"Coder","text":"Which one?"}"""

    @Test fun theQuestionIsReadAndShownWhenSomethingStandsBetween() {
        val m = message(asked)
        assertEquals(GroupQuestion("r1", "coder", "Coder", "Which one?"), m.question)
        assertEquals("r1", Groups.questionAbove(m, reply("r2", "reviewer"))?.runId)
        assertEquals("r1", Groups.questionAbove(m, null)?.runId)
    }

    @Test fun rightUnderTheReplyThatAskedNothingIsShown() {
        assertNull(Groups.questionAbove(message(asked), reply("r1", "coder")))
    }

    @Test fun aMessageWithoutOneOrWithOneItCannotReadIsAsBefore() {
        assertNull(message().question)
        assertNull(message(""","question":"r1"""").question)
        assertNull(message(""","question":{"runId":"r1"}""").question)
        assertNull(message(""","question":{"text":"Which one?"}""").question)
        assertNull(message(""","question":{"runId":"r1","text":"  "}""").question)
    }
}
