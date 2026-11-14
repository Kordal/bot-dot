package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.time.Instant

/** Claude's usage limit (#1090): `backAt` of a signed-in `claude` says when the bots carry on, while it is to come. */
class UsageLimitTest {
    private fun data(json: String) = Json.parseToJsonElement(json).jsonObject
    private val now = Instant.parse("2026-11-06T12:00:00Z")

    @Test fun backAtIsReadWhileItIsToCome() {
        assertEquals("2026-11-06T15:00:00Z", claudeBackAt(data("""{"loggedIn":true,"backAt":"2026-11-06T15:00:00Z"}"""), now))
        assertNull("gone by", claudeBackAt(data("""{"loggedIn":true,"backAt":"2026-11-06T11:00:00Z"}"""), now))
        assertNull("a sign-out wins", claudeBackAt(data("""{"loggedIn":false,"backAt":"2026-11-06T15:00:00Z"}"""), now))
        assertNull(claudeBackAt(data("""{"loggedIn":true}"""), now))
        assertNull(claudeBackAt(data("""{"loggedIn":true,"backAt":"soon"}"""), now))
        assertNull(claudeBackAt(null, now))
    }

    @Test fun theStateFollowsTheFeed() {
        val claude = ClaudeState()
        val later = (kotlin.time.Clock.System.now() + kotlin.time.Duration.parse("1h")).toString()
        claude.handle(FeedEvent(null, "hello", data("""{"lastEventId":"boot.9","features":["job-line"],"claude":{"loggedIn":true,"backAt":"$later"}}""")))
        assertEquals(later, claude.backAt.value)
        assertFalse(claude.signedOut.value)
        claude.handle(FeedEvent("boot.10", "claude", data("""{"loggedIn":true}""")))
        assertNull("the reset: no line", claude.backAt.value)
    }
}
