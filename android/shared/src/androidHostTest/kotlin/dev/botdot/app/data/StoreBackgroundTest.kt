package dev.botdot.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * With the app behind, only the background notification looks at the bot list (#1115): a burst of run events does not
 * read it again at once, but once in the quiet time, or as soon as the app comes to front.
 */
class StoreBackgroundTest {
    private suspend fun MockWebServer.reaches(n: Int) = withTimeout(5_000) { while (requestCount < n) delay(10) }

    private fun withStore(quietMs: Long, test: suspend (MockWebServer, Store, MutableStateFlow<Boolean>) -> Unit) = runBlocking {
        val server = MockWebServer()
        server.start()
        val bg = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            repeat(5) { server.enqueue(MockResponse.Builder().addHeader("Content-Type", "application/json").body("[]").build()) }
            val front = MutableStateFlow(false)
            val store = Store(bg, MutableStateFlow(Api(server.url("/").toString().trimEnd('/'))), front = front, quietMs = quietMs)
            bg.launch { store.bots.value.collect {} } // the notification's line looks at it
            server.reaches(1) // read once when it starts looking
            test(server, store, front)
        } finally {
            bg.cancel()
            server.close()
        }
    }

    @Test fun behindAChangeWaitsUntilTheAppComesToFront() = withStore(quietMs = 60_000) { server, store, front ->
        repeat(3) { store.bots.changed() }
        delay(800) // well past the 250 ms burst a screen gets
        assertEquals(1, server.requestCount)
        front.value = true
        server.reaches(2)
        delay(300)
        assertEquals("one read for the three changes", 2, server.requestCount)
    }

    @Test fun behindAChangeIsReadOnceTheQuietTimeHasPassed() = withStore(quietMs = 400) { server, store, _ ->
        // Timed from before the change, so a busy machine can only make the read look later, never earlier: no
        // "not yet" check after a sleep, which failed when this thread was held up past the quiet time.
        val start = System.nanoTime()
        store.bots.changed()
        server.reaches(2)
        val waited = (System.nanoTime() - start) / 1_000_000
        assertTrue("read after the quiet time, not at once (waited $waited ms)", waited >= 400)
        assertEquals(2, server.requestCount)
    }

    @Test fun inFrontAChangeIsReadAfterTheBurst() = withStore(quietMs = 60_000) { server, store, front ->
        front.value = true
        store.bots.changed()
        server.reaches(2)
    }
}
