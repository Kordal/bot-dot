package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Where a bot's computer is and its proxy, for both phones (BotSettings): when each shows, its choices, the move's question. */
class BotComputerProxyTest {
    private fun bot(json: String) = Api.JSON.decodeFromString(Bot.serializer(), json)
    private val linux = bot("""{"id":"a","name":"A","computer":"linux","proxy":""}""")
    private val boatF = listOf("boat-computer", "computer-move")

    @Test fun theComputerShowsWithAdvancedOnABotdotWithBoatDevAndNotWhereTheAccountChooses() {
        assertEquals(listOf("none", "linux", "boat"), BotSettings.computerChoices(true, boatF, boat = true, linux)?.map { it.id })
        assertEquals(listOf("linux", "boat"), BotSettings.computerChoices(true, boatF + "everything-allowed", true, linux)?.map { it.id }, "every bot has one: no None")
        assertNull(BotSettings.computerChoices(false, boatF, true, linux), "Advanced off")
        assertNull(BotSettings.computerChoices(true, boatF + "account-computer", true, linux), "the account chooses it in Settings")
        assertNull(BotSettings.computerChoices(true, boatF, boat = false, linux), "no boat.dev key")
        assertTrue(BotSettings.computerChoices(true, boatF, boat = false, bot("""{"id":"a","name":"A","computer":"boat"}""")) != null, "already there: still shown")
    }

    @Test fun aMoveBetweenComputersAsksAboutItsFilesAndTheDraftFollows() {
        assertTrue(BotSettings.asksMove(boatF, linux, "boat"))
        assertFalse(BotSettings.asksMove(boatF, linux, "linux"), "the same")
        assertFalse(BotSettings.asksMove(boatF, linux, "none"), "to none: nothing to move")
        assertFalse(BotSettings.asksMove(listOf("boat-computer"), linux, "boat"), "no computer-move")
        assertEquals("Copy its files to the External Virtual PC?", BotSettings.moveQuestion("boat"))
        val d = BotDraft(computer = true, computerOn = "linux").withComputerOn("boat", move = true)
        assertEquals(Triple(true, "boat", true), Triple(d.computer, d.computerOn, d.moveFiles))
        assertEquals("none", BotSettings.computerValue(d.withComputerOn("none", false)))
    }

    @Test fun theProxyIsOnThisMachineOnlyWithTheAccountsChoices() {
        val list = ProxyList(listOf(Proxy(id = "p1", name = "Home")), default = "p1")
        assertEquals(listOf("" to "Account's (Home)", "none" to "No proxy", "p1" to "Home"), BotSettings.proxyChoices(true, listOf(Proxies.FEATURE), linux, list)?.map { it.id to it.label })
        assertNull(BotSettings.proxyChoices(true, listOf(Proxies.FEATURE), bot("""{"id":"a","name":"A","computer":"boat"}"""), list), "boat.dev's browser uses the account's")
        assertNull(BotSettings.proxyChoices(false, listOf(Proxies.FEATURE), linux, list), "Advanced off")
        assertNull(BotSettings.proxyChoices(true, listOf(Proxies.FEATURE), linux, ProxyList()), "no proxies and none set: no row")
    }
}
