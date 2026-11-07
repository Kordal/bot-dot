package dev.botdot.app.ui

import dev.botdot.app.data.Tile
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A tile that asks "are you sure" before a tap (its confirm), as the web page asks it (test/tile-confirm.test.js). */
class TileAsksFirstTest {
    @Test fun aSwitchWithOffAsksOnlyBeforeItTurnsOff() {
        assertTrue(tileAsksFirst("off", "toggle", false))
        assertFalse(tileAsksFirst("off", "toggle", true))
        assertTrue(tileAsksFirst("on", "toggle", true))
        assertTrue(tileAsksFirst("always", "toggle", true))
    }

    @Test fun aButtonAsksOnlyWithAlways() {
        assertTrue(tileAsksFirst("always", "act", null))
        assertFalse(tileAsksFirst("off", "act", null))
        assertFalse(tileAsksFirst("always", "panel", null))
    }

    @Test fun aTileWithoutItAsksNothing() {
        assertFalse(tileAsksFirst(null, "toggle", false))
        val t = Json { ignoreUnknownKeys = true }.decodeFromString(Tile.serializer(), """{"id":"t_1","kind":"switch","confirm":"off"}""")
        assertEquals("off", t.confirm)
    }
}
