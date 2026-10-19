package dev.botdot.app.ui

import dev.botdot.app.data.Answered
import dev.botdot.app.data.Api
import dev.botdot.app.data.Bot
import dev.botdot.app.data.CarriesOn
import dev.botdot.app.data.Job
import dev.botdot.app.data.Tile
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The card of a waiting job and tile (Milestone 8, C3 and C9 to C14): a new one with the server's word for its no,
 * a change to an approved one with what goes and what comes, what an answered card reads, and the jobs screen's line.
 * The words for the buttons and the answers are the botdot server's ("The contract" of SURE-001 and SURE-002).
 */
class ChangeCardTest {
    private fun job(json: String): Job = Api.JSON.decodeFromString(json)
    private fun tile(json: String): Tile = Api.JSON.decodeFromString(json)

    private val old = "Every day at 08:00, send me the three biggest tech stories."
    private val new = "Every day at 07:00, send me the five biggest tech stories and one from Poland."

    @Test fun aSecondChangeToAnAnsweredJobOrTileHasItsOwnCard() {
        val news = Bot(id = "news", name = "News Watcher")
        fun changed(at: String?) = news to job("""{"id":"j1","name":"Morning news","kind":"ai","approved":true,"prompt":"$old","change":{"prompt":"$new"${at?.let { ""","at":"$it"""" } ?: ""}}}""")
        fun lights(at: String?) = tile("""{"id":"t1","title":"Lights","approved":true,"scripts":["hue on"],"change":{"scripts":["hue on --dim"]${at?.let { ""","at":"$it"""" } ?: ""}}}""")
        val other = news to job("""{"id":"j2","name":"Price watch","kind":"ai","approved":false}""")
        val first = changed("2026-10-07T08:00:00.000Z")
        val second = changed("2026-10-07T08:05:00.000Z")
        // "Keep as it is" on the first change: its card is answered, and stays so while the list still holds it.
        val answered = listOf(jobKey(first.first, first.second), tileKey(lights("2026-10-07T08:00:00.000Z")))
        assertEquals(listOf(other), jobsLeft(listOf(first, other), answered))
        assertEquals(emptyList<Tile>(), tilesLeft(listOf(lights("2026-10-07T08:00:00.000Z")), answered))
        // The bot proposes again: a card of its own, with its buttons, and "Approve N" counts it.
        assertEquals(listOf(second, other), jobsLeft(listOf(second, other), answered))
        assertEquals("Approve 2", approveAll(jobsLeft(listOf(second, other), answered), emptyList(), emptyList()).label)
        assertEquals(listOf("t1"), tilesLeft(listOf(lights("2026-10-07T08:05:00.000Z")), answered).map { it.id })
        // A new job that was approved, and then a change to it: the change is not the answered card either.
        val fresh = news to job("""{"id":"j1","name":"Morning news","kind":"ai","approved":false}""")
        assertEquals("j:news:j1", jobKey(fresh.first, fresh.second))
        assertEquals(listOf(first), jobsLeft(listOf(first), listOf(jobKey(fresh.first, fresh.second))))
        assertEquals("t:t1", tileKey(tile("""{"id":"t1","approved":false,"scripts":["hue on"]}""")))
        assertEquals(1, tilesLeft(listOf(lights("2026-10-07T08:00:00.000Z")), listOf("t:t1")).size)
        // A server that does not say when a change was proposed: one key for the job's changes, as before.
        assertEquals("j:news:j1:change:", jobKey(news, changed(null).second))
        assertEquals("t:t1:change:", tileKey(lights(null)))
        assertEquals("j:news:j1:change:2026-10-07T08:00:00.000Z", jobKey(first.first, first.second))
        // `change` on a job that waits for its first OK is no change: the job's own card.
        assertEquals("j:news:j9", jobKey(news, job("""{"id":"j9","approved":false,"change":{"at":"2026-10-07T08:00:00.000Z"}}""")))
    }

    @Test fun aNewJobHasTheServersNoOnItsButton() {
        val card = jobCard(job("""{"id":"j1","name":"Disk check","kind":"script","when":"Hourly","approved":false,"script":"df -h","createdBy":"bot","no":"Decline and remove"}"""))
        assertEquals("Disk check", card.title)
        assertEquals("Hourly · a script, no AI · added by itself", card.meta)
        assertEquals("Decline and remove", card.no)
        assertEquals("Approve", card.yes)
        assertEquals("df -h", card.script)
        assertNull(card.scriptWas); assertNull(card.promptWas); assertNull("nothing runs before its first OK", card.line)
    }

    @Test fun againstAServerWithoutDeclineWordsTheCardIsAsBefore() {
        val card = jobCard(job("""{"id":"j1","name":"Morning news","kind":"ai","when":"Daily at 08:00","approved":false,"prompt":"$old","changedBy":"chief"}"""))
        assertEquals(JobCard("Morning news", "Daily at 08:00 · uses AI · added by the Chief", null, null, old, null, null, "Decline", "Approve"), card)
        assertEquals("Declined", answeredWord(null, Answered.of("""{"ok":true,"removed":true}"""), yes = false))
        assertEquals("Approved", answeredWord(null, Answered.of("""{"id":"j1","approved":true}"""), yes = true))
        assertEquals("an answer that returns nothing, as a memory change's", "Approved", answeredWord(null, null, yes = true))
    }

    @Test fun aChangedJobShowsTheApprovedScheduleAndTextBesideTheNew() {
        val card = jobCard(job("""{"id":"j1","name":"Morning news","kind":"ai","when":"Daily at 08:00","approved":true,"prompt":"$old",
            "change":{"name":"Morning news","kind":"ai","when":"Daily at 07:00","prompt":"$new","script":"","by":"bot"},"no":"Keep as it is","yes":"Approve the change"}"""))
        assertEquals("Morning news: a change", card.title)
        assertEquals("now Daily at 08:00 → Daily at 07:00 · uses AI · changed by itself", card.meta)
        assertEquals("the approved text, struck", old, card.promptWas)
        assertEquals(new, card.prompt)
        assertNull(card.script); assertNull(card.scriptWas)
        assertEquals("Runs as you approved it until you answer.", card.line)
        assertEquals("Keep as it is", card.no)
        assertEquals("Approve the change", card.yes)
    }

    @Test fun aChangeWithItsSentenceShowsThatAndTheRestOnATap() {
        val says = "Five stories instead of three, an hour earlier."
        val card = jobCard(job("""{"id":"j1","name":"Morning news","kind":"ai","when":"Daily at 08:00","approved":true,"prompt":"$old",
            "change":{"when":"Daily at 07:00","prompt":"$new","by":"bot","summary":"  $says "}}"""))
        assertEquals(says, card.summary)
        assertEquals("what goes and what comes are on the card all the same", old, card.promptWas)
        assertFalse(showsFull(card, open = false))
        assertTrue(showsFull(card, open = true))
        // No sentence, one that is blank, one that is no text: the card as before, with both texts on a closed card too.
        for (summary in listOf("", ",\"summary\":\"  \"", ",\"summary\":{\"no\":\"text\"}", ",\"summary\":7")) {
            val plain = jobCard(job("""{"id":"j1","name":"Morning news","when":"Daily at 08:00","approved":true,"prompt":"$old","change":{"prompt":"$new"$summary}}"""))
            assertNull(summary, plain.summary)
            assertTrue(showsFull(plain, open = false))
        }
        // A job before its first OK has none.
        assertNull(jobCard(job("""{"id":"j1","name":"Morning news","when":"Daily at 08:00","approved":false,"prompt":"$old","summary":"$says"}""")).summary)
    }

    @Test fun onlyWhatChangesIsShownTwice() {
        // Only the time changes: one schedule line with both, the text once.
        val timed = jobCard(job("""{"id":"j1","name":"Morning news","when":"Daily at 08:00","approved":true,"prompt":"$old","change":{"when":"Daily at 07:00","prompt":"$old","by":"chief"}}"""))
        assertEquals("now Daily at 08:00 → Daily at 07:00 · uses AI · changed by the Chief", timed.meta)
        assertNull(timed.promptWas)
        assertEquals(old, timed.prompt)
        // Only the text changes: the schedule once. A change that names no time, or nobody, reads as unchanged.
        val worded = jobCard(job("""{"id":"j1","name":"Morning news","when":"Daily at 08:00","approved":true,"prompt":"$old","change":{"prompt":"$new"}}"""))
        assertEquals("Daily at 08:00 · uses AI · changed", worded.meta)
        assertEquals(old, worded.promptWas)
        // The words of a server that names no buttons: the app's own, which say that the no removes nothing.
        assertEquals("Keep as it is" to "Approve the change", worded.no to worded.yes)
        val renamed = jobCard(job("""{"id":"j1","name":"Morning news","when":"Daily at 08:00","approved":true,"change":{"name":"Tech news"}}"""))
        assertEquals("Morning news: a change", renamed.title)
        assertEquals("Daily at 08:00 · renamed “Tech news” · uses AI · changed", renamed.meta)
    }

    @Test fun aChangedScriptShowsBothScripts() {
        val card = jobCard(job("""{"id":"j2","name":"Disk check","kind":"script","when":"Hourly","approved":true,"script":"df -h /mnt/backup","prompt":"",
            "change":{"kind":"script","when":"Hourly","script":"df -h /mnt/backup | tail -1","prompt":"","by":"bot"}}"""))
        assertEquals("Hourly · a script, no AI · changed by itself", card.meta)
        assertEquals("df -h /mnt/backup", card.scriptWas)
        assertEquals("df -h /mnt/backup | tail -1", card.script)
        // A script job whose time alone changes: its script once.
        val timed = jobCard(job("""{"id":"j2","name":"Disk check","kind":"script","when":"Hourly","approved":true,"script":"df -h","change":{"when":"Daily at 09:00"}}"""))
        assertEquals("df -h", timed.script)
        assertNull(timed.scriptWas)
        // An AI job that becomes a script, and a script job that becomes an AI job.
        val becomes = jobCard(job("""{"id":"j3","name":"Feeds","kind":"ai","when":"Hourly","approved":true,"prompt":"Read the feeds.","change":{"kind":"script","script":"curl example.org","prompt":""}}"""))
        assertEquals("curl example.org", becomes.script)
        assertNull(becomes.scriptWas)
        assertEquals("Read the feeds.", becomes.promptWas)
        assertEquals("Hourly · a script, no AI · changed", becomes.meta)
        val back = jobCard(job("""{"id":"j3","name":"Feeds","kind":"script","when":"Hourly","approved":true,"script":"curl example.org","change":{"kind":"ai","script":"","prompt":"Read the feeds."}}"""))
        assertNull(back.script)
        assertEquals("curl example.org", back.scriptWas)
        assertEquals("Read the feeds.", back.prompt)
        // A change that carries a script and names no kind: "Approve all" leaves it out, and its card shows that script.
        val carried = job("""{"id":"j4","name":"Feeds","kind":"ai","when":"Hourly","approved":true,"change":{"script":"curl example.org"}}""")
        assertTrue(carried.touchesScript)
        assertEquals("curl example.org", jobCard(carried).script)
        assertEquals("Hourly · a script, no AI · changed", jobCard(carried).meta)
    }

    @Test fun aChangeOfWhatItReportsOrWhenItAsksTheAiIsSaid() {
        // Nothing a yes approves stays unseen: a change of the report setting alone has its line.
        val reports = jobCard(job("""{"id":"j1","name":"Morning news","kind":"ai","when":"Daily at 08:00","approved":true,"prompt":"$old","notify":"report-only",
            "change":{"kind":"ai","when":"Daily at 08:00","prompt":"$old","script":"","notify":"always","aiWhen":null}}"""))
        assertEquals(listOf("Tells you: only when it has something to report → after every run"), reports.also)
        assertNull(reports.promptWas)
        // A job from a server that names no setting reports only what it has, as the server's default says.
        assertEquals(listOf("Tells you: only when it has something to report → after every run"), jobCard(job("""{"id":"j1","approved":true,"change":{"notify":"always"}}""")).also)
        val asksAi = jobCard(job("""{"id":"j2","name":"Disk check","kind":"script","when":"Hourly","approved":true,"script":"df -h","aiWhen":"never","notify":"report-only",
            "change":{"kind":"script","script":"df -h","aiWhen":"output","notify":"report-only"}}"""))
        assertEquals(listOf("Asks the AI: never, just its output → only when it prints something"), asksAi.also)
        assertNull(asksAi.scriptWas)
        // An AI job that becomes a script had no such setting; a value this app does not know is shown as it came.
        assertEquals(listOf("Asks the AI: only when it fails"), jobCard(job("""{"id":"j3","kind":"ai","approved":true,"change":{"kind":"script","script":"x","aiWhen":"failed"}}""")).also)
        assertEquals(listOf("Tells you: only when it has something to report → weekly"), jobCard(job("""{"id":"j1","approved":true,"change":{"notify":"weekly"}}""")).also)
        // What stays is not said, and a new job has no such lines.
        assertEquals(emptyList<String>(), jobCard(job("""{"id":"j1","approved":true,"notify":"always","aiWhen":null,"change":{"notify":"always","aiWhen":null,"when":"Hourly"}}""")).also)
        assertEquals(emptyList<String>(), jobCard(job("""{"id":"j1","approved":false,"notify":"always"}""")).also)
    }

    @Test fun aChangedTileHasTheSameCardWithItsScripts() {
        val card = tileCard(tile("""{"id":"t1","title":"Lights","section":"Home","approved":true,"scripts":["hue on"],
            "change":{"title":"Lights","scripts":["hue on --dim"],"changedBy":"bot"},"no":"Keep as it is","yes":"Approve the change"}"""))
        assertEquals(TileCard("Lights: a change", "Home · a script, no AI · changed by itself", listOf("hue on --dim"), listOf("hue on"), RUNS_AS_APPROVED, "Keep as it is", "Approve the change"), card)
        // A server that lists no scripts for an approved tile: the new ones alone.
        assertEquals(emptyList<String>(), tileCard(tile("""{"id":"t1","title":"Lights","approved":true,"change":{"scripts":["hue on --dim"]}}""")).scriptsWas)
        // A change that lists no scripts shows none as proposed: the approved ones are never what the yes approves.
        // They stand as the approved ones, as on the web page. A new title is said.
        val renamed = tileCard(tile("""{"id":"t1","title":"Lights","approved":true,"scripts":["hue on"],"change":{"title":"Lamps","by":"chief"}}"""))
        assertEquals(TileCard("Lights: a change", "renamed “Lamps” · changed by the Chief", emptyList(), listOf("hue on"), RUNS_AS_APPROVED, "Keep as it is", "Approve the change"), renamed)
        assertEquals(emptyList<String>(), tileCard(tile("""{"id":"t1","title":"Lights","approved":true,"scripts":["hue on"],"change":{"scripts":[]}}""")).scripts)
        // A new tile: the server's no, or "Decline" as before.
        val fresh = tileCard(tile("""{"id":"t2","title":"Disk","approved":false,"changedBy":"bot","scripts":["df -h"],"no":"Decline and remove"}"""))
        assertEquals(TileCard("Put “Disk” on your Board?", "a script, no AI · added by itself", listOf("df -h"), emptyList(), null, "Decline and remove", "Approve"), fresh)
        assertEquals("Decline", tileCard(tile("""{"id":"t2","title":"Disk","approved":false,"scripts":["df -h"]}""")).no)
    }

    @Test fun anAnsweredCardReadsTheServersText() {
        assertEquals("Declined and removed", answeredWord(null, Answered.of("""{"ok":true,"removed":true,"text":"Declined and removed"}"""), yes = false))
        assertEquals("Kept as it was: Daily at 08:00", answeredWord(null, Answered.of("""{"ok":true,"kept":true,"text":"Kept as it was: Daily at 08:00"}"""), yes = false))
        val changed = Answered.of("""{"id":"j1","text":"Changed: Daily at 07:00","carriesOn":{"who":"bot","text":"it carries on"}}""")
        assertEquals("Changed: Daily at 07:00 · it carries on", answeredLabel(answeredWord(null, changed, yes = true), changed.carriesOn))
        // A card's own word for its answer stays: "Always approved" says more than the server's line.
        assertEquals("Always approved", answeredWord("Always approved", changed, yes = true))
        assertEquals("On your Board · it carries on", answeredLabel(answeredWord("On your Board", Answered(carriesOn = CarriesOn("it carries on")), yes = true), CarriesOn("it carries on")))
    }

    @Test fun theJobsScreenShowsAChangedJobAsRunning() {
        val changed = job("""{"id":"j1","approved":true,"nextRunAt":"2026-10-07T08:00:00Z","change":{"when":"Daily at 07:00"}}""")
        assertTrue(changeWaits(changed))
        assertEquals("A change waits for your OK", CHANGE_WAITS)
        assertFalse("a job before its first OK waits itself", changeWaits(job("""{"id":"j2","approved":false}""")))
        assertFalse(changeWaits(job("""{"id":"j3","approved":true}""")))
    }

    @Test fun alwaysAllowAsksInTheWebPagesWords() {
        // The same question as the web page's (public/needs.js): one sentence, read from the page so the two stay alike.
        val page = File(System.getProperty("webPage") ?: "../../public/needs.js").readText()
        assertTrue(ALWAYS_ALLOW_QUESTION, page.contains("confirm('$ALWAYS_ALLOW_QUESTION')"))
    }
}
