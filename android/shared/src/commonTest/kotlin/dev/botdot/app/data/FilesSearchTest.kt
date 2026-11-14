package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Files' search against a fake botdot (Ktor's MockEngine): one that couldn't be made is said, not "Nothing by that name". */
class FilesSearchTest {
    private fun botdot(status: Int, body: String) = Api("https://botdot.test", MockEngine {
        respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
    })

    @Test fun aSearchThatFoundNothingSaysSo() = runTest {
        val s = FilesExplorer.search(botdot(200, """{"results":[]}"""), "b1", "report")
        assertEquals(emptyList(), s.found)
        assertNull(s.failed)
        assertEquals(FilesExplorer.Pane.EMPTY, FilesExplorer.pane(s.found, "server", null, WorkspaceListing(), emptyList(), s.failed))
        assertEquals("Nothing by that name.", FilesExplorer.emptyWords(s.found))
    }

    @Test fun aSearchThatFailedIsSaidWithItsReason() = runTest {
        val s = FilesExplorer.search(botdot(503, """{"error":"botdot is restarting"}"""), "b1", "report")
        assertNull(s.found)
        assertNotNull(s.failed)
        assertEquals(FilesExplorer.Pane.SEARCH_FAILED, FilesExplorer.pane(s.found, "server", null, WorkspaceListing(), emptyList(), s.failed))
        assertEquals("botdot is restarting", FilesExplorer.searchFailedWords(s.failed))
    }

    @Test fun aFailureWithoutWordsSaysCouldntSearch() {
        assertEquals("Couldn't search", FilesExplorer.searchFailedWords(null))
        assertEquals("Couldn't search", FilesExplorer.searchFailedWords(Exception("")))
    }
}
