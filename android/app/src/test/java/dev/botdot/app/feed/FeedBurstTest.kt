package dev.botdot.app.feed

import dev.botdot.app.data.Api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * After a night away botdot replays up to 500 missed events right after hello (#1079): none of them is dropped while
 * a listener takes its time, and a slow listener holds up no other.
 */
class FeedBurstTest {
    @Test fun aBurstOfEventsReachesASlowListenerWhole() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val body = (1..300).joinToString("") { "id: b.$it\nevent: bot_message\ndata: {\"n\":$it}\n\n" }
            server.enqueue(MockResponse.Builder().addHeader("Content-Type", "text/event-stream").body(body).build())
            val api = Api(server.url("/").toString().trimEnd('/'))
            // Slower than the stream: before #1079 okhttp's callback dropped what did not fit in 64.
            val ids = withTimeout(20_000) { api.feed(null).take(300).map { delay(2); it.id }.toList() }
            assertEquals((1..300).map { "b.$it" }, ids)
        } finally {
            server.close()
        }
    }

    @Test fun aQueuedListenerHoldsUpNothingAndGetsEverythingInOrder() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val events = MutableSharedFlow<Int>(extraBufferCapacity = 64)
            val slow = events.queued(scope)
            // 500 values while the listener reads none of them: emit never waits on it.
            withTimeout(2_000) { repeat(500) { events.emit(it) } }
            val got = withTimeout(5_000) { List(500) { slow.receive() } }
            assertEquals((0 until 500).toList(), got)
        } finally {
            scope.cancel()
        }
    }
}
