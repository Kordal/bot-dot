package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/** The Board's numbers over the keys: three a row on a phone, a value in words wider, none cut off (#1187). */
class BoardGridTest {
    @Test fun aPhoneHasThreeColumnsAndAWideWindowOnePer160dp() {
        assertEquals(3, boardColumns(387f))
        assertEquals(3, boardColumns(479f))
        assertEquals(3, boardColumns(480f))
        assertEquals(4, boardColumns(800f))
        assertEquals(4, boardColumns(1400f))
    }

    @Test fun aNumberTakesOneColumnWordsTwoAndALongLineTheRow() {
        assertEquals(1, boardSpan("14", 3))
        assertEquals(1, boardSpan("21.5", 3))
        assertEquals(1, boardSpan(null, 3))
        assertEquals(2, boardSpan("09:30 Team sync", 3))
        assertEquals(3, boardSpan("Backups ran fine last night", 3))
        assertEquals(1, boardSpan("09:30 Team sync", 2))
    }

    @Test fun theTilesKeepTheirOrderAndOneThatNoLongerFitsStartsTheNextRow() {
        // Unread mail, Next up (words), Living room, Heating, Disk: two rows, not three.
        assertEquals(listOf(listOf(0, 1), listOf(2, 3, 4)), boardRows(listOf(1, 2, 1, 1, 1), 3))
        assertEquals(listOf(listOf(0), listOf(1), listOf(2, 3)), boardRows(listOf(1, 3, 2, 1), 3))
        assertEquals(emptyList<List<Int>>(), boardRows(emptyList(), 3))
        // A span wider than the grid takes the whole row.
        assertEquals(listOf(listOf(0), listOf(1)), boardRows(listOf(5, 1), 3))
    }
}
