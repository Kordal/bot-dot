package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.ChiefActivity
import dev.botdot.app.data.ChiefChat
import dev.botdot.app.data.OpeningLine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

/**
 * What the Chief of Staff is doing while it replies is the server's text (docs/api.md, "The working line", the Chief
 * of Staff): the `activity` of the reply it is writing and of its stream, `{ tool, text }`. The app draws `text` and
 * has no words of its own for a tool. `test/chief-line-web.test.js` says the same of the web page.
 */
class ChiefWordsTest {
    private fun pending(activity: String) =
        Api.JSON.decodeFromString<ChiefChat>("""{"id":"c1","busy":true,"messages":[{"role":"chief","pending":true$activity}]}""").messages.single().activity
    private fun streamed(json: String) = OpeningLine.chiefActivity(Json.parseToJsonElement(json).jsonObject)
    private fun line(activity: String?) = OpeningLine.chiefLine(null, activity, busy = true)

    @Test fun theChiefsLineReadsTheServersWords() {
        // A tool a bot can also use reads as a bot's line does; the Chief's own tools and "Thinking" as before.
        for (text in listOf("Reading nytimes.com", "Searching the web", "Running a command", "Saving a note", "Waiting for Web Surfer", "Thinking")) {
            assertEquals("$text…", line(OpeningLine.chiefActivity(pending(""","activity":{"tool":"WebFetch","text":"$text"}"""))))
            assertEquals("$text…", line(streamed("""{"type":"activity","tool":"WebFetch","text":"$text","input":{"url":"https://nytimes.com"}}""")))
        }
        assertEquals("one line, as the server cut it", "Reading plan.md", streamed("""{"type":"activity","tool":"Read","text":"  Reading plan.md "}"""))
    }

    @Test fun anActivityWithoutWordsReadsWorking() {
        // A server from before it had words for every tool names the tool alone.
        for (tool in listOf("WebSearch", "create_bot", "list_bots", "Read", "", "some_new_tool")) {
            assertEquals(tool, "Working", OpeningLine.chiefActivity(ChiefActivity(tool)))
            assertEquals(tool, "Working", OpeningLine.chiefActivity(ChiefActivity(tool, "  ")))
            assertEquals(tool, "Working…", line(streamed("""{"type":"activity","tool":"$tool"}""")))
        }
        assertEquals("Working…", line(OpeningLine.chiefActivity(pending(""","activity":{"tool":"WebSearch"}"""))))
    }

    @Test fun untilTheChiefSaysWhatItDoesItThinks() {
        assertEquals("no activity yet", "", OpeningLine.chiefActivity(pending("")))
        assertEquals("Thinking…", line(OpeningLine.chiefActivity(pending(""))))
        assertEquals("its opening line stands until the server says what it is doing", "Looking at your bots…", OpeningLine.chiefLine("Looking at your bots", OpeningLine.chiefActivity(pending("")), busy = true))
        assertEquals("the line goes on after the opening line", "Reading nytimes.com…", OpeningLine.chiefLine("Looking at your bots", "Reading nytimes.com", busy = true))
        assertEquals("", OpeningLine.chiefLine(null, "Reading nytimes.com", busy = false))
    }

    @Test fun theAppHoldsNoWordsForTheChiefsTools() {
        val src = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "src/main/java/dev/botdot/app") }.first { it.exists() }
        val code = src.walkTopDown().filter { it.extension == "kt" }.joinToString("\n") { it.readText() }
        for (words in listOf("friendlyTool", "Looking at your bots", "Creating a bot", "Changing a bot", "Starting a bot", "Reading what a bot did",
            "Searching its memory", "Searching the web", "Reading a web page", "Looking through files", "Using a skill")) assertFalse(words, code.contains(words))
    }
}
