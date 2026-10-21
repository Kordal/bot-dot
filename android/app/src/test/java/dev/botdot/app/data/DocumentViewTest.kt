package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * The document viewer (#251): asked only of a server that has it, a file comes as JSON from its download's address
 * with ?view=1, a CSV is read into rows (quoted cells kept whole) and shown sorted and searched.
 */
class DocumentViewTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    @Test fun showsOnlyOnAServerThatHasIt() {
        assertTrue(DocumentView.shows(listOf("document-viewer")))
        assertFalse(DocumentView.shows(listOf("bot-files")))
        assertFalse(DocumentView.shows(null))
    }

    @Test fun theAddressesAreTheDownloadsWithViewAdded() {
        assertEquals("/files/r1/weekly%20report.md", DocumentView.runFile("r1/weekly report.md"))
        assertEquals("/bots/news/files/2026-ab-cv.pdf", DocumentView.botFile("news", "uploads/2026-ab-cv.pdf"))
        assertEquals("/bots/news/path?path=%7E%2Fnotes%2Ftoday.md", DocumentView.pathFile("news", "~/notes/today.md"))
        assertEquals("/files/r1/a.md?view=1", DocumentView.withQuery("/files/r1/a.md", "view=1"))
        assertEquals("/bots/news/path?path=a.md&view=1", DocumentView.withQuery("/bots/news/path?path=a.md", "view=1"))
    }

    @Test fun aFileComesAsJsonAndAGoneOrOffOneThrowsItsStatus() = runBlocking {
        server.enqueue(json("""{"name":"report.md","size":42,"at":"2026-10-21T09:14:00.000Z","kind":"markdown","type":"text/markdown","truncated":false,"text":"# Hi\n<script>x</script>"}"""))
        val v = api.viewFile("/files/r1/report.md")
        assertEquals("/api/files/r1/report.md?view=1", server.takeRequest().target)
        assertEquals("markdown", v.kind)
        assertEquals("# Hi\n<script>x</script>", v.text)
        server.enqueue(json("""{"error":"The computer is off. Start it to open the file.","state":"computer-off"}""", 409))
        try { api.viewFile(DocumentView.pathFile("news", "/workspace/a.md")); fail("no view") } catch (e: ApiException) { assertEquals(409, e.status) }
        server.enqueue(json("""{"error":"This file is gone.","state":"gone"}""", 404))
        try { api.viewFile(DocumentView.pathFile("news", "a.md")); fail("no view") } catch (e: ApiException) { assertEquals(404, e.status) }
    }

    @Test fun aCsvIsReadIntoRowsWithQuotedCellsWhole() {
        assertEquals(
            listOf(listOf("source", "note"), listOf("Reuters", "big, fast"), listOf("Paper", "says \"hi\"\non two lines"), listOf("x", "")),
            DocumentView.csvRows("source,note\r\nReuters,\"big, fast\"\nPaper,\"says \"\"hi\"\"\non two lines\"\nx,\n"),
        )
        assertEquals(listOf(listOf("a", "b"), listOf("1", "2")), DocumentView.csvRows("\uFEFFa\tb\n1\t2", '\t'))
    }

    @Test fun aTableIsCountedSortedByNumberAndSearched() {
        val csv = "source,stories\nReuters,6\nLocal paper,12\nBlogs,3\n"
        val t = DocumentView.table(csv, ',')
        assertEquals(3, t.total); assertEquals(2, t.cols)
        assertEquals(listOf("Reuters", "Local paper", "Blogs"), t.rows.map { it.second[0] })
        assertEquals(listOf("Blogs", "Reuters", "Local paper"), DocumentView.table(csv, ',', sortCol = 1).rows.map { it.second[0] })
        assertEquals(listOf(2, 1, 3), DocumentView.table(csv, ',', sortCol = 1, ascending = false).rows.map { it.first })
        assertEquals(listOf("Local paper"), DocumentView.table(csv, ',', find = "PAPER").rows.map { it.second[0] })
    }

    @Test fun theHeaderSaysWhoItIsFromItsSizeAndTime() {
        assertEquals("From News Monitor · 12 KB · 09:14", DocumentView.subtitle("News Monitor", FileView(size = 12 * 1024), "09:14"))
        assertEquals("", DocumentView.subtitle("", null, ""))
    }
}
