package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One request a [FakeServer] took: its method, its whole path (the front door's own, or /api/…), and its JSON body. */
data class Took(val method: String, val path: String, val body: String, val query: String = "")

/**
 * A fake botdot behind its front door, for the shared tests: Ktor's MockEngine under the shared Api, so they run on
 * Android's host and in the iOS simulator alike. [answer] says what each request gets: a status and a JSON body.
 */
class FakeServer(session: Session? = null, base: String = "https://botdot.test", answer: suspend (Took) -> Pair<Int, String>) {
    private val lock = Mutex()
    private val took = mutableListOf<Took>()
    val api = Api(base, session, MockEngine { req ->
        val t = Took(req.method.value, req.url.encodedPath, (req.body as? TextContent)?.text.orEmpty(), req.url.encodedQuery)
        lock.withLock { took += t }
        val (status, body) = answer(t)
        respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
    })
    suspend fun sent(): List<Took> = lock.withLock { took.toList() }
    suspend fun posts(): List<Took> = sent().filter { it.method != "GET" }
}
