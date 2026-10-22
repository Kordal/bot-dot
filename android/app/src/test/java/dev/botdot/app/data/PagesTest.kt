package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

/**
 * A bot's pages (#346): only from a server with `pages`, a run lists the pages it saved, the viewer reads a page with
 * its `page`, and "Keep up to date" sends the sheet's words, which the server makes a job of.
 */
class PagesTest {
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

    @Test fun showsOnlyOnAServerThatHasPagesAndTheViewer() {
        assertTrue(Pages.shows(listOf("document-viewer", "pages")))
        assertFalse(Pages.shows(listOf("pages")))
        assertFalse(Pages.shows(listOf("document-viewer")))
        assertFalse(Pages.shows(null))
        assertEquals("/bots/ops/pages/hq-health", Pages.src("ops", "hq-health"))
    }

    @Test fun aRunListsThePagesItSavedAndSkipsWhatItCannotRead() {
        val run = Api.JSON.decodeFromString(Run.serializer(), """{"id":"r1","pages":[{"slug":"hq-health","title":"hq health"},{"title":"no slug"},"x"]}""")
        assertEquals(listOf(PageRef("hq-health", "hq health")), run.pages)
        assertEquals(emptyList<PageRef>(), Api.JSON.decodeFromString(Run.serializer(), """{"id":"r2"}""").pages)
    }

    @Test fun theHeaderAndTheListSayWhoMadeItAndWhenItWasUpdated() {
        val now = Instant.parse("2026-10-22T07:05:00Z")
        val page = PageInfo(slug = "hq-health", title = "hq health", updatedAt = "2026-10-22T07:00:00Z")
        assertEquals("Page by Ops · updated 5m ago", Pages.subtitle("Ops", page, now))
        assertEquals("Page", Pages.subtitle("", null, now))
        assertEquals("updated 5m ago", Pages.line(page, now))
        assertEquals("updated 5m ago · Daily at 07:00", Pages.line(page.copy(keep = PageKeep("j1", "Daily at 07:00", "day", "07:00")), now))
    }

    @Test fun aPageComesWithWhatItIsAndKeepUpToDateSendsTheSheetsWords() = runBlocking {
        server.enqueue(json("""{"name":"hq-health.md","size":12,"kind":"markdown","text":"# hq","page":{"slug":"hq-health","title":"hq health","updatedAt":"2026-10-22T07:00:00Z","keep":null}}"""))
        val v = api.viewFile(Pages.src("ops", "hq-health"))
        assertEquals("/api/bots/ops/pages/hq-health?view=1", server.takeRequest().target)
        assertEquals("hq health", v.page?.title)
        assertNull(v.page?.keep)

        server.enqueue(json("""{"page":{"slug":"hq-health","title":"hq health","keep":{"jobId":"j1","when":"Mondays at 08:30","every":"monday","time":"08:30","notify":"always","check":"Disk"}},"job":{"id":"j1"}}""", 201))
        val kept = api.keepPage("ops", "hq-health", "monday", "08:30", "always", "Disk")
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/bots/ops/pages/hq-health/keep", req.target)
        assertEquals(buildJsonObject { put("every", "monday"); put("time", "08:30"); put("notify", "always"); put("check", "Disk") }, Api.JSON.parseToJsonElement(req.body!!.utf8()).jsonObject)
        assertEquals("j1", kept?.keep?.jobId)
        assertEquals("monday", kept?.keep?.every)

        server.enqueue(json("""{"page":{"slug":"hq-health","title":"hq health","keep":null}}"""))
        assertNull(api.stopKeepingPage("ops", "hq-health")?.keep)
        assertEquals("DELETE", server.takeRequest().method)
    }

    @Test fun everyBotsPagesComeInOneListKeptOnesFirst() = runBlocking {
        assertTrue(Pages.showsAll(listOf("document-viewer", "pages", "pages-all")))
        assertFalse(Pages.showsAll(listOf("document-viewer", "pages")))
        assertFalse(Pages.showsAll(null))

        server.enqueue(json("""{"pages":[{"botId":"ops","bot":"Ops","slug":"router-ports","title":"Router ports","updatedAt":"2026-10-22T07:04:00Z","keep":null},{"botId":"ops","bot":"Ops","slug":"hq-health","title":"hq health","updatedAt":"2026-10-22T07:00:00Z","keep":{"jobId":"j1","when":"Daily at 07:00"}},{"botId":"w","bot":"Writer","slug":"memo","title":"Memo","updatedAt":"2026-10-22T06:00:00Z","keep":null}]}"""))
        val all = api.allPages()
        assertEquals("/api/pages", server.takeRequest().target)
        val (kept, other) = Pages.split(all)
        assertEquals(listOf("hq-health"), kept.map { it.slug })
        assertEquals(listOf("router-ports", "memo"), other.map { it.slug })
        val now = Instant.parse("2026-10-22T07:05:00Z")
        assertEquals("Ops · updated 5m ago · Daily at 07:00", Pages.allLine(kept[0], now))
        assertEquals("Writer · updated 1h ago", Pages.allLine(other[1], now))
    }

    @Test fun theFeedsPageEventIsKeptByBotAndSlug() {
        val saves = PageSaves()
        saves.handle(FeedEvent("b.1", "page", buildJsonObject { put("botId", "ops"); put("slug", "hq-health"); put("updatedAt", "2026-10-22T07:00:00Z") }))
        saves.handle(FeedEvent("b.2", "page", buildJsonObject { put("slug", "x") }))
        saves.handle(FeedEvent("b.3", "run_finished", buildJsonObject { put("botId", "ops") }))
        assertEquals(mapOf("ops/hq-health" to "b.1"), saves.value.value)
    }
}
