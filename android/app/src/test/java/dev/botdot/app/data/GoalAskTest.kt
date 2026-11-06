package dev.botdot.app.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Change" (#820) and Remove on a goal card show only where the botdot says it can (`objective-change`, `objective-remove`). */
class GoalAskTest {
    @Test fun changeShowsOnlyWithTheFeature() {
        assertTrue(GoalAsk.shows(listOf("company", "objective-change")))
        assertFalse(GoalAsk.shows(listOf("company")))
        assertFalse(GoalAsk.shows(null))
    }

    @Test fun removeShowsOnlyWithTheFeature() {
        assertTrue(GoalAsk.removes(listOf("company", "objective-remove")))
        assertFalse(GoalAsk.removes(listOf("company", "objective-change")))
        assertFalse(GoalAsk.removes(null))
    }
}
