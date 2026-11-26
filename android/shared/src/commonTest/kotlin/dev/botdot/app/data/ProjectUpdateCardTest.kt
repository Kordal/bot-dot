package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

/** A project update as a card of the block kit (#1755, docs/api.md "Consolidated project updates"): the data as both phones read it. */
class ProjectUpdateCardTest {
    private val quiet = """{"project":{"id":"p1","name":"Qwotz Development"},"since":"2026-11-24T09:00:00.000Z","summary":"Nothing needs you, 2 in progress",
        "pills":[{"level":"ok","text":"Nothing needs you"},{"level":"ok","text":"No blockers"},{"level":"info","text":"2 in progress"}],
        "needs":[],"blockers":[],"goals":[],"done":[],"decisions":[],
        "work":[{"botId":"infra","runId":"r1","name":"Infra Admin","text":"Plan the **database** copy","state":"working"},{"name":"Mail","text":"Decide on Brevo","state":"planned"}],
        "replies":[{"botId":"qa","runId":"r9","name":"QA Tester","text":"Three new issues","at":"2026-11-25T08:41:00.000Z"}],
        "quiet":"Nothing marked done, no goal figures, no new decisions."}"""
    private val busy = """{"project":{"id":"p1","name":"Qwotz Development"},"since":"","summary":"1 needs you, 1 blocker, 2 done, 2 in progress",
        "pills":[{"level":"warn","text":"1 needs you"},{"level":"err","text":"1 blocker"},{"level":"ok","text":"2 done"},{"level":"info","text":"2 in progress"}],
        "needs":[{"botId":"infra","cardId":"ask9","name":"Infra Admin","text":"May I sign in?"}],
        "blockers":[{"botId":"infra","runId":"r5","name":"Infra Admin","text":"No access"}],
        "goals":[{"id":"v1","name":"Version 1.0","value":"4","of":"of 6 steps","ratio":0.6667,"level":"ok"},{"id":"i","name":"Open issues","value":"19","of":"/ 10","ratio":1,"level":"warn"},{"id":"n","name":"Members","value":"12","level":"ok"}],
        "done":[{"id":"a","text":"Groq removed"},{"id":"b","text":"QA tests"}],"decisions":[{"id":"d1","text":"Mail goes through Brevo"}],
        "work":[{"chatId":"c1","name":"Chief","text":"","state":"working"},{"groupId":"g1","botId":"qa","name":"Team","text":"x","state":"asks"}],
        "replies":[]}"""
    private fun card(s: String) = ProjectUpdateCard.of(Json.parseToJsonElement(s))!!

    @Test fun aQuietUpdateReadsAsTheServerSentIt() {
        val u = card(quiet)
        assertEquals("p1", u.projectId)
        assertEquals("Qwotz Development", u.projectName)
        assertEquals("2026-11-24T09:00:00.000Z", u.since)
        assertEquals("Nothing needs you, 2 in progress", u.summary)
        assertEquals(listOf("ok" to "Nothing needs you", "ok" to "No blockers", "info" to "2 in progress"), u.pills.map { it.level to it.text })
        assertTrue(u.needs.isEmpty() && u.blockers.isEmpty() && u.goals.isEmpty() && u.done.isEmpty() && u.decisions.isEmpty())
        assertEquals(listOf("working", "planned"), u.work.map { it.state })
        assertEquals("Plan the **database** copy", u.work[0].text, "Markdown as the bot wrote it")
        assertEquals("Nothing marked done, no goal figures, no new decisions.", u.quiet)
        assertEquals("bot/qa", u.replies.single().destination)
        assertNull(u.work[1].destination, "a to-do of nobody opens nothing")
    }

    @Test fun aBusyUpdateCarriesEverySection() {
        val u = card(busy)
        assertEquals("ask9", u.needs.single().cardId)
        assertEquals("r5", u.blockers.single().runId)
        assertEquals(listOf("4", "19", "12"), u.goals.map { it.value })
        assertEquals(listOf("of 6 steps", "/ 10", ""), u.goals.map { it.of })
        assertEquals(listOf(0.6667f, 1f, null), u.goals.map { it.ratio })
        assertEquals(listOf("ok", "warn", "ok"), u.goals.map { it.level })
        assertEquals(listOf("Groq removed", "QA tests"), u.done)
        assertEquals(listOf("Mail goes through Brevo"), u.decisions)
        assertEquals("chief/c1", u.work[0].destination)
        assertEquals("group/g1", u.work[1].destination, "a team's chat before its bot's")
        assertNull(u.quiet)
        assertTrue(u.notes.isEmpty())
        assertEquals("", u.since)
    }

    @Test fun theTeamsWhoseReportIsMissingAreTheNotes() {
        val u = card(quiet.replace("\"quiet\":", "\"notes\":[\"No new recorded team report: Ops.\",\"Saved report unavailable for this update: Sales.\"],\"quiet\":"))
        assertEquals(listOf("No new recorded team report: Ops.", "Saved report unavailable for this update: Sales."), u.notes)
    }

    @Test fun whatIsNotAnUpdateIsNone() {
        assertNull(ProjectUpdateCard.of(null))
        assertNull(ProjectUpdateCard.of(Json.parseToJsonElement("\"x\"")))
        assertNull(ProjectUpdateCard.of(Json.parseToJsonElement("""{"summary":"x"}""")), "no project: not an update")
        val odd = ProjectUpdateCard.of(Json.parseToJsonElement("""{"project":{"name":"X"},"pills":"no","needs":[1,{"name":"A"}],"goals":[{"name":"G","ratio":9,"level":"zzz"}],"work":[{"state":"zzz","name":"W"}]}"""))!!
        assertEquals(0, odd.pills.size)
        assertEquals(1, odd.needs.size, "a row that is no object is dropped")
        assertEquals(1f, odd.goals.single().ratio, "a ratio is held to 0..1")
        assertEquals("ok", odd.goals.single().level, "a level to the kit's")
        assertEquals("working", odd.work.single().state)
    }

    @Test fun theListSaysTheOutcomeOfAnUpdateAndNothingElse() {
        val bot = Bot(id = "m", name = "Manager", description = "")
        val update = Json.parseToJsonElement(quiet)
        val run = Run(id = "r", botId = "m", kind = "project-update", status = "success", result = "Project update: Qwotz\n\nMarked done", updateValue = update)
        assertEquals("Nothing needs you, 2 in progress", botSub(bot, run, null))
        assertEquals("Project update: Qwotz Marked done", botSub(bot, run.copy(updateValue = null), null), "an older record keeps its text")
        assertEquals("Hello", botSub(bot, run.copy(kind = null, result = "Hello"), null), "a reply is no update")
        val message = ChiefMessage(role = "chief", projectUpdate = "k", updateValue = update)
        assertEquals("Qwotz Development", message.update?.projectName)
    }
}
