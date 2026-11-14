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
        assertEquals(ProjectBoard.PIECES - "files", ProjectBoard.missing(features, c))
        assertEquals(emptyList<String>(), ProjectBoard.missing(emptyList(), c))
        assertEquals(listOf("teams"), ProjectBoard.toggled(c, "teams"))
    }

    @Test fun aProjectMadeBeforeShowsEveryPiece() {
        val c = of("""{"id":"c1","phase":"running"}""")
        ProjectBoard.PIECES.forEach { assertTrue(it, ProjectBoard.shows(c, it)) }
        assertEquals(emptyList<String>(), ProjectBoard.missing(features, c))
        assertEquals(listOf("days", "goals", "calendar", "todo", "files"), ProjectBoard.toggled(c, "teams"))
    }

    @Test fun theFilesTileIsOfferedOnlyByABotdotThatHasIt() {
        val c = of("""{"id":"c1","phase":"running","board":["calendar"]}""")
        assertFalse("files" in ProjectBoard.missing(features, c))
        assertTrue("files" in ProjectBoard.missing(features + ProjectFiles.FEATURE, c))
        assertEquals("Files", ProjectBoard.label("files"))
    }

    // A tap on a file of the tile opens that file, not only its folder (the route carries it to FilesScreen).
    @Test fun aFileOfTheFilesTileOpensThatFile() {
        val enc: (String) -> String = { java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        assertEquals("files/${enc(UploadedFiles.FOLDER + "qwotz")}?root=&path=&file=2026-11-10-prod-login.md",
            ProjectFiles.fileRoute("qwotz", "2026-11-10-prod-login.md", enc))
        assertEquals("files/${enc(UploadedFiles.FOLDER + "qwotz")}?root=&path=docs%2Fplans&file=docs%2Fplans%2Fa%20b.md",
            ProjectFiles.fileRoute("qwotz", "docs/plans/a b.md", enc))
    }

    @Test fun theFilesTileSaysWhereAFileIsAndWhenItChanged() {
        val zone = kotlinx.datetime.TimeZone.UTC
        val today = kotlinx.datetime.LocalDate(2026, 11, 6)
        assertEquals("infra", ProjectFiles.folderOf("infra/plan.md"))
        assertEquals("", ProjectFiles.folderOf("plan.md"))
        assertEquals("08:45", ProjectFiles.whenOf(java.time.Instant.parse("2026-11-06T08:45:00Z").toEpochMilli(), zone, today))
        assertEquals("Yesterday", ProjectFiles.whenOf(java.time.Instant.parse("2026-11-05T22:00:00Z").toEpochMilli(), zone, today))
        assertEquals("", ProjectFiles.whenOf(0, zone, today))
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
