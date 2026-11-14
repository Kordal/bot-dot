package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Files (#603): only from a server that has it; its places; folders first, sorted by name, date or size, dot-names
 * too; an icon by kind and a folder's size as its items; what botdot keeps offers nothing
 * that writes; Move to… never offers the folder the items are in or one of them; a move or copy into another place
 * names that place; a file on botdot is kept in mind by its path.
 */
class FilesExplorerTest {
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

    private val entries = listOf(
        WorkspaceEntry("notes", "notes", "folder", items = 14, at = "2026-10-20T07:00:00Z"),
        WorkspaceEntry(".cache", ".cache", "folder", items = 2, at = "2026-10-22T07:00:00Z"),
        WorkspaceEntry("uploads", "uploads", "folder", items = 3, at = "2026-10-19T07:00:00Z", kept = true),
        WorkspaceEntry("w10.md", "w10.md", "file", 4096, at = "2026-10-21T07:00:00Z"),
        WorkspaceEntry("w9.md", "w9.md", "file", 10, at = "2026-10-16T07:00:00Z"),
        WorkspaceEntry("prices.csv", "prices.csv", "file", 18000, at = "2026-10-18T07:00:00Z"),
        WorkspaceEntry("acme.png", "acme.png", "file", 412000, at = "2026-10-23T07:00:00Z"),
        WorkspaceEntry("CLAUDE.md", "CLAUDE.md", "file", 5, at = "2026-10-17T07:00:00Z", kept = true),
        WorkspaceEntry(".claude", ".claude", "folder", items = 1, at = "2026-10-17T07:00:00Z", kept = true),
        WorkspaceEntry("away", "away", "link", at = "2026-10-15T07:00:00Z"),
    )
    private fun named(n: String) = entries.first { it.name == n }

    @Test fun showsOnlyOnAServerThatHasItAndSearchesOnlyWithTheSearch() {
        assertTrue(FilesExplorer.shows(listOf("files-explorer")))
        assertFalse(FilesExplorer.shows(listOf("workspace-files")))
        assertFalse(FilesExplorer.shows(null))
        assertTrue(FilesExplorer.searches(listOf("workspace-search")))
        assertFalse(FilesExplorer.searches(listOf("files-explorer")))
    }

    @Test fun itsPlacesAreBotdotTheComputerAndItsProjects() {
        val projects = listOf(Project("Website", listOf("b1")), Project("Other", listOf("b2")))
        assertEquals(listOf("server", "computer", "project/Website"), FilesExplorer.places("b1", "linux", projects))
        assertEquals(listOf("server"), FilesExplorer.places("b1", "none", projects))
        assertEquals(listOf("On botdot", "Computer", "Website", "Kept in mind"), listOf("server", "computer", "project/Website", "kept").map { FilesExplorer.placeName(it) })
        assertEquals("server", FilesExplorer.rootOf(FilesExplorer.KEPT))
        assertEquals("project/Website", FilesExplorer.placeOf(FoundFile("a", "a", root = "project", project = "Website")))
    }

    @Test fun foldersFirstByNameDateOrSizeDotNamesToo() {
        assertEquals(listOf(".cache", ".claude", "notes", "uploads", "acme.png", "away", "CLAUDE.md", "prices.csv", "w9.md", "w10.md"), FilesExplorer.sorted(entries).map { it.name })
        assertEquals(listOf("acme.png", "w10.md", "prices.csv", "CLAUDE.md", "w9.md", "away"), FilesExplorer.sorted(entries, FilesExplorer.Sort.DATE).filter { it.type != "folder" }.map { it.name })
        assertEquals(listOf("notes", "uploads", ".cache"), FilesExplorer.sorted(entries, FilesExplorer.Sort.SIZE).take(3).map { it.name })
        assertEquals("acme.png", FilesExplorer.sorted(entries, FilesExplorer.Sort.SIZE).first { it.type == "file" }.name)
    }

    @Test fun anIconByKindAndAFolderSizedByItsItems() {
        assertEquals(
            listOf(FilesExplorer.Kind.FOLDER, FilesExplorer.Kind.FOLDER, FilesExplorer.Kind.LOCK, FilesExplorer.Kind.LOCK, FilesExplorer.Kind.SHEET, FilesExplorer.Kind.IMAGE, FilesExplorer.Kind.DOC, FilesExplorer.Kind.LINK),
            listOf("notes", "uploads", ".claude", "CLAUDE.md", "prices.csv", "acme.png", "w9.md", "away").map { FilesExplorer.kindOf(named(it)) },
        )
        assertEquals("14 items", FilesExplorer.sizeOf(named("notes")))
        assertEquals("1 item", FilesExplorer.sizeOf(named(".claude")))
        assertTrue(FilesExplorer.thumbs(named("acme.png")))
        assertFalse(FilesExplorer.thumbs(named("prices.csv")))
        assertFalse(FilesExplorer.thumbs(WorkspaceEntry("big.jpg", "big.jpg", "file", 2L * 1024 * 1024)))
        val zone = ZoneOffset.UTC
        val today = LocalDate.of(2026, 10, 21)
        assertEquals("07:00", FilesExplorer.whenOf("2026-10-21T07:00:00Z", zone, today))
        assertEquals("Yesterday", FilesExplorer.whenOf("2026-10-20T07:00:00Z", zone, today))
        assertEquals("16 Oct", FilesExplorer.whenOf("2026-10-16T07:00:00Z", zone, today))
        assertEquals("16 Oct 2025", FilesExplorer.whenOf("2025-10-16T07:00:00Z", zone, today))
        assertEquals("14 items · Yesterday", FilesExplorer.detail(named("notes"), zone, today))
    }

    @Test fun whatBotdotKeepsOffersNothingThatWritesAndTheComputerChangesLinks() {
        val l = WorkspaceListing(entries = entries)
        val claude = FilesExplorer.can("server", l, named("CLAUDE.md"), emptySet())
        assertEquals(FilesExplorer.Can(open = true, rename = false, move = false, copy = true, download = true, keep = true, unpin = false, delete = false), claude)
        val csv = FilesExplorer.can("server", l, named("prices.csv"), emptySet())
        assertTrue(csv.rename && csv.move && csv.copy && csv.delete && csv.keep)
        assertFalse(FilesExplorer.can("server", l, named("away"), emptySet()).delete)
        assertFalse(FilesExplorer.can("server", l, named("uploads"), emptySet()).delete)
        assertFalse(FilesExplorer.can("server", l.copy(readOnly = true), named("prices.csv"), emptySet()).rename)
        assertTrue("on the computer a link goes, the link alone", FilesExplorer.can("computer", l, named("away"), emptySet()).delete)
        assertFalse(FilesExplorer.can("computer", l, named("prices.csv"), emptySet()).keep)
        val given = WorkspaceEntry("CV.pdf", "uploads/1-ab-CV.pdf", "file", 4, keepsName = true)
        val pinned = FilesExplorer.can("server", l, given, setOf("uploads/1-ab-CV.pdf"))
        assertTrue(pinned.unpin && pinned.delete && !pinned.keep && !pinned.rename && !pinned.move)
        val inKept = FilesExplorer.can(FilesExplorer.KEPT, null, given, setOf("uploads/1-ab-CV.pdf"))
        assertTrue(inKept.open && inKept.download && inKept.unpin)
        assertFalse(inKept.delete || inKept.copy || inKept.move)
        val kept = FilesExplorer.keptEntries(listOf(UploadedFile("uploads/1-ab-CV.pdf", "CV.pdf", 4, "2026-10-20T07:00:00Z", pinned = true), UploadedFile("uploads/2-x.txt", "x.txt")))
        assertEquals(listOf("uploads/1-ab-CV.pdf"), kept.map { it.path })
    }

    @Test fun moveToNeverOffersTheFolderTheyAreInNorOneOfThem() {
        assertFalse(FilesExplorer.takes("server", listOf("notes/a.md"), "server", "notes"))
        assertFalse(FilesExplorer.takes("server", listOf("notes"), "server", "notes"))
        assertFalse(FilesExplorer.takes("server", listOf("notes"), "server", "notes/old"))
        assertTrue(FilesExplorer.takes("server", listOf("notes"), "server", "notes-old"))
        assertTrue(FilesExplorer.takes("server", listOf("notes/a.md"), "computer", "notes"))
        assertFalse(FilesExplorer.takes(FilesExplorer.KEPT, listOf("uploads/a"), "server", "uploads"))
        assertEquals("Moved 2 items to Website / data", FilesExplorer.carriedWords(true, listOf("a", "b"), "project/Website", "reports/data"))
        assertEquals("Copied a.md to On botdot", FilesExplorer.carriedWords(false, listOf("a.md"), "server", ""))
    }

    @Test fun aCopyOrMoveIntoAnotherPlaceNamesItAndKeepTakesThePath() = runBlocking {
        server.enqueue(json("""{"ok":true,"path":"data/prices.csv","root":"project","project":"my site"}""", 201))
        val landed = api.carryInWorkspace("b1", "prices.csv", "data", "server", "project/my site")
        assertEquals("data/prices.csv", landed.path)
        val copy = server.takeRequest()
        assertEquals("/api/bots/b1/workspace/copy?root=server", copy.target)
        assertEquals("""{"from":"prices.csv","into":"data","place":{"root":"project","project":"my site"}}""", copy.body?.utf8())

        server.enqueue(json("""{"ok":true,"path":"notes/a.md","root":"computer"}"""))
        api.carryInWorkspace("b1", "a.md", "notes", "computer", move = true)
        val move = server.takeRequest()
        assertEquals("/api/bots/b1/workspace/move?root=computer", move.target)
        assertEquals("""{"from":"a.md","into":"notes"}""", move.body?.utf8())

        server.enqueue(json("""{"ok":true,"path":"a.md","root":"server"}"""))
        api.carryInWorkspace("b1", "a.md", "", "project/my site", "server")
        val back = server.takeRequest()
        assertEquals("/api/bots/b1/workspace/copy?root=project&project=my%20site", back.target)
        assertEquals("""{"from":"a.md","into":"","place":{"root":"server"}}""", back.body?.utf8())

        server.enqueue(json("""{"ok":true,"file":"uploads/1-ab-prices.csv"}"""))
        api.keepFromWorkspace("b1", "prices.csv")
        val keep = server.takeRequest()
        assertEquals("/api/bots/b1/workspace/keep", keep.target)
        assertEquals("""{"path":"prices.csv"}""", keep.body?.utf8())
        assertEquals("/bots/b1/workspace/thumb?root=computer&path=a%20b.png", WorkspaceFiles.thumb("b1", "computer", "a b.png"))
        assertEquals("/chief/workspace/keep", WorkspaceFiles.keep(UploadedFiles.CHIEF))

    }
}
