package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.URI
import java.security.MessageDigest
import java.util.Base64

/**
 * The sign-in in the browser (docs/api.md, "The front door"): the app keeps a secret, opens the front door's page
 * with only its SHA-256, reads the one-time code from botdot://signed-in, and turns code and secret into its session.
 * Against a stand-in front door.
 */
class BrowserSignInTest {
    private lateinit var door: MockWebServer
    private lateinit var url: String
    private var kept: String? = null
    private val keep = object : BrowserSignIn.Keep {
        override fun read() = kept
        override fun write(value: String?) { kept = value }
    }
    private val sessions = mutableMapOf<String, String>()
    private val session = Session(object : Session.Keep {
        override fun read(server: String) = sessions[server]
        override fun write(server: String, token: String?) { if (token == null) sessions.remove(server) else sessions[server] = token }
    })
    private var clock = 1_000_000L
    private var api: Api? = null
    private val code = "C0de_-".padEnd(43, 'x')

    @Before fun start() {
        door = MockWebServer()
        door.start()
        url = door.url("/").toString().trimEnd('/')
        api = Api(url, session)
    }

    @After fun stop() = door.close()

    private fun signIn() = BrowserSignIn(keep, now = { clock }, api = { api })
    private fun answer(body: String, code: Int = 200, cookie: String? = null) = MockResponse.Builder().code(code)
        .addHeader("Content-Type", "application/json").apply { if (cookie != null) addHeader("Set-Cookie", cookie) }.body(body).build()

    @Test fun theSecretIsRandomAndThePageCarriesOnlyItsSha256() {
        val a = Handoff.start("https://hq.example.com/", 0)
        val b = Handoff.start("https://hq.example.com", 0)
        assertNotEquals(a.verifier, b.verifier)
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(a.verifier))
        val sha = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(a.verifier.toByteArray()))
        assertEquals(sha, a.challenge)
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(a.challenge))
        assertEquals("https://hq.example.com/sign-in?app=android&handoff=${a.challenge}", a.page)
        assertFalse(a.verifier in a.page)
    }

    @Test fun theChallengeIsTheOneTheFrontDoorChecks() {
        // RFC 7636's example: the same SHA-256 in base64url that front-door.js takes.
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Handoff.challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test fun theCodeIsReadOnlyFromBotdotsOwnReturnAddress() {
        assertEquals(code, Handoff.codeOf("botdot://signed-in?code=$code"))
        assertEquals(code, Handoff.codeOf("botdot://signed-in?x=1&code=$code"))
        assertNull(Handoff.codeOf("botdot://signed-in?code=short"))
        assertNull(Handoff.codeOf("botdot://signed-in?code=${code}%26"))
        assertNull(Handoff.codeOf("botdot://signed-in"))
        assertNull(Handoff.codeOf("botdot://elsewhere?code=$code"))
        assertNull(Handoff.codeOf("https://signed-in?code=$code"))
        assertNull(Handoff.codeOf("not a uri at all"))
        assertNull(Handoff.codeOf(null))
        assertTrue(Handoff.isReturn("botdot://signed-in"))
        assertFalse(Handoff.isReturn("botdot://other"))
    }

    @Test fun backFromTheBrowserTheCodeAndTheKeptSecretBecomeTheSession() = runBlocking {
        val s = signIn()
        val page = s.start()!!
        assertEquals(BrowserSignIn.State.Waiting, s.state.value)
        val waiting = Handoff.parse(kept)!!
        assertEquals(url, waiting.server)
        assertEquals(waiting.challenge, URI(page).rawQuery.substringAfter("handoff="))

        door.enqueue(answer("""{"ok":true,"account":"ann"}""", cookie = "botdot_session=s3cret; Path=/; HttpOnly"))
        s.back("botdot://signed-in?code=$code")
        assertEquals(BrowserSignIn.State.Done("ann"), s.state.value)
        val r = door.takeRequest()
        assertEquals("POST" to "/sign-in/handoff", r.method to r.target)
        val body = Api.JSON.parseToJsonElement(r.body!!.utf8()).jsonObject
        assertEquals(code, body["code"]!!.jsonPrimitive.content)
        assertEquals(waiting.verifier, body["verifier"]!!.jsonPrimitive.content)
        assertEquals("s3cret", sessions[url])
        assertNull("the secret is used once", kept)
        s.seen()
        assertEquals(BrowserSignIn.State.Idle, s.state.value)
    }

    @Test fun aCodeForNoWaitingSignInOrAnOldOneOrAnotherBotdotSignsNothingIn() = runBlocking {
        val s = signIn()
        s.back("botdot://signed-in?code=$code")
        assertEquals(BrowserSignIn.State.Failed("That sign-in has ended. Sign in again."), s.state.value)

        s.start()
        clock += Handoff.WAITS_MS + 1
        s.back("botdot://signed-in?code=$code")
        assertEquals(BrowserSignIn.State.Failed("That sign-in has ended. Sign in again."), s.state.value)

        s.start()
        api = Api("https://other.example.com", session)
        s.back("botdot://signed-in?code=$code")
        assertEquals(BrowserSignIn.State.Failed("That sign-in was for another botdot. Sign in again."), s.state.value)
        assertNull(kept)

        api = Api(url, session)
        s.start()
        s.back("botdot://signed-in")
        assertEquals(BrowserSignIn.State.Failed("The sign-in didn't come back from the browser. Sign in again."), s.state.value)
        assertNull("a return without a code ends the waiting sign-in too", kept)
        assertEquals(0, door.requestCount)
    }

    @Test fun aCodeTheFrontDoorRefusesSaysItsWords() = runBlocking {
        val s = signIn()
        s.start()
        door.enqueue(answer("""{"error":"That sign-in didn't come from this app. Sign in again."}""", 401))
        s.back("botdot://signed-in?code=$code")
        assertEquals(BrowserSignIn.State.Failed("That sign-in didn't come from this app. Sign in again."), s.state.value)
        assertTrue(sessions.isEmpty())
    }

    @Test fun noBrowserSaysSoAndForgetsTheSecret() {
        val s = signIn()
        s.start()
        s.couldNotOpen("No browser.")
        assertEquals(BrowserSignIn.State.Failed("No browser."), s.state.value)
        assertNull(kept)
    }

    @Test fun whatIsKeptReadsBack() {
        val h = Handoff.start("https://hq.example.com", 42)
        val again = Handoff.parse(h.kept())!!
        assertEquals(h.server to h.verifier, again.server to again.verifier)
        assertEquals(42L, again.startedAt)
        assertNull(Handoff.parse("nonsense"))
        assertNull(Handoff.parse(null))
    }
}
