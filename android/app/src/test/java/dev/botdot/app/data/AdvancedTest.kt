package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Advanced (ADR 205): a server without the switch shows every row; with it, the account's choice; before the settings
 * are read nothing is taken away; and a save of the switch sends it alone.
 */
class AdvancedTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    @Test fun followsTheServerAndTheAccount() {
        assertTrue(Advanced.shows(listOf("language"), AppSettings(advanced = false)))
        assertTrue(Advanced.shows(null, null))
        assertFalse(Advanced.shows(listOf("advanced"), AppSettings(advanced = false)))
        assertTrue(Advanced.shows(listOf("advanced"), AppSettings(advanced = true)))
        assertTrue(Advanced.shows(listOf("advanced"), null))
    }

    @Test fun readsTheSettingsAndSavesTheSwitchAlone() = runBlocking {
        server.enqueue(json("""{"settings":{"advanced":false,"language":"en"},"models":[],"efforts":[]}"""))
        Advanced.sync(api, listOf("advanced"))
        assertFalse(Advanced.on.value)
        server.takeRequest()
        server.enqueue(json("""{"settings":{"advanced":true},"models":[],"efforts":[]}"""))
        val saved = api.saveSettings(AppSettings(advanced = true))
        assertEquals(true, saved.settings.advanced)
        val body = Json.parseToJsonElement(server.takeRequest().body!!.utf8()) as JsonObject
        assertEquals(setOf("advanced"), body.keys)
        assertTrue(body["advanced"]!!.jsonPrimitive.boolean)
        Advanced.take(listOf("advanced"), saved.settings)
        assertTrue(Advanced.on.value)
        assertNull(AppSettings().advanced)
    }
}
