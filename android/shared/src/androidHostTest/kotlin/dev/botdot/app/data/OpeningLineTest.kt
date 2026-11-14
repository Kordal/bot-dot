package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A working bot's opening line, read from what the server says (docs/api.md, "The opening line"). */
class OpeningLineTest {
    private fun event(type: String, data: String) = FeedEvent("boot.1", type, Json.parseToJsonElement(data).jsonObject)
    private val bots: (String) -> Boolean = { it.startsWith("bot:") }
    private fun OpeningLines.of(chat: String) = lines.value[chat]

    @Test fun previewAddsTheEllipsis() {
        assertEquals("Checking the weather in Brussels…", OpeningLine.preview("Checking the weather in Brussels"))
        assertEquals("", OpeningLine.preview(null))
        assertEquals("", OpeningLine.preview("  "))
    }

    @Test fun aWorkingBotIsOneLine() {
        // A bot's chat while it works: its line, or "Working…" until it says one (and against an older server).
        assertEquals("Checking the Agent Mail inbox…", OpeningLine.status("Checking the Agent Mail inbox", working = true))
        assertEquals("Working…", OpeningLine.status(null, working = true))
        assertEquals("Working…", OpeningLine.status("  ", working = true))
        // At rest, and in the Chief's chat, there is a line only when one was said.
        assertEquals("", OpeningLine.status(null, working = false))
        assertEquals("Looking at your bots…", OpeningLine.status("Looking at your bots", working = false))
    }

    @Test fun aFeedEventSaysABotsLine() {
        val l = OpeningLines()
        l.handle(event("opening_line", """{"chat":"bot:b1","botId":"b1","runId":"r1","text":"Checking my scheduled jobs"}"""))
        assertEquals("Checking my scheduled jobs", l.of("bot:b1"))
        assertNull(l.of("bot:b2"))
    }

    @Test fun theLineGoesWhenItsRunEndsWhateverTheStatus() {
        for (status in listOf("success", "error", "stopped", "interrupted")) {
            val l = OpeningLines()
            l.handle(event("opening_line", """{"chat":"bot:b1","botId":"b1","runId":"r1","text":"Reading the page"}"""))
            l.handle(event("run_finished", """{"id":"r1","botId":"b1","status":"$status"}"""))
            assertNull(status, l.of("bot:b1"))
        }
    }

    @Test fun twoRunsOfOneBotEachKeepTheirLine() {
        val l = OpeningLines()
        l.say("bot:b1", "First", "r1")
        l.say("bot:b1", "Second", "r2")
        assertEquals("Second", l.of("bot:b1")) // the latest that still goes on
        l.end("bot:b1", "r2")
        assertEquals("First", l.of("bot:b1"))
        l.end("bot:b1", "r1")
        assertNull(l.of("bot:b1"))
    }

    @Test fun anotherRunsEndLeavesTheLine() {
        val l = OpeningLines()
        l.say("bot:b1", "Looking", "r1")
        l.handle(event("run_finished", """{"id":"r0","botId":"b1","status":"success"}"""))
        assertEquals("Looking", l.of("bot:b1"))
    }

    @Test fun theChiefsLineGoesWithItsOwnReplyOnly() {
        val l = OpeningLines()
        l.handle(event("opening_line", """{"chat":"chief:c1","chatId":"c1","text":"Checking your bots' schedules"}"""))
        assertEquals("Checking your bots' schedules", l.of("chief:c1"))
        l.handle(event("chief_reply", """{"chatId":"c1","from":{"id":"b1","name":"Coder"}}""")) // a bot's report in the chat
        assertEquals("Checking your bots' schedules", l.of("chief:c1"))
        l.handle(event("chief_reply", """{"chatId":"c1","btw":true,"text":"Halfway"}""")) // a "/btw" answer beside the reply (#386)
        assertEquals("Checking your bots' schedules", l.of("chief:c1"))
        l.handle(event("chief_reply", """{"chatId":"c2"}""")) // another chat
        assertEquals("Checking your bots' schedules", l.of("chief:c1"))
        l.handle(event("chief_reply", """{"chatId":"c1","from":null}"""))
        assertNull(l.of("chief:c1"))
    }

    @Test fun anAppThatConnectsMidRunReadsTheLineFromHello() {
        val l = OpeningLines()
        l.say("bot:gone", "From before", "r0") // its run ended while the app was away
        l.say("chief:c1", "The Chief's", null) // hello says nothing about the Chief
        l.handle(event("hello", """{"running":[{"id":"r1","botId":"b1","status":"running","openingLine":"Checking the weather"},{"id":"r2","botId":"b2","status":"running"}]}"""))
        assertEquals("Checking the weather", l.of("bot:b1"))
        assertNull(l.of("bot:b2"))
        assertNull(l.of("bot:gone"))
        assertEquals("The Chief's", l.of("chief:c1"))
    }

    @Test fun aListOfRunsBringsTheLinesOfThoseStillRunning() {
        val l = OpeningLines()
        val runs = listOf(
            Run(id = "r1", botId = "b1", status = "running", openingLine = "Opening the inbox"),
            Run(id = "r2", botId = "b2", status = "success", openingLine = "Never shown"),
        )
        l.sync(OpeningLine.live(runs), bots)
        assertEquals(mapOf("bot:b1" to "Opening the inbox"), l.lines.value)
    }

    @Test fun aListFromBeforeTheLineWasSaidKeepsIt() {
        val l = OpeningLines()
        l.say("bot:b1", "Said on the feed", "r1")
        l.sync(OpeningLine.live(listOf(Run(id = "r1", botId = "b1", status = "running"))), bots)
        assertEquals("Said on the feed", l.of("bot:b1"))
    }

    @Test fun aListFromBeforeTheRunEndedDoesNotBringItsLineBack() {
        val l = OpeningLines()
        l.say("bot:b1", "Working on it", "r1")
        l.end("bot:b1", "r1")
        l.sync(OpeningLine.live(listOf(Run(id = "r1", botId = "b1", status = "running", openingLine = "Working on it"))), bots)
        l.say("bot:b1", "Working on it", "r1") // its stream, replayed late
        assertNull(l.of("bot:b1"))
    }

    @Test fun oneChatsListLeavesTheOtherChatsAlone() {
        val l = OpeningLines()
        l.say("bot:b1", "Mine", "r1")
        l.say("bot:b2", "Theirs", "r2")
        l.sync(emptyList()) { it == "bot:b1" } // b1's chat read its runs: none is running
        assertEquals(mapOf("bot:b2" to "Theirs"), l.lines.value)
    }

    @Test fun theChiefsChatsCarryItsLineWhileItReplies() {
        val l = OpeningLines()
        val chats = listOf(ChiefChatSummary(id = "c1", openingLine = "Looking at your bots"), ChiefChatSummary(id = "c2"))
        l.sync(OpeningLine.live(ChiefOverview(chats = chats, busy = true))) { it.startsWith("chief:") }
        assertEquals(mapOf("chief:c1" to "Looking at your bots"), l.lines.value)
        l.sync(OpeningLine.live(ChiefOverview(chats = chats, busy = false))) { it.startsWith("chief:") }
        assertEquals(emptyMap<String, String>(), l.lines.value)
    }

    @Test fun aResetForgetsEveryLine() {
        val l = OpeningLines()
        l.say("bot:b1", "One", "r1")
        l.say("chief:c1", "Two")
        l.handle(event("reset", "{}"))
        assertEquals(emptyMap<String, String>(), l.lines.value)
    }

    @Test fun aServerWithoutTheLineSaysNothing() {
        val l = OpeningLines()
        l.handle(event("hello", """{"version":"1.0","features":[]}"""))
        l.handle(event("run_started", """{"id":"r1","botId":"b1","status":"running"}"""))
        l.handle(event("opening_line", """{"chat":"bot:b1","runId":"r1"}""")) // no text
        l.handle(event("run_finished", """{"id":"r1","botId":"b1","status":"success"}"""))
        l.sync(OpeningLine.live(Api.JSON.decodeFromString<List<Run>>("""[{"id":"r2","botId":"b1","status":"running"}]""")), bots)
        assertEquals(emptyMap<String, String>(), l.lines.value)
    }

    // ---------- a run that waits for the owner's OK (`waitingFor`) ----------

    private fun runs(json: String) = OpeningLine.live(Api.JSON.decodeFromString<List<Run>>(json))

    @Test fun aRunThatWaitsForYourOkSaysSoWhereItsLineStood() {
        // Over its opening line and over "Working…", with no ellipsis: nothing moves until the owner answers.
        assertEquals("Waiting for your OK", OpeningLine.status("Writing the email to Anna", working = true, waiting = true))
        assertEquals("Waiting for your OK", OpeningLine.status(null, working = true, waiting = true))
        assertEquals("Writing the email to Anna…", OpeningLine.status("Writing the email to Anna", working = true, waiting = false))
    }

    @Test fun onlyOkOnARunningRunIsAWait() {
        assertTrue(Api.JSON.decodeFromString<Run>("""{"id":"r1","status":"running","waitingFor":"ok"}""").waitsForOk)
        for (other in listOf(""""waitingFor":"login"""", """"waitingFor":true""", """"waitingFor":null""", """"waitingFor":{"for":"ok"}""", """"waitingFor":"OK """", """"x":1""")) {
            assertFalse(other, Api.JSON.decodeFromString<Run>("""{"id":"r1","status":"running",$other}""").waitsForOk)
        }
        assertFalse("its wait ended with it", Api.JSON.decodeFromString<Run>("""{"id":"r1","status":"success","waitingFor":"ok"}""").waitsForOk)
    }

    @Test fun aListOfRunsSaysWhichChatWaitsAndTheLineComesBack() {
        val l = OpeningLines()
        l.sync(runs("""[{"id":"r1","botId":"b1","status":"running","openingLine":"Writing the email to Anna","waitingFor":"ok"},{"id":"r2","botId":"b2","status":"running","openingLine":"Reading the news"}]"""), bots)
        assertEquals(setOf("bot:b1"), l.waits.value)
        assertEquals("the line is kept beneath", "Writing the email to Anna", l.of("bot:b1"))
        // The owner answered: the field goes from the run, and the chat shows the line again.
        l.sync(runs("""[{"id":"r1","botId":"b1","status":"running","openingLine":"Writing the email to Anna"},{"id":"r2","botId":"b2","status":"running","openingLine":"Reading the news"}]"""), bots)
        assertEquals(emptySet<String>(), l.waits.value)
        assertEquals("Writing the email to Anna", l.of("bot:b1"))
    }

    @Test fun oneChatsListLeavesAnotherChatsWaitAlone() {
        val l = OpeningLines()
        l.sync(runs("""[{"id":"r1","botId":"b1","status":"running","waitingFor":"ok"},{"id":"r2","botId":"b2","status":"running","waitingFor":"ok"}]"""), bots)
        l.sync(runs("""[{"id":"r1","botId":"b1","status":"running"}]""")) { it == "bot:b1" } // b1's chat read its runs again
        assertEquals(setOf("bot:b2"), l.waits.value)
    }

    @Test fun helloSaysWhichRunsWait() {
        val l = OpeningLines()
        l.waiting("bot:gone", "r0", on = true) // its wait ended while the app was away
        l.handle(event("hello", """{"running":[{"id":"r1","botId":"b1","status":"running","openingLine":"Writing the email","waitingFor":"ok"},{"id":"r2","botId":"b2","status":"running"}]}"""))
        assertEquals(setOf("bot:b1"), l.waits.value)
    }

    @Test fun theFeedSaysWhenAWaitBeginsAndEndsAsItSaysAnOpeningLine() {
        val l = OpeningLines()
        l.handle(event("opening_line", """{"chat":"bot:b1","botId":"b1","runId":"r1","text":"Writing the email to Anna"}"""))
        assertEquals("an opening line alone is no wait", emptySet<String>(), l.waits.value)
        // Whatever the event is called: it names the chat and the run, and says what the run waits for now.
        l.handle(event("waiting_for", """{"chat":"bot:b1","botId":"b1","runId":"r1","waitingFor":"ok"}"""))
        assertEquals(setOf("bot:b1"), l.waits.value)
        l.handle(event("waiting_for", """{"chat":"bot:b1","botId":"b1","runId":"r1","waitingFor":null}"""))
        assertEquals(emptySet<String>(), l.waits.value)
        assertEquals("Writing the email to Anna", l.of("bot:b1"))
        // "The field goes when the wait ends": the same event for that run, now without it. Another event leaves the wait.
        l.handle(event("waiting_for", """{"chat":"bot:b1","botId":"b1","runId":"r1","waitingFor":"ok"}"""))
        l.handle(event("opening_line", """{"chat":"bot:b1","botId":"b1","runId":"r1","text":"Writing the email to Anna"}"""))
        l.handle(event("waiting_for", """{"chat":"bot:b1","botId":"b1","runId":"r2"}""")) // another run
        assertEquals(setOf("bot:b1"), l.waits.value)
        l.handle(event("waiting_for", """{"chat":"bot:b1","botId":"b1","runId":"r1"}"""))
        assertEquals(emptySet<String>(), l.waits.value)
        // Said with the opening line's own event, and over with the next one for that run.
        l.handle(event("opening_line", """{"chat":"bot:b1","botId":"b1","runId":"r1","text":"Writing the email to Anna","waitingFor":"ok"}"""))
        assertEquals(setOf("bot:b1"), l.waits.value)
        l.handle(event("opening_line", """{"chat":"bot:b1","botId":"b1","runId":"r1","text":"Writing the email to Anna"}"""))
        assertEquals(emptySet<String>(), l.waits.value)
        // Without a run, or for the Chief's chat, nothing waits.
        l.handle(event("waiting_for", """{"chat":"bot:b1","botId":"b1","waitingFor":"ok"}"""))
        l.handle(event("waiting_for", """{"chat":"chief:c1","runId":"r1","waitingFor":"ok"}"""))
        assertEquals(emptySet<String>(), l.waits.value)
    }

    @Test fun aWaitEndsWithItsRunAndIsNotBroughtBack() {
        val l = OpeningLines()
        l.waiting("bot:b1", "r1", on = true)
        l.waiting("bot:b1", "r2", on = true) // a second run of the same bot
        l.handle(event("run_finished", """{"id":"r1","botId":"b1","status":"stopped"}"""))
        assertEquals("the other run still waits", setOf("bot:b1"), l.waits.value)
        l.handle(event("run_finished", """{"id":"r2","botId":"b1","status":"success"}"""))
        assertEquals(emptySet<String>(), l.waits.value)
        // A list fetched before the run ended, and the feed replayed late, do not bring it back.
        l.sync(runs("""[{"id":"r2","botId":"b1","status":"running","waitingFor":"ok"}]"""), bots)
        l.waiting("bot:b1", "r2", on = true)
        assertEquals(emptySet<String>(), l.waits.value)
        // Another botdot, or the lists are read again: nothing waits.
        l.waiting("bot:b3", "r9", on = true)
        l.handle(event("reset", "{}"))
        assertEquals(emptySet<String>(), l.waits.value)
    }

    @Test fun aServerWithoutTheFieldNeverWaits() {
        val l = OpeningLines()
        l.handle(event("hello", """{"version":"1.0","features":[],"running":[{"id":"r1","botId":"b1","status":"running","openingLine":"Looking"}]}"""))
        l.handle(event("asks", """{"waiting":1,"list":[{"id":"a1","kind":"connector-action","botId":"b1"}]}"""))
        l.sync(runs("""[{"id":"r1","botId":"b1","status":"running","openingLine":"Looking"}]"""), bots)
        assertEquals(emptySet<String>(), l.waits.value)
        assertEquals("Looking…", OpeningLine.status(l.of("bot:b1"), working = true, waiting = "bot:b1" in l.waits.value))
    }

    @Test fun theModelsReadTheServersField() {
        assertEquals("Checking the weather", Api.JSON.decodeFromString<Run>("""{"id":"r1","status":"running","openingLine":"Checking the weather"}""").openingLine)
        assertEquals("Looking", Api.JSON.decodeFromString<ChiefChat>("""{"id":"c1","busy":true,"openingLine":"Looking"}""").openingLine)
        assertNull(Api.JSON.decodeFromString<Run>("""{"id":"r1","status":"success"}""").openingLine)
    }
}
