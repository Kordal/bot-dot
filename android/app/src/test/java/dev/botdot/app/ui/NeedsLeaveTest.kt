package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Needs you goes back after its last card (#264). `test/needs-return-web.test.js` holds the web page's side. */
class NeedsLeaveTest {
    @Test fun openedWithNothingWaitingItStays() {
        assertEquals(NeedsLeave.Step(seen = false, leave = false), NeedsLeave.step(false, 0, false))
    }

    @Test fun itLeavesWhenTheCardsWentFromSomeToNone() {
        var s = NeedsLeave.step(false, 3, false)
        assertEquals(NeedsLeave.Step(seen = true, leave = false), s)
        s = NeedsLeave.step(s.seen, 1, true)
        assertEquals(NeedsLeave.Step(seen = true, leave = false), s)
        s = NeedsLeave.step(s.seen, 0, true)
        assertEquals(NeedsLeave.Step(seen = false, leave = true), s)
        assertEquals("and once only", NeedsLeave.Step(seen = false, leave = false), NeedsLeave.step(s.seen, 0, true))
    }

    @Test fun aCardThatComesInKeepsTheOwnerThere() {
        assertEquals(NeedsLeave.Step(seen = true, leave = false), NeedsLeave.step(false, 1, true))
    }

    @Test fun cardsAnsweredElsewhereKeepTheOwnerThere() {
        assertEquals(NeedsLeave.Step(seen = false, leave = false), NeedsLeave.step(true, 0, false))
    }

    @Test fun theMomentIsShort() {
        assertTrue(NeedsLeave.DELAY_MS in 800L..2000L)
    }
}
