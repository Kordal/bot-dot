package dev.botdot.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import dev.botdot.app.feed.Feed
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String) = MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build()

    @Test fun chiefActivitySurvivesChatReloadAndStreamDecoding() = runBlocking {
        server.enqueue(json("""{"id":"c1","busy":true,"messages":[{"role":"chief","pending":true,"activity":{"tool":"wait_for_run","text":"Waiting for Proxmox Keeper"}}]}"""))
        val activity = api.chiefChat("c1").messages.single().activity
        assertEquals(ChiefActivity("wait_for_run", "Waiting for Proxmox Keeper"), activity)
        server.enqueue(json("""{"id":"c1","messages":[{"role":"chief","pending":true}]}"""))
        assertNull(api.chiefChat("c1").messages.single().activity)

        server.enqueue(MockResponse.Builder().addHeader("Content-Type", "text/event-stream").body(
            "data: {\"type\":\"activity\",\"tool\":\"thinking\",\"text\":\"Thinking\"}\n\n" +
                "data: {\"type\":\"activity\",\"tool\":\"wait_for_run\"}\n\n"
        ).build())
        val events = withTimeout(5000) { api.chiefStream("c1").take(2).toList() }
        assertEquals("Thinking", events[0].second.str("text"))
        assertEquals("wait_for_run", events[1].second.str("tool"))
        assertEquals("", events[1].second.str("text"))
    }

    @Test fun aMessageGoesWithItsKeyAndAnAnswerWithAgainIsAMessageThatWent() = runBlocking {
        // botdot had the message already: the chat as it is now, or the run the first send started, with again.
        server.enqueue(json("""{"id":"c1","again":true,"messages":[{"role":"user","text":"hi"}]}"""))
        api.sendToChief("c1", "hi", emptyList(), "typed-message-key")
        val chief = server.takeRequest()
        assertEquals("POST" to "/api/chief/chats/c1/messages", chief.method to chief.target)
        assertEquals("""{"text":"hi","attachments":[],"key":"typed-message-key"}""", chief.body!!.utf8())

        server.enqueue(json("""{"id":"r1","botId":"coder","status":"success","again":true}"""))
        assertEquals("r1", api.runBot("coder", "Fix it", emptyList(), "another-message-key").id)
        assertEquals("""{"prompt":"Fix it","attachments":[],"key":"another-message-key"}""", server.takeRequest().body!!.utf8())

        // Without a key, as before: the field is left out.
        server.enqueue(json("""{"id":"c1"}"""))
        api.sendToChief("c1", "hi", emptyList())
        assertEquals("""{"text":"hi","attachments":[]}""", server.takeRequest().body!!.utf8())
    }

    @Test fun addressesAreMadeWhole() {
        assertEquals("https://my-vm.tail1234.ts.net", Api.normalize(" my-vm.tail1234.ts.net/ "))
        assertNull(Api.normalize("http://10.0.2.2:4747/some/path?x=1"))
        assertEquals("http://127.0.0.1:4747", Api.normalize("http://127.0.0.1:4747/some/path?x=1"))
        assertNull(Api.normalize("   "))
    }

    @Test fun olderRunsAndPartsOfAChiefChat() = runBlocking {
        server.enqueue(json("""[{"id":"r1","status":"success"}]"""))
        assertEquals(listOf("r1"), api.runs("my bot", limit = 40, before = "r2").map { it.id })
        assertEquals("/api/runs?botId=my%20bot&limit=40&before=r2", server.takeRequest().target)

        server.enqueue(json("""{"id":"c1","messages":[{"role":"user","text":"hi"}],"offset":7,"total":8}"""))
        val part = api.chiefChat("c1", offset = 7)
        assertEquals(listOf(7, 8, 1), listOf(part.offset, part.total, part.messages.size))
        assertEquals("/api/chief/chats/c1?offset=7", server.takeRequest().target)

        // An older botdot: all of it, without offset or total.
        server.enqueue(json("""{"id":"c1","messages":[]}"""))
        val old = api.chiefChat("c1", limit = 40)
        assertEquals(listOf(0, -1), listOf(old.offset, old.total))
        assertEquals("/api/chief/chats/c1?limit=40", server.takeRequest().target)
    }

    @Test fun anErrorInWordsIsWhatTheAppShows() = runBlocking {
        server.enqueue(MockResponse.Builder().code(404).body("""{"error":"Bot not found"}""").build())
        val e = runCatching { api.runs("x") }.exceptionOrNull() as ApiException
        assertEquals("Bot not found" to 404, e.message to e.status)
    }

    @Test fun vaultLoginsRoundTripThroughTheOwnerApi() = runBlocking {
        server.enqueue(json("""[{"id":"login1","name":"Example","site":"example.com","allowedBots":["b1"],"allowedHosts":["api.example.com"]},{"id":"c1","name":"Visa","kind":"card","last4":"4242","allowedBots":[]}]"""))
        val items = api.vault()
        assertEquals(listOf("api.example.com"), items[0].allowedHosts)
        assertEquals("card" to "4242", items[1].kind to items[1].last4)
        assertEquals("a server from before the types sends none: a login", "login", items[0].type)
        assertEquals("/api/vault", server.takeRequest().target)
        // With types, one of them unknown to this app, and requests that carry one: all of it is read.
        server.enqueue(json("""[{"id":"t1","name":"Proxmox","kind":"login","type":"api-token","site":"pve.example.ts.net"},{"id":"t2","name":"Odd","kind":"login","type":"ssh-key","site":"odd.example.org"},{"id":"t3","name":"Old","site":"old.example.org"}]"""))
        assertEquals(listOf("api-token", "ssh-key", "login"), api.vault().map { it.type })
        server.takeRequest()
        server.enqueue(json("""[{"id":"r1","site":"git.example.org","type":"api-token"},{"id":"r2","site":"old.example.org"},{"id":"r3","site":"odd.example.org","type":"passkey"}]"""))
        assertEquals(listOf("api-token", "login", "login"), api.loginRequests().map { VaultTypes.of(it.type).id })
        server.takeRequest()
        // An empty password keeps the saved one: it isn't sent at all.
        server.enqueue(json("{}"))
        api.saveVaultLogin("login1", "Example", "example.com", "me", "", false, listOf("b1"), listOf("api.example.com", "internal.lan"))
        val saved = server.takeRequest()
        assertEquals("PUT" to "/api/vault/login1", saved.method to saved.target)
        assertEquals("""{"name":"Example","site":"example.com","username":"me","insecureTls":false,"allowedBots":["b1"],"allowedHosts":["api.example.com","internal.lan"]}""", saved.body!!.utf8())
        server.enqueue(json("{}"))
        api.saveVaultLogin(null, "New", "new.example", "me", "secret", true, emptyList(), emptyList())
        val added = server.takeRequest()
        assertEquals("POST" to "/api/vault", added.method to added.target)
        assertTrue(added.body!!.utf8().endsWith(""","password":"secret"}"""))
        // The type and the username go as VaultTypes.sent says: a type for a server that keeps types, and no
        // username for Other, so that the saved one stays.
        server.enqueue(json("{}"))
        VaultTypes.sent("api-token", "root@pam!botdot", listOf("vault-types")).let { api.saveVaultLogin("login1", "Example", "example.com", it.username, "", false, emptyList(), emptyList(), it.type) }
        assertEquals("""{"type":"api-token","name":"Example","site":"example.com","username":"root@pam!botdot","insecureTls":false,"allowedBots":[],"allowedHosts":[]}""", server.takeRequest().body!!.utf8())
        server.enqueue(json("{}"))
        VaultTypes.sent("other", "kept", listOf("vault-types")).let { api.saveVaultLogin("login1", "Example", "example.com", it.username, "", false, emptyList(), emptyList(), it.type) }
        assertEquals("""{"type":"other","name":"Example","site":"example.com","insecureTls":false,"allowedBots":[],"allowedHosts":[]}""", server.takeRequest().body!!.utf8())
        server.enqueue(json("{}"))
        VaultTypes.sent("api-token", "me", listOf("unread")).let { api.saveVaultLogin("login1", "Example", "example.com", it.username, "", false, emptyList(), emptyList(), it.type) }
        assertEquals("a server from before the types gets none", """{"name":"Example","site":"example.com","username":"me","insecureTls":false,"allowedBots":[],"allowedHosts":[]}""", server.takeRequest().body!!.utf8())
        server.enqueue(json("{}"))
        api.setVaultBots("c1", listOf("b1"))
        assertEquals("""{"allowedBots":["b1"]}""", server.takeRequest().body!!.utf8())
        server.enqueue(json("""{"ok":true}"""))
        api.deleteVaultItem("login1")
        val gone = server.takeRequest()
        assertEquals("DELETE" to "/api/vault/login1", gone.method to gone.target)
    }

    @Test fun bitwardenIsSetUpLockedAndSyncedFromTheApp() = runBlocking {
        server.enqueue(json("{}"))
        api.setUpBitwarden("eu", "", "user.x", "s3cret")
        val setup = server.takeRequest()
        assertEquals("/api/vault/bitwarden/setup", setup.target)
        assertEquals("""{"server":"eu","serverUrl":"","clientId":"user.x","clientSecret":"s3cret"}""", setup.body!!.utf8())
        server.enqueue(json("{}")); api.lockBitwarden()
        assertEquals("POST" to "/api/vault/bitwarden/lock", server.takeRequest().let { it.method to it.target })
        server.enqueue(json("{}")); api.syncBitwarden()
        assertEquals("/api/vault/bitwarden/sync", server.takeRequest().target)
    }

    @Test fun theFeedResumesAfterTheLastEventItSaw() = runBlocking {
        val sse = { body: String -> MockResponse.Builder().addHeader("Content-Type", "text/event-stream").body(body).build() }
        server.enqueue(sse("id: b.1\nevent: hello\ndata: {}\n\nid: b.2\nevent: run_started\ndata: {\"botId\":\"x\"}\n\n"))
        server.enqueue(sse("id: b.3\nevent: run_finished\ndata: {\"botId\":\"x\"}\n\n"))
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val feed = Feed(scope)
            val got = scope.async { feed.events.take(3).toList() }
            feed.connect(api)
            // The first stream ends (botdot restarting): a nudge skips the wait before trying again.
            withTimeout(5_000) { feed.state.first { it == Feed.State.Retrying } }
            feed.retryNow()
            val events = withTimeout(5_000) { got.await() }
            assertEquals(listOf("hello", "run_started", "run_finished"), events.map { it.type })
            // Asked with guarded=1 each time: what waits then lists the guarded memory changes too (MEM-008).
            assertEquals("/api/events?guarded=1", server.takeRequest().target)
            server.takeRequest().url.let { assertEquals(listOf("/api/events", "1", "b.2"), listOf(it.encodedPath, it.queryParameter("guarded"), it.queryParameter("since"))) }
        } finally {
            scope.cancel()
        }
    }

    @Test fun whatAFailedRequestSaysOfItself() = runBlocking {
        val failure: suspend () -> ApiException = { runCatching { api.sendToChief("c1", "hi", emptyList()) }.exceptionOrNull() as ApiException }
        // botdot's own sentence.
        server.enqueue(MockResponse.Builder().code(409).body("""{"error":" The Chief is busy. "}""").build())
        failure().let { assertEquals(listOf("The Chief is busy.", 409, true), listOf(it.message, it.status, it.said)) }
        // A gateway's answer, and an `error` that is no sentence: the status, and not botdot's words.
        server.enqueue(MockResponse.Builder().code(502).body("<html>Bad Gateway</html>").build())
        failure().let { assertEquals(listOf("botdot answered 502", 502, false), listOf(it.message, it.status, it.said)) }
        server.enqueue(MockResponse.Builder().code(500).body("""{"error":"  "}""").build())
        failure().let { assertEquals(listOf("botdot answered 500", 500, false), listOf(it.message, it.status, it.said)) }
        server.enqueue(MockResponse.Builder().code(500).body("""{"error":true}""").build())
        failure().let { assertEquals(listOf(500, false), listOf(it.status, it.said)) }
        // The connection dropped after the request went out: botdot may have taken it.
        repeat(3) { server.enqueue(MockResponse.Builder().onResponseStart(mockwebserver3.SocketEffect.CloseSocket()).build()) }
        failure().let { assertEquals(listOf(0, false, true), listOf(it.status, it.said, it.sent)) }
        // No connection at all: it never left.
        server.close()
        failure().let { assertEquals(listOf(0, false, false), listOf(it.status, it.said, it.sent)) }
    }
}
