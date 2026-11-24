package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * Five answers in Needs you each ask for the lists again (#1112): those that ask while a read is under way share the
 * one read that starts after it, so the list is read twice, not five times one after another.
 *
 * "While a read is under way" is made so, not hoped for (#1387): the fake botdot holds the first read until all five
 * have asked. Left to the network's speed, a first read that finished before the others asked was an ordinary read of
 * its own, and the count went to 3 on a busy machine. The reads are counted at the fake botdot (Ktor's MockEngine, as
 * in NeedsDeskTest), so no socket, and no connection retry of OkHttp, can add one.
 */
class StoreRefreshTest {
    @Test fun refreshesAskedAtOnceShareOneRead() = runBlocking {
        val reads = AtomicInteger()
        val firstRead = CompletableDeferred<Unit>() // the first read waits here, under way, until all five have asked
        val api = Api("https://botdot.test", MockEngine {
            if (reads.incrementAndGet() == 1) firstRead.await()
            respond("[]", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        val bg = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val store = Store(bg, MutableStateFlow(api))
            // UNDISPATCHED: each runs up to where it waits, here and now: the first for its read, the second for the
            // first to end, the other three for the second's read. All five have asked before the first read ends.
            val asks = List(5) { launch(start = CoroutineStart.UNDISPATCHED) { store.bots.refresh() } }
            firstRead.complete(Unit)
            asks.joinAll()
            assertEquals("the read under way, and one after it for the four that asked during it", 2, reads.get())
            assertEquals(emptyList<Bot>(), store.bots.value.value)
            store.bots.refresh()
            assertEquals("asked after the reads ended: a read of its own", 3, reads.get())
        } finally {
            bg.cancel()
        }
    }
}
