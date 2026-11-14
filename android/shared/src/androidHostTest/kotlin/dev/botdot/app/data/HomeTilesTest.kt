package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Board tiles on home (#447): as the server names them, else every tile at the top; checked, unchecked and dragged. */
class HomeTilesTest {
    private val led = Tile(id = "led", title = "LED strip")
    private val group = Tile(id = "g", title = "Servers", kind = "group")
    private val cpu = Tile(id = "cpu", title = "Proxmox CPU", parent = "g")
    private val waiting = Tile(id = "w", title = "Disk", approved = false)
    private val tiles = listOf(led, group, cpu, waiting)

    @Test fun onlyFromABotdotThatTakesIt() {
        assertTrue(HomeTiles.shows(listOf("board-blocks", "home-tiles")))
        assertFalse(HomeTiles.shows(listOf("board-blocks")))
        assertFalse(HomeTiles.shows(null))
    }

    @Test fun withoutAChoiceEveryApprovedTileAtTheTop() {
        assertEquals(listOf("led", "g"), HomeTiles.on(Dashboard(tiles = tiles)).map { it.id })
    }

    @Test fun theServersListInItsOrderAlsoATileInAGroup() {
        val dash = Dashboard(tiles = tiles, home = listOf("cpu", "led", "gone"))
        assertEquals(listOf("cpu", "led"), HomeTiles.on(dash).map { it.id })
        assertEquals(listOf("cpu", "led") to listOf("g"), HomeTiles.rows(dash))
    }

    @Test fun checkedUncheckedAndDragged() {
        assertEquals(listOf("led"), HomeTiles.toggle(listOf("led", "g"), "g"))
        assertEquals(listOf("led", "g", "cpu"), HomeTiles.toggle(listOf("led", "g"), "cpu"))
        assertEquals(listOf("g", "cpu", "led"), HomeTiles.move(listOf("led", "g", "cpu"), "led", "cpu"))
        assertEquals(listOf("led", "g"), HomeTiles.move(listOf("led", "g"), "led", "nope"))
    }
}
