package dev.botdot.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Five answers in Needs you each ask for the lists again (#1112): those that ask while a read is under way share the
 * one read that starts after it, so the list is read twice, not five times one after another.
 */
class StoreRefreshTest {
    @Test fun refreshesAskedAtOnceShareOneRead() = runBlocking {
        val server = MockWebServer()
        server.start()
        val bg = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            repeat(6) { server.enqueue(MockResponse.Builder().addHeader("Content-Type", "application/json").body("[]").build()) }
            val store = Store(bg, MutableStateFlow(Api(server.url("/").toString().trimEnd('/'))))
            List(5) { launch { store.bots.refresh() } }.joinAll()
            assertEquals("the read under way, and one after it for the four that asked during it", 2, server.requestCount)
            assertEquals(emptyList<Bot>(), store.bots.value.value)
            store.bots.refresh()
            assertEquals("asked after the reads ended: a read of its own", 3, server.requestCount)
        } finally {
            bg.cancel()
            server.close()
        }
    }
}
