package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Claude on an Anthropic API key as well as the subscription (#35; docs/api.md, Setup and updates): Settings → Claude
 * says which of the two bots run on and names the other as not used when both are there, and saves, picks and removes
 * the key with the server's routes. `test/claude-api-key-web.test.js` holds the web page's side.
 */
class ClaudeApiKeyTest {
    private fun status(body: String) = Api.JSON.decodeFromString<ClaudeStatus>(body)

    @Test fun onTheKeyItSaysSoAndNamesASubscriptionThatIsNotUsed() {
        val both = status("""{"installed":true,"loggedIn":true,"email":"me@example.com","using":"api-key","apiKey":"…wxyz","subscription":true}""")
        assertTrue(both.onApiKey)
        assertEquals("Bots run on your Anthropic API key …wxyz. Your Claude subscription (me@example.com) is signed in too; bots don't use it.", claudeSays(both))
        val keyOnly = status("""{"installed":true,"loggedIn":true,"using":"api-key","apiKey":"…wxyz","subscription":false}""")
        assertEquals("Bots run on your Anthropic API key …wxyz.", claudeSays(keyOnly))
    }

    @Test fun onTheSubscriptionASavedKeyIsNamedAsNotUsed() {
        val both = status("""{"installed":true,"loggedIn":true,"email":"me@example.com","using":"subscription","apiKey":"…wxyz","subscription":true}""")
        assertFalse(both.onApiKey)
        assertEquals("Signed in with me@example.com. An Anthropic API key (…wxyz) is saved too; bots don't use it.", claudeSays(both))
        assertEquals("Not signed in, so bots can't run.", claudeSays(status("""{"installed":true,"loggedIn":false,"using":"subscription","apiKey":null}""")))
        assertTrue(status("""{"using":"subscription"}""").knowsKeys)
    }

    @Test fun aServerThatSaysNothingOfAKeyIsDrawnAsBefore() {
        val old = status("""{"installed":true,"loggedIn":true,"email":"me@example.com"}""")
        assertFalse(old.knowsKeys)
        assertEquals("Signed in with me@example.com.", claudeSays(old))
        assertEquals("Signed in with a token from the server's settings.", claudeSays(status("""{"loggedIn":true,"fromEnv":true}""")))
    }

    @Test fun theKeyIsSavedPickedAndRemovedWithTheServersRoutes() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            fun answer(using: String, key: String?) = MockResponse.Builder().addHeader("Content-Type", "application/json")
                .body("""{"claude":{"installed":true,"loggedIn":true,"using":"$using","apiKey":${key?.let { "\"$it\"" } ?: "null"}}}""").build()
            server.enqueue(answer("api-key", "…wxyz"))
            assertEquals("…wxyz", api.claudeSaveKey("sk-ant-api03-secret-wxyz")?.apiKey)
            val saved = server.takeRequest()
            assertEquals("PUT" to "/api/setup/claude/key", saved.method to saved.target)
            assertEquals("""{"key":"sk-ant-api03-secret-wxyz"}""", saved.body!!.utf8())
            server.enqueue(answer("subscription", "…wxyz"))
            assertEquals("subscription", api.claudeUse("subscription")?.using)
            val picked = server.takeRequest()
            assertEquals("PUT" to "/api/setup/claude/use", picked.method to picked.target)
            assertEquals("""{"use":"subscription"}""", picked.body!!.utf8())
            server.enqueue(answer("subscription", null))
            assertNull(api.claudeRemoveKey()?.apiKey)
            val removed = server.takeRequest()
            assertEquals("DELETE" to "/api/setup/claude/key", removed.method to removed.target)
        } finally { server.close() }
    }
}
