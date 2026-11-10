package dev.botdot.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The team's one answer (ADR 184; docs/api.md, "The team's answer"): a message of a team's chat with `answer` has the
 * members' replies before that reply folded under one row ([Groups.folded], [Groups.shown]), as `public/groups.js`
 * groupFolded has them.
 */
class GroupFoldTest {
    private fun message(id: String, more: String = "") =
        GroupItem.of(Json.parseToJsonElement("""{"type":"message","id":"$id","text":"$id","at":"2026-11-10T09:00:00Z"$more}"""))!!
    private fun reply(id: String, bot: String, minute: Int, message: String = "m1") =
        GroupItem.Reply(id, "2026-11-10T09:0$minute:00Z", Run(id = id, botId = bot, botName = bot, status = "success", result = "$bot says", groupMessageId = message))

    private val rows = listOf(message("m1", ""","answer":"r3""""), reply("r1", "writer", 1), reply("r2", "reviewer", 2), reply("r3", "lead", 3), reply("r4", "writer", 4))

    @Test fun theRepliesBeforeTheAnswerAreFoldedNotTheAnswerNorWhatCameAfter() {
        assertEquals(mapOf("r1" to "m1", "r2" to "m1"), Groups.folded(rows))
        assertEquals("r3", (rows[0] as GroupItem.Message).message.answer)
    }

    @Test fun closedTheFoldIsOneRowWhereTheFirstStood() {
        val shown = Groups.shown(rows, emptySet())
        assertEquals(listOf("m1", "fold:m1", "r3", "r4"), shown.map { (it as? GroupItem)?.id ?: (it as Groups.Fold).id })
        val fold = shown[1] as Groups.Fold
        assertEquals(listOf("writer", "reviewer"), fold.runs.map { it.botId })
        assertEquals(false, fold.open)
    }

    @Test fun openedTheRepliesStandUnderTheRow() {
        val shown = Groups.shown(rows, setOf("m1"))
        assertEquals(listOf("m1", "fold:m1", "r1", "r2", "r3", "r4"), shown.map { (it as? GroupItem)?.id ?: (it as Groups.Fold).id })
    }

    @Test fun withoutAnAnswerOrItsReplyNothingIsFolded() {
        val plain = listOf(message("m1"), reply("r1", "writer", 1), reply("r2", "lead", 2))
        assertNull((plain[0] as GroupItem.Message).message.answer)
        assertEquals(emptyMap<String, String>(), Groups.folded(plain))
        assertEquals(emptyMap<String, String>(), Groups.folded(listOf(message("m1", ""","answer":"gone""""), reply("r1", "writer", 1))))
    }
}
