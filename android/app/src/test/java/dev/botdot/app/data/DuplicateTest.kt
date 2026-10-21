package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * "Duplicate" (#227), against a stand-in botdot: asked only of a server that has it, the confirmation is the
 * server's lines, and the copy is made with the name typed (or the suggested one when it is left blank).
 */
class DuplicateTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    @Test fun showsOnlyOnAServerThatHasIt() {
        assertTrue(Duplicate.shows(listOf("duplicate-bot")))
        assertFalse(Duplicate.shows(listOf("whats-new")))
        assertFalse(Duplicate.shows(null))
    }

    @Test fun theConfirmationIsTheServersLines() = runBlocking {
        server.enqueue(json("""{"name":"Coder 2","copies":["Its main assignment, rules and description","The Vault entries it may use: Portal"],"notCopied":"Its memory, chats, runs, jobs, Board tiles, files and groups","logins":["Portal"],"vaultLocked":false,"later":1}"""))
        val plan = api.copyPlan("c1")
        assertEquals("GET" to "/api/bots/c1/duplicate", server.takeRequest().let { it.method to it.target })
        assertEquals("Coder 2", plan.name)
        assertEquals(listOf("Portal"), plan.logins)
        val text = Duplicate.text(plan)
        assertTrue(text, text.contains("• The Vault entries it may use: Portal"))
        assertTrue(text, text.endsWith("Not copied: Its memory, chats, runs, jobs, Board tiles, files and groups."))
        assertTrue(Duplicate.text(plan.copy(vaultLocked = true)).contains("Bitwarden is locked"))
    }

    @Test fun makesTheCopyWithTheNameTyped() = runBlocking {
        server.enqueue(json("""{"id":"c2","name":"Reviewer","prompt":"Write code."}""", 201))
        val made = api.duplicateBot("c1", " Reviewer ")
        val r = server.takeRequest()
        assertEquals("POST" to "/api/bots/c1/duplicate", r.method to r.target)
        assertEquals("Reviewer", Api.JSON.parseToJsonElement(r.body!!.utf8()).jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals("c2", made.id)
        server.enqueue(json("""{"id":"c3","name":"Coder 3"}""", 201))
        api.duplicateBot("c1", "")
        assertEquals("{}", server.takeRequest().body!!.utf8())
    }
}
