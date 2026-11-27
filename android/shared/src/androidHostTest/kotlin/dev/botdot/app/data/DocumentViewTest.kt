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

    @Test fun theOwnersFilesInAChiefChatOrAGroupOpenOnlyFromAServerThatServesThem() {
        assertTrue(DocumentView.opensChatFiles(listOf("document-viewer", "chat-attachments")))
        assertFalse(DocumentView.opensChatFiles(listOf("document-viewer")))
        assertFalse(DocumentView.opensChatFiles(listOf("chat-attachments")))
        assertFalse(DocumentView.opensChatFiles(null))
        assertEquals("/chief/chats/c1/uploads/2026-ab-qa%20test.md", DocumentView.chiefUpload("c1", "uploads/2026-ab-qa test.md"))
        assertEquals("/group-chats/g1/uploads/2026-ab-prices.csv", DocumentView.groupUpload("g1", "uploads/2026-ab-prices.csv"))
        assertEquals(null, DocumentView.chiefUpload("c1", "../chief.json"))
        assertEquals(null, DocumentView.groupUpload("g1", "uploads/a/b.md"))
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

    @Test fun aPdfIsDrawnInTheAppWhenItCanBeBroughtOutWhole() {
        assertTrue(DocumentView.isPdf(FileView(name = "scan.pdf", kind = "none", type = "application/pdf", size = 5_600_000)))
        assertFalse(DocumentView.isPdf(FileView(name = "scan.pdf", kind = "none", type = "application/pdf", downloadable = false)))
        assertFalse(DocumentView.isPdf(FileView(name = "a.docx", kind = "none", type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document")))
        assertFalse(DocumentView.isPdf(null))
    }

    // An HTML file shown rendered (ADR 281): in the same locked-down WebView an interactive page has, on the sandbox's
    // address, from a server with `html-preview`; its source is the other mode.
    private val frame = "https://botdot.example.com:8443/ann/eyJoIjoiYSJ9.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/index.html"
    private val features = listOf("document-viewer", "html-preview")
    private fun html(frame: String? = this.frame, name: String = "index.html", kind: String = "text") =
        FileView(name = name, kind = kind, text = "<h1>Hi</h1>", preview = frame?.let { HtmlPreview(it, "2026-11-26T20:00:00.000Z") })

    @Test fun anHtmlFilesViewCarriesItsFrameAndAnAppReadsIt() = runBlocking {
        server.enqueue(json("""{"name":"index.html","size":11,"kind":"text","type":"text/plain","truncated":false,"text":"<h1>Hi</h1>","preview":{"frame":"$frame","expires":"2026-11-26T20:00:00.000Z"}}"""))
        val v = api.viewFile(DocumentView.pathFile("web", "site-mockup/index.html"))
        assertEquals(frame, v.preview?.frame)
        server.enqueue(json("""{"name":"a.txt","size":3,"kind":"text","type":"text/plain","truncated":false,"text":"hi"}"""))
        assertEquals(null, api.viewFile("/files/r1/a.txt").preview)
    }

    // The files beside an HTML file load too (ADR 282): its view says `bundle`, and its frame may end in the file's own plain name.
    @Test fun aFilesFolderLoadsWithItAndItsFrameMayEndInItsOwnName() = runBlocking {
        server.enqueue(json("""{"name":"index.html","size":11,"kind":"text","type":"text/plain","truncated":false,"text":"<h1>Hi</h1>","preview":{"frame":"$frame","expires":"2026-11-26T20:00:00.000Z","bundle":true}}"""))
        assertTrue(api.viewFile(DocumentView.pathFile("web", "site-mockup/index.html")).preview?.bundle == true)
        assertFalse(html().preview?.bundle == true) // a single file: an older server's answer has none
        val named = frame.replace("index.html", "about.html")
        assertEquals(named, DocumentView.htmlFrame(html(frame = named, name = "about.html"), "about.html", features))
        for (bad in listOf(frame.replace("index.html", ".hidden.html"), frame.replace("index.html", "a b.html"), frame.replace("index.html", "../x.html"), frame.replace("index.html", "a/b.html"), frame.replace("index.html", "a.js"))) {
            assertEquals(bad, null, DocumentView.htmlFrame(html(frame = bad), "index.html", features))
        }
    }

    @Test fun anHtmlFileIsRenderedOnlyForAServerWithThePreviewAndOnlyAtTheSandboxsOwnAddress() {
        assertEquals(frame, DocumentView.htmlFrame(html(), "index.html", features))
        assertEquals(frame, DocumentView.htmlFrame(html(name = "old.HTM"), "old.HTM", features))
        assertEquals(null, DocumentView.htmlFrame(html(), "index.html", listOf("document-viewer"))) // a server without the preview
        assertEquals(null, DocumentView.htmlFrame(html(), "index.html", null))
        assertEquals(null, DocumentView.htmlFrame(html(frame = null), "index.html", features)) // no sandbox address on that machine
        assertEquals(null, DocumentView.htmlFrame(html(), "notes.txt", features))
        assertEquals(null, DocumentView.htmlFrame(html(kind = "markdown"), "index.html", features))
        assertEquals(null, DocumentView.htmlFrame(null, "index.html", features))
        for (bad in listOf("javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "//evil.example/x", "/api/bots", "file:///etc/passwd", "https://a\"onload=\"x", "$frame?x=1", "https://botdot.example.com:8443/ann/x.y/app.js")) {
            assertEquals(bad, null, DocumentView.htmlFrame(html(frame = bad), "index.html", features))
        }
    }

    @Test fun anHtmlFileOpensRenderedWithRenderedAndSourceToSwitchBetween() {
        assertEquals("rendered", DocumentView.modeFor(html(), "index.html", features))
        assertEquals(listOf("rendered", "source"), DocumentView.modes(html(), "index.html", features).map { it.first })
        assertEquals("source", DocumentView.modeFor(html(), "index.html", listOf("document-viewer")))
        assertEquals(emptyList<String>(), DocumentView.modes(html(), "index.html", listOf("document-viewer")).map { it.first })
        assertEquals("rendered", DocumentView.modeFor(FileView(kind = "markdown"), "a.md", features))
        assertEquals(listOf("table", "source"), DocumentView.modes(FileView(kind = "csv"), "a.csv", features).map { it.first })
    }

    @Test fun aFramesAddressRunsOutAtItsExpiry() {
        val v = html()
        assertFalse(DocumentView.frameStale(v, kotlin.time.Instant.parse("2026-11-26T19:59:59Z")))
        assertTrue(DocumentView.frameStale(v, kotlin.time.Instant.parse("2026-11-26T20:00:01Z")))
        assertFalse(DocumentView.frameStale(FileView(), kotlin.time.Instant.parse("2030-01-01T00:00:00Z"))) // no expiry said
    }
}
