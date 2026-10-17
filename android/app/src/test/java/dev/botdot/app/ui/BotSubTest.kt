package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Run
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What a bot's row says under its name in the list. */
class BotSubTest {
    private val bot = Bot(id = "b1", name = "Weather", description = "Tells the weather")

    @Test fun aWorkingBotShowsItsOpeningLine() {
        val running = Run(id = "r1", botId = "b1", status = "running")
        assertEquals("Checking the weather in Brussels…", botSub(bot.copy(running = true), running, "Checking the weather in Brussels"))
        assertEquals("Checking the weather in Brussels…", botSub(bot, running, "Checking the weather in Brussels")) // the run is known before the bot's state
    }

    @Test fun aWorkingBotWithoutALineReadsWorkingAsUnderItsChatAndOnTheWebPage() {
        assertEquals("Working…", botSub(bot.copy(running = true), null, null))
        assertEquals("Working…", botSub(bot, Run(id = "r1", botId = "b1", status = "running"), ""))
    }

    @Test fun aBotThatIsNotWorkingNeverShowsALine() {
        assertEquals("It is sunny.", botSub(bot, Run(id = "r1", botId = "b1", status = "success", result = "It is sunny."), "Checking the weather"))
        assertEquals("Couldn't finish", botSub(bot, Run(id = "r1", botId = "b1", status = "error"), "Checking the weather"))
        assertEquals("Stopped", botSub(bot, Run(id = "r1", botId = "b1", status = "stopped"), null))
        assertEquals("Tells the weather", botSub(bot, null, null))
    }

    // ---------- a bot that asks the owner something (`asks-you`, docs/api.md) ----------

    private val question = "Two mailboxes have unread invoices. Which one shall I sort first?"
    private val asking: Bot = Api.JSON.decodeFromString("""{"id":"b1","name":"Weather","description":"Tells the weather","state":"needs_you","asks":{"text":"$question","runId":"r1"}}""")
    private val asked = Run(id = "r1", botId = "b1", status = "success", result = "I found two.\n\n$question")

    @Test fun aBotThatAsksReadsAsksAndItsQuestion() {
        assertEquals("Asks: $question", botSub(asking, asked, null))
        assertEquals("Asks: $question", botAsks(asking, asked))
        assertEquals("a question from a run this list does not have", "Asks: $question", botSub(asking, null, null))
        // One line, also when the server's text has more.
        val two: Bot = Api.JSON.decodeFromString("""{"id":"b1","name":"Weather","asks":{"text":"Which one?\n(+2 more)"}}""")
        assertEquals("Asks: Which one? (+2 more)", botSub(two, null, null))
    }

    @Test fun theQuestionStandsBeforeAWaitingJobAndAfterWork() {
        val job = dev.botdot.app.data.Job(id = "j1", approved = false)
        assertEquals("Asks: $question", botSub(asking.copy(jobs = listOf(job)), asked, null))
        // While it works its row says what it does, and has no mark.
        val running = Run(id = "r2", botId = "b1", status = "running")
        assertEquals("Working…", botSub(asking.copy(running = true), running, null))
        assertNull(botAsks(asking.copy(running = true), running))
        assertNull(botAsks(asking, running))
    }

    @Test fun whenTheFeedEndsItTheRowIsAsBefore() {
        val ended = dev.botdot.app.data.Asks.on(listOf(asking), dev.botdot.app.data.FeedEvent("b.9", "asks", kotlinx.serialization.json.Json.parseToJsonElement("""{"botId":"b1","asks":null}""") as kotlinx.serialization.json.JsonObject)).single()
        assertNull(botAsks(ended, asked))
        assertEquals("I found two. $question", botSub(ended, asked, null))
    }

    @Test fun againstAServerWithoutAsksYouTheRowIsAsToday() {
        assertNull(botAsks(bot, asked))
        assertEquals("I found two. $question", botSub(bot, asked, null))
    }

    @Test fun aChangeThatWaitsIsSaidLikeAWaitingJob() {
        val changed: dev.botdot.app.data.Job = Api.JSON.decodeFromString("""{"id":"j1","approved":true,"change":{"when":"Daily at 07:00"}}""")
        assertEquals("a change to a job waits for your OK", botSub(bot.copy(jobs = listOf(changed)), null, null))
        assertEquals("a job waits for your OK", botSub(bot.copy(jobs = listOf(dev.botdot.app.data.Job(id = "j2", approved = false), changed)), null, null))
    }
}
