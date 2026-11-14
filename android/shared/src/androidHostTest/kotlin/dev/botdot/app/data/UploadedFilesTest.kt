package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * A bot's files (#235), against a stand-in botdot: listed from a server that has them, pinned and deleted by the
 * file's own name in uploads/, and the server's list as it is afterwards is what the settings show.
 */
class UploadedFilesTest {
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

    private val one = """{"files":[{"file":"uploads/20261021070000-ab12-CV.pdf","name":"CV.pdf","size":2048,"at":"2026-10-21T07:00:00.000Z","readable":null,"pinned":true,"later":1}],"maxPinned":5}"""

    @Test fun showsOnlyOnAServerThatHasIt() {
        assertTrue(UploadedFiles.shows(listOf("bot-files")))
        assertFalse(UploadedFiles.shows(listOf("duplicate-bot")))
        assertFalse(UploadedFiles.shows(null))
    }

    @Test fun listsPinsAndDeletesByTheFilesName() = runBlocking {
        server.enqueue(json(one))
        val list = api.botFiles("b1")
        assertEquals("GET" to "/api/bots/b1/files", server.takeRequest().let { it.method to it.target })
        assertEquals("CV.pdf", list.files.single().name)
        assertTrue(list.files.single().pinned)
        assertEquals("2 KB · 2026-10-21", UploadedFiles.detail(list.files.single()))
        assertEquals("1 file, 1 kept in mind", UploadedFiles.summary(list.files))
        assertEquals("None", UploadedFiles.summary(emptyList()))

        server.enqueue(json(one.replace("\"pinned\":true", "\"pinned\":false")))
        val after = api.pinBotFile("b1", "uploads/20261021070000-ab12-CV.pdf", false)
        val pin = server.takeRequest()
        assertEquals("PUT" to "/api/bots/b1/files/20261021070000-ab12-CV.pdf", pin.method to pin.target)
        assertEquals("false", Api.JSON.parseToJsonElement(pin.body!!.utf8()).jsonObject["pinned"]!!.jsonPrimitive.content)
        assertFalse(after.files.single().pinned)

        server.enqueue(json("""{"files":[],"maxPinned":5}"""))
        assertTrue(api.deleteBotFile("b1", "uploads/20261021070000-ab12-CV.pdf").files.isEmpty())
        assertEquals("DELETE" to "/api/bots/b1/files/20261021070000-ab12-CV.pdf", server.takeRequest().let { it.method to it.target })
    }

    @Test fun theChiefsOwnFilesAndWorkspaceAreUnderApiChief() {
        assertEquals("/chief", UploadedFiles.owner(UploadedFiles.CHIEF))
        assertEquals("/bots/b1", UploadedFiles.owner("b1"))
        assertEquals("/chief/files/20261021070000-ab12-CV.pdf", DocumentView.botFile(UploadedFiles.CHIEF, "uploads/20261021070000-ab12-CV.pdf"))
        assertEquals("/chief/workspace?root=server&path=notes", WorkspaceFiles.list(UploadedFiles.CHIEF, WorkspaceFiles.SERVER, "notes"))
        assertTrue(UploadedFiles.chiefShows(listOf("bot-files", "chief-files")))
        assertFalse(UploadedFiles.chiefShows(listOf("bot-files")))
        assertFalse(UploadedFiles.chiefShows(null))
    }

    @Test fun sizesReadPlainly() {
        assertEquals("12 B", UploadedFiles.size(12))
        assertEquals("1.5 MB", UploadedFiles.size(1_572_864))
    }
}
