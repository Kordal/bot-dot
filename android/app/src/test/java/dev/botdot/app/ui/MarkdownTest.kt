package dev.botdot.app.ui

import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class MarkdownTest {
    // The rules the web page shares (test/fixtures/markdown-cases.json): each case is a text and its blocks.
    private val cases = Json.parseToJsonElement(
        File(System.getProperty("markdownCases") ?: "../../test/fixtures/markdown-cases.json").readText(),
    ).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }

    private fun JsonObject.text() = getValue("text").jsonPrimitive.content
    private fun block(b: JsonObject): Block = when (val type = b.getValue("type").jsonPrimitive.content) {
        "heading" -> Block.Heading(b.getValue("level").jsonPrimitive.int, b.text())
        "para" -> Block.Para(b.text())
        "item" -> Block.Item(b.text(), b.getValue("number").jsonPrimitive.intOrNull, b.getValue("depth").jsonPrimitive.int)
        "quote" -> Block.Quote(b.text())
        "rule" -> Block.Rule
        "code" -> Block.Code(b.text(), b.getValue("lang").jsonPrimitive.content)
        "table" -> Block.Table(b.getValue("rows").jsonArray.map { row -> row.jsonArray.map { it.jsonPrimitive.content } })
        else -> error("The fixture has a block the app does not know: $type")
    }

    @Test fun everyCaseOfTheSharedFixtureIsReadIntoItsBlocks() {
        assertTrue(cases.size >= 30)
        cases.forEach { c ->
            assertEquals(c.getValue("name").jsonPrimitive.content, c.getValue("blocks").jsonArray.map { block(it.jsonObject) }, parseBlocks(c.getValue("source").jsonPrimitive.content))
        }
    }

    @Test fun aSubItemsTextStartsRightOfItsParentsText() {
        // Where an item's text starts: its indent, then the room of its marker.
        fun textStart(depth: Int, numbered: Boolean) = itemIndent(depth) + markerWidth(numbered)
        for (depth in 1..3) for (parent in listOf(true, false)) for (child in listOf(true, false)) {
            assertTrue("depth $depth", textStart(depth, child) > textStart(depth - 1, parent))
        }
        assertEquals(0.dp, itemIndent(0))
    }

    @Test fun aTitleIsLargerThanTheTextAndStandsOffFromWhatIsAboveIt() {
        assertEquals(listOf(20.sp, 18.sp, 16.5.sp, 15.sp), (1..4).map { headingSize(it) })
        val title = Block.Heading(2, "Title"); val text = Block.Para("Text"); val item = Block.Item("a", null, 0)
        assertEquals(0.dp, gapAbove(null, title))
        assertEquals(16.dp, gapAbove(text, title))
        assertEquals(16.dp, gapAbove(item, title))
        assertEquals(4.dp, gapAbove(item, item.copy(indent = 1)))
        assertEquals(6.dp, gapAbove(title, text))
        assertEquals(6.dp, gapAbove(text, item))
        assertEquals(6.dp, gapAbove(item, text))
        assertEquals(6.dp, gapAbove(text, Block.Rule))
    }

    @Test fun headingsParagraphsAndLists() {
        val blocks = parseBlocks("# Title\nOne line\nand the next\n\n- a\n  - b\n2. two")
        assertEquals(
            listOf(
                Block.Heading(1, "Title"),
                Block.Para("One line\nand the next"),
                Block.Item("a", null, 0),
                Block.Item("b", null, 1),
                Block.Item("two", 2, 0),
            ),
            blocks,
        )
    }

    @Test fun aMermaidBlockInAChatHasALinkToTheSameChatOnTheWebPage() {
        // The addresses the web page opens a chat from (public/boot.js), whether or not the server's address ends in "/".
        assertEquals("https://box.tail.ts.net/#chief/c1", chatOnWeb("https://box.tail.ts.net", "chief", "c1"))
        assertEquals("https://box.tail.ts.net/#bot/b-2", chatOnWeb("https://box.tail.ts.net/", "bot", "b-2"))
        assertEquals("https://box.tail.ts.net/#group/g3", chatOnWeb("https://box.tail.ts.net", "group", "g3"))
        val (diagram, code) = parseBlocks("```mermaid\nflowchart LR\n  A --> B\n```\n\n```kotlin\nval x = 1\n```")
        assertEquals(Block.Code("flowchart LR\n  A --> B", "mermaid"), diagram)
        val web = "https://box.tail.ts.net/#bot/b1"
        assertEquals(web, webLinkUnder(diagram, web))
        // Other code and other blocks have no link, and nothing has one outside a chat (a board tile, a skill).
        assertEquals(null, webLinkUnder(code, web))
        assertEquals(null, webLinkUnder(Block.Code("x"), web))
        assertEquals(null, webLinkUnder(Block.Para("mermaid"), web))
        assertEquals(null, webLinkUnder(diagram, null))
        // A fence's word counts only alone on its line, as on the web page: no diagram, no link.
        assertEquals(Block.Code("A --> B", ""), parseBlocks("```mermaid please\nA --> B\n```").single())
    }

    @Test fun codeIsKeptAsWritten() {
        assertEquals(listOf(Block.Code("val x = 1\n  # not a heading", "kotlin")), parseBlocks("```kotlin\nval x = 1\n  # not a heading\n```"))
    }

    @Test fun tablesLeaveOutTheSeparatorRow() {
        assertEquals(listOf(Block.Table(listOf(listOf("A", "B"), listOf("1", "2")))), parseBlocks("| A | B |\n|---|:-:|\n| 1 | 2 |"))
    }

    @Test fun quotesAndRules() {
        assertEquals(listOf(Block.Quote("said"), Block.Rule, Block.Para("after")), parseBlocks("> said\n---\nafter"))
    }
}
