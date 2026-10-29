package dev.botdot.app.data

import dev.botdot.app.data.BoardCanvas.R
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * The board as a free canvas on Android (#784): the same cases as test/board-canvas.test.js for the web page's
 * rules (public/board-canvas.js), the layout read from botdot, and a drop sending the whole layout with PUT.
 */
class BoardCanvasTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun clear(l: Map<String, R>) {
        for (a in l.keys) for (b in l.keys) if (a < b) assertFalse("$a and $b overlap", BoardCanvas.hits(l.getValue(a), l.getValue(b)))
    }

    @Test fun kinds() {
        assertEquals("calendar", BoardCanvas.kindOf("calendar"))
        assertEquals("goal", BoardCanvas.kindOf("goal:o1"))
        assertEquals("new-card", BoardCanvas.kindOf("new-card"))
        assertNull(BoardCanvas.kindOf("goal"))
        assertNull(BoardCanvas.kindOf("calendar:x"))
        assertNull(BoardCanvas.kindOf("desk:1"))
        assertNull(BoardCanvas.kindOf("room:a/b"))
        assertNull(BoardCanvas.kindOf(""))
    }

    @Test fun fitKeepsTheCanvasAndTheSmallestSize() {
        assertEquals(R(1200 - 420, 0, 420, 260), BoardCanvas.fit("calendar", 1100.4, -5.0, 10.0, 10.0))
        assertEquals(R(0, 20, 1200, 300), BoardCanvas.fit("todo", 10.6, 20.2, 5000.0, 300.0))
    }

    @Test fun aCoveredTileSlidesDownAndPushesTheNext() {
        val l = mapOf("a" to R(0, 100, 400, 200), "b" to R(0, 216, 400, 200), "c" to R(0, 432, 400, 200))
        val out = BoardCanvas.settle(l, "a")
        assertEquals(R(0, 100, 400, 200), out["a"])
        assertEquals(R(0, 316, 400, 200), out["b"])
        assertEquals(R(0, 532, 400, 200), out["c"])
        clear(out)
    }

    @Test fun tilesApartStayAndNothingIsPulledUp() {
        val l = mapOf("a" to R(0, 0, 400, 200), "b" to R(416, 0, 400, 200), "c" to R(0, 900, 400, 100))
        assertEquals(l, BoardCanvas.settle(l, "a"))
    }

    @Test fun dragMovesAndResizes() {
        val l = mapOf("calendar" to R(0, 0, 600, 300), "todo" to R(616, 0, 400, 400))
        val moved = BoardCanvas.drag(l, "calendar", null, 500.0, 0.0)
        assertEquals(R(500, 0, 600, 300), moved["calendar"])
        assertEquals(316, moved.getValue("todo").y)
        clear(moved)
        val grown = BoardCanvas.drag(l, "calendar", "se", 200.0, 50.0)
        assertEquals(R(0, 0, 800, 350), grown["calendar"])
        assertEquals(366, grown.getValue("todo").y)
        clear(grown)
        assertEquals(R(280, 0, 420, 300), BoardCanvas.drag(mapOf("calendar" to R(100, 0, 600, 300)), "calendar", "w", 500.0, 0.0)["calendar"])
    }

    @Test fun completePlacesNewTilesAtTheFirstFreeSpot() {
        val out = BoardCanvas.complete(mapOf("calendar" to R(0, 0, 600, 300), "goal:gone" to R(0, 400, 400, 200)), listOf("calendar", "new-card"))
        assertEquals(setOf("calendar", "new-card"), out.keys)
        assertEquals(R(0, 0, 600, 300), out["calendar"])
        assertEquals(R(616, 0, 392, 64), out["new-card"])
        assertEquals(R(0, 316, 392, 560), BoardCanvas.complete(mapOf("calendar" to R(0, 0, 1000, 300)), listOf("calendar", "todo"))["todo"])
    }

    @Test fun heightIsTheLowestBottom() {
        assertEquals(0, BoardCanvas.height(emptyMap()))
        assertEquals(30, BoardCanvas.height(mapOf("a" to R(0, 10, 5, 20), "b" to R(0, 0, 5, 5))))
    }

    @Test fun theLayoutIsReadAndSentWhole() = runBlocking {
        val c = CompanySetup.of("""{"id":"c1","phase":"running","layout":{"calendar":[0,0,600,300],"desk":[0,0,1,1]}}""")
        assertEquals(mapOf("calendar" to R(0, 0, 600, 300)), BoardCanvas.of(c.layout))
        assertNull(BoardCanvas.of(CompanySetup.of("""{"id":"c1","phase":"running"}""").layout))
        server.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body("""{"id":"c1","phase":"running","layout":{"todo":[0,0,400,400]}}""").build())
        val back = api.setLayout(BoardCanvas.raw(mapOf("todo" to R(0, 0, 400, 400))))
        val req = server.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("/api/company/layout", req.target)
        assertEquals("""{"layout":{"todo":[0,0,400,400]}}""", req.body?.utf8())
        assertEquals(mapOf("todo" to R(0, 0, 400, 400)), BoardCanvas.of(back.layout))
    }
}
