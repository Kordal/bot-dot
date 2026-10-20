package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// The reply draft (docs/api.md, "The reply draft", ADR 041): a run's stream sends the whole draft so far, the app
// draws it only from a server that lists `reply-draft`, and a group's drafts follow its turns (ReplyDraft.Group).
class ReplyDraftTest {
    private fun of(json: String) = RunEvent.of(Json.parseToJsonElement(json).jsonObject)

    @Test fun aDraftOnTheRunStreamIsTheWholeDraftSoFar() {
        assertEquals(RunEvent.Draft("The disk\nhas room"), of("""{"type":"reply_draft","text":"The disk\nhas room"}"""))
        assertEquals(RunEvent.Draft(""), of("""{"type":"reply_draft","text":""}"""))
        assertEquals(RunEvent.Draft(""), of("""{"type":"reply_draft"}"""))
    }

    @Test fun draftsAreShownOnlyWhenTheServerListsThem() {
        assertTrue(ReplyDraft.shows(listOf("working-line", "reply-draft")))
        assertFalse(ReplyDraft.shows(listOf("working-line")))
        assertFalse(ReplyDraft.shows(null))
        assertEquals("reply-draft", ReplyDraft.FEATURE)
    }

    @Test fun aGroupDraftStaysUntilItsReplyIsThereAndAPassLeavesNothing() {
        val coder = GroupWorking("coder", "t1", "m1")
        val reviewer = GroupWorking("reviewer", "t2", "m1")
        val drafts = ReplyDraft.Group()
        drafts.say(coder, "The tests\nare green")
        drafts.say(reviewer, "Reviewing\nthe change")
        drafts.say(coder, "The tests\nare green, all 40")
        assertEquals(listOf(coder to "The tests\nare green, all 40", reviewer to "Reviewing\nthe change"), drafts.shown(emptySet()))
        // Its turn ended, and its reply is not among the rows yet: the draft stays, so no row goes blank.
        assertEquals(2, drafts.shown(emptySet()).size)
        assertEquals("the reply took its place", listOf(reviewer to "Reviewing\nthe change"), drafts.shown(setOf("t1")))
        drafts.passed("t2")
        assertEquals("a pass leaves nothing", emptyList<Pair<GroupWorking, String>>(), drafts.shown(emptySet()))
        drafts.say(coder, "Text\nmore")
        drafts.say(coder, "")
        assertEquals("cleared at a tool call", emptyList<Pair<GroupWorking, String>>(), drafts.shown(emptySet()))
        drafts.say(coder, "Text\nmore")
        drafts.clear()
        assertEquals("the chat was left", emptyList<Pair<GroupWorking, String>>(), drafts.shown(emptySet()))
    }
}
