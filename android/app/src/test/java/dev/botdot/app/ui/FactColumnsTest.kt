package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The two columns of a tool card's facts: nothing is ever wider than the card, so nothing scrolls sideways. */
class FactColumnsTest {
    @Test fun theLabelsTakeWhatTheyNeedAndTheValuesTheRest() {
        // A phone's card, 900 px wide inside its padding: labels as wide as the widest, the value gets the rest.
        assertEquals(180 to 684, factColumns(width = 900, widestLabel = 180, gap = 36))
    }

    @Test fun aLongLabelStopsAtTwoFifthsOfTheCard() {
        assertEquals(360 to 504, factColumns(width = 900, widestLabel = 5_000, gap = 36))
    }

    @Test fun theColumnsNeverExceedTheCard() {
        for (width in listOf(0, 1, 20, 300, 900, 2_000)) for (label in listOf(0, 10, 150, 9_999)) {
            val (l, v) = factColumns(width, label, gap = 36)
            assertTrue("$width/$label: $l + $v", l >= 0 && v >= 0 && (v == 0 || l + 36 + v <= width))
        }
        assertEquals(0 to 0, factColumns(width = 20, widestLabel = 0, gap = 36))
    }
}
