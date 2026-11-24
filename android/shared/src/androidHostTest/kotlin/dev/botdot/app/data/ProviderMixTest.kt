package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Several providers at once, the model deciding which runs (ADR 267, `provider-mix`; docs/api.md, Settings and Setup): the model
 * list is every connected provider's models, grouped, each with its provider's name; Settings says what is connected; a provider
 * is saved without switching and removed by its preset. `test/provider-mix.test.js` holds the server's side, `test/llm-provider-web.test.js`
 * the web page's.
 */
class ProviderMixTest {
    private val pro = "provider:deepseek:deepseek-v4-pro"
    private val glm = "provider:glm:glm-5"
    private val settings = """{
        "settings":{"defaultModel":"$pro","defaultEffort":"high","chiefModel":"","chiefEffort":""},
        "models":[
            {"id":"opus","label":"Opus","group":"Current models","effort":true},
            {"id":"claude-haiku","label":"Haiku","group":"Current models","effort":false},
            {"id":"$pro","label":"DeepSeek V4 Pro","group":"DeepSeek","provider":"deepseek","effort":true,"efforts":["high","max"]},
            {"id":"$glm","label":"GLM 5","group":"GLM","provider":"glm","effort":false,"efforts":[]}],
        "efforts":[{"id":"low","label":"Low"},{"id":"high","label":"High"},{"id":"max","label":"Max"}],
        "provider":{"name":"DeepSeek","main":"$pro","helper":"provider:deepseek:deepseek-flash"},
        "providers":[{"preset":"deepseek","name":"DeepSeek","refreshable":true},{"preset":"glm","name":"GLM"}]
    }"""
    private fun info() = Api.JSON.decodeFromString<SettingsInfo>(settings)
    private fun status(body: String) = Api.JSON.decodeFromString<ClaudeStatus>(body)

    @Test fun everyConnectedProvidersModelsAreListedWithTheirProvider() {
        val info = info()
        assertTrue(info.mixed)
        assertEquals(listOf("deepseek", "glm"), info.providers!!.map { it.preset })
        assertEquals(listOf(null, null, "deepseek", "glm"), info.models.map { it.provider })
        // The list a picker draws: each model under its provider's name, Claude's first.
        assertEquals(listOf("Current models", "Current models", "DeepSeek", "GLM"), AppSettingsRules.models(info).drop(1).map { it.group })
    }

    @Test fun aModelIsNamedWithItsProviderAndTheSummaryAddsTheReasoningLevel() {
        val info = info()
        assertEquals("DeepSeek V4 Pro · DeepSeek", info.modelLabel(pro))
        assertEquals("Opus", info.modelLabel("opus"))
        assertEquals("DeepSeek V4 Pro · DeepSeek · High", info.summary(pro, "high"))
        // A level the model lacks is not said, nor one a model without reasoning is given.
        assertEquals("DeepSeek V4 Pro · DeepSeek", info.summary(pro, "low"))
        assertEquals("GLM 5 · GLM", info.summary(glm, "high"))
    }

    @Test fun aModelWhoseProviderWasRemovedIsNoChoiceAndAClaudeNameStays() {
        val info = info()
        assertEquals("", info.shownModel("provider:ollama:qwen3"))
        assertEquals("sonnet", info.shownModel("sonnet"))
        // A Claude name is not turned into a provider's model any more: the model decides the provider.
        assertEquals("haiku", info.shownModel("haiku"))
    }

    @Test fun reasoningFollowsTheModelAndABotWithoutOneFollowsTheDefault() {
        val info = info()
        assertEquals(listOf("high", "max"), info.availableEfforts(pro).map { it.id })
        // "" is the account default's model: its levels, and the reasoning it takes.
        assertEquals(listOf("high", "max"), info.availableEfforts("").map { it.id })
        assertTrue(info.canThink(""))
        assertTrue(info.canThink(pro))
        assertFalse(info.canThink(glm))
        assertEquals("high", info.shownEffort("high", pro))
        assertEquals("", info.shownEffort("low", pro))
    }

    @Test fun theOlderSingleProviderAnswerKeepsItsMeaning() {
        val old = Api.JSON.decodeFromString<SettingsInfo>("""{
            "provider":{"name":"DeepSeek","main":"$pro","helper":"provider:deepseek:deepseek-flash"},
            "models":[{"id":"$pro","label":"deepseek-v4-pro","effort":true}],"efforts":[{"id":"max","label":"Max"}]}""")
        assertFalse(old.mixed)
        assertEquals(pro, old.shownModel("opus"))
        assertEquals("provider:deepseek:deepseek-flash", old.shownModel("haiku"))
        assertEquals("Default (deepseek-v4-pro)", old.defaultModelLabel())
        assertEquals("Claude Code's default", info().defaultModelLabel())
    }

    @Test fun settingsNameTheClaudeConnectionAndEveryConnectedProvider() {
        val both = status("""{"installed":true,"loggedIn":true,"email":"me@example.com","using":"provider","connection":"subscription","subscription":true,
            "providers":[{"preset":"deepseek","name":"DeepSeek","key":"…wxyz"},{"preset":"glm","name":"GLM","key":"…abcd"}]}""")
        assertTrue(both.mixed)
        assertFalse(both.claudeOnKey)
        assertEquals("Signed in with me@example.com. Connected: DeepSeek, GLM.", claudeSays(both))
        assertEquals("me@example.com, DeepSeek, GLM", claudeValue(both))
        assertEquals(listOf("deepseek", "glm"), both.savedProviders.map { it.preset })

        val key = status("""{"installed":true,"loggedIn":true,"email":"me@example.com","using":"api-key","connection":"api-key","apiKey":"…1234","subscription":true,"providers":[]}""")
        assertTrue(key.claudeOnKey)
        assertEquals("Claude runs on your Anthropic API key …1234. Your Claude subscription (me@example.com) is signed in too; bots don't use it.", claudeSays(key))
        assertEquals("API key", claudeValue(key))

        // Signed out, with a provider: Claude's own models can't run, the provider's can.
        val out = status("""{"installed":true,"loggedIn":false,"using":"provider","connection":"subscription","subscription":false,"providers":[{"preset":"glm","name":"GLM"}]}""")
        assertTrue(out.claudeOut)
        assertEquals("Not signed in, so Claude's models can't run. Connected: GLM.", claudeSays(out))
    }

    @Test fun anOlderServersSingleProviderIsStillSaid() {
        val old = status("""{"installed":true,"loggedIn":true,"using":"provider","subscription":false,"provider":{"preset":"ollama","name":"Ollama","key":null,"big":"m","small":"m"}}""")
        assertFalse(old.mixed)
        assertEquals("Bots run on Ollama.", claudeSays(old))
        assertEquals(listOf("ollama"), old.savedProviders.map { it.preset })
    }

    @Test fun aProviderIsRemovedByItsPresetAndAnOlderCallStillWorks() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            val answer = MockResponse.Builder().addHeader("Content-Type", "application/json")
                .body("""{"claude":{"installed":true,"loggedIn":true,"using":"subscription","connection":"subscription","providers":[{"preset":"glm","name":"GLM"}]}}""")
            server.enqueue(answer.build())
            assertEquals(listOf("glm"), api.claudeRemoveProvider("deepseek")?.providers?.map { it.preset })
            val removed = server.takeRequest()
            assertEquals("DELETE" to "/api/setup/claude/provider/deepseek", removed.method to removed.target)
            server.enqueue(answer.build())
            api.claudeRemoveProvider()
            assertEquals("/api/setup/claude/provider", server.takeRequest().target)
        } finally { server.close() }
    }
}
