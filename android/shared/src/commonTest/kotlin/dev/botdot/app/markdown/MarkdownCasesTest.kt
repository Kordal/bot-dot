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
        "table" -> Block.Table(b.getValue("rows").jsonArray.map { row -> row.jsonArray.map { it.jsonPrimitive.content } }, b.getValue("aligns").jsonArray.map { it.jsonPrimitive.content })
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

    private fun firstTable(src: String) = parseBlocks(src).filterIsInstance<Block.Table>().firstOrNull()
    private fun viewOf(src: String): JsonObject? = firstTable(src)?.let { tableView(it) }?.toJson()

    @Test fun everyTableCaseOfTheSharedFixtureIsTheViewOfItsFirstTableOrNone() {
        val tables = markdown.getValue("tables").jsonArray.map { it.jsonObject }
        assertTrue(tables.size >= 8)
        for (c in tables) {
            val want = c.getValue("view").let { if (it is JsonObject) it else null }
            assertEquals(want, viewOf(c.getValue("source").jsonPrimitive.content), c.getValue("name").jsonPrimitive.content)
        }
    }

    @Test fun aTableHasTheCatalogsTableLimitsAndOverThemItStaysTheMarkdownTable() {
        val limits = Json.parseToJsonElement(fixture("uiCatalog")).jsonObject.getValue("components").jsonObject.getValue("table").jsonObject.getValue("props").jsonObject
        fun max(v: kotlinx.serialization.json.JsonElement) = v.jsonObject.getValue("max").jsonPrimitive.int
        val columns = max(limits.getValue("columns"))
        val rows = max(limits.getValue("rows"))
        val label = max(limits.getValue("columns").jsonObject.getValue("of").jsonObject.getValue("props").jsonObject.getValue("label"))
        val cell = max(limits.getValue("rows").jsonObject.getValue("of").jsonObject.getValue("of"))
        assertEquals(listOf(12, 100, 40, 200), listOf(columns, rows, label, cell))
        fun row(n: Int, text: String) = "| " + List(n) { text }.joinToString(" | ") + " |"
        fun table(cols: Int, body: Int, head: String = "h", text: String = "x") = (listOf(row(cols, head), row(cols, "---")) + List(body) { row(cols, text) }).joinToString("\n")
        assertTrue(viewOf(table(columns, 1)) != null, "the most columns")
        assertEquals(null, viewOf(table(columns + 1, 1)), "one column more")
        assertEquals(rows, viewOf(table(2, rows))!!.getValue("rows").jsonArray.size, "the most rows")
        assertEquals(null, viewOf(table(2, rows + 1)), "one row more")
        assertTrue(viewOf(table(2, 1, head = "l".repeat(label))) != null, "the longest header cell")
        assertEquals(null, viewOf(table(2, 1, head = "l".repeat(label + 1))), "one character more in a header cell")
        assertTrue(viewOf(table(2, 1, text = "c".repeat(cell))) != null, "the longest cell")
        assertEquals(null, viewOf(table(2, 1, text = "c".repeat(cell + 1))), "one character more in a cell")
    }

    @Test fun everyPreviewCaseOfTheSharedFixtureIsItsLines() {
        val preview = markdown.getValue("preview").jsonArray.map { it.jsonObject }
        assertTrue(preview.size >= 5)
        for (c in preview) assertEquals(c.getValue("lines").jsonArray.map { it.jsonPrimitive.content }, previewLines(c.getValue("source").jsonPrimitive.content), c.getValue("name").jsonPrimitive.content)
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
