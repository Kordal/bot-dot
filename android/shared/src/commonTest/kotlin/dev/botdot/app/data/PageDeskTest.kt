package dev.botdot.app.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** A page's bar in the viewer for both phones (PageDesk, #346, #451, #475): Board, Keep up to date, Refresh now, Stop. */
class PageDeskTest {
    private val page = PageInfo(slug = "menu", title = "Menu", sources = "the menu file", onBoard = false)
    private val on = listOf(Pages.FEATURE, DocumentView.FEATURE, Pages.FEATURE_BOARD)

    private suspend fun TestScope.until(what: String, done: suspend () -> Boolean) {
        repeat(200) { if (done()) return; runCurrent(); withContext(Dispatchers.Default) { delay(5) } }
        fail("never: $what")
    }

    @Test fun keepUpToDateOpensOnWhatKeepsItElseEveryMorningFromItsSources() {
        assertEquals(KeepDraft("day", "07:00", "report-only", "the menu file"), KeepDraft.of(page))
        val kept = page.copy(keep = PageKeep(jobId = "j1", `when` = "Every Monday", every = "monday", time = "09:00", notify = "always", check = "prices"))
        assertEquals(KeepDraft("monday", "09:00", "always", "prices"), KeepDraft.of(kept))
    }

    @Test fun boardFlipsAtOnceAndBackWithBotdotsWords() = runTest {
        var status = 200
        val server = FakeServer { t -> if (status == 200) 200 to """{"page":{"slug":"menu","onBoard":true}}""" else 500 to """{"error":"Board is full"}""" }
        val desk = PageDesk(backgroundScope, server.api, "b1", "menu", "Ada", on)
        desk.show(page)
        assertTrue(desk.state.value.board)
        desk.toggleBoard()
        assertEquals(true, desk.state.value.onBoard, "flipped at once")
        until("botdot took it") { server.posts().size == 1 && !desk.state.value.boarding }
        assertEquals(true, desk.state.value.onBoard)
        status = 500
        desk.toggleBoard()
        until("put back") { desk.state.value.work?.kind == "err" }
        assertEquals(true, desk.state.value.onBoard, "back as it was")
        assertEquals("Board is full", desk.state.value.work?.text)
        assertFalse(PageDesk(backgroundScope, server.api, "b1", "menu", "Ada", listOf(Pages.FEATURE)).also { it.show(page) }.state.value.board, "no pages-board: no button")
    }

    @Test fun keepSaysWhileItSavesThenOkAndAFailureOpensTheSheetAgainWithWhatWasEntered() = runTest {
        val held = CompletableDeferred<Unit>()
        var ok = true
        val server = FakeServer { _ -> held.await(); if (ok) 200 to """{"page":{"slug":"menu","keep":{"jobId":"j1","when":"Every morning"}}}""" else 500 to """{"error":"No"}""" }
        val desk = PageDesk(backgroundScope, server.api, "b1", "menu", "Ada", on)
        desk.show(page)
        val draft = KeepDraft("day", "08:00", "always", "prices")
        desk.keep(draft)
        assertEquals(PageWork("busy", "Saving schedule…"), desk.state.value.work)
        desk.stop()
        assertEquals("Saving schedule…", desk.state.value.work?.text, "one action at a time")
        held.complete(Unit)
        until("saved, and the ok gone by itself") { desk.state.value.work == null }
        assertEquals(1, desk.state.value.pageChanged, "a save changed what keeps it")
        assertEquals("Every morning", desk.state.value.keep?.`when`)
        assertTrue("\"time\":\"08:00\"" in server.posts().single().body)
        ok = false
        desk.keep(draft)
        until("refused") { desk.state.value.work?.kind == "err" }
        desk.retry()
        assertEquals(draft, desk.state.value.reopen, "the sheet again, with what was entered")
        desk.reopened()
        assertNull(desk.state.value.reopen)
    }

    @Test fun refreshRunsItsJobAndStopEndsIt() = runTest {
        val server = FakeServer { t -> if (t.method == "DELETE") 200 to """{"page":{"slug":"menu"}}""" else 200 to """{"started":true}""" }
        val desk = PageDesk(backgroundScope, server.api, "b1", "menu", "Ada", on)
        val said = mutableListOf<String>()
        desk.watch { s -> s.work?.takeIf { it.kind == "ok" }?.let { if (said.lastOrNull() != it.text) said += it.text } }
        desk.show(page.copy(keep = PageKeep(jobId = "j1", `when` = "Every morning")))
        desk.refresh()
        until("refreshing") { "Ada is refreshing it" in said }
        assertTrue(server.posts().single().path.endsWith("/jobs/j1/run"))
        until("the ok gone") { desk.state.value.work == null }
        desk.stop()
        assertEquals(0, desk.state.value.pageChanged, "Refresh now runs a job: the page is not read again for it")
        until("stopped") { "It no longer keeps up to date" in said }
        until("Stop changed what keeps it") { desk.state.value.pageChanged == 1 }
        assertNull(desk.state.value.keep, "nothing keeps it now")
    }
    @Test fun changeOpensOnWhatKeepsItNowAfterASaveOrAStop() = runTest {
        var stopped = false
        val server = FakeServer { t ->
            if (t.method == "DELETE") { stopped = true; 200 to """{"page":{"slug":"menu","sources":"the menu file"}}""" }
            else 200 to """{"page":{"slug":"menu","sources":"the menu file","keep":{"jobId":"j1","when":"Every Monday","every":"monday","time":"09:00","notify":"always","check":"prices"}}}"""
        }
        val desk = PageDesk(backgroundScope, server.api, "b1", "menu", "Ada", on)
        desk.show(page)
        assertEquals(KeepDraft("day", "07:00", "report-only", "the menu file"), desk.draft(), "as first read")
        desk.keep(KeepDraft("monday", "09:00", "always", "prices"))
        until("kept") { desk.state.value.keep != null }
        assertEquals(KeepDraft("monday", "09:00", "always", "prices"), desk.draft(), "Change opens on the schedule saved")
        until("the ok gone") { desk.state.value.work == null }
        desk.stop()
        until("stopped") { stopped && desk.state.value.keep == null }
        assertEquals(KeepDraft("day", "07:00", "report-only", "the menu file"), desk.draft(), "stopped: the defaults again")
    }
}
