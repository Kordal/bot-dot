package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * A bot's page with blocks (#395): the viewer reads its parts, the tiles they read and its text with the blocks written
 * out; its blocks are read anew at `?blocks=1`; a grid draws two side by side on a phone, a chart in a row of its own.
 */
class PageBlocksTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    @Test fun viewHasPartsTilesAndTextAsADocument() = runBlocking {
        server.enqueue(json("""{"name":"ops.md","kind":"markdown","text":"# Ops","page":{"slug":"ops","title":"Ops"},
            "parts":[{"md":"# Ops"},{"block":{"type":"hero","eyebrow":"Report","title":"Ops","lead":"Live","tags":["a"]}},
            {"block":{"type":"grid","columns":3,"blocks":[{"type":"kpi","text":"7","label":"Queue","points":[5,7],"delta":{"text":"2","dir":"up","good":false}}]}},
            {"block":{"type":"error","text":"Block 3: its JSON can't be read"}},{"block":{"type":"later-kind","x":1}}],
            "tiles":["t_1"],"plain":"# Ops\n\n**Queue:** 7"}"""))
        val v = api.viewFile(Pages.src("ops", "ops"))
        assertEquals("/api/bots/ops/pages/ops?view=1", server.takeRequest().target)
        val parts = v.parts!!
        assertEquals("# Ops", parts[0].md)
        assertEquals("Report", parts[1].block!!.eyebrow)
        assertEquals(listOf("a"), parts[1].block!!.tags)
        assertEquals(3, parts[2].block!!.columns)
        assertEquals(false, parts[2].block!!.blocks[0].delta!!.good)
        assertEquals("error", parts[3].block!!.type)
        assertEquals("later-kind", parts[4].block!!.type)
        assertEquals(listOf("t_1"), v.tiles)
        assertEquals("# Ops\n\n**Queue:** 7", v.plain)

        server.enqueue(json("""{"parts":[{"md":"# Ops"}],"tiles":[]}"""))
        val b = api.pageBlocks(Pages.src("ops", "ops"))
        assertEquals("/api/bots/ops/pages/ops?blocks=1", server.takeRequest().target)
        assertEquals(1, b.parts.size)
    }

    @Test fun aPageWithoutBlocksHasNoParts() = runBlocking {
        server.enqueue(json("""{"name":"a.md","kind":"markdown","text":"# A"}"""))
        val v = api.viewFile(Pages.src("ops", "a"))
        assertNull(v.parts)
        assertNull(v.plain)
    }

    @Test fun gridRowsTwoOnAPhoneAChartAloneItsColumnsWhenWide() {
        val k = { n: Int -> Block("kpi", text = "$n") }
        val chart = Block("chart")
        val list = listOf(k(1), k(2), k(3), chart, k(4))
        assertEquals(listOf(listOf(k(1), k(2)), listOf(k(3)), listOf(chart), listOf(k(4))), Pages.rows(list, 3, wide = false))
        assertEquals(listOf(listOf(k(1), k(2), k(3)), listOf(chart, k(4))), Pages.rows(list, 3, wide = true))
        assertEquals(listOf(listOf(k(1)), listOf(k(2))), Pages.rows(listOf(k(1), k(2)), null, wide = true))
        assertEquals(4, Pages.rows(List(8) { k(it) }, 9, wide = true)[0].size)
    }
}
