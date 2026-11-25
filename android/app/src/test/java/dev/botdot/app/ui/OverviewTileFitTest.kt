package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.OverviewEntry
import dev.botdot.app.data.OverviewState
import dev.botdot.app.data.ProjectOverview
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * An overview tile on the canvas shows the whole rows that fit the height the owner gave it and "N more" (ADR 273, as the
 * web page does, test/overview-board.test.js); in the one-column flow it shows every row.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w400dp-h800dp")
class OverviewTileFitTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val feed = OverviewState(snapshot = ProjectOverview(
        projectId = "p1", at = "2026-11-25T12:00:00Z",
        work = (1..8).map { OverviewEntry(id = "r$it", state = "working", name = "Writer $it", text = "Row $it") },
    ))

    @Test fun aTileOnTheCanvasShowsWholeRowsAndHowManyMore() {
        rule.setContent { Box(Modifier.fillMaxWidth().height(300.dp)) { OverviewTile("work", feed, null, {}, Modifier.fillMaxWidth().height(300.dp), fixed = true) } }
        rule.onNodeWithText("Row 1").assertExists()
        rule.onAllNodesWithText("Row 8").assertCountEquals(0)
        rule.onNodeWithText("more", substring = true).assertExists()
    }

    @Test fun aTileInTheColumnShowsEveryRow() {
        rule.setContent { OverviewTile("work", feed, null, {}, Modifier.fillMaxWidth(), fixed = false) }
        rule.onNodeWithText("Row 8").assertExists()
        rule.onAllNodesWithText("more", substring = true).assertCountEquals(0)
    }
}
