package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/**
 * The owner's own MCP servers (ADR 265, docs/api.md): `GET /api/connectors/servers` read as `lib/routes/custom-servers.js`
 * sends it, the four calls' paths, methods and bodies, and the line under a server's name.
 */
class CustomServersTest {
    // What the server sends (lib/custom-servers.js `view`, with `usedBy` of the route): `header` only when set, `toolCount` null until counted.
    private val answer = """{"servers":[
        {"id":"mcp-1a2b3c4d","name":"Linear","url":"https://mcp.linear.example/mcp","hasKey":true,"header":"X-Api-Key","toolCount":12,"addedAt":"2026-11-24T08:00:00.000Z","usedBy":["b1","b2"]},
        {"id":"mcp-9f8e7d6c","name":"Docs","url":"https://docs.example.com/mcp","hasKey":false,"toolCount":null,"addedAt":"2026-11-24T09:30:00.000Z","usedBy":[]}]}"""

    private fun bots(vararg ids: String) = ids.map { Bot(id = it, name = it.uppercase()) }
    private fun server(hasKey: Boolean, vararg usedBy: String) = CustomServer(id = "mcp-1a2b3c4d", name = "Linear", hasKey = hasKey, usedBy = usedBy.toList())

    @Test fun theServersAnswerIsRead() = runTest {
        val server = FakeServer { 200 to answer }
        val (linear, docs) = server.api.customServers()
        assertEquals(CustomServer("mcp-1a2b3c4d", "Linear", "https://mcp.linear.example/mcp", hasKey = true, toolCount = 12, usedBy = listOf("b1", "b2")), linear)
        assertEquals(CustomServer("mcp-9f8e7d6c", "Docs", "https://docs.example.com/mcp", hasKey = false, toolCount = null, usedBy = emptyList()), docs)
        assertEquals(listOf("GET" to "/api/connectors/servers"), server.sent().map { it.method to it.path })
    }

    @Test fun noServersIsAnEmptyList() = runTest {
        assertEquals(emptyList(), FakeServer { 200 to """{"servers":[]}""" }.api.customServers())
    }

    @Test fun anAnswerThatCannotBeReadThrowsAndIsNotAnEmptyList() = runTest {
        // A server without its id is no server: the call fails, so the screen can say so instead of drawing nothing.
        assertFailsWith<SerializationException> { FakeServer { 200 to """{"servers":[{"name":"Linear","url":"https://x.example/mcp"}]}""" }.api.customServers() }
        assertFailsWith<SerializationException> { FakeServer { 200 to "<html>not botdot</html>" }.api.customServers() }
        // A refusal is the server's own words.
        val e = assertFailsWith<ApiException> { FakeServer { 404 to """{"error":"Unknown endpoint"}""" }.api.customServers() }
        assertEquals("Unknown endpoint", e.message)
    }

    @Test fun addingPostsTheNameTheAddressAndTheKey() = runTest {
        val server = FakeServer { 201 to """{"id":"mcp-1a2b3c4d","name":"Linear","url":"https://mcp.linear.example/mcp","hasKey":true,"toolCount":12,"addedAt":"2026-11-24T08:00:00.000Z","usedBy":["b1"]}""" }
        val added = server.api.addCustomServer("Linear", "https://mcp.linear.example/mcp", "lin_secret")
        assertEquals(CustomServer("mcp-1a2b3c4d", "Linear", "https://mcp.linear.example/mcp", hasKey = true, toolCount = 12, usedBy = listOf("b1")), added)
        val sent = server.sent().single()
        assertEquals("POST", sent.method)
        assertEquals("/api/connectors/servers", sent.path)
        assertEquals(
            JsonObject(mapOf("name" to JsonPrimitive("Linear"), "url" to JsonPrimitive("https://mcp.linear.example/mcp"), "key" to JsonPrimitive("lin_secret"))),
            Json.parseToJsonElement(sent.body),
        )
    }

    @Test fun aBlankKeyIsNotSentAtAll() = runTest {
        val server = FakeServer { 201 to """{"id":"mcp-9f8e7d6c","name":"Docs","url":"https://docs.example.com/mcp","hasKey":false}""" }
        for (blank in listOf("", "   ")) server.api.addCustomServer("Docs", "https://docs.example.com/mcp", blank)
        for (took in server.sent()) {
            val body = Json.parseToJsonElement(took.body).jsonObject
            assertFalse("key" in body, "no key field in ${took.body}")
            assertEquals(setOf("name", "url"), body.keys)
        }
    }

    @Test fun aRefusedServerThrowsTheServersWords() = runTest {
        val e = assertFailsWith<ApiException> { FakeServer { 400 to """{"error":"The address must start with https://.","code":"bad-address"}""" }.api.addCustomServer("X", "http://x.example", "") }
        assertEquals("The address must start with https://.", e.message)
        assertEquals(400, e.status)
    }

    @Test fun removingDeletesTheServerById() = runTest {
        val server = FakeServer { 200 to """{"ok":true}""" }
        server.api.removeCustomServer("mcp-1a2b3c4d")
        val sent = server.sent().single()
        assertEquals("DELETE", sent.method)
        assertEquals("/api/connectors/servers/mcp-1a2b3c4d", sent.path)
    }

    @Test fun theBotsThatHaveItArePutAsAListAndNoneIsAnEmptyList() = runTest {
        val server = FakeServer { 200 to """{"ok":true,"usedBy":[]}""" }
        server.api.setCustomServerBots("mcp-1a2b3c4d", listOf("b1", "b2"))
        server.api.setCustomServerBots("mcp-1a2b3c4d", emptyList())
        val (some, none) = server.sent()
        for (took in listOf(some, none)) {
            assertEquals("PUT", took.method)
            assertEquals("/api/connectors/servers/mcp-1a2b3c4d/bots", took.path)
        }
        assertEquals(JsonObject(mapOf("bots" to JsonArray(listOf(JsonPrimitive("b1"), JsonPrimitive("b2"))))), Json.parseToJsonElement(some.body))
        assertEquals(JsonObject(mapOf("bots" to JsonArray(emptyList()))), Json.parseToJsonElement(none.body))
        assertEquals(0, Json.parseToJsonElement(none.body).jsonObject["bots"]!!.jsonArray.size)
    }

    @Test fun theLineSaysIfItHasAKeyAndWhoHasIt() {
        val all = bots("b1", "b2", "b3")
        assertEquals("has a key · no bot has it", Apps.serverLine(server(true), all))
        assertEquals("no key · no bot has it", Apps.serverLine(server(false), all))
        assertEquals("has a key · 1 bot has it", Apps.serverLine(server(true, "b2"), all))
        assertEquals("no key · 2 bots have it", Apps.serverLine(server(false, "b1", "b3"), all))
        assertEquals("has a key · all bots have it", Apps.serverLine(server(true, "b1", "b2", "b3"), all))
    }

    @Test fun allBotsNeedsMoreThanOneBotAndIgnoresABotThatIsGone() {
        // One bot that has it is "1 bot", not "all bots"; a server's list may name a bot that was deleted.
        assertEquals("no key · 1 bot has it", Apps.serverLine(server(false, "b1"), bots("b1")))
        assertEquals("no key · 2 bots have it", Apps.serverLine(server(false, "b1", "gone"), bots("b1", "b2")))
        assertEquals("no key · all bots have it", Apps.serverLine(server(false, "b1", "b2", "gone"), bots("b1", "b2")))
        assertEquals("no key · 1 bot has it", Apps.serverLine(server(false, "b1"), emptyList()))
    }

    @Test fun theFeatureNameIsTheServersOwn() {
        assertEquals("custom-mcp-servers", Apps.CUSTOM_SERVERS)
        assertNull(CustomServer(id = "mcp-x").toolCount)
        assertTrue(CustomServers().servers.isEmpty())
    }
}
