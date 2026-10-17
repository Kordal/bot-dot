package dev.botdot.app.feed

import dev.botdot.app.data.ClaudeState
import dev.botdot.app.data.FeedEvent
import dev.botdot.app.data.claudeSignedOut
import dev.botdot.app.data.saysSignedOut
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Claude signed out (docs/api.md: `claude` in the feed's "hello", and the `claude` event, both `{ loggedIn }`): one
 * standing line above the message box, and one notification per sign-out.
 */
class SignedOutNotifierTest {
    private fun data(json: String) = Json.parseToJsonElement(json).jsonObject
    private fun event(type: String, json: String, id: String? = "boot.9") = FeedEvent(id, type, data(json))

    @Test fun theFeedSaysWhetherClaudeIsSignedOut() {
        assertEquals(true, claudeSignedOut(data("""{"loggedIn":false}""")))
        assertEquals(false, claudeSignedOut(data("""{"loggedIn":true}""")))
        // "hello" before the server could tell, and anything this app does not expect: it does not say.
        assertNull(claudeSignedOut(data("""{"claude":null}""")["claude"]))
        assertNull(claudeSignedOut(null))
        assertNull(claudeSignedOut(data("""{}""")))
        assertNull(claudeSignedOut(data("""{"loggedIn":"false"}""")))
    }

    @Test fun oneNotificationPerSignOut() {
        // What rang is kept as the notifier keeps it: once said, a sign-out is not said again.
        var rung = false
        fun hears(signedOut: Boolean?): SignedOutStep = signedOutStep(signedOut, rung).also {
            if (it == SignedOutStep.RING) rung = true
            if (it == SignedOutStep.TAKE) rung = false
        }
        assertEquals(SignedOutStep.RING, hears(true))
        assertEquals("the next hello says it again: not a second time", SignedOutStep.NONE, hears(true))
        assertEquals(SignedOutStep.NONE, hears(null))
        assertEquals("signed in again: it is taken away", SignedOutStep.TAKE, hears(false))
        assertEquals("the next sign-out is said again", SignedOutStep.RING, hears(true))
        // Signed in and nothing showing: taking away what is not there does no harm.
        rung = false
        assertEquals(SignedOutStep.TAKE, hears(false))
    }

    @Test fun itIsSaidAlsoWhileTheWebPageIsInUse() {
        // What needs the owner stays silent while the web page is in use, where it shows already; this does not.
        assertTrue(staysSilent(webActive = true, evenOnWeb = false))
        assertFalse(staysSilent(webActive = true, evenOnWeb = true))
        assertFalse(staysSilent(webActive = false, evenOnWeb = false))
        // The step asks nothing about the web page, and the event is one the owner is told of.
        assertTrue(shouldNotifyOwner(event("claude", """{"loggedIn":false,"webActive":true}""")))
        assertEquals(SignedOutStep.RING, signedOutStep(claudeSignedOut(data("""{"loggedIn":false,"webActive":true}""")), rung = false))
        assertEquals("Claude is signed out: bots can't work.", SIGNED_OUT_TEXT)
    }

    @Test fun aServerFromBeforeSaysTheSameWordsAndItsScreensStayAsTheyWere() {
        // `claude` in the feed is older than Milestone 7: only a botdot that names one of its features has the line and the notification.
        assertTrue(saysSignedOut(listOf("events", "message-waits")))
        assertTrue(saysSignedOut(listOf("ended-by")))
        assertTrue(saysSignedOut(listOf("unread", "job-line")))
        assertFalse(saysSignedOut(listOf("events", "unread", "message-key", "ask-continues", "connector-waits")))
        assertFalse(saysSignedOut(null))
        val claude = ClaudeState()
        claude.handle(event("hello", """{"lastEventId":"boot.9","features":["unread","connector-waits"],"claude":{"loggedIn":false}}""", id = null))
        assertFalse(claude.signedOut.value)
        claude.handle(event("claude", """{"loggedIn":false}""", id = "boot.10"))
        assertFalse(claude.signedOut.value)
        // Updated to Milestone 7 while Claude is signed out: its next "hello" says it.
        claude.handle(event("hello", """{"lastEventId":"boot2.1","features":["unread","job-line"],"claude":{"loggedIn":false}}""", id = null))
        assertTrue(claude.signedOut.value)
    }

    @Test fun theLineStandsWhileClaudeIsSignedOut() {
        val claude = ClaudeState()
        assertFalse(claude.signedOut.value)
        claude.handle(event("hello", """{"lastEventId":"boot.9","features":["message-waits","ended-by","job-line"],"claude":{"loggedIn":false}}""", id = null))
        assertTrue(claude.signedOut.value)
        // An event the feed replays from before "hello" is older than what "hello" said.
        claude.handle(event("claude", """{"loggedIn":true}""", id = "boot.7"))
        assertTrue(claude.signedOut.value)
        claude.handle(event("claude", """{"loggedIn":true}""", id = "boot.10"))
        assertFalse("signed in: the line goes", claude.signedOut.value)
        claude.handle(event("claude", """{"loggedIn":false}""", id = "boot.11"))
        assertTrue(claude.signedOut.value)
        // A "hello" that does not say leaves what was known; another botdot starts from nothing.
        claude.handle(event("hello", """{"lastEventId":"boot.12","features":["job-line"],"claude":null}""", id = null))
        assertTrue(claude.signedOut.value)
        claude.clear()
        assertFalse(claude.signedOut.value)
        // A server that never names it: no line.
        claude.handle(event("hello", """{"lastEventId":"boot.1","features":["job-line"]}""", id = null))
        assertFalse(claude.signedOut.value)
    }
}
