package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.SocketEffect
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/** A download whose connection breaks is no file: it fails, and leaves nothing behind. */
class BrokenDownloadTest {
    private lateinit var botdot: MockWebServer
    private val dir = File(System.getProperty("java.io.tmpdir"), "botdot-broken-${System.nanoTime()}")

    @Before fun start() { botdot = MockWebServer().apply { start() } }
    @After fun stop() { botdot.close(); dir.deleteRecursively() }

    @Test fun aBrokenDownloadFailsAndLeavesNoFile() = runBlocking {
        botdot.enqueue(MockResponse.Builder().addHeader("Content-Length", "100000").body("x".repeat(100_000))
            .onResponseBody(SocketEffect.CloseSocket()).build())
        val dest = File(dir, "f.bin")
        val failed = runCatching { Api(botdot.url("/").toString().trimEnd('/')).downloadFile("r1/f.bin", dest) }
        assertTrue("it fails", failed.exceptionOrNull() is ApiException)
        assertFalse("no file", dest.exists())
        assertFalse("no part", File(dest.path + ".part").exists())
    }
}
