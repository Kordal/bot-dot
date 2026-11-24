package dev.botdot.app.answerview

import dev.botdot.app.data.fixture
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Answer views on both phones (ADR 264, #1626): the shared cases of test/fixtures/ui-cases.json, run by the web page's
 * validator too (test/answer-view.test.js), read here by the validator in the shared layer, driven by the catalog the
 * server hands out (lib/ui-catalog.json): what a fence draws, or why it is drawn as code.
 */
class AnswerViewTest {
    private val fixture = Json.parseToJsonElement(fixture("uiCases")).jsonObject
    private val catalogText = fixture("uiCatalog")
    private val views = assertNotNull(AnswerViews.of(catalogText))

    /** A tree as plain Kotlin values, a number as its value (a 2 and a 2.0 are one), so that it can be compared. */
    private fun plain(e: JsonElement?): Any? = when (e) {
        null, is JsonNull -> null
        is JsonObject -> e.mapValues { plain(it.value) }
        is JsonArray -> e.map { plain(it) }
        is JsonPrimitive -> if (e.isString) e.content else if (e.content == "true" || e.content == "false") e.boolean else e.content.toDouble()
    }

    private fun sourceOf(c: JsonObject): String {
        val source = c.getValue("source").jsonPrimitive.content
        val repeat = c["repeat"]?.jsonObject ?: return source
        return source.replace(repeat.getValue("mark").jsonPrimitive.content, repeat.getValue("with").jsonPrimitive.content.repeat(repeat.getValue("times").jsonPrimitive.content.toInt()))
    }

    private fun problem(p: JsonObject) = Problem(p.getValue("at").jsonPrimitive.content, p.getValue("code").jsonPrimitive.content, p["prop"]?.jsonPrimitive?.content, p["name"]?.jsonPrimitive?.content)

    @Test fun everyCaseOfTheSharedFixtureDrawsTheTreeItNamesOrIsRefusedForTheReasonItNames() {
        val cases = fixture.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 60)
        for (c in cases) {
            val name = c.getValue("name").jsonPrimitive.content
            val r = views.validate(sourceOf(c))
            assertEquals(c["problems"]?.jsonArray?.map { problem(it.jsonObject) }.orEmpty(), r.problems, "$name: problems")
            val refused = c["refused"]?.jsonPrimitive?.content
            if (refused != null) {
                assertIs<ViewResult.Code>(r, name)
                assertEquals(refused, r.refused, name)
                assertEquals(c.getValue("alt").jsonPrimitive.content, r.alt, "$name: alt")
            } else {
                assertIs<ViewResult.Drawn>(r, name)
                val drawn = c.getValue("drawn").jsonObject
                assertEquals(plain(drawn.getValue("alt")), r.alt, "$name: alt")
                assertEquals(plain(drawn.getValue("root")), plain(r.root.toJson()), name)
            }
        }
    }

    private fun parts(c: JsonObject) = c.getValue("parts").jsonArray.map { it.jsonObject }

    @Test fun everyReplyOfTheSharedFixtureIsSplitIntoItsTextItsViewsAndItsCode() {
        val replies = fixture.getValue("replies").jsonArray.map { it.jsonObject }
        assertTrue(replies.size >= 10)
        for (c in replies) {
            val want = parts(c).map { p ->
                when {
                    "text" in p -> "text:" + p.getValue("text").jsonPrimitive.content
                    "view" in p -> "view:" + plain(p.getValue("view").jsonObject.getValue("root")).toString() + p.getValue("view").jsonObject.getValue("alt").jsonPrimitive.content
                    "code" in p -> "code:" + p.getValue("code").jsonPrimitive.content + "|" + p.getValue("alt").jsonPrimitive.content + "|" + p.getValue("refused").jsonPrimitive.content
                    else -> "drawing"
                }
            }
            val got = views.split(c.getValue("reply").jsonPrimitive.content, done = c["done"]?.jsonPrimitive?.boolean != false).map { p ->
                when (p) {
                    is ReplyPart.Text -> "text:" + p.text
                    is ReplyPart.View -> "view:" + plain(p.root.toJson()).toString() + p.alt
                    is ReplyPart.Code -> "code:" + p.code + "|" + p.alt + "|" + p.refused
                    ReplyPart.Drawing -> "drawing"
                }
            }
            assertEquals(want, got, c.getValue("name").jsonPrimitive.content)
        }
    }

    @Test fun theFixtureCoversEveryLimitAndEveryRefusalAndEveryComponentOfTheCatalog() {
        val cases = fixture.getValue("cases").jsonArray.map { it.jsonObject }
        val refusals = cases.mapNotNull { it["refused"]?.jsonPrimitive?.content }.toSet() +
            fixture.getValue("replies").jsonArray.flatMap { parts(it.jsonObject).mapNotNull { p -> p["refused"]?.jsonPrimitive?.content } }
        for (why in listOf("too-big", "too-many-nodes", "too-deep", "too-many-points", "not-json", "not-object", "no-alt", "no-root", "too-many-fences", "unclosed")) assertTrue(why in refusals, why)
        val seen = mutableSetOf<String>()
        fun walk(e: JsonElement?) {
            when (e) {
                is JsonObject -> { (e["type"] as? JsonPrimitive)?.takeIf { it.isString }?.let { seen += it.content }; e.values.forEach { walk(it) } }
                is JsonArray -> e.forEach { walk(it) }
                else -> {}
            }
        }
        cases.forEach { walk(it["drawn"]) }
        val catalog = Json.parseToJsonElement(catalogText).jsonObject
        for (name in catalog.getValue("components").jsonObject.keys) assertTrue(name in seen, "a case draws $name")
    }

    @Test fun anAppThatDrawsAnOlderCatalogShowsAComponentThatCameLaterAsOneQuietUnknownNode() {
        val catalog = Json.parseToJsonElement(catalogText).jsonObject
        val later = JsonObject(catalog + mapOf(
            "version" to JsonPrimitive(2),
            "components" to JsonObject(catalog.getValue("components").jsonObject + ("slider" to Json.parseToJsonElement(
                """{"group":"text","since":2,"means":"A slider.","props":{"label":{"type":"string","max":40,"required":true}}}"""))),
        )).toString()
        val src = """{"alt":"A","root":{"type":"stack","children":[{"type":"slider","label":"Budget"},{"type":"divider"}]}}"""
        val newer = assertIs<ViewResult.Drawn>(assertNotNull(AnswerViews.of(later)).validate(src))
        assertEquals(listOf("slider", "divider"), newer.root.children!!.map { it.type })
        val older = assertIs<ViewResult.Drawn>(assertNotNull(AnswerViews.of(later, known = 1)).validate(src))
        assertEquals(listOf("unknown", "divider"), older.root.children!!.map { it.type })
        assertEquals(listOf(Problem("root/children/0", "unknown-component", name = "slider")), older.problems)
    }

    @Test fun aBotCannotReachWhatIsNotInTheCatalogThroughTheNamesOfAnObject() {
        val r = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"text","text":"Hi","__proto__":{"x":1},"constructor":"y","toString":"z"}}"""))
        assertEquals("Hi", r.root.text("text"))
        assertEquals(setOf("text"), r.root.props.keys)
    }

    @Test fun aCatalogThatCannotBeReadIsNoCatalog() {
        assertNull(AnswerViews.of("not json"))
        assertNull(AnswerViews.of("{}"))
        assertNull(AnswerViews.of("[]"))
    }

    @Test fun jsonIsReadAsJavaScriptReadsIt() {
        for (bad in listOf("{\"alt\":\"A\",\"root\":{\"type\":\"divider\"},}", "{'alt':'A'}", "{\"alt\":\"A\",\"root\":{\"type\":\"divider\"}} x", "{\"alt\":\"A\n\",\"root\":{\"type\":\"divider\"}}", "{\"alt\":01}"))
            assertIs<ViewResult.Code>(views.validate(bad), bad).also { assertEquals("not-json", it.refused, bad) }
        assertIs<ViewResult.Drawn>(views.validate(" \n{\"alt\" : \"\\u0041\\n\", \"root\":{\"type\":\"divider\"}}\t"))
        assertEquals("A", (views.validate("{\"alt\":\"\\u0041\",\"root\":{\"type\":\"divider\"}}") as ViewResult.Drawn).alt)
    }

    @Test fun aNumberIsWrittenAsTextTheWayJavaScriptWritesIt() {
        assertEquals("12", jsNumberText(12.0))
        assertEquals("1.5", jsNumberText(1.5))
        assertEquals("-0.001", jsNumberText(-0.001))
        assertEquals("0.000001", jsNumberText(0.000001))
        assertEquals("1e-7", jsNumberText(0.0000001))
        assertEquals("12345678.5", jsNumberText(12345678.5))
        assertEquals("1e+21", jsNumberText(1e21))
        assertEquals("123456789012345680000", jsNumberText(1.2345678901234568e20))
        assertEquals("0", jsNumberText(0.0))
    }

    @Test fun aFenceIsMeasuredInUtf8Bytes() {
        assertEquals(1 + 2 + 3 + 4, utf8Bytes("a\u00e9\u20ac\ud83d\ude00"))
    }

    @Test fun aDraftKeepsAnOpenUiFenceOpenSoThatTheReplyCanSayItIsDrawingAView() {
        val draft = "Looking.\n\n```ui\n{\"alt\":\"Revenue\",\"root\":{\"type\":\"sta"
        assertEquals(draft, dev.botdot.app.markdown.draftSource(draft))
        assertEquals(listOf(ReplyPart.Text("Looking."), ReplyPart.Drawing), views.split(dev.botdot.app.markdown.draftSource(draft), done = false))
        // Another code block is closed for the draft, as before.
        assertEquals("```kotlin\nval a = 1\n```", dev.botdot.app.markdown.draftSource("```kotlin\nval a = 1"))
        // A closed mermaid fence before an open ui fence still loses its word: no "Open on web" under a draft (ADR 041).
        assertEquals("```\ngraph TD\n```\n```ui\n{\"alt\"", dev.botdot.app.markdown.draftSource("```mermaid\ngraph TD\n```\n```ui\n{\"alt\""))
    }

    @Test fun aCopyOfAReplyWritesTheAltOfAViewAndItsTablesAsMarkdownTables() {
        val reply = "Here you go.\n\n```ui\n" + """{"alt":"Options compared","root":{"type":"stack","children":[{"type":"chart","series":[{"points":[1,2]}],"source":"s"},{"type":"table","title":"Options","columns":[{"label":"Option"},{"label":"Price"}],"rows":[["A","10"],["B | C","12"]],"source":"Pricing"}]}}""" + "\n```\n\nThe second one is cheaper."
        assertEquals(
            "Here you go.\n\nOptions compared\n\n|  | Value |\n| --- | --- |\n| 1 | 1 |\n| 2 | 2 |\n\n**Options**\n\n| Option | Price |\n| --- | --- |\n| A | 10 |\n| B \\| C | 12 |\n\nThe second one is cheaper.",
            views.copyText(reply),
        )
        // A fence that can't be drawn is its alt and its code; one still being written is nothing.
        assertEquals("Nothing here\n\n```ui\n{\"alt\":\"Nothing here\"}\n```", views.copyText("```ui\n{\"alt\":\"Nothing here\"}\n```"))
        assertEquals("Looking.", views.copyText("Looking.\n\n```ui\n{\"alt\":\"R", done = false))
    }

    @Test fun theNumbersOfAChartAreReadAsATable() {
        val r = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"chart","labels":["Q1","Q2"],"series":[{"label":"EU","points":[1,null]},{"label":"US","points":[3.14159,4]}],"unit":"k","source":"s"}}"""))
        assertEquals(ViewTable(null, listOf("", "EU", "US"), listOf(listOf("Q1", "1 k", "3.14 k"), listOf("Q2", "", "4 k"))), r.root.dataTable())
        val h = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"histogram","values":[1,2,2,3],"bins":2,"source":"s"}}"""))
        assertEquals(listOf(listOf("1 to 2", "1"), listOf("2 to 3", "3")), h.root.dataTable()!!.rows)
        val same = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"histogram","values":[4,4,4],"source":"s"}}"""))
        assertEquals(listOf(listOf("4 to 4", "3")), same.root.dataTable()!!.rows)
        val pie = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"pie","slices":[{"label":"A","value":1},{"label":"B","value":3}],"source":"s"}}"""))
        assertEquals(listOf(listOf("A", "1", "25%"), listOf("B", "3", "75%")), pie.root.dataTable()!!.rows)
        val gauge = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"gauge","label":"Load","value":7,"min":2,"source":"s"}}"""))
        assertEquals(ViewTable("Load", listOf("Load", "Minimum", "Maximum"), listOf(listOf("7", "2", "100"))), gauge.root.dataTable())
        assertNull(assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"divider"}}""")).root.dataTable())
    }

    @Test fun aNodeThatDrawsTheSameIsEqual() {
        val a = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"stack","children":[{"type":"text","text":"x"}]}}""")).root
        val b = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"stack","children":[{"type":"text","text":"x"}]}}""")).root
        val c = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"stack","children":[{"type":"text","text":"y"}]}}""")).root
        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
        assertNotEquals(a, c)
    }

    @Test fun aMessageThatStartsWithAViewShowsItsAltOnItsFirstLine() {
        assertEquals("Sales by quarter", dev.botdot.app.data.RunSteps.firstLine("```ui\n{\"alt\":\"Sales by quarter\",\"root\":{\"type\":\"divider\"}}\n```"))
    }

    @Test fun aNotificationReadsAViewAsItsAltAndNothingElseOfIt() {
        val reply = "Here it is.\n\n```ui\n{\"alt\":\"Sales by quarter\",\"root\":{\"type\":\"chart\",\"series\":[{\"points\":[1,2]}]}}\n```\n\nExample:\n\n````md\n```ui\n{\"alt\":\"In a code block\"}\n```\n````"
        // A ui fence inside another code block is only text, as everywhere else.
        assertEquals("Here it is.\nSales by quarter\nExample:\nmd\nui\n{\"alt\":\"In a code block\"}", dev.botdot.app.data.plainText(reply))
        // A fence still being written, or one that can't be drawn, is its alt too.
        assertEquals("Looking.\nRevenue", dev.botdot.app.data.plainText("Looking.\n```ui\n{\"alt\":\"Revenue\",\"root\":{\"type\":\"sta"))
        assertEquals("Plain text", dev.botdot.app.data.plainText("**Plain** text"))
    }

    // ---- wave 2: what a view sends (#1628, ADR 265), the same cases the web page runs (test/answer-view.test.js) ----

    private fun viewOf(c: JsonObject) = assertIs<ViewResult.Drawn>(views.validate(c.getValue("view").toString())).root

    @Test fun everySendOfTheSharedFixtureIsPostedAsTheWebPagePostsIt() {
        val sends = fixture.getValue("sends").jsonArray.map { it.jsonObject }
        assertTrue(sends.size >= 9)
        for (c in sends) {
            val name = c.getValue("name").jsonPrimitive.content
            val root = viewOf(c)
            c["posts"]?.let { posts ->
                val values = c["values"]?.jsonObject.orEmpty().mapValues { it.value }
                assertEquals(posts.jsonPrimitive.content, ViewForm.form(root, values), name)
            }
            c["presses"]?.jsonObject?.forEach { (path, says) ->
                val button = assertNotNull(ViewForm.buttons(root).firstOrNull { it.path == path }, "$name: a button at $path")
                assertEquals(says.jsonPrimitive.content, ViewForm.press(button.node), "$name: $path")
            }
        }
    }

    @Test fun theInputsOfAViewAreCountedByPathAsTheWebPageCountsThem() {
        val root = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":{"type":"stack","children":[{"type":"card","title":"Who","children":[{"type":"text-input","label":"Name"},{"type":"button","label":"Go"}]},{"type":"toggle","label":"Alerts"}]}}""")).root
        assertEquals(listOf("0.0.0", "0.1"), ViewForm.fields(root).map { it.path })
        assertEquals(listOf("0.0.1"), ViewForm.buttons(root).map { it.path })
    }

    @Test fun aButtonSendsAtMostTwoHundredCharactersAndNeverHalfAPair() {
        val long = "x".repeat(199) + "\ud83d\ude00"
        val node = ViewNode("button", JsonObject(mapOf("label" to JsonPrimitive("Go"), "send" to JsonPrimitive(long))))
        assertEquals("x".repeat(199), ViewForm.press(node))
        assertEquals("Go", ViewForm.press(ViewNode("button", JsonObject(mapOf("label" to JsonPrimitive("Go"), "send" to JsonPrimitive("   "))))))
    }

    @Test fun whatTheOwnerTypedIsKeptToWhatTheInputAllows() {
        fun node(json: String) = assertIs<ViewResult.Drawn>(views.validate("""{"alt":"A","root":$json}""")).root
        val number = node("""{"type":"number","label":"N","min":0,"max":10}""")
        assertEquals(Held.Num(10.0), ViewForm.start(number, JsonPrimitive(99)))
        assertEquals(Held.Num(null), ViewForm.start(number, JsonPrimitive("")))
        assertEquals(Held.Num(1.5), ViewForm.start(number, JsonPrimitive(" 1.5 ")))
        assertEquals(Held.Num(null), ViewForm.start(number, JsonPrimitive("1.5f")))
        val range = node("""{"type":"range","label":"R","low":10,"high":90}""")
        assertEquals(Held.Span(10.0, 90.0), ViewForm.start(range, null))
        assertEquals(Held.Span(20.0, 80.0), ViewForm.start(range, JsonArray(listOf(JsonPrimitive(80), JsonPrimitive(20)))))
        val select = node("""{"type":"select","label":"S","options":["A","B"],"value":"B"}""")
        assertEquals(Held.Text("A"), ViewForm.start(select, JsonPrimitive("A")))
        assertEquals(Held.Text("B"), ViewForm.start(select, JsonPrimitive("C")))
        assertEquals(Held.Text(""), ViewForm.start(select, JsonPrimitive("")))
        val date = node("""{"type":"date","label":"D","min":"2026-11-24","max":"2027-01-31"}""")
        assertEquals(Held.Text("2026-11-24"), ViewForm.start(date, JsonPrimitive("2020-01-01")))
        assertEquals(Held.Text(""), ViewForm.start(date, JsonPrimitive("tomorrow")))
        assertEquals(Held.Grade(3), ViewForm.start(node("""{"type":"rating","label":"G","max":3}"""), JsonPrimitive(7)))
        assertEquals(Held.Picks(listOf("A", "C")), ViewForm.start(node("""{"type":"multi-select","label":"M","options":["A","B","C"]}"""), JsonArray(listOf(JsonPrimitive("C"), JsonPrimitive("A"), JsonPrimitive("Z")))))
    }

    @Test fun aViewIsSentWhenTheOwnersNextMessageIsOneOfItsButtonsOrHasALineForEveryInput() {
        val says = listOf("Yes, go ahead", "Option B")
        assertEquals("Yes, go ahead", ViewForm.sentFrom("Yes, go ahead", says, emptyList()))
        assertEquals("Option B", ViewForm.sentFrom("  Option B \r\n", says, emptyList()))
        assertNull(ViewForm.sentFrom("Something else", says, emptyList()))
        assertNull(ViewForm.sentFrom(null, says, emptyList()))
        val labels = listOf("Name", "Budget")
        assertEquals("Name: Ada\nBudget: 500", ViewForm.sentFrom("Name: Ada\nBudget: 500", emptyList(), labels))
        assertNull(ViewForm.sentFrom("Name: Ada", emptyList(), labels))
        assertEquals("Budget: 500\nName: –", ViewForm.sentFrom("Budget: 500\nName: –", emptyList(), labels))
        assertNull(ViewForm.sentFrom("anything", emptyList(), emptyList()))
    }

    @Test fun onlyTheNewestWholeBotMessageCanSendAndTheStateSaysWhatWasSent() {
        val bubbles = listOf(ViewBubble.bot("a"), ViewBubble.owner("hi"), ViewBubble.bot("b"), ViewBubble.bot("c", working = true), ViewBubble.bot("d", problem = true))
        assertEquals("b", ViewForm.newest(bubbles))
        assertNull(ViewForm.newest(listOf(ViewBubble.owner("hi"))))
        assertNull(ViewForm.newest(listOf(ViewBubble.bot("x", folded = true))))
        assertEquals(ViewState.Open, ViewForm.state(newest = true, sent = null))
        assertEquals(ViewState.Sent("Yes"), ViewForm.state(newest = true, sent = "Yes"))
        assertEquals(ViewState.Sent("Yes"), ViewForm.state(newest = false, sent = "Yes"))
        assertEquals(ViewState.Closed, ViewForm.state(newest = false, sent = null))
        // The owner's message after a bot message, whatever else stands between them.
        assertEquals("hi", ViewForm.ownerAfter(bubbles, "a"))
        assertNull(ViewForm.ownerAfter(bubbles, "b"))
        assertNull(ViewForm.ownerAfter(bubbles, "missing"))
    }

    @Test fun whatTheOwnerTypedStaysUntilItIsSentAndTheKeyOfAMessageIsTheSameWhileItsTextIs() {
        val drafts = ViewDrafts()
        drafts.put("r1#0", "0.1", JsonPrimitive("Grace"))
        assertEquals(JsonPrimitive("Grace"), drafts.of("r1#0")["0.1"])
        assertTrue(drafts.of("r2#0").isEmpty())
        val first = drafts.keyFor("r1#0", "Name: Grace")
        assertEquals(first, drafts.keyFor("r1#0", "Name: Grace"))
        assertNotEquals(first, drafts.keyFor("r1#0", "Name: Ada"))
        drafts.sent("r1#0", "Name: Grace")
        assertTrue(drafts.of("r1#0").isEmpty())
        assertEquals("Name: Grace", drafts.sentOf("r1#0"))
        for (i in 0 until 400) drafts.put("v$i", "0", JsonPrimitive(i))
        assertTrue(drafts.size <= 300)
    }

    @Test fun aNumberIsRoundedHalfUpAsTheWebPageDoes() {
        assertEquals("0.13", viewNumber(0.125))
        assertEquals("-2.5", viewNumber(-2.5))
    }
}
