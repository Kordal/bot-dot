package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Files and the document viewer as the phones share them (#1368): whose places Files lists and where it opens, what a
 * folder's space shows, how a file of the list is opened, and what the viewer's body shows for each kind of file.
 */
class FilesBrowserTest {
    private val files = listOf("files-explorer", "document-viewer")

    @Test fun aBotsFilesOpenFromAServerWithFilesAndTheChiefsAlsoWithItsFiles() {
        assertTrue(FilesExplorer.opensFor("news", files))
        assertFalse(FilesExplorer.opensFor("news", listOf("document-viewer")))
        assertFalse(FilesExplorer.opensFor(UploadedFiles.CHIEF, files))
        assertTrue(FilesExplorer.opensFor(UploadedFiles.CHIEF, files + UploadedFiles.CHIEF_FEATURE))
        assertFalse(FilesExplorer.opensFor("news", null))
    }

    @Test fun thePlacesFollowTheComputerAndAProjectsFolderHasItsOne() {
        val bot = Bot("news", "News", computer = "linux")
        val projects = listOf(Project("Website", listOf("news")), Project("Other", listOf("home")))
        assertEquals("linux", FilesExplorer.computerOf("news", bot))
        assertEquals("none", FilesExplorer.computerOf(UploadedFiles.CHIEF, bot))
        assertEquals("linux", FilesExplorer.computerOf(UploadedFiles.FOLDER + "Website", null))
        assertEquals("none", FilesExplorer.computerOf("gone", null))
        assertEquals(listOf("server", "computer", "project/Website"), FilesExplorer.placesOf("news", "linux", projects))
        assertEquals(listOf("server"), FilesExplorer.placesOf("news", "none", projects))
        assertEquals(listOf("project/Website"), FilesExplorer.placesOf(UploadedFiles.FOLDER + "Website", "linux", projects))
        assertEquals("server", FilesExplorer.firstPlace("news"))
        assertEquals("computer", FilesExplorer.firstPlace("news", "computer"))
        assertEquals("project/Website", FilesExplorer.firstPlace(UploadedFiles.FOLDER + "Website"))
    }

    @Test fun aFileOfTheBoardsTileOpensOverItsFolderInTheProjectsFiles() {
        val owner = ProjectFiles.owner("Website")
        assertEquals("project:Website", owner)
        val place = FilesExplorer.firstPlace(owner)
        assertEquals("project/Website", place, "a project's folder has its one place")
        assertEquals("docs", ProjectFiles.folderOf("docs/plan.md"), "the file's folder is shown under it")
        val o = FilesExplorer.fileAt(owner, place, "docs/plan.md", "Website")
        assertEquals("plan.md", o.name)
        assertEquals("Website", o.from)
        assertEquals(WorkspaceFiles.file(owner, place, "docs/plan.md"), o.src)
        assertNull(o.botId, "a project's folder starts no computer")
    }

    @Test fun newProjectsAndSearchOnlyWhereTheyBelong() {
        assertTrue(FilesExplorer.makesProjects("news", "linux", listOf(Projects.FEATURE)))
        assertFalse(FilesExplorer.makesProjects("news", "none", listOf(Projects.FEATURE)))
        assertFalse(FilesExplorer.makesProjects(UploadedFiles.CHIEF, "linux", listOf(Projects.FEATURE)))
        assertTrue(FilesExplorer.searchesFor("news", listOf(FilesExplorer.SEARCH)))
        assertFalse(FilesExplorer.searchesFor(UploadedFiles.FOLDER + "Website", listOf(FilesExplorer.SEARCH)))
    }

    @Test fun theListShowsHitsWhatIsKeptOrTheFolderSorted() {
        val listing = WorkspaceListing(entries = listOf(WorkspaceEntry("b.md", "b.md"), WorkspaceEntry("a", "a", "folder"), WorkspaceEntry("a.md", "a.md")))
        val sorted = FilesExplorer.shown(null, "server", emptyList(), listing, FilesExplorer.Sort.NAME)
        assertEquals(listOf("a", "a.md", "b.md"), sorted.map { it.name })
        assertEquals(listOf("server", "server", "server"), FilesExplorer.shownAt(null, sorted, "server"))
        val kept = listOf(UploadedFile("uploads/cv.pdf", "cv.pdf", pinned = true), UploadedFile("uploads/old.txt", "old.txt"))
        assertEquals(listOf("uploads/cv.pdf"), FilesExplorer.shown(null, FilesExplorer.KEPT, kept, null, FilesExplorer.Sort.NAME).map { it.path })
        assertEquals(listOf("server"), FilesExplorer.shownAt(null, listOf(WorkspaceEntry("cv.pdf")), FilesExplorer.KEPT))
        val hits = listOf(FoundFile("x.md", "docs/x.md", root = "project", project = "Website"), FoundFile("y.md", "y.md", root = "computer"))
        assertEquals(listOf("x.md", "y.md"), FilesExplorer.shown(hits, "server", kept, listing, FilesExplorer.Sort.NAME).map { it.name })
        assertEquals(listOf("project/Website", "computer"), FilesExplorer.shownAt(hits, emptyList(), "server"))
    }

    @Test fun aFolderTakesUploadsOnlyWhenItIsShownAndWritable() {
        assertTrue(FilesExplorer.writesHere(null, "server", WorkspaceListing()))
        assertFalse(FilesExplorer.writesHere(null, "server", WorkspaceListing(readOnly = true)))
        assertFalse(FilesExplorer.writesHere(null, "server", null))
        assertFalse(FilesExplorer.writesHere(emptyList(), "server", WorkspaceListing()))
        assertFalse(FilesExplorer.writesHere(null, FilesExplorer.KEPT, WorkspaceListing()))
    }

    @Test fun theFoldersSpaceSaysWhatWentWrongThatItComesOrWhatItHolds() {
        val one = listOf(WorkspaceEntry("a.md", "a.md"))
        assertEquals(FilesExplorer.Pane.COMPUTER_OFF, FilesExplorer.pane(null, "computer", ApiException("off", 409), null, emptyList()))
        assertEquals(FilesExplorer.Pane.GONE, FilesExplorer.pane(null, "server", ApiException("gone", 404), null, emptyList()))
        assertEquals(FilesExplorer.Pane.FAILED, FilesExplorer.pane(null, "server", ApiException("no", 500), null, emptyList()))
        assertEquals(FilesExplorer.Pane.LOADING, FilesExplorer.pane(null, "server", null, null, emptyList()))
        assertEquals(FilesExplorer.Pane.EMPTY, FilesExplorer.pane(null, "server", null, WorkspaceListing(), emptyList()))
        assertEquals(FilesExplorer.Pane.ENTRIES, FilesExplorer.pane(null, "server", null, WorkspaceListing(), one))
        // A search, or what is kept in mind, is shown whatever the folder's read said.
        assertEquals(FilesExplorer.Pane.ENTRIES, FilesExplorer.pane(emptyList<FoundFile>() + FoundFile("a.md"), "server", ApiException("no", 500), null, one))
        assertEquals(FilesExplorer.Pane.EMPTY, FilesExplorer.pane(null, FilesExplorer.KEPT, null, null, emptyList()))
        assertEquals("Nothing by that name.", FilesExplorer.emptyWords(emptyList()))
        assertEquals("Empty.", FilesExplorer.emptyWords(null))
    }

    @Test fun aFileOfTheListOpensInTheViewerAndOneOnTheComputerCanStartIt() {
        val e = WorkspaceEntry("report.md", "news/report.md")
        val here = FilesExplorer.opening("news", "server", e, "News")
        assertEquals(DocumentView.Opening("/bots/news/workspace/file?root=server&path=news%2Freport.md", "report.md", "News", null), here)
        assertEquals("news", FilesExplorer.opening("news", "computer", e, "News").botId)
        assertNull(FilesExplorer.opening(UploadedFiles.FOLDER + "Website", "project/Website", e, "Website").botId)
    }

    @Test fun theViewersBodyIsDecidedByWhatWentWrongThenTheKindOfFile() {
        assertEquals(DocumentView.Pane.NOT_FOUND, DocumentView.pane(null, ApiException("x", 404), page = false))
        assertEquals(DocumentView.Pane.COMPUTER_OFF, DocumentView.pane(null, ApiException("x", 409), page = false))
        assertEquals(DocumentView.Pane.FAILED, DocumentView.pane(null, IllegalStateException("x"), page = false))
        assertEquals(DocumentView.Pane.LOADING, DocumentView.pane(null, null, page = false))
        assertEquals(DocumentView.Pane.TOO_LARGE, DocumentView.pane(FileView(kind = "none", downloadable = false), null, page = false))
        assertEquals(DocumentView.Pane.PDF, DocumentView.pane(FileView(kind = "none", type = "application/pdf"), null, page = false))
        assertEquals(DocumentView.Pane.TOO_LARGE, DocumentView.pane(FileView(kind = "none", type = "application/pdf", downloadable = false), null, page = false))
        assertEquals(DocumentView.Pane.NO_PREVIEW, DocumentView.pane(FileView(kind = "none", type = "application/zip"), null, page = false))
        assertEquals(DocumentView.Pane.IMAGE, DocumentView.pane(FileView(kind = "image"), null, page = false))
        listOf("markdown", "text", "csv").forEach { assertEquals(DocumentView.Pane.TEXT, DocumentView.pane(FileView(kind = it), null, page = false), it) }
        val site = FileView(kind = "markdown", interactive = InteractiveView())
        assertEquals(DocumentView.Pane.INTERACTIVE, DocumentView.pane(site, null, page = true))
        assertEquals(DocumentView.Pane.TEXT, DocumentView.pane(site, null, page = false))
    }

    @Test fun markdownOpensRenderedACsvAsATableAndEachHasItsSwitches() {
        assertEquals("rendered", DocumentView.modeOf("markdown"))
        assertEquals("table", DocumentView.modeOf("csv"))
        assertEquals("source", DocumentView.modeOf("text"))
        assertEquals(listOf("rendered", "source"), DocumentView.modes("markdown").map { it.first })
        assertEquals(listOf("Table", "Source code"), DocumentView.modes("csv").map { it.second })
        assertTrue(DocumentView.modes("text").isEmpty())
    }
}
