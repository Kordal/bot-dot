package dev.botdot.app.answerview

import dev.botdot.app.data.fixture
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Live numbers in answer views (#1630): which nodes bind, what is asked, how the server's answer is read (the same rules as the web page's, public/answer-view-draw.js). */
class AnswerViewLiveTest {
    private val views = assertNotNull(AnswerViews.of(fixture("uiCatalog")))

    private fun view(root: String): ViewNode = (views.validate("""{"alt":"A","root":$root}""") as ViewResult.Drawn).root

    private val tree = view("""{"type":"stack","children":[
        {"type":"text","text":"Hi"},
        {"type":"kpi","label":"Queue","value":"5","tile":"t_q","bind":"value"},
        {"type":"card","title":"C","children":[{"type":"table","columns":[{"label":"A","item":"name"}],"rows":[["x"]],"tile":"Queue","bind":"value.runs"}]},
        {"type":"kpi","label":"Plain","value":"1"},
        {"type":"progress","label":"P","value":50,"tile":"t_q"}]}""")

    @Test fun onlyTheDataComponentsThatNameATileBind() {
        assertEquals(listOf("0.1" to "kpi", "0.2.0" to "table"), AnswerViewLive.boundIn(tree).map { it.path to it.node.type })
    }

    @Test fun theBodyHoldsTheNodesAsTheyWereWrittenAndTheBotWhoseReplyItIs() {
        val nodes = AnswerViewLive.boundIn(tree).map { it.node }
        val body = AnswerViewLive.body("shopper", nodes)
        assertEquals("shopper", body.getValue("bot").jsonPrimitive.content)
        assertEquals(listOf("kpi", "table"), body.getValue("nodes").jsonArray.map { it.jsonObject.getValue("type").jsonPrimitive.content })
        assertTrue("bot" !in AnswerViewLive.body(null, nodes))
    }

    @Test fun theAnswerIsReadAgainByTheValidatorAndANullLeavesTheWrittenValues() {
        val asked = AnswerViewLive.boundIn(tree).map { it.node }
        val answer = """{"nodes":[{"type":"kpi","label":"Queue","value":"7","tile":"t_q","bind":"value","source":"Queue"},null],"tiles":["t_q"]}"""
        val got = AnswerViewLive.filled(views, asked, answer)
        assertEquals("7", got[0]!!.text("value"))
        assertEquals("Queue", got[0]!!.text("source"))
        assertNull(got[1])
        assertEquals(setOf("t_q"), AnswerViewLive.tiles(answer))
    }

    @Test fun whatTheTileSaidIsCutToTheCatalogsLengthsAndAWrongKindOfNodeIsNone() {
        val asked = AnswerViewLive.boundIn(tree).map { it.node }
        val long = "v".repeat(500)
        val got = AnswerViewLive.filled(views, asked, """{"nodes":[{"type":"kpi","label":"Queue","value":"$long","tile":"t_q"},{"type":"kpi","label":"X","value":"1"}],"tiles":[]}""")
        assertEquals(40, got[0]!!.text("value")!!.length)
        assertNull(got[1], "the table was asked for: a kpi is not it")
    }

    @Test fun anAnswerThatCantBeReadIsNoValuesAtAll() {
        val asked = AnswerViewLive.boundIn(tree).map { it.node }
        assertEquals(listOf(null, null), AnswerViewLive.filled(views, asked, "not json"))
        assertEquals(listOf(null, null), AnswerViewLive.filled(views, asked, """{"error":"nope"}"""))
        assertEquals(emptySet(), AnswerViewLive.tiles("""{"nodes":[]}"""))
    }
}
