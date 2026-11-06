package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The Board's strip in the list (FitRow): the list dragged narrow enough that not even the first tile fits whole
 * crashed the app, as that tile was measured a second time to be cut short. Dragged back and forth, it keeps
 * showing what fits whole, and the first cut short when nothing does.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w800dp-h600dp")
class FitRowTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private var width by mutableIntStateOf(400)

    private fun placed(tag: String) = rule.onAllNodesWithTag(tag).fetchSemanticsNodes().count { it.layoutInfo.isPlaced }

    private fun at(w: Int) { width = w; rule.waitForIdle() }

    @Test fun aRowTooNarrowForItsFirstTileCutsItShortAndKeepsUpWithTheWidth() {
        rule.setContent {
            Row(Modifier.width(width.dp)) {
                FitRow(Modifier.weight(1f), gap = 14.dp) {
                    Box(Modifier.width(200.dp).height(20.dp).testTag("first"))
                    Box(Modifier.width(80.dp).height(20.dp).testTag("second"))
                }
            }
        }
        assertEquals(1, placed("second"))
        // As a finger drags the list's edge: through widths where nothing fits whole, and back.
        for (w in listOf(40, 300, 20, 120, 0, 60, 400, 30, 250, 10)) at(w)
        at(60)
        rule.onNodeWithTag("first").assertWidthIsEqualTo(60.dp) // cut short
        assertEquals(0, placed("second"))
        at(250) // the first whole, no room for the second
        rule.onNodeWithTag("first").assertWidthIsEqualTo(200.dp)
        assertEquals(0, placed("second"))
        at(400)
        rule.onNodeWithTag("first").assertWidthIsEqualTo(200.dp)
        assertEquals(1, placed("second"))
    }
}
