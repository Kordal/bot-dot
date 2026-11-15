package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

/** Every bot's pages as both phones list them (PagesDesk), and an interactive page's versions in words. */
class PagesDeskTest {
    private val pages = """{"pages":[
        {"slug":"news","title":"News","botId":"b1","bot":"Scout","keep":{"every":"day","time":"08:00"},"onBoard":true},
        {"slug":"plan","title":"Plan","botId":"b2","bot":"Coder","onBoard":false}]}"""

    @Test fun theKeptPagesComeFirstThenTheOthers() = runTest {
        val server = FakeServer { 200 to pages }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        store.version.set(VersionInfo(features = listOf(Pages.FEATURE, DocumentView.FEATURE, Pages.FEATURE_BOARD)))
        val desk = PagesDesk(backgroundScope, server.api, store)
        desk.load()
        val s = desk.state.value
        assertEquals(listOf("news"), s.kept.map { it.slug })
        assertEquals(listOf("plan"), s.other.map { it.slug })
        assertEquals("Other pages", s.otherTitle)
        assertTrue(s.board, "a botdot that puts pages on the Board")
        assertNull(s.empty)
    }

    @Test fun aSwitchTheBoardRefusedGoesBackWithBotdotsWords() = runTest {
        val server = FakeServer { t -> if (t.method == "POST" || t.method == "PUT") 409 to """{"error":"The Board is full"}""" else 200 to pages }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        val desk = PagesDesk(backgroundScope, server.api, store)
        desk.load()
        val plan = desk.state.value.other.single()
        desk.setOnBoard(plan, true)
        assertEquals(false, desk.state.value.other.single().onBoard, "put back")
        assertEquals("The Board is full", desk.state.value.error)
    }

    @Test fun noPagesSaysHowToGetOneAndAFailureSaysSo() = runTest {
        var fail = false
        val server = FakeServer { if (fail) 503 to """{"error":"down"}""" else 200 to """{"pages":[]}""" }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        val desk = PagesDesk(backgroundScope, server.api, store)
        desk.load()
        assertTrue(desk.state.value.empty!!.startsWith("No pages yet."))
        assertEquals("All pages", desk.state.value.otherTitle)
        fail = true
        desk.load()
        assertEquals("Couldn't load the pages.", desk.state.value.error)
        assertFalse(desk.state.value.board)
    }

    @Test fun anInteractivePagesVersionsAreSaidAsBothPhonesSayThem() {
        val v = SiteVersion(n = 3, at = null, bytes = 2048, files = 2)
        assertEquals("Version 3 · on the page", InteractivePages.versionTitle(v, current = 3))
        assertEquals("Version 3", InteractivePages.versionTitle(v, current = 4))
        assertTrue(InteractivePages.versionLine(v).endsWith("2 files"), InteractivePages.versionLine(v))
        assertEquals("You are looking at version 2. The page shows version 4.", InteractivePages.olderShown(2, 4))
        assertEquals("The page shows version 2 again", InteractivePages.shownAgain(2))
        val o = DocumentView.ofPage("b1", "news", "News", "Scout")
        assertEquals(Pages.src("b1", "news"), o.src)
        assertEquals("news", o.slug)
    }

    @Test fun theBoardSwitchesShowOnceTheFeaturesComeAfterTheList() = runTest {
        val server = FakeServer { 200 to pages }
        val store = Store(backgroundScope, MutableStateFlow(server.api))
        runCurrent()
        val desk = PagesDesk(backgroundScope, server.api, store)
        desk.load()
        // The desk's look at the features starts a read of them on the fake (a real thread, not this test's clock):
        // wait for it, or its answer could land after the set below and take the features away again.
        store.version.refresh()
        runCurrent()
        assertFalse(desk.state.value.board, "the features not known yet")
        store.version.set(VersionInfo(features = listOf(Pages.FEATURE, DocumentView.FEATURE, Pages.FEATURE_BOARD)))
        runCurrent()
        assertTrue(desk.state.value.board, "they came: the switches show")
        assertEquals(listOf("news"), desk.state.value.kept.map { it.slug }, "the list as it was")
    }
}
