package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** A bot's Apps for both phones (BotSettings): which apps it is offered, which it has, and a tick. */
class BotSettingsAppsTest {
    private fun conn(json: String) = Api.JSON.decodeFromString(Connection.serializer(), json)

    @Test fun eachAppOnceItsLiveConnectionAndARowPerAccountOfOneWithTwo() {
        val all = listOf(
            conn("""{"id":"a","toolkit":"gmail","status":"EXPIRED"}"""),
            conn("""{"id":"b","toolkit":"gmail","status":"ACTIVE","app":{"name":"Gmail"}}"""),
            conn("""{"id":"c","toolkit":"notion","status":"EXPIRED"}"""),
            conn("""{"id":"d","toolkit":"slack","status":"ACTIVE","accounts":2,"label":"Work"}"""),
            conn("""{"id":"e","toolkit":"slack","status":"ACTIVE","accounts":2,"label":"Home","usedBy":["b1"]}"""),
        )
        assertEquals(listOf("b", "c", "d", "e"), BotSettings.appChoices(all).map { it.id }, "a dead connection only when no live one; each account of slack")
        val slackWork = all[3]
        val slackHome = all[4]
        assertEquals("slack · Work", BotSettings.appName(slackWork))
        assertTrue(BotSettings.appPicked(slackHome, setOf("slack"), emptyMap(), "b1"), "no account chosen: the one it uses")
        val (k, a) = BotSettings.appToggled(slackWork, true, setOf("slack"), emptyMap())
        assertEquals(mapOf("slack" to "d"), a)
        assertTrue(BotSettings.appPicked(slackWork, k, a, "b1"))
        assertFalse(BotSettings.appPicked(slackHome, k, a, "b1"), "one account of an app at most")
        val off = BotDraft(connectors = k, accounts = a).withApp(slackWork, false)
        assertEquals(emptySet(), off.connectors)
        assertEquals(emptyMap(), off.accounts)
    }
}
