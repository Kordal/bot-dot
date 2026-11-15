package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A bot's computer screen (#1371): where it opens, its page, "I'm done" and what it sends, as Android's LiveScreen and
 * the iPhone's ScreenView draw it (ComputerScreen, ScreenDesk). A fake botdot answers: Ktor's MockEngine under the Api.
 */
class ComputerScreenTest {
    private data class Sent(val method: String, val path: String, val body: String)

    private class FakeBotdot(answer: suspend (Sent) -> Pair<Int, String>) {
        private val lock = Mutex()
        private val took = mutableListOf<Sent>()
        val api = Api("https://botdot.test", MockEngine { req ->
            val sent = Sent(req.method.value, req.url.encodedPath.removePrefix("/api"), (req.body as? TextContent)?.text.orEmpty())
            lock.withLock { took += sent }
            val (status, body) = answer(sent)
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        suspend fun posts(): List<Sent> = lock.withLock { took.filter { it.method == "POST" } }
    }

    private val running = """{"state":"running"}"""
    private val off = """{"state":"running","screenOff":{"text":"Its screen is off.","start":"Turn it on"}}"""

    private fun TestScope.desk(botdot: FakeBotdot, features: List<String> = listOf(SCREEN_DONE)) =
        ScreenDesk(botdot.api, "b", backgroundScope, MutableStateFlow(VersionInfo(features = features))).also { it.open() }

    private suspend fun ScreenDesk.settled(): ScreenState = state.first { !it.waiting }

    @Test fun aRunningComputerOpensItsScreenWatchingOnly() = runTest {
        val botdot = FakeBotdot { 200 to running }
        val desk = desk(botdot)
        val s = desk.settled()
        assertEquals(ComputerScreen.RUNNING, s.state)
        assertEquals("https://botdot.test/computer/b/vnc.html?autoconnect=1&reconnect=1&resize=scale&show_dot=1&view_only=1&path=computer%2Fb%2Fwebsockify", s.url)
        assertEquals("Take control", s.controlLabel)
        assertFalse(s.handBack, "I'm done only while the owner has control")
        assertTrue(botdot.posts().isEmpty(), "a running computer is not started again")
    }

    @Test fun takingControlSendsTapsToItsScreenAndShowsDone() = runTest {
        val desk = desk(FakeBotdot { 200 to running })
        desk.settled()
        desk.control()
        val s = desk.state.first { it.control }
        assertTrue(s.url.orEmpty().contains("view_only=0"))
        assertEquals("Stop controlling", s.controlLabel)
        assertTrue(s.handBack)
    }

    @Test fun noDoneOnABotdotWithoutScreenDone() = runTest {
        val desk = desk(FakeBotdot { 200 to running }, features = emptyList())
        desk.settled()
        desk.control()
        assertFalse(desk.state.first { it.control }.handBack)
        assertFalse(ComputerScreen.canHandBack(ComputerScreen.RUNNING, true, null))
        assertFalse(ComputerScreen.canHandBack(ComputerScreen.STARTING, true, listOf(SCREEN_DONE)))
    }

    @Test fun aStoppedComputerIsStarted() = runTest {
        val botdot = FakeBotdot { r -> if (r.method == "GET") 200 to """{"state":"stopped"}""" else 200 to "{}" }
        val s = desk(botdot).settled()
        assertEquals(ComputerScreen.RUNNING, s.state)
        assertEquals(listOf(Sent("POST", "/bots/b/computer", """{"action":"start"}""")), botdot.posts())
    }

    @Test fun aComputerThatCannotStartSaysWhy() = runTest {
        val botdot = FakeBotdot { r -> if (r.method == "GET") 200 to """{"state":"stopped"}""" else 409 to """{"error":"No free computer."}""" }
        val s = desk(botdot).settled()
        assertEquals(ComputerScreen.ERROR, s.state)
        assertTrue(s.failed)
        assertEquals("No free computer.", s.errorLine)
        assertNull(s.url)
        assertEquals("Couldn't start its computer.", ComputerScreen.errorLine(null))
    }

    @Test fun itsOwnScreenOffIsStartedOnlyWhenAsked() = runTest {
        var on = false
        val botdot = FakeBotdot { r -> if (r.method == "POST") { on = true; 200 to "{}" } else 200 to (if (on) running else off) }
        val desk = desk(botdot)
        val s = desk.settled()
        assertEquals(ComputerScreen.OFF, s.state)
        assertTrue(s.off)
        assertFalse(s.canControl)
        assertEquals("Its screen is off.", s.offLine)
        assertEquals("Turn it on", s.startLabel)
        assertTrue(botdot.posts().isEmpty())
        desk.start()
        assertEquals(ComputerScreen.RUNNING, desk.state.first { it.state == ComputerScreen.RUNNING }.state)
        assertEquals(listOf(Sent("POST", "/bots/b/computer", """{"action":"start"}""")), botdot.posts())
        assertEquals("Start its screen", ComputerScreen.startLabel(null))
    }

    @Test fun doneHandsTheScreenBackAndCloses() = runTest {
        val botdot = FakeBotdot { r -> if (r.method == "POST") 200 to """{"ok":true,"status":"started","text":"It carries on."}""" else 200 to running }
        val desk = desk(botdot)
        desk.settled()
        assertFalse(desk.done(), "nothing is sent before the owner has control")
        desk.control()
        desk.state.first { it.control }
        assertTrue(desk.done())
        assertTrue(desk.state.first { it.closed }.closed)
        assertEquals(listOf(Sent("POST", "/bots/b/computer/done", "{}")), botdot.posts())
    }

    @Test fun doneTappedTwiceIsSentOnce() = runTest {
        val botdot = FakeBotdot { r -> if (r.method == "POST") 200 to """{"ok":true}""" else 200 to running }
        val desk = desk(botdot)
        desk.settled()
        desk.control()
        desk.state.first { it.control }
        val first = async { desk.done() }
        val second = async { desk.done() }
        assertEquals(1, listOf(first.await(), second.await()).count { it })
        assertEquals(1, botdot.posts().size)
    }

    @Test fun doneTappedTwiceFromTwoThreadsAtOnceIsSentOnceEveryTime() = runTest {
        repeat(200) { round ->
            val botdot = FakeBotdot { r -> if (r.method == "POST") 200 to """{"ok":true}""" else 200 to running }
            val desk = desk(botdot)
            desk.settled()
            desk.control()
            desk.state.first { it.control }
            val taps = List(2) { async(Dispatchers.Default) { desk.done() } }
            assertEquals(1, taps.awaitAll().count { it }, "round $round: one tap hands it back")
            assertEquals(1, botdot.posts().size, "round $round: sent once")
        }
    }

    @Test fun aHandBackCancelledOnItsWaySaysNothingAndCanBeTappedAgain() = runTest {
        val held = CompletableDeferred<Unit>()
        val botdot = FakeBotdot { r -> if (r.method == "POST") { held.await(); 200 to """{"ok":true}""" } else 200 to running }
        val desk = desk(botdot)
        desk.settled()
        desk.control()
        desk.state.first { it.control }
        val tap = launch(Dispatchers.Default) { desk.done() }
        desk.state.first { !it.handBack } // on its way
        tap.cancelAndJoin() // the screen left while it was sent
        val after = desk.state.first { it.handBack }
        assertNull(after.notice, "cancelled is not a failure: no notice")
        assertFalse(after.closed)
        held.complete(Unit)
    }

    @Test fun aTapAfterTheScreenWentBackSendsNothing() = runTest {
        val botdot = FakeBotdot { r -> if (r.method == "POST") 200 to """{"ok":true}""" else 200 to running }
        val desk = desk(botdot)
        desk.settled()
        desk.control()
        desk.state.first { it.control }
        assertTrue(desk.done())
        assertFalse(desk.done(), "it went back already: a late second tap does nothing")
        // state is derived (stateIn): read it once it has the screen closed, not as it was a moment before.
        assertFalse(desk.state.first { it.closed }.handBack, "and I'm done no longer shows")
        assertEquals(1, botdot.posts().size)
    }

    @Test fun doneRefusedSaysWhyAndStays() = runTest {
        val botdot = FakeBotdot { r -> if (r.method == "POST") 409 to """{"error":"It is working."}""" else 200 to running }
        val desk = desk(botdot)
        desk.settled()
        desk.control()
        desk.state.first { it.control }
        assertFalse(desk.done())
        val s = desk.state.first { it.noticeId > 0 }
        assertFalse(s.closed)
        assertEquals("It is working.", s.notice)
        assertEquals(1, s.noticeId)
    }

    @Test fun thePageCarriesTheSessionCookie() {
        val keep = object : Session.Keep {
            val kept = mutableMapOf<String, String?>()
            override fun read(server: String) = kept[server]
            override fun write(server: String, token: String?) { kept[server] = token }
        }
        val api = Api("https://botdot.test", Session(keep))
        assertNull(ComputerScreen.cookie(api), "no session: no cookie")
        keep.write("https://botdot.test", "abc")
        val c = ComputerScreen.cookie(api)
        assertEquals(ComputerScreen.Cookie("botdot_session", "abc", true), c)
        assertEquals("botdot_session=abc; Path=/; Secure; HttpOnly", c?.header)
        assertNull(ComputerScreen.cookie(Api("https://botdot.test")))
    }
}
