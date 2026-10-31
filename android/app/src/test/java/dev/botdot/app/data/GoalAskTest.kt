package dev.botdot.app.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Change" on a goal card (#820) shows only where the botdot asks the Chief for it (`objective-change`). */
class GoalAskTest {
    @Test fun changeShowsOnlyWithTheFeature() {
        assertTrue(GoalAsk.shows(listOf("company", "objective-change")))
        assertFalse(GoalAsk.shows(listOf("company")))
        assertFalse(GoalAsk.shows(null))
    }
}
