package dev.botdot.app.ui

import dev.botdot.app.data.Dashboard
import dev.botdot.app.data.Tile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The Board's name, its strip in the list and its empty page say what the web page says (BOARD-002). */
class BoardWordsTest {
    @Test fun noStripBeforeTheBoardHasLoaded() {
        assertNull(stripTiles(null))
    }

    @Test fun anEmptyBoardHasItsStripWithNoTiles() {
        assertEquals(emptyList<Tile>(), stripTiles(Dashboard()))
    }

    @Test fun aTileWhoseScriptWaitsIsNotOnItYet() {
        val waiting = Tile(id = "t1", title = "Disk", approved = false)
        assertEquals(emptyList<Tile>(), stripTiles(Dashboard(tiles = listOf(waiting), pending = listOf(waiting))))
    }

    @Test fun theStripShowsTheTilesOutsideGroups() {
        val light = Tile(id = "t1", title = "Light")
        val lights = Tile(id = "g", title = "Lights", kind = "group")
        val inside = Tile(id = "t2", title = "Desk", parent = "g")
        assertEquals(listOf(light, lights), stripTiles(Dashboard(tiles = listOf(light, lights, inside))))
    }

    @Test fun theWords() {
        assertEquals("Board · Nothing on it yet", "${BoardWords.NAME} · ${BoardWords.NOTHING}")
        assertEquals("Tiles for the things you use most: a light switch, the temperature, a shopping list, a morning summary.", BoardWords.WHAT_FOR)
        assertEquals("Nothing is on it yet. Tell the Chief or any bot, for example: “Put a shopping list on my board.”", BoardWords.TELL + BoardWords.EXAMPLE)
    }

    /** A tile's pop-up says how often it refreshes, as the web page says it (#42); nothing when it reads nothing. */
    @Test fun howOftenATileRefreshes() {
        val change = " Ask the Chief of Staff to change it."
        assertEquals("Refreshes every minute while the Board is open.$change", refreshLine(Tile(id = "t", every = 60)))
        assertEquals("Refreshes every 15 minutes while the Board is open.$change", refreshLine(Tile(id = "t", every = 900)))
        assertEquals("Refreshes every hour while the Board is open.$change", refreshLine(Tile(id = "t", every = 3600)))
        assertEquals("Refreshes every 2 hours while the Board is open.$change", refreshLine(Tile(id = "t", every = 7200)))
        assertEquals("Refreshes every day while the Board is open.$change", refreshLine(Tile(id = "t", every = 86400)))
        assertEquals("Refreshes every 30 seconds while the Board is open.$change", refreshLine(Tile(id = "t", every = 30)))
        assertEquals("Refreshes only when tapped.$change", refreshLine(Tile(id = "t", every = 0)))
        assertNull(refreshLine(Tile(id = "t")))
    }
}
