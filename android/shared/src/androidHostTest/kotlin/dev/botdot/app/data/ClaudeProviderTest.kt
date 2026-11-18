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
 * Claude on another model provider (ADR 255; docs/api.md, Setup and updates): Settings → Claude says which one bots
 * run on and names a saved provider as not used, the setup answer carries the presets the server offers, and the
 * provider is saved, picked and removed with the server's routes. `test/llm-provider-web.test.js` holds the web page's side.
 */
class ClaudeProviderTest {
    private fun status(body: String) = Api.JSON.decodeFromString<ClaudeStatus>(body)
    private val saved = """{"preset":"deepseek","name":"DeepSeek","key":"…wxyz","big":"deepseek-v4-pro","small":"deepseek-flash"}"""

    @Test fun onAProviderItSaysSoAndNamesASubscriptionThatIsNotUsed() {
        val both = status("""{"installed":true,"loggedIn":true,"email":"me@example.com","using":"provider","subscription":true,"provider":$saved}""")
        assertTrue(both.onProvider)
        assertFalse(both.onApiKey)
        assertTrue(both.knowsKeys)
        assertEquals("Bots run on DeepSeek (…wxyz). Your Claude subscription (me@example.com) is signed in too; bots don't use it.", claudeSays(both))
        assertEquals("DeepSeek", claudeValue(both))
        val keyless = status("""{"installed":true,"loggedIn":true,"using":"provider","subscription":false,"provider":{"preset":"ollama","name":"Ollama","key":null,"big":"m","small":"m"}}""")
        assertEquals("Bots run on Ollama.", claudeSays(keyless))
    }

    @Test fun onTheSubscriptionASavedProviderIsNamedAsNotUsed() {
        val sub = status("""{"installed":true,"loggedIn":true,"email":"me@example.com","using":"subscription","subscription":true,"provider":$saved}""")
        assertFalse(sub.onProvider)
        assertEquals("Signed in with me@example.com. DeepSeek is saved too; bots don't use it.", claudeSays(sub))
        assertNull(status("""{"using":"subscription"}""").provider)
        assertEquals("Signed in with me@example.com.", claudeSays(status("""{"installed":true,"loggedIn":true,"email":"me@example.com"}""")))
    }

    @Test fun theSetupAnswerCarriesThePresetsAServerOffers() {
        val info = Api.JSON.decodeFromString<SetupInfo>("""{"done":true,"claude":{"using":"subscription"},"providers":[
            {"id":"deepseek","name":"DeepSeek","url":"https://api.deepseek.com/anthropic","big":"deepseek-v4-pro","small":"deepseek-flash"},
            {"id":"ollama","name":"Ollama","url":"http://host.docker.internal:11434","big":"","small":"","keyless":true},
            {"id":"custom","name":"Other","url":"","big":"","small":"","custom":true}]}""")
        assertEquals(listOf("deepseek", "ollama", "custom"), info.providers.map { it.id })
        assertTrue(info.providers[1].keyless)
        assertTrue(info.providers[2].custom)
        assertTrue(Api.JSON.decodeFromString<SetupInfo>("""{"done":true}""").providers.isEmpty())
    }

    @Test fun settingsShowTheProvidersModelsAndSupportedEfforts() {
        val pro = "provider:deepseek:deepseek-v4-pro"
        val flash = "provider:deepseek:deepseek-flash"
        val info = Api.JSON.decodeFromString<SettingsInfo>("""{
            "provider":{"name":"DeepSeek","main":"$pro","helper":"$flash"},
            "models":[{"id":"$pro","label":"deepseek-v4-pro","effort":true},
                {"id":"$flash","label":"deepseek-flash","effort":true}],
            "efforts":[{"id":"max","label":"Max"}]
        }""")
        assertEquals(pro, info.shownModel("opus"))
        assertEquals(flash, info.shownModel("haiku"))
        assertEquals(flash, info.shownModel(flash))
        assertTrue(info.canThink("haiku"))
        assertEquals("max", info.shownEffort("max"))
        assertEquals("", info.shownEffort("medium"))
        assertEquals("", SettingsInfo().shownModel(flash))
    }

    @Test fun modelDiscoveryReturnsChoicesWithoutSavingTheProvider() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            server.enqueue(MockResponse.Builder().addHeader("Content-Type", "application/json")
                .body("""{"models":[{"id":"qwen3:8b","label":"Qwen3 8B"}],"main":"","helper":""}""").build())
            val catalog = api.claudeProviderModels("ollama", "", "http://ollama:11434")
            assertEquals(listOf(ProviderModel("qwen3:8b", "Qwen3 8B")), catalog.models)
            val request = server.takeRequest()
            assertEquals("POST" to "/api/setup/claude/provider/models", request.method to request.target)
            assertEquals("""{"preset":"ollama","key":"","url":"http://ollama:11434"}""", request.body!!.utf8())
        } finally { server.close() }
    }

    @Test fun theProviderIsSavedPickedAndRemovedWithTheServersRoutes() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            fun answer(using: String, provider: String?) = MockResponse.Builder().addHeader("Content-Type", "application/json")
                .body("""{"claude":{"installed":true,"loggedIn":true,"using":"$using","provider":${provider ?: "null"}}}""").build()
            server.enqueue(answer("provider", saved))
            assertEquals("DeepSeek", api.claudeSaveProvider("deepseek", "secret-wxyz", null, "", "")?.provider?.name)
            val put = server.takeRequest()
            assertEquals("PUT" to "/api/setup/claude/provider", put.method to put.target)
            assertEquals("""{"preset":"deepseek","key":"secret-wxyz","big":"","small":""}""", put.body!!.utf8())
            server.enqueue(answer("provider", saved))
            api.claudeSaveProvider("custom", "k", "https://gateway.example.com/anthropic", "m", "s")
            assertEquals("""{"preset":"custom","key":"k","url":"https://gateway.example.com/anthropic","big":"m","small":"s"}""", server.takeRequest().body!!.utf8())
            server.enqueue(answer("subscription", saved))
            assertEquals("subscription", api.claudeUse("subscription")?.using)
            assertEquals("""{"use":"subscription"}""", server.takeRequest().body!!.utf8())
            server.enqueue(answer("subscription", null))
            assertNull(api.claudeRemoveProvider()?.provider)
            val removed = server.takeRequest()
            assertEquals("DELETE" to "/api/setup/claude/provider", removed.method to removed.target)
        } finally { server.close() }
    }
}
