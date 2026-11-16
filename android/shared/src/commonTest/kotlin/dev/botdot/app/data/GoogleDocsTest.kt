package dev.botdot.app.data

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Save to Google Docs for both phones (GoogleDocs, #351, #378): its status, the save, connecting and connecting again. */
class GoogleDocsTest {
    private val doc = "https://docs.google.com/document/d/abc123/edit"

    @Test fun connectedItSavesAndOpensTheDoc() = runTest {
        val server = FakeServer { t -> if (t.method == "GET") 200 to """{"configured":true,"connected":true}""" else 200 to """{"url":"$doc"}""" }
        val docs = GoogleDocs(server.api)
        docs.read()
        assertEquals("connected", docs.label)
        val said = mutableListOf<String>()
        val done = docs.tap("Week", "# Week") { said += it }
        assertEquals(listOf("Saving to Google Docs…"), said)
        assertEquals("Saved to Google Docs", done.say)
        assertEquals(doc, done.open)
        assertTrue(server.posts().single().body.contains("\"title\":\"Week\""))
    }

    @Test fun notSetUpItSaysSoAndSendsNothing() = runTest {
        val server = FakeServer { 200 to """{"configured":false}""" }
        val docs = GoogleDocs(server.api)
        docs.read()
        assertEquals("Not set up", docs.label)
        val done = docs.tap("Week", "# Week") {}
        assertEquals(DocumentExport.GOOGLE_DOCS_NOT_SET_UP, done.say)
        assertNull(done.open)
        assertTrue(server.posts().isEmpty())
    }

    @Test fun notConnectedItOpensGooglesSignInAndALostConnectionConnectsAgain() = runTest {
        var connected = false
        val server = FakeServer { t ->
            when {
                t.method == "GET" -> 200 to """{"configured":true,"connected":$connected}"""
                t.path.endsWith("/connectors/connect") -> 200 to """{"redirectUrl":"https://accounts.example.test/signin"}"""
                else -> 409 to """{"error":"reconnect"}"""
            }
        }
        val docs = GoogleDocs(server.api)
        docs.read()
        assertEquals("Connect…", docs.label)
        val signIn = docs.tap("Week", "# Week") {}
        assertEquals(DocumentExport.GOOGLE_DOCS_SIGN_IN, signIn.say)
        assertEquals("https://accounts.example.test/signin", signIn.open)
        connected = true
        docs.read()
        val lost = docs.tap("Week", "# Week") {}
        assertEquals("Google Docs needs connecting again. Tap Google Docs to connect it.", lost.say)
        assertEquals("Connect…", docs.label, "the next tap connects it again")
    }

    @Test fun afterTheSignInInTheBrowserTheNextTapSaves() = runTest {
        var connected = false
        val server = FakeServer { t ->
            when {
                t.method == "GET" -> 200 to """{"configured":true,"connected":$connected}"""
                t.path.endsWith("/connectors/connect") -> 200 to """{"redirectUrl":"https://accounts.example.test/signin"}"""
                else -> 200 to """{"url":"$doc"}"""
            }
        }
        val docs = GoogleDocs(server.api)
        docs.read()
        assertEquals(DocumentExport.GOOGLE_DOCS_SIGN_IN, docs.tap("Week", "# Week") {}.say)
        // Signed in in the browser; Export… still open, its status as it was read.
        connected = true
        val saved = docs.tap("Week", "# Week") {}
        assertEquals("Saved to Google Docs", saved.say)
        assertEquals(doc, saved.open)
        assertEquals("connected", docs.label)
        assertEquals(1, server.posts().count { it.path.endsWith("/connectors/connect") }, "connected once, not again")
    }
}
