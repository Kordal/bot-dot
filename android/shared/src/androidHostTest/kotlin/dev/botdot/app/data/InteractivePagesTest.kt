package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

/**
 * A bot's interactive page (#399, ADR 072): the viewer gets its frame's address and its versions, the frame keeps to
 * its own files, a link out is asked about first, anything else stays shut, and roll back names the version.
 */
class InteractivePagesTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private val frame = "https://vm.example.ts.net:8443/ann/eyJiIjoib3BzIn0.abcdefghijklmnopqrstuvwxyz012345/index.html"

    @Test fun theFrameKeepsToItsOwnFilesAndALinkOutIsAskedFirst() {
        assertEquals("https://vm.example.ts.net:8443/ann/eyJiIjoib3BzIn0.abcdefghijklmnopqrstuvwxyz012345/", InteractivePages.prefix(frame))
        assertEquals(InteractivePages.Go.Stay, InteractivePages.go(frame, InteractivePages.prefix(frame) + "board.html"))
        assertEquals(InteractivePages.Go.Ask("https://github.com/Kordal/bot-dot/issues/12"), InteractivePages.go(frame, "https://github.com/Kordal/bot-dot/issues/12"))
        assertEquals(InteractivePages.Go.Ask("https://example.com/a?b=1"), InteractivePages.go(frame, "botdot-open:https%3A%2F%2Fexample.com%2Fa%3Fb%3D1"))
        assertEquals(InteractivePages.Go.Block, InteractivePages.go(frame, "javascript:alert(1)"))
        assertEquals(InteractivePages.Go.Block, InteractivePages.go(frame, "botdot-open:intent%3A%2F%2Fx"))
        assertEquals("the app's own address is a link out too", InteractivePages.Go.Ask("https://vm.example.ts.net/api/bots"), InteractivePages.go(frame, "https://vm.example.ts.net/api/bots"))
        assertEquals(InteractivePages.Go.Ask("https://vm.example.ts.net:8443/ann/other.token/index.html"), InteractivePages.go(frame, "https://vm.example.ts.net:8443/ann/other.token/index.html"))
    }

    @Test fun theOneMessageIntoThePageIsItsValues() {
        val values = Api.JSON.parseToJsonElement("""{"Disk":{"title":"Disk","data":{"value":"81%"},"at":null}}""") as kotlinx.serialization.json.JsonObject
        assertEquals("""window.postMessage({"botdot":"values","values":{"Disk":{"title":"Disk","data":{"value":"81%"},"at":null}}},'*');""", InteractivePages.valuesScript(values))
        assertTrue("its one request becomes a navigation the WebView never loads", "location.href='botdot-open:'" in InteractivePages.LISTENER)
    }

    @Test fun theViewerGetsItsFrameAndVersionsAndRollBackNamesTheVersion() = runBlocking {
        server.enqueue(json("""{"name":"roadmap.zip","kind":"none","size":2048,"page":{"slug":"roadmap","title":"Roadmap","kind":"interactive","version":3,"updatedAt":"2026-10-22T07:00:00Z"},
            "interactive":{"current":3,"shown":3,"frame":"$frame","expires":"2026-10-22T07:30:00Z","versions":[{"n":3,"at":"2026-10-22T07:00:00Z","bytes":2048,"files":3},{"n":2,"at":"2026-10-21T07:00:00Z","bytes":1024,"files":2}],"values":{},"tiles":[]}}"""))
        val v = api.viewFile(Pages.src("ops", "roadmap"))
        assertEquals("/api/bots/ops/pages/roadmap?view=1", server.takeRequest().target)
        assertEquals(frame, v.interactive?.frame)
        assertEquals(listOf(3, 2), v.interactive?.versions?.map { it.n })
        assertEquals("Interactive page by Ops · updated 5m ago", Pages.subtitle("Ops", v.page, Instant.parse("2026-10-22T07:05:00Z")))

        server.enqueue(json("""{"page":{"slug":"roadmap","title":"Roadmap","kind":"interactive","version":2}}"""))
        assertEquals(2, api.setPageVersion("ops", "roadmap", 2)?.version)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/bots/ops/pages/roadmap/versions/2", req.target)

        server.enqueue(json("""{"values":{"Disk":{"title":"Disk","data":{"value":"81%"}}},"tiles":["t1"]}"""))
        assertEquals(listOf("t1"), api.pageValues(Pages.src("ops", "roadmap")).tiles)
        assertEquals("/api/bots/ops/pages/roadmap?values=1", server.takeRequest().target)

        server.enqueue(json("""{"name":"roadmap.zip","kind":"none","size":1,"interactive":{"current":3,"shown":2,"frame":null,"versions":[]}}"""))
        assertNull("a machine without the sandbox's address", api.viewFile(Pages.src("ops", "roadmap")).interactive?.frame)
        server.takeRequest()
        Unit
    }
}
