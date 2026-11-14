package dev.botdot.app.markdown

import dev.botdot.app.data.fixture
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A reply's Markdown read as the web page reads it, on both phones (test/fixtures/markdown-cases.json, chat-links.json). */
class MarkdownCasesTest {
    private val markdown = Json.parseToJsonElement(fixture("markdownCases")).jsonObject

    private fun JsonObject.text() = getValue("text").jsonPrimitive.content
    private fun block(b: JsonObject): Block = when (val type = b.getValue("type").jsonPrimitive.content) {
        "heading" -> Block.Heading(b.getValue("level").jsonPrimitive.int, b.text())
        "para" -> Block.Para(b.text())
        "item" -> Block.Item(b.text(), b.getValue("number").jsonPrimitive.intOrNull, b.getValue("depth").jsonPrimitive.int, b["task"]?.jsonPrimitive?.content)
        "quote" -> Block.Quote(b.text())
        "rule" -> Block.Rule
        "code" -> Block.Code(b.text(), b.getValue("lang").jsonPrimitive.content)
        "table" -> Block.Table(b.getValue("rows").jsonArray.map { row -> row.jsonArray.map { it.jsonPrimitive.content } })
        else -> error("The fixture has a block the app does not know: $type")
    }

    @Test fun everyCaseOfTheSharedFixtureIsReadIntoItsBlocks() {
        val cases = markdown.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 30)
        for (c in cases) assertEquals(c.getValue("blocks").jsonArray.map { block(it.jsonObject) }, parseBlocks(c.getValue("source").jsonPrimitive.content), c.getValue("name").jsonPrimitive.content)
    }

    @Test fun everyStreamCaseOfTheSharedFixtureIsDrawnAsItsBlocks() {
        val stream = markdown.getValue("stream").jsonArray.map { it.jsonObject }
        assertTrue(stream.size >= 10)
        for (c in stream) assertEquals(c.getValue("blocks").jsonArray.map { block(it.jsonObject) }, parseBlocks(draftSource(c.getValue("source").jsonPrimitive.content)), c.getValue("name").jsonPrimitive.content)
    }

    @Test fun everyAddressOfTheSharedFixtureIsLinkedAndLabelled() {
        val table = Json.parseToJsonElement(fixture("chatLinks")).jsonObject
        for (c in table.getValue("cases").jsonArray.map { it.jsonObject }) {
            val text = c.getValue("text").jsonPrimitive.content
            val want = c.getValue("links").jsonArray.map { l -> l.jsonArray.map { it.jsonPrimitive.content } }
            val links = chatLinks(text)
            assertEquals(want, links.map { listOf(it.text, it.url, linkLabel(it.text)) }, text)
            for (l in links) assertEquals(l.text, text.substring(l.start, l.start + l.text.length))
        }
        for (pair in table.getValue("labels").jsonArray.map { it.jsonArray }) {
            assertEquals(pair[1].jsonPrimitive.content, linkLabel(pair[0].jsonPrimitive.content), pair[0].jsonPrimitive.content)
        }
    }

    @Test fun aLineIsRunsOfTextWithTheirMarks() {
        val runs = inlineRuns("Hi **there** and `code`, see [docs](https://docs.example.com/a) or https://www.example.com/x. ~~old~~ *now*")
        assertEquals("Hi there and code, see docs or example.com. old now", runs.joinToString("") { it.text })
        assertEquals(listOf("there"), runs.filter { it.bold }.map { it.text })
        assertEquals(listOf("code"), runs.filter { it.code }.map { it.text })
        assertEquals(listOf("https://docs.example.com/a", "https://www.example.com/x"), runs.mapNotNull { it.link })
        assertEquals(listOf("old"), runs.filter { it.strike }.map { it.text })
        assertEquals(listOf("now"), runs.filter { it.italic }.map { it.text })
    }

    @Test fun tildesStrikeThroughOutsideCodeOnly() {
        val runs = inlineRuns("~~struck~~ **~~both~~** `~~code~~` ~~open ~one~ ~~ spaced ~~")
        assertEquals("struck both ~~code~~ ~~open ~one~ ~~ spaced ~~", runs.joinToString("") { it.text })
        assertEquals(listOf("struck", "both"), runs.filter { it.strike }.map { it.text })
    }
}
