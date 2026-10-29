package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.putJsonArray
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The board's pieces on Android (#780), against a stand-in botdot: docs/api.md "The board's pieces". A new project's
 * board is empty and offers every piece, a project made before shows every piece and offers none, and a pick or a
 * settings switch sends the whole list with PATCH.
 */
class ProjectBoardTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun of(body: String) = CompanySetup.of(body)
    private val features = listOf(ProjectBoard.FEATURE)

    @Test fun anEmptyBoardShowsNothingAndOffersEveryPiece() {
        val c = of("""{"id":"c1","phase":"running","board":[]}""")
        ProjectBoard.PIECES.forEach { assertFalse(it, ProjectBoard.shows(c, it)) }
        assertEquals(ProjectBoard.PIECES, ProjectBoard.missing(features, c))
        assertEquals(emptyList<String>(), ProjectBoard.missing(emptyList(), c))
        assertEquals(listOf("teams"), ProjectBoard.toggled(c, "teams"))
    }

    @Test fun aProjectMadeBeforeShowsEveryPiece() {
        val c = of("""{"id":"c1","phase":"running"}""")
        ProjectBoard.PIECES.forEach { assertTrue(it, ProjectBoard.shows(c, it)) }
        assertEquals(emptyList<String>(), ProjectBoard.missing(features, c))
        assertEquals(listOf("days", "goals", "calendar", "todo"), ProjectBoard.toggled(c, "teams"))
    }

    @Test fun piecesKeepTheOrderTheyWereAdded() {
        val c = of("""{"id":"c1","phase":"running","board":["todo","teams","whiteboard"]}""")
        assertTrue(ProjectBoard.shows(c, "teams"))
        assertFalse(ProjectBoard.shows(c, "goals"))
        assertEquals(listOf("days", "goals", "calendar"), ProjectBoard.missing(features, c))
        assertEquals(listOf("todo", "teams", "whiteboard", "goals"), ProjectBoard.toggled(c, "goals"))
        assertEquals(listOf("todo", "whiteboard"), ProjectBoard.toggled(c, "teams"))
    }

    @Test fun aPickSendsTheWholeList() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body("""{"id":"c1","phase":"running","board":["teams"]}""").build())
        val c = api.patchCompany(buildJsonObject { putJsonArray("board") { add("teams") } })
        val req = server.takeRequest()
        assertEquals("PATCH", req.method)
        assertEquals("""{"board":["teams"]}""", req.body?.utf8())
        assertEquals(listOf("teams"), c.board)
    }
}
