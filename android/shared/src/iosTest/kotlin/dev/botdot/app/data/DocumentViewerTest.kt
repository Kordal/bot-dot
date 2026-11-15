package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/** The iPhone's viewer of a bot's page (DocumentViewer): a version shown, made the page's again, and the page's pane. */
class DocumentViewerTest {
    private val interactive = """{"name":"news","kind":"none","downloadable":true,"interactive":{"current":3,"shown":2,"versions":[],"frame":"https://sandbox.test/p/index.html"}}"""

    @Test fun aVersionShownIsAskedForAndAPageDrawsInItsFrame() = runTest {
        val server = FakeServer { 200 to interactive }
        val viewer = DocumentViewer(server.api, DocumentView.ofPage("b1", "news", "News", "Scout"))
        assertTrue(viewer.page)
        viewer.version = 2
        val viewed = viewer.load()
        assertTrue("version=2" in server.sent().single().query, server.sent().single().query)
        assertEquals(DocumentView.Pane.INTERACTIVE, viewed.pane, "a page's interactive view")
        val file = DocumentViewer(server.api, DocumentView.Opening("/files/r1/a.html", "a.html"))
        assertFalse(file.page)
        assertEquals(DocumentView.Pane.NO_PREVIEW, file.load().pane, "a file is never drawn as a page")
    }

    @Test fun goingBackToAVersionShowsThePagesOwnAgainOrSaysWhyNot() = runTest {
        var refuse = false
        val server = FakeServer { t ->
            if (t.method == "POST") (if (refuse) 409 to """{"error":"That version is gone"}""" else 200 to """{"page":{"slug":"news"}}""") else 200 to interactive
        }
        val viewer = DocumentViewer(server.api, DocumentView.ofPage("b1", "news", "News", "Scout"))
        viewer.version = 2
        assertEquals(InteractivePages.shownAgain(2), viewer.setVersion(2))
        assertNull(viewer.version, "the page's own shows again")
        assertTrue(server.posts().single().path.endsWith("/pages/news/versions/2"), server.posts().single().path)
        refuse = true
        viewer.version = 1
        assertEquals("That version is gone", viewer.setVersion(1))
        assertEquals(1, viewer.version, "refused: still the one shown")
        val noPage = DocumentViewer(server.api, DocumentView.Opening("/files/r1/a.md", "a.md", "", "b1", null, null))
        assertEquals("", noPage.setVersion(1), "a file has no versions")
        val noBot = DocumentViewer(server.api, DocumentView.Opening("/x", "x", "", null, null, "news"))
        assertEquals("", noBot.setVersion(1))
    }
}
