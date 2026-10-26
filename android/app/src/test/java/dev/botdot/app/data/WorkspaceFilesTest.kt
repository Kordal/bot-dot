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
 * A bot's workspace in its settings (#296): asked only of a server that has it; folders first, by name or newest
 * first, dot-names only when shown; what botdot keeps and links are never changed; a delete names what goes; a
 * computer that is off throws its 409 and is not started by the listing.
 */
class WorkspaceFilesTest {
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
        WorkspaceEntry("notes", "notes", "folder", at = "2026-10-20T07:00:00Z"),
        WorkspaceEntry(".cache", ".cache", "folder", at = "2026-10-22T07:00:00Z"),
        WorkspaceEntry("b.md", "b.md", "file", 2048, "2026-10-21T07:00:00Z"),
        WorkspaceEntry("a.txt", "a.txt", "file", 3, "2026-10-18T07:00:00Z"),
        WorkspaceEntry("CLAUDE.md", "CLAUDE.md", "file", 5, "2026-10-17T07:00:00Z", kept = true),
        WorkspaceEntry("away", "away", "link", at = "2026-10-16T07:00:00Z"),
    )

    @Test fun showsOnlyOnAServerThatHasIt() {
        assertTrue(WorkspaceFiles.shows(listOf("workspace-files")))
        assertFalse(WorkspaceFiles.shows(listOf("bot-files")))
        assertFalse(WorkspaceFiles.shows(null))
    }

    @Test fun foldersFirstByNameOrNewestAndHiddenOnlyWhenShown() {
        assertEquals(listOf("notes", "a.txt", "away", "b.md", "CLAUDE.md"), WorkspaceFiles.sorted(entries).map { it.name })
        assertEquals(listOf(".cache", "notes", "b.md", "a.txt", "CLAUDE.md", "away"), WorkspaceFiles.sorted(entries, byDate = true, hidden = true).map { it.name })
        assertEquals(1, WorkspaceFiles.hiddenCount(entries))
        assertEquals(listOf("Its folder" to "", "notes" to "notes", "old" to "notes/old"), WorkspaceFiles.crumbs("notes/old", "Its folder"))
    }

    @Test fun renameAndMoveMakeTheNewPath() {
        assertEquals("notes/b.txt", WorkspaceFiles.renamed("notes/a.txt", " b.txt "))
        assertEquals("b.txt", WorkspaceFiles.renamed("a.txt", "b.txt"))
        assertEquals("notes/old/a.txt", WorkspaceFiles.movedTo("a.txt", "/notes/old/"))
        assertEquals("a.txt", WorkspaceFiles.movedTo("notes/a.txt", ""))
        assertEquals("notes", WorkspaceFiles.parentOf("notes/a.txt"))
    }

    @Test fun whatBotdotKeepsAndLinksAreNeverChangedAndTheComputerOnlyDeletes() {
        val l = WorkspaceListing(entries = entries)
        assertTrue(WorkspaceFiles.changes("server", l, entries[3]))
        assertFalse(WorkspaceFiles.changes("server", l, entries[4]))
        assertFalse(WorkspaceFiles.deletes("server", l, entries[5]))
        assertFalse(WorkspaceFiles.changes("server", l.copy(readOnly = true), entries[3]))
        assertFalse(WorkspaceFiles.changes("computer", l, entries[3]))
        assertTrue(WorkspaceFiles.deletes("computer", l, entries[3]))
        assertTrue("on the computer a link goes, the link alone", WorkspaceFiles.deletes("computer", l, entries[5]))
        val given = WorkspaceEntry("2026-ab-CV.pdf", "uploads/2026-ab-CV.pdf", "file", 4, keepsName = true)
        assertTrue(WorkspaceFiles.deletes("server", l, given))
        assertFalse(WorkspaceFiles.changes("server", l, given))
        assertFalse(WorkspaceFiles.nameOk("old/b.txt"))
        assertTrue(WorkspaceFiles.nameOk("b.txt"))
    }

    @Test fun aDeleteNamesWhatGoes() {
        assertEquals("Delete a.txt? This can't be undone.", WorkspaceFiles.deleteWords("a.txt", WorkspaceCount("file", 1, 0)))
        assertEquals("Delete the folder notes? It holds 1,200 files and 3 folders, which go with it. This can't be undone.", WorkspaceFiles.deleteWords("notes", WorkspaceCount("folder", 1200, 3)))
        assertEquals("Delete the folder x? It holds more than 10,000 files, which go with it. This can't be undone.", WorkspaceFiles.deleteWords("x", WorkspaceCount("folder", 10000, 0, capped = true)))
        assertEquals("Delete the folder e? It is empty. This can't be undone.", WorkspaceFiles.deleteWords("e", WorkspaceCount("folder", 0, 0)))
    }

    @Test fun theListingComesFromItsAddressAndAComputerThatIsOffThrows409() = runBlocking {
        server.enqueue(json("""{"root":"server","path":"notes","entries":[{"name":"CLAUDE.md","path":"CLAUDE.md","type":"file","size":5,"at":"2026-10-17T07:00:00.000Z","protected":true}],"more":3,"readOnly":false}"""))
        val l = api.workspace("b1", "server", "notes")
        assertEquals("/api/bots/b1/workspace?root=server&path=notes", server.takeRequest().target)
        assertTrue(l.entries[0].kept)
        assertEquals(3, l.more)
        server.enqueue(json("""{"error":"The computer is off. Start it to see its files.","state":"computer-off"}""", 409))
        try { api.workspace("b1", "computer", ""); fail("no listing") } catch (e: ApiException) { assertEquals(409, e.status) }
        server.takeRequest()
        server.enqueue(json("""{"ok":true,"path":"notes/old/a.txt"}"""))
        api.moveInWorkspace("b1", "a.txt", "notes/old/a.txt")
        val moved = server.takeRequest()
        assertEquals("/api/bots/b1/workspace/move?root=server", moved.target)
        assertEquals("""{"from":"a.txt","to":"notes/old/a.txt"}""", moved.body?.utf8())
        server.enqueue(json("""{"ok":true}"""))
        api.deleteFromWorkspace("b1", "server", "notes/a b.txt")
        val del = server.takeRequest()
        assertEquals("DELETE", del.method)
        assertEquals("/api/bots/b1/workspace?root=server&path=notes%2Fa%20b.txt", del.target)
        assertEquals("/bots/b1/workspace/file?root=computer&path=out.csv", WorkspaceFiles.file("b1", "computer", "out.csv"))
    }

    @Test fun withWorkspaceFoldersTheComputerTakesWritesAndAFolderGoesUpUnderAFreeName() = runBlocking {
        val listing = WorkspaceListing(root = WorkspaceFiles.COMPUTER)
        val file = WorkspaceEntry("out.csv", "out.csv", "file", 9)
        assertFalse(WorkspaceFiles.writes(WorkspaceFiles.COMPUTER, listing, folders = false))
        assertFalse(WorkspaceFiles.changes(WorkspaceFiles.COMPUTER, listing, file))
        assertTrue(WorkspaceFiles.writes(WorkspaceFiles.COMPUTER, listing, folders = true))
        assertTrue(WorkspaceFiles.changes(WorkspaceFiles.COMPUTER, listing, file, folders = true))
        assertFalse(WorkspaceFiles.writes(WorkspaceFiles.SERVER, WorkspaceListing(readOnly = true), folders = true))
        assertTrue(WorkspaceFiles.folders(listOf("workspace-files", "workspace-folders")))
        assertFalse(WorkspaceFiles.folders(listOf("workspace-files")))
        assertEquals("proj/site (2)/css/deep", WorkspaceFiles.folderDir("proj/site (2)", "css/deep"))
        assertEquals("site", WorkspaceFiles.folderDir("site", ""))
        assertEquals("/bots/b1/workspace/upload?root=computer&path=a%20b&folders=1", WorkspaceFiles.upload("b1", "a b", WorkspaceFiles.COMPUTER, made = true))

        server.enqueue(json("""{"ok":true,"path":"proj/site (2)"}""", 201))
        assertEquals("proj/site (2)", api.makeWorkspaceFolder("b1", "proj", "site", WorkspaceFiles.COMPUTER, free = true))
        val made = server.takeRequest()
        assertEquals("/api/bots/b1/workspace/folder?root=computer", made.target)
        assertEquals("""{"path":"proj","name":"site","free":true}""", made.body?.utf8())
        server.enqueue(json("""{"ok":true,"path":"b.txt"}"""))
        api.moveInWorkspace("b1", "a.txt", "b.txt", WorkspaceFiles.COMPUTER)
        assertEquals("/api/bots/b1/workspace/move?root=computer", server.takeRequest().target)
    }
}
