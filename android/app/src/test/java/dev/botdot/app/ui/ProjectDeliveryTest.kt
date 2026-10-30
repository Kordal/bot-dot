package dev.botdot.app.ui

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The delivery date's presets (#800): days worked out from today, the server sees only the day or "none" (#792). */
class ProjectDeliveryTest {
    private val today = LocalDate.of(2026, 10, 30)

    @Test fun eachPresetIsADayFromToday() {
        assertEquals(LocalDate.of(2026, 11, 30), Delivery.presetDay("month", today))
        assertEquals(LocalDate.of(2027, 1, 30), Delivery.presetDay("quarter", today))
        assertEquals(LocalDate.of(2026, 12, 31), Delivery.presetDay("year", today))
        // A month from the 31st is the month's last day.
        assertEquals(LocalDate.of(2026, 2, 28), Delivery.presetDay("month", LocalDate.of(2026, 1, 31)))
    }

    @Test fun aSavedDayShowsAsItsPresetOrAsAPickedDay() {
        assertEquals("month", Delivery.presetOf("2026-11-30", today))
        assertEquals("year", Delivery.presetOf("2026-12-31", today))
        assertNull(Delivery.presetOf("2026-12-01", today))
        assertNull(Delivery.presetOf(Delivery.NONE, today))
        assertNull(Delivery.presetOf("", today))
    }
}
