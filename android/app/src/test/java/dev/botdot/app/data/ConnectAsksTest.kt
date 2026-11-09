package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A missing connected app's card (`connect-app`, ADR 168, #1184): its button by a verb, where it stands, and its Connect. */
class ConnectAsksTest {
    private fun asks(json: String) = Ask.list(json)
    private val coder = """"bot":{"id":"coder","name":"Coder"}"""
    private fun card(extra: String = "", act: String = """{"verb":"connect","label":"Connect"}""") =
        """{"id":"k1","kind":"connect-app",$coder,"app":"gmail","name":"Gmail","mode":"connect","title":"Connect Gmail for Coder","act":$act,"no":"Not now","text":"Needs Gmail connected"$extra}"""

    @Test fun itsFieldsAreRead() {
        val a = asks("[${card()}]").single()
        assertEquals("gmail", a.app)
        assertEquals("Gmail", a.appName)
        assertEquals("connect", a.mode)
        assertEquals("Not now", a.no)
        assertEquals(AskAct("connect", "Connect", null), a.act)
        assertNull(a.chatId)
    }

    @Test fun theButtonIsTheServersWordElseTheAppsByTheVerb() {
        assertEquals("Connect", asks("[${card()}]").single().actLabel)
        assertEquals("Reconnect", asks("[${card(act = """{"verb":"connect"}""").replace("\"mode\":\"connect\"", "\"mode\":\"reconnect\"")}]").single().actLabel)
        assertEquals("Connect", asks("[${card(act = """{"verb":"connect"}""")}]").single().actLabel)
        assertEquals("Open Connectors", asks("[${card(act = """{"verb":"open","screen":"connectors"}""")}]").single().actLabel)
        // A card of any other kind has none: its own buttons.
        assertNull(asks("""[{"id":"a1","kind":"skill"}]""").single().actLabel)
    }

    @Test fun aVerbThisAppDoesNotKnowDrawsNoCard() {
        val list = asks("[${card(act = """{"verb":"teleport","label":"Go"}""")},${card(act = """{"verb":"open","screen":"vault"}""").replace("k1", "k2")},${card().replace("k1", "k3")}]")
        assertEquals(listOf("k3"), list.map { it.id })
        // An `act` without a verb is no act: the card's kind's own buttons.
        assertNull(AskAct.of(kotlinx.serialization.json.Json.parseToJsonElement("""{"label":"Connect"}""")))
    }

    @Test fun aBotsCardStandsInItsChatTheChiefsOwnInTheChiefsAndOneTheChiefOfferedInBoth() {
        val bots = asks("[${card()}]").single()
        assertTrue(bots.standsInChat("coder"))
        assertFalse(bots.standsInChat("chief"))
        val chiefs = asks("""[{"id":"k2","kind":"connect-app","bot":null,"app":"gmail","title":"Connect Gmail","act":{"verb":"connect"}}]""").single()
        assertTrue(chiefs.standsInChat("chief"))
        assertFalse(chiefs.standsInChat("coder"))
        val offered = asks("[${card(""","chatId":"c1"""")}]").single()
        assertTrue(offered.standsInChat("chief"))
        assertTrue(offered.standsInChat("coder"))
        assertFalse(offered.standsInChat("mail"))
        // Asked in a group: in that group's chat alone.
        val grouped = asks("[${card(""","groupId":"g1","groupName":"Writers"""")}]").single()
        assertTrue(grouped.standsInChat("group:g1"))
        assertFalse(grouped.standsInChat("coder"))
    }

    @Test fun theConnectionSaysWhereTheCardIs() {
        assertEquals(AskConnect.Outcome.Connected, AskConnect(status = "ACTIVE").outcome)
        assertEquals(AskConnect.Outcome.Connected, AskConnect(settled = true).outcome)
        assertEquals(AskConnect.Outcome.Connected, AskConnect(noAuth = true).outcome)
        assertEquals(AskConnect.Outcome.Ended, AskConnect(status = "FAILED").outcome)
        assertEquals(AskConnect.Outcome.Ended, AskConnect(status = "EXPIRED").outcome)
        assertEquals(AskConnect.Outcome.Waiting, AskConnect(status = "INITIATED").outcome)
        assertEquals(AskConnect.Outcome.Waiting, AskConnect().outcome)
        val opened = Api.JSON.decodeFromString(AskConnect.serializer(), """{"redirectUrl":"https://connect.example/x","connectionId":"c1","expiresAt":"2026-11-09T08:00:00Z"}""")
        assertEquals("https://connect.example/x", opened.redirectUrl)
        assertEquals(AskConnect.Outcome.Waiting, opened.outcome)
    }

    @Test fun aRunDrawsNoReconnectCardForAnAppItsBotHasACardFor() {
        val list = asks("[${card()}]")
        assertTrue(hasConnectCard(list, "coder", "gmail"))
        assertFalse(hasConnectCard(list, "coder", "slack"))
        assertFalse(hasConnectCard(list, "mail", "gmail"))
        assertFalse(hasConnectCard(list, null, "gmail"))
    }

    @Test fun itsRowOverTheKeysHasItsButton() {
        val a = asks("[${card()}]").single()
        val w = waitingOf(emptyList(), null, Needs(asks = listOf(a)), null).single()
        assertEquals("Coder: Connect Gmail for Coder", w.text)
        assertEquals("k1", w.act)
        assertEquals("Connect", w.actLabel)
        assertNull(w.permission)
    }
}
