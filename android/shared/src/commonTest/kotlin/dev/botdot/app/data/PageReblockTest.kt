package dev.botdot.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.update
import kotlin.test.fail
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** A page's blocks read again while it is open (PageReblock, #395): a tile they read, and each minute. */
class PageReblockTest {
    private val blocks = """{"parts":[{"md":"# Week"}],"tiles":["t1"]}"""

    /** botdot answers on its own thread: wait a little for what it brought. */
    private suspend fun TestScope.until(what: String, done: () -> Boolean) {
        repeat(200) { if (done()) return; runCurrent(); withContext(Dispatchers.Default) { delay(5) } }
        fail("never: $what")
    }

    // On a real clock, short: botdot's answer comes on its own thread, and a virtual one would run past its timeout.
    private suspend fun waitFor(what: String, done: suspend () -> Boolean) {
        repeat(200) { if (done()) return; withContext(Dispatchers.Default) { delay(10) } }
        fail("never: $what")
    }

    @Test fun aTileTheBlocksReadReadsThemAgain() = runTest {
        val server = FakeServer { 200 to blocks }
        val ticks = TileTicks()
        val got = kotlinx.coroutines.flow.MutableStateFlow<List<PageBlocks>>(emptyList())
        val scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Default)
        val job = PageReblock(server.api, ticks.value, scope, every = 600_000, settle = 20).follow("/bots/b1/pages/week", listOf("t1")) { b -> got.update { it + b } }
        withContext(Dispatchers.Default) { delay(50) }
        ticks.tick("t2")
        withContext(Dispatchers.Default) { delay(100) }
        assertEquals(0, server.sent().size, "a tile it doesn't read")
        ticks.tick("t1")
        waitFor("read") { got.value.size == 1 }
        assertEquals("# Week", got.value.single().parts.single().md)
        ticks.tick(null)
        waitFor("the Board changed") { got.value.size == 2 }
        job.cancel()
        ticks.tick("t1")
        withContext(Dispatchers.Default) { delay(100) }
        assertEquals(2, server.sent().size, "closed: read no more")
        scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
    }

    @Test fun eachMinuteItIsReadAgain() = runTest {
        val server = FakeServer { 200 to blocks }
        val got = kotlinx.coroutines.flow.MutableStateFlow<List<PageBlocks>>(emptyList())
        val scope = kotlinx.coroutines.CoroutineScope(Dispatchers.Default)
        PageReblock(server.api, TileTicks().value, scope, every = 50).follow("/bots/b1/pages/week", listOf("t1")) { b -> got.update { it + b } }
        waitFor("the interval") { got.value.size >= 2 }
        scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
    }

    @Test fun onlyAPageWhoseBlocksReadTilesIsReadAgain() = runTest {
        assertTrue(PageReblock.reads(listOf("t1"), null))
        assertTrue(PageReblock.reads(listOf("t1"), "t1"))
        assertFalse(PageReblock.reads(listOf("t1"), "t2"))
        assertFalse(PageReblock.reads(emptyList(), null))
        assertFalse(PageReblock.reads(null, "t1"))
        val server = FakeServer { 200 to blocks }
        var read = 0
        PageReblock(server.api, TileTicks().value, backgroundScope).follow("/bots/b1/pages/week", emptyList()) { read++ }
        advanceTimeBy(PageReblock.EVERY_MS * 2); runCurrent()
        assertEquals(0, read)
    }
}
