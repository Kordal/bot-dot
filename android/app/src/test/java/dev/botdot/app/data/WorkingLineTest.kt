package dev.botdot.app.data

import dev.botdot.app.ui.botSub
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A working bot's working line (docs/api.md, "The working line"): with `working-line` in the server's `features`
 * the line under a bot's chat and in its row is the server's text, and follows it as it changes: from the feed, from
 * the run's stream and from the runs as they are read. Against a server without the feature the app shows the
 * opening line as before. `test/working-line-web.test.js` says the same of the web page.
 */
class WorkingLineTest {
    private val with = listOf("opening-line", "working-line")
    private val without = listOf("opening-line")
    private fun event(type: String, data: String) = FeedEvent("boot.1", type, Json.parseToJsonElement(data).jsonObject)
    private fun hello(features: List<String>, running: String = "") =
        event("hello", """{"version":"1.0","features":[${features.joinToString(",") { "\"$it\"" }}],"running":[$running]}""")
    private fun line(type: String, text: String, runId: String = "r1") = event(type, """{"chat":"bot:news","botId":"news","runId":"$runId","text":${Json.encodeToString(kotlinx.serialization.serializer<String>(), text)}}""")
    private fun runs(json: String) = Api.JSON.decodeFromString<List<Run>>(json)
    private val bots: (String) -> Boolean = { it.startsWith("bot:") }
    private fun OpeningLines.of(chat: String = "bot:news") = lines.value[chat]
    private fun on(features: List<String>) = OpeningLines().also { it.handle(hello(features)) }
    private val running = Run(id = "r1", botId = "news", status = "running")
    private val news = Bot(id = "news", name = "News", description = "Reads the news")

    /** The line under the chat and the row's words, as the screens word them. */
    private fun OpeningLines.under(run: Run? = running) = OpeningLine.botLine(of(), run, run != null && "bot:news" in waits.value)
    private fun OpeningLines.row() = botSub(news.copy(running = true), running, of())

    @Test fun onlyAServerThatAnnouncesItHasTheWorkingLine() {
        assertTrue(OpeningLine.follows(with))
        assertFalse(OpeningLine.follows(without))
        assertFalse(OpeningLine.follows(emptyList()))
        assertFalse("its features are not known yet", OpeningLine.follows(null))
    }

    @Test fun aRunsLineIsItsWorkingLineFromAServerThatHasOneItsOpeningLineFromOneThatDoesNot() {
        assertEquals("Reading nytimes.com", OpeningLine.ofRun("Reading nytimes.com", "Checking the news", with))
        assertEquals("a field the app was not told about is not drawn", "Checking the news", OpeningLine.ofRun("Reading nytimes.com", "Checking the news", without))
        assertEquals("Checking the news", OpeningLine.ofRun("Reading nytimes.com", "Checking the news", null))
        assertEquals("a turn in a group has no working line yet", "Checking the news", OpeningLine.ofRun(null, "Checking the news", with))
        assertEquals("a run that did nothing yet: \"Working\"", "", OpeningLine.ofRun(null, null, with))
        assertEquals("", OpeningLine.ofRun("   ", null, with))
    }

    @Test fun whichEventBringsARunsLine() {
        assertTrue(OpeningLine.says("working_line", with))
        assertFalse("the working line starts with it: read twice, the line would change twice in a second", OpeningLine.says("opening_line", with))
        assertTrue(OpeningLine.says("opening_line", without))
        assertFalse(OpeningLine.says("working_line", without))
        assertTrue(OpeningLine.says("opening_line", null))
        for (other in listOf("run_end", "step", "phase", "")) for (f in listOf(with, without)) assertFalse(other, OpeningLine.says(other, f))
    }

    @Test fun withTheFeatureTheLineUnderTheChatAndInTheRowFollowsTheFeed() {
        val l = on(with)
        assertEquals("before the server said anything", "Working…", l.under())
        assertEquals("the row's word is the web page's", "Working…", l.row())
        l.handle(line("working_line", "Checking the news"))
        assertEquals("the opening line first: the server sends it as the line's first text", "Checking the news…", l.under())
        assertEquals("Checking the news…", l.row())
        // A change: the run's new text takes the place of its last.
        l.handle(line("working_line", "Reading nytimes.com"))
        assertEquals("Reading nytimes.com…", l.under())
        assertEquals("Reading nytimes.com…", l.row())
        l.handle(line("working_line", "Starting its computer"))
        assertEquals("Starting its computer…", l.under())
        assertEquals(mapOf("bot:news" to "Starting its computer"), l.lines.value)
        // The server's `opening_line`, sent as before for an older app, changes nothing here.
        l.handle(line("opening_line", "Checking the news"))
        assertEquals("Starting its computer…", l.under())
    }

    @Test fun whatIsNoLineIsNotDrawn() {
        val l = on(with)
        l.handle(line("working_line", "Reading nytimes.com"))
        l.handle(line("working_line", "   "))
        l.handle(event("working_line", """{"chat":"bot:news","botId":"news","runId":"r1"}"""))
        l.handle(event("working_line", """{"chat":"bot:news","botId":"news","runId":"r1","text":{"a":1}}"""))
        assertEquals("the line stays as it was", "Reading nytimes.com", l.of())
    }

    @Test fun theLineIsGoneOnTheReplyAndOnStop() {
        // The reply, a failure, Stop, a restart of the server: the run's end takes the line away.
        for (status in listOf("success", "error", "stopped", "interrupted")) {
            val l = on(with)
            l.handle(line("working_line", "Reading nytimes.com"))
            l.handle(event("run_finished", """{"id":"r1","botId":"news","status":"$status"}"""))
            assertNull(status, l.of())
            assertEquals(status, "", l.under(run = null))
            l.handle(line("working_line", "Reading late.example.com"))
            assertNull("a line that comes after its run ended is not drawn", l.of())
        }
    }

    @Test fun withoutTheFeatureTheOpeningLineIsShownAsBefore() {
        val l = on(without)
        assertEquals("Working…", l.under())
        l.handle(line("opening_line", "Checking the news"))
        assertEquals("Checking the news…", l.under())
        assertEquals("Checking the news…", l.row())
        l.handle(line("working_line", "Reading nytimes.com")) // not a thing this server says
        assertEquals("Checking the news…", l.under())
        // Its lists: `openingLine`, and no field the app was not told about.
        val fresh = on(without)
        fresh.sync(OpeningLine.live(runs("""[{"id":"r1","botId":"news","status":"running","openingLine":"Checking the news","workingLine":"Reading nytimes.com"}]"""), fresh.features), bots)
        assertEquals("Checking the news", fresh.of())
        fresh.handle(event("run_finished", """{"id":"r1","botId":"news","status":"success"}"""))
        assertNull(fresh.of())
    }

    @Test fun anAppThatHeardNoHelloYetShowsTheOpeningLine() {
        val l = OpeningLines()
        assertNull(l.features)
        l.handle(line("opening_line", "Checking the news"))
        assertEquals("Checking the news", l.of())
    }

    @Test fun anAppThatConnectsAgainReadsTheLineTheServerHolds() {
        val l = on(with)
        l.handle(line("working_line", "Checking the news"))
        l.say("bot:gone", "From before", "r0") // its run ended while the app was away
        // The feed connects again: `hello` names the running runs, each with what its line reads now.
        l.handle(hello(with, """{"id":"r1","botId":"news","status":"running","openingLine":"Checking the news","workingLine":"Reading nytimes.com"},{"id":"r2","botId":"b2","status":"running"}"""))
        assertEquals("Reading nytimes.com", l.of())
        assertNull(l.of("bot:b2"))
        assertNull(l.of("bot:gone"))
        // And it goes on changing.
        l.handle(line("working_line", "Reading bbc.com"))
        assertEquals("Reading bbc.com…", l.under())
    }

    @Test fun aChatThatIsOpenedAgainReadsTheLineFromItsRunningRuns() {
        val l = on(with)
        // `reset`: the feed could not say what was missed, and the lists are read again.
        l.handle(line("working_line", "Checking the news"))
        l.handle(event("reset", "{}"))
        assertNull(l.of())
        val list = runs("""[{"id":"r1","botId":"news","status":"running","openingLine":"Checking the news","workingLine":"Reading nytimes.com"},{"id":"r0","botId":"news","status":"success","workingLine":"Never shown"}]""")
        l.sync(OpeningLine.live(list, l.features)) { it == "bot:news" }
        assertEquals("the server still has the working line after a reset", "Reading nytimes.com…", l.under())
        assertEquals("Reading nytimes.com…", l.row())
        // The run ended meanwhile: the list has no line for it, and none is left for the next run.
        l.sync(OpeningLine.live(runs("""[{"id":"r1","botId":"news","status":"success","result":"Here is the news."}]"""), l.features)) { it == "bot:news" }
        assertNull(l.of())
        assertEquals("Working…", l.row())
    }

    @Test fun aRunWithoutAWorkingLineButWithAnOpeningLineShowsThat() {
        val l = on(with)
        l.sync(OpeningLine.live(runs("""[{"id":"r1","botId":"news","status":"running","openingLine":"Checking the news"}]"""), l.features), bots)
        assertEquals("Checking the news", l.of())
        val h = OpeningLines()
        h.handle(hello(with, """{"id":"r1","botId":"news","status":"running","openingLine":"Checking the news"}"""))
        assertEquals("Checking the news", h.of())
    }

    @Test fun theOpenChatFollowsTheRunsStream() {
        val l = on(with)
        // A reconnect: what happened is replayed, then the opening line as before, then what the line reads now.
        l.streamed("bot:news", RunEvent.Line("Checking the news"), "r1")
        assertEquals("`opening_line` is not read from a server with the working line", "Working…", l.under())
        l.streamed("bot:news", RunEvent.Line("Reading nytimes.com", working = true), "r1")
        assertEquals("Reading nytimes.com…", l.under())
        l.streamed("bot:news", RunEvent.Line("Starting its computer", working = true), "r1")
        assertEquals("Starting its computer…", l.under())
        assertEquals("Starting its computer…", l.row())
        // Against a server without the feature: its opening line, as before.
        val old = on(without)
        old.streamed("bot:news", RunEvent.Line("Checking the news"), "r1")
        old.streamed("bot:news", RunEvent.Line("Reading nytimes.com", working = true), "r1")
        assertEquals("Checking the news…", old.under())
    }

    @Test fun theRunsStreamIsReadAsTheServerSendsIt() {
        fun of(json: String) = RunEvent.of(Json.parseToJsonElement(json).jsonObject)
        assertEquals(RunEvent.Line("Reading nytimes.com", working = true), of("""{"type":"working_line","text":"Reading nytimes.com"}"""))
        assertEquals(RunEvent.Line("Checking the news"), of("""{"type":"opening_line","text":"Checking the news"}"""))
        assertEquals(RunEvent.Step("Reading a page"), of("""{"type":"step","text":"Reading a page"}"""))
        assertEquals(RunEvent.End("stopped"), of("""{"type":"end","run":{"status":"stopped"}}"""))
        assertEquals(RunEvent.File, of("""{"type":"file"}"""))
        assertNull("what this app does not know is left out", of("""{"type":"phase","text":"Starting its computer"}"""))
    }

    @Test fun aJobsRunReadsAsTheServerSays() {
        val job = Api.JSON.decodeFromString<Run>("""{"id":"r2","botId":"news","status":"running","trigger":"schedule","jobName":"Disk check","kind":"ai"}""")
        val l = on(with)
        l.handle(line("working_line", "Running Disk check", "r2"))
        assertEquals("Running Disk check…", l.under(job))
        assertEquals("Running Disk check…", l.row())
        l.handle(line("working_line", "Running a command", "r2"))
        assertEquals("Running a command…", l.under(job))
        // The app has no words of its own for a job's run: without a line from the server it says "Working", as the web page does.
        val script = job.copy(kind = "script")
        for (run in listOf(job, script)) for (f in listOf(with, without)) assertEquals("Working…", on(f).under(run))
    }

    @Test fun waitingForYourOkKeepsItsWordsAndItsPlaceOverTheWorkingLine() {
        val l = on(with)
        l.handle(line("working_line", "Using gmail"))
        l.sync(OpeningLine.live(runs("""[{"id":"r1","botId":"news","status":"running","workingLine":"Using gmail","waitingFor":"ok"}]"""), l.features), bots)
        assertEquals(setOf("bot:news"), l.waits.value)
        assertEquals(OpeningLine.WAITING_FOR_OK, l.under())
        // The line changes beneath, and is back when the owner answered.
        l.handle(line("working_line", "Sending the email"))
        assertEquals(OpeningLine.WAITING_FOR_OK, l.under())
        l.sync(OpeningLine.live(runs("""[{"id":"r1","botId":"news","status":"running","workingLine":"Sending the email"}]"""), l.features), bots)
        assertEquals("Sending the email…", l.under())
        // `hello` says it too.
        val h = OpeningLines()
        h.handle(hello(with, """{"id":"r1","botId":"news","status":"running","workingLine":"Using gmail","waitingFor":"ok"}"""))
        assertEquals(OpeningLine.WAITING_FOR_OK, h.under())
    }

    @Test fun theChiefsLineIsItsOpeningLineAsBefore() {
        val l = on(with)
        l.handle(event("opening_line", """{"chat":"chief:c1","chatId":"c1","text":"Looking at your bots"}"""))
        assertEquals("Looking at your bots", l.of("chief:c1"))
        l.handle(event("working_line", """{"chat":"chief:c1","chatId":"c1","text":"Not a thing the server says"}"""))
        assertEquals("Looking at your bots", l.of("chief:c1"))
    }

    @Test fun anotherBotdotIsAskedAgain() {
        val l = on(with)
        l.serverHas(null) // another botdot was chosen: its features are not known yet
        l.handle(line("opening_line", "Checking the news"))
        assertEquals("Checking the news", l.of())
        l.serverHas(with) // its version was read
        l.handle(line("working_line", "Reading nytimes.com"))
        l.handle(line("opening_line", "Checking the news"))
        assertEquals("Reading nytimes.com", l.of())
        // A `reset` forgets the lines, not what the server offers.
        l.handle(event("reset", "{}"))
        assertEquals(with, l.features)
    }

    @Test fun theRunReadsTheServersField() {
        assertEquals("Reading nytimes.com", Api.JSON.decodeFromString<Run>("""{"id":"r1","status":"running","workingLine":"Reading nytimes.com"}""").workingLine)
        assertNull(Api.JSON.decodeFromString<Run>("""{"id":"r1","status":"success"}""").workingLine)
    }
}
