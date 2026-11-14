package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

/**
 * What the login editor's Save sends (VaultLogin.save, both phones), against a stand-in botdot: the type and username
 * as VaultTypes.sent says, the category only to a server that keeps them, no switch and no bots, and the secret only
 * when one was typed.
 */
class VaultLoginSaveTest {
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

    private val all = listOf(VaultTypes.FEATURE, VaultTypes.CATEGORIES_FEATURE)

    @Test fun aNewLoginGoesWithItsSecretTypeAndCategory() = runBlocking {
        server.enqueue(json("{}"))
        VaultLogin(" Food ", " food.example.org ", "login", "alice", "s3cret", "a.example.org, b.example.org", " Shopping ").save(api, null, all)
        val sent = server.takeRequest()
        assertEquals("POST" to "/api/vault", sent.method to sent.target)
        assertEquals("""{"type":"login","category":"Shopping","name":"Food","site":"food.example.org","username":"alice","allowedHosts":["a.example.org","b.example.org"],"password":"s3cret"}""", sent.body!!.utf8())
    }

    @Test fun aSavedLoginKeepsItsSecretAndBotsAndOtherSendsNoUsername() = runBlocking {
        val saved = VaultItem(id = "l1", name = "NAS", type = "other", site = "nas.example.net", username = "kept", allowedBots = listOf("b1"))
        server.enqueue(json("{}"))
        VaultLogin.of(saved).save(api, saved, all)
        val sent = server.takeRequest()
        assertEquals("PUT" to "/api/vault/l1", sent.method to sent.target)
        assertEquals("""{"type":"other","category":"","name":"NAS","site":"nas.example.net","allowedHosts":[]}""", sent.body!!.utf8())
    }

    @Test fun aServerBeforeTypesAndCategoriesGetsNeither() = runBlocking {
        server.enqueue(json("{}"))
        VaultLogin("Proxmox", "pve.example.ts.net", "api-token", "root", "t", "", "Servers").save(api, null, listOf("unread"))
        assertEquals("""{"name":"Proxmox","site":"pve.example.ts.net","username":"root","allowedHosts":[],"password":"t"}""", server.takeRequest().body!!.utf8())
    }

    @Test fun aRefusedSaveThrowsTheServersSentence() {
        server.enqueue(json("""{"error":"Website is required"}""", 400))
        val e = assertThrows(ApiException::class.java) { runBlocking { VaultLogin("X", "x", secret = "p").save(api, null, all) } }
        assertEquals("Website is required", e.message)
    }
}
