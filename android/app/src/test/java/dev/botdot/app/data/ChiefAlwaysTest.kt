package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The Chief's "Always approved" in its settings (#381): its lasting grants in connected apps and after the web, as
 * the server lists them, the kinds a server has, and Revoke, which sends each back to its own route.
 */
class ChiefAlwaysTest {
    @Test fun appActionsAreReadInTheOwnersWordsAndFromAnOlderServerByTheirName() {
        val now = ChiefGrant.of(ChiefGrant.Kind.APP, """{"actions":["gmail:GMAIL_SEND_EMAIL"],"grants":[{"action":"gmail:GMAIL_SEND_EMAIL","label":"Send email with Gmail"}]}""")
        assertEquals(listOf(ChiefGrant(ChiefGrant.Kind.APP, "gmail:GMAIL_SEND_EMAIL", "Send email with Gmail")), now)
        val old = ChiefGrant.of(ChiefGrant.Kind.APP, """{"actions":["gmail:GMAIL_SEND_EMAIL"]}""")
        assertEquals(listOf("gmail:GMAIL_SEND_EMAIL"), old.map { it.label })
        assertEquals(emptyList<ChiefGrant>(), ChiefGrant.of(ChiefGrant.Kind.APP, "not json"))
    }

    @Test fun afterWebTypesStartWithACapital() {
        val types = ChiefGrant.of(ChiefGrant.Kind.WEB, """{"types":[{"type":"reminders","label":"reminders"},{"type":"board","label":"changes to your Board"}]}""")
        assertEquals(listOf("Reminders", "Changes to your Board"), types.map { it.label })
        assertEquals(listOf("reminders", "board"), types.map { it.id })
    }

    @Test fun onlyTheKindsTheServerAnnounces() {
        assertEquals(emptyList<ChiefGrant.Kind>(), ChiefGrant.kinds(null))
        assertEquals(listOf(ChiefGrant.Kind.WEB), ChiefGrant.kinds(listOf("more-always")))
        assertEquals(ChiefGrant.Kind.entries.toList(), ChiefGrant.kinds(listOf("chief-connectors", "more-always")))
    }

    @Test fun revokeSendsTheGrantToItsOwnRoute() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse.Builder().addHeader("Content-Type", "application/json").body("""{"ok":true,"types":[]}""").build())
        server.enqueue(MockResponse.Builder().addHeader("Content-Type", "application/json").body("""{"ok":true,"actions":[],"grants":[]}""").build())
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            assertEquals(emptyList<ChiefGrant>(), api.revokeChiefGrant(ChiefGrant(ChiefGrant.Kind.WEB, "reminders", "Reminders")))
            val web = server.takeRequest()
            assertEquals("DELETE", web.method)
            assertEquals("/api/chief/after-web", web.target)
            assertEquals("""{"type":"reminders"}""", web.body?.utf8())
            api.revokeChiefGrant(ChiefGrant(ChiefGrant.Kind.APP, "gmail:GMAIL_SEND_EMAIL", "Send email with Gmail"))
            val app = server.takeRequest()
            assertEquals("/api/chief/connector-actions", app.target)
            assertEquals("""{"action":"gmail:GMAIL_SEND_EMAIL"}""", app.body?.utf8())
        } finally { server.close() }
    }
}
