package dev.botdot.app

import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.botdot.app.data.Handoff
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * On a phone or an emulator: the browser's way back from the front door's sign-in page. Android finds the app for
 * botdot://signed-in by its manifest, brings the main activity back, and the app sends the code with the secret it
 * kept to a stand-in front door, which answers with the session's cookie; the app then keeps that session. The
 * passkey in the browser itself is not part of it (the front door's own page and routes are tested in
 * test/front-door-android-browser.test.js).
 */
@RunWith(AndroidJUnit4::class)
class SignInReturnTest {
    private val door = MockWebServer()
    private val handoffs = LinkedBlockingQueue<RecordedRequest>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Before fun start() {
        door.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.method == "POST" && request.target == "/sign-in/handoff") {
                    handoffs.add(request)
                    MockResponse.Builder().addHeader("Content-Type", "application/json")
                        .addHeader("Set-Cookie", "botdot_session=from-the-browser; Path=/; HttpOnly; SameSite=Lax")
                        .body("""{"ok":true,"account":"ann"}""").build()
                } else {
                    // Everything else the app asks meanwhile (its feed, its version): not signed in yet.
                    MockResponse.Builder().code(401).addHeader("Content-Type", "application/json")
                        .body("""{"error":"Sign in first.","signIn":"/sign-in"}""").build()
                }
        }
        door.start()
    }

    @After fun stop() = door.close()

    @Test fun theBrowsersWayBackSignsTheAppIn() = runBlocking {
        val app = BotDotApp.of(context)
        val url = "http://localhost:${door.port}"
        app.settings.setServer(url)
        withTimeout(10_000) { app.api.first { it?.baseUrl?.trimEnd('/') == url } }

        // What the sign-in screen does before it opens the browser: a secret kept, its SHA-256 in the page's address.
        val page = Uri.parse(app.browserSignIn.start()!!)
        assertEquals("android", page.getQueryParameter("app"))
        val challenge = page.getQueryParameter("handoff")!!

        // What the page does after the passkey: the browser opens botdot://signed-in?code=…, through Android.
        val code = "c0de".padEnd(43, 'x')
        val back = Intent(Intent.ACTION_VIEW, Uri.parse("botdot://signed-in?code=$code"))
            .addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val found = context.packageManager.queryIntentActivities(back, 0).map { it.activityInfo.name }
        assertTrue("the manifest takes botdot://signed-in: $found", MainActivity::class.java.name in found)
        context.startActivity(back)

        val sent = handoffs.poll(30, TimeUnit.SECONDS) ?: throw AssertionError("the app never sent the code to the front door")
        val body = JSONObject(sent.body!!.utf8())
        assertEquals(code, body.getString("code"))
        assertEquals("the secret whose SHA-256 the page carried", challenge, Handoff.challengeOf(body.getString("verifier")))
        assertEquals("1", sent.headers["X-Bot-Dot"])

        // The session is kept, and every request now carries it.
        withTimeout(10_000) { while (app.session.token(url) != "from-the-browser") delay(100) }
    }
}
