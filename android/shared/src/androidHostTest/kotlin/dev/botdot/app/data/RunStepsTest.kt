package dev.botdot.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A run's steps and its block's step line (docs/api.md, "A run's steps"; #625). */
class RunStepsTest {
    private fun run(json: String) = Api.JSON.decodeFromString(Run.serializer(), json)

    @Test fun readsWhatTheServerSends() {
        val s = RunSteps.of(Json.parseToJsonElement("""{"count":5,"rows":[{"at":"2026-10-27T10:00:00Z","text":"Reading a.js"},{"at":"2026-10-27T10:00:02Z","text":"Running a command","n":3},{"text":"Messaging Reviewer","kind":"message"},{"nope":1}]}"""))!!
        assertEquals(5, s.count)
        assertEquals(listOf("Reading a.js", "Running a command", "Messaging Reviewer"), s.rows.map { it.text })
        assertEquals(listOf(1, 3, 1), s.rows.map { it.n })
        assertEquals("message", s.rows[2].kind)
        assertNull(RunSteps.of(null))
        assertNull(RunSteps.of(Json.parseToJsonElement("""{"count":0,"rows":[]}""")))
        assertNull(RunSteps.of(Json.parseToJsonElement("\"5\"")))
    }

    @Test fun aRunFromBeforeTheStepsHasNone() {
        val r = run("""{"id":"r1","botId":"b","prompt":"Hi","status":"done","result":"Hello"}""")
        assertNull(r.steps)
        assertFalse(RunSteps.shows(r))
        assertEquals(emptyList<RunSteps.Row>(), RunSteps.timeline(r))
    }

    @Test fun theTimelineHoldsStepsMessagesAndChangedSkillsInTheOrderTheyCame() {
        val r = run(
            """{"id":"r1","botId":"b","prompt":"Ship it","status":"done","result":"Done",
               "steps":{"count":3,"rows":[{"at":"2026-10-27T10:00:00Z","text":"Reading a.js"},{"at":"2026-10-27T10:00:03Z","text":"Messaging Reviewer","kind":"message"},{"at":"2026-10-27T10:00:05Z","text":"Running a command"}]},
               "sentTo":{"id":"b2","name":"Reviewer","text":"Please review\nthe diff","at":"2026-10-27T10:00:03Z"},
               "learned":[{"kind":"skill-updated","text":"deploy","chip":"Changed the skill deploy","at":"2026-10-27T10:00:04Z"},{"kind":"note","text":"a note"}]}""",
        )
        assertTrue(RunSteps.shows(r))
        assertEquals(1, RunSteps.skills(r).size)
        assertEquals(listOf("Reviewer"), RunSteps.messaged(r).map { it.name })
        val rows = RunSteps.timeline(r)
        assertEquals(listOf("Reading a.js", "Messaged Reviewer\nPlease review", "Changed the skill deploy", "Running a command"), rows.map { it.text })
        assertEquals(listOf("", RunSteps.MESSAGE, RunSteps.CHANGED, ""), rows.map { it.kind })
    }

    @Test fun countsAndTimes() {
        assertEquals("", RunSteps.countWords(0))
        assertEquals("1 step", RunSteps.countWords(1))
        assertEquals("23 steps", RunSteps.countWords(23))
        assertEquals("18s", RunSteps.took("2026-10-27T10:00:00Z", "2026-10-27T10:00:18Z"))
        assertEquals("7m 37s", RunSteps.took("2026-10-27T10:00:00Z", "2026-10-27T10:07:37Z"))
        assertEquals("1h 02m", RunSteps.took("2026-10-27T10:00:00Z", "2026-10-27T11:02:10Z"))
        assertEquals("", RunSteps.took(null, "2026-10-27T10:00:18Z"))
    }

    @Test fun aLongReplyFoldsToItsFirstParagraphAndKeepsItsLinks() {
        val para = "word ".repeat(80).trim()
        val text = "First.\n\n$para\n\nThe PR: https://github.com/x/y/pull/1\n\n$para"
        assertEquals("First.\n\nThe PR: https://github.com/x/y/pull/1", RunSteps.folded(text))
        assertNull("short", RunSteps.folded("Short.\n\nReply."))
        assertNull("one paragraph", RunSteps.folded(para.repeat(4)))
        assertNull("code", RunSteps.folded("$text\n\n```\ncode\n```"))
    }

    @Test fun aStepLineOpenedWhileItsRunWorksFoldsWhenTheRunEnds() {
        val working = run("""{"id":"w","botId":"b","prompt":"Test it","status":"running"}""")
        val ended = run("""{"id":"w","botId":"b","prompt":"Test it","status":"success","result":"Done."}""")
        assertFalse(RunSteps.open(emptyMap(), working))
        assertFalse(RunSteps.open(emptyMap(), ended))
        assertTrue(RunSteps.open(mapOf("w" to true), working))
        assertFalse(RunSteps.open(mapOf("w" to true), ended))
        assertTrue(RunSteps.open(mapOf("w" to false), ended))
    }
    @Test fun theStepLineSaysWhatARunAtWorkDoesAndWhatAFinishedOneDid() {
        val working = run("""{"id":"r1","botId":"b","prompt":"Ship it","status":"running","startedAt":"2026-10-27T10:00:00Z"}""")
        assertEquals("Reading a.js, 3 steps", RunSteps.label(working, "Reading a.js", 3, held = false))
        assertEquals("Working", RunSteps.label(working, null, 0, held = false))
        assertEquals(OpeningLine.WAITING_FOR_OK, RunSteps.now("Reading a.js", held = true))
        val done = run(
            """{"id":"r2","botId":"b","prompt":"Ship it","status":"done","result":"Done","startedAt":"2026-10-27T10:00:00Z","endedAt":"2026-10-27T10:07:00Z",
               "sentTo":{"id":"b2","name":"Reviewer","text":"Please review","at":"2026-10-27T10:00:03Z"},
               "learned":[{"kind":"skill","skill":"backup-check","text":"Used backup-check"}]}""",
        )
        assertEquals("23 steps, the skill backup-check, Reviewer, ${RunSteps.took(done.startedAt, done.endedAt)}", RunSteps.label(done, null, 23, held = false))
    }

    @Test fun aRepliesLearnedChipsLeaveTheSkillsToTheStepLineAndSayWhatTheyOpen() {
        val r = run(
            """{"id":"r1","botId":"b","prompt":"Ship it","status":"done","result":"Done",
               "learned":[{"kind":"skill","skill":"deploy","text":"Used deploy"},{"kind":"job","text":"Every morning","chip":"Made a job: every morning"},
                          {"kind":"memory","text":"${"x".repeat(120)}"}]}""",
        )
        val chips = LearnedChips.of(r, listOf(MEMORY_CHIPS))
        assertEquals(2, chips.size)
        assertTrue(chips[0].text.endsWith("Made a job: every morning"))
        assertEquals(Learned.Opens.JOBS, chips[0].opens)
        assertNull("a note opens nothing", chips[1].opens)
        assertTrue("whole from a server that writes them", chips[1].text.length > LearnedChips.CHARS)
        val before = LearnedChips.of(r, listOf("pages"))
        assertEquals(LearnedChips.CHARS, before[1].text.length)
        assertTrue(before[1].text.endsWith("…"))
    }
}
