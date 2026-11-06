package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The Board's strip in the list (FitRow): the list dragged narrow enough that not even the first tile fits whole
 * crashed the app, as that tile was measured a second time to be cut short. Dragged back and forth, it keeps
 * showing what fits.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w800dp-h600dp")
class FitRowTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun aRowTooNarrowForItsFirstChildCutsItShortAndTheRowKeepsUpWithTheWidth() {
        var width by mutableIntStateOf(400)
        rule.setContent {
            Row(Modifier.width(width.dp)) {
                FitRow(Modifier.weight(1f), gap = 14.dp) {
                    Text("Revenue this month 12 400", maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("Deploys 3", maxLines = 1)
                }
            }
        }
        rule.onNodeWithText("Deploys 3").assertIsDisplayed()
        // As a finger drags the list's edge: through widths where nothing fits whole, and back.
        for (w in listOf(40, 300, 20, 120, 0, 60, 400, 30, 250, 10)) {
            width = w
            rule.waitForIdle()
        }
        width = 60
        rule.waitForIdle()
        val tree = rule.onRoot().printToString()
        org.junit.Assert.assertTrue(tree, tree.contains("Revenue this month 12 400")) // the first, cut short
        rule.onNodeWithText("Deploys 3").assertIsNotDisplayed()
        width = 400
        rule.waitForIdle()
        rule.onNodeWithText("Revenue this month 12 400").assertIsDisplayed()
        rule.onNodeWithText("Deploys 3").assertIsDisplayed()
    }
}
