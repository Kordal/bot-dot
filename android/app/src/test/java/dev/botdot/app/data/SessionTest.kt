package dev.botdot.app.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * The app's session with the front door (ADR 028, #468), against a stand-in front door: it signs in once with the
 * passkey, every request and the feed carry the session, it is kept across a restart, a session that was ended
 * sends the app back to sign-in, and "Sign out everywhere" ends it.
 */
class SessionTest {
    private lateinit var door: MockWebServer
    private lateinit var url: String
    /** What the phone keeps: here in memory, on the phone in its private preferences. */
    private val kept = mutableMapOf<String, String>()
    private val keep = object : Session.Keep {
        override fun read(server: String) = kept[server]
        override fun write(server: String, token: String?) { if (token == null) kept.remove(server) else kept[server] = token }
    }

    @Before fun start() {
        door = MockWebServer()
        door.start()
        url = door.url("/").toString().trimEnd('/')
    }

    @After fun stop() = door.close()

    private fun json(body: String, code: Int = 200, vararg headers: Pair<String, String>) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").apply { headers.forEach { addHeader(it.first, it.second) } }.body(body).build()
    private val signInFirst = """{"error":"Sign in first.","signIn":"/sign-in"}"""
    private val options = """{"publicKey":{"challenge":"Y2hhbGxlbmdl","rpId":"botdot.example.com","userVerification":"required","timeout":300000}}"""
    /** What Credential Manager hands back for the options: a PublicKeyCredential as JSON. */
    private val credential = """{"id":"a2V5","rawId":"a2V5","type":"public-key","response":{"clientDataJSON":"Y2Q","authenticatorData":"YWQ","signature":"c2ln","userHandle":"dQ"},"clientExtensionResults":{}}"""

    private suspend fun signIn(api: Api): String {
        door.enqueue(json(options))
        door.enqueue(json("""{"ok":true,"account":"ann"}""", 200, "Set-Cookie" to "botdot_session=s3cret; Path=/; HttpOnly; SameSite=Lax; Max-Age=34560000; Secure"))
        var asked: String? = null
        val account = api.signInWithPasskey { requestJson -> asked = requestJson; credential }
        val o = door.takeRequest()
        assertEquals("POST" to "/sign-in/options", o.method to o.target)
        assertEquals("1", o.headers["X-Bot-Dot"])
        // The passkey is asked with the front door's own options, as WebAuthn's JSON.
        assertEquals("Y2hhbGxlbmdl", Api.JSON.parseToJsonElement(asked!!).jsonObject["challenge"]!!.jsonPrimitive.content)
        val s = door.takeRequest()
        assertEquals("POST" to "/sign-in", s.method to s.target)
        assertEquals("1", s.headers["X-Bot-Dot"])
        val body = Api.JSON.parseToJsonElement(s.body!!.utf8()).jsonObject
        assertEquals("android", body["app"]!!.jsonPrimitive.content)
        assertEquals(Api.JSON.parseToJsonElement(credential), body["credential"])
        return account
    }

    private suspend fun refused(api: Api) {
        try { api.bots(); fail("not signed in") } catch (e: ApiException) { assertEquals(401, e.status) }
    }

    @Test fun signsInOnceWithThePasskeyAndEveryRequestCarriesTheSession() = runBlocking {
        val session = Session(keep)
        val api = Api(url, session)
        // Not signed in: the front door asks for it, and the app knows to show its sign-in.
        door.enqueue(json(signInFirst, 401))
        refused(api)
        assertNull(door.takeRequest().headers["Cookie"])
        assertEquals(url, session.signInNeeded.value)

        assertEquals("ann", signIn(api))
        assertNull(session.signInNeeded.value)

        door.enqueue(json("[]"))
        api.bots()
        assertEquals("botdot_session=s3cret", door.takeRequest().headers["Cookie"])
        // The feed carries it too.
        door.enqueue(MockResponse.Builder().addHeader("Content-Type", "text/event-stream").body("id: 1\nevent: hello\ndata: {}\n\n").build())
        withTimeout(5000) { api.feed(null).first() }
        val feed = door.takeRequest()
        assertEquals("/api/events?guarded=1", feed.target)
        assertEquals("botdot_session=s3cret", feed.headers["Cookie"])
    }

    @Test fun theSessionIsKeptAcrossARestartAndGoesOnlyToItsOwnServer() = runBlocking {
        signIn(Api(url, Session(keep)))
        // The app starts again: a new session over what the phone kept.
        val again = Api(url, Session(keep))
        door.enqueue(json("[]"))
        again.bots()
        assertEquals("botdot_session=s3cret", door.takeRequest().headers["Cookie"])

        // Another server is never sent it.
        val other = MockWebServer().apply { start() }
        try {
            other.enqueue(json("[]"))
            Api(other.url("/").toString().trimEnd('/'), Session(keep)).bots()
            assertNull(other.takeRequest().headers["Cookie"])
        } finally { other.close() }
    }

    @Test fun aSessionEndedElsewhereSendsTheAppBackToSignIn() = runBlocking {
        val session = Session(keep)
        val api = Api(url, session)
        signIn(api)
        // Signed out everywhere from the web page: the front door no longer knows this session.
        door.enqueue(json(signInFirst, 401))
        refused(api)
        assertEquals("botdot_session=s3cret", door.takeRequest().headers["Cookie"])
        assertEquals(url, session.signInNeeded.value)
        assertTrue(kept.isEmpty())
        door.enqueue(json(signInFirst, 401))
        refused(api)
        assertNull("an ended session is not sent again", door.takeRequest().headers["Cookie"])

        // A 401 of botdot's own, with no sign-in in it, ends no session.
        signIn(api)
        door.enqueue(json("""{"error":"Wrong code"}""", 401))
        refused(api)
        door.takeRequest()
        assertNull(session.signInNeeded.value)
        assertFalse(kept.isEmpty())
    }

    @Test fun signOutEverywhereEndsTheSession() = runBlocking {
        val session = Session(keep)
        val api = Api(url, session)
        signIn(api)
        door.enqueue(json("""{"ok":true,"ended":3}""", 200, "Set-Cookie" to "botdot_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"))
        api.signOutEverywhere()
        val r = door.takeRequest()
        assertEquals("POST" to "/sign-out-everywhere", r.method to r.target)
        assertEquals("1", r.headers["X-Bot-Dot"])
        assertEquals("botdot_session=s3cret", r.headers["Cookie"])
        assertTrue(kept.isEmpty())
        assertEquals(url, session.signInNeeded.value)
    }

    @Test fun aPasskeyThatDidNotSignInSaysWhy() = runBlocking {
        val api = Api(url, Session(keep))
        door.enqueue(json(options))
        door.enqueue(json("""{"error":"That passkey didn't sign you in."}""", 401))
        try { api.signInWithPasskey { credential }; fail("refused") } catch (e: ApiException) {
            assertEquals("That passkey didn't sign you in.", e.message)
        }
        assertTrue(kept.isEmpty())
    }
}
