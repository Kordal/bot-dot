package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Asking the Chief to change one Board tile (#430): only from a botdot that takes it, and the tile says where it went. */
class TileAskTest {
    @Test fun onlyFromABotdotThatTakesIt() {
        assertTrue(TileAsk.shows(listOf("board-blocks", "tile-change")))
        assertFalse(TileAsk.shows(listOf("board-blocks")))
        assertFalse(TileAsk.shows(null))
    }

    @Test fun theTileSaysWhereItWent() {
        assertEquals("Sent to Ada", TileAsk.sent("Ada"))
        assertEquals("Sent to Chief of Staff", TileAsk.sent(null))
    }
}
