package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.longClick
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanyFloor
import dev.botdot.app.data.CompanyTeam
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A project's team keys (#841): one row per team, its name as a chip that opens the team chat (held: the team's
 * sheet), its bots as keys with the crown on the lead, and a key opens its bot's chat. A team with no bots left is
 * not shown.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w411dp-h891dp")
class TeamKeysUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val bots = listOf(Bot(id = "ops", name = "Ops Watchkeeper", color = "#34c759"), Bot(id = "rel", name = "Release Planner", color = "#8e7cff"))
    private val project = Company(id = "p1", name = "Quotz IT", teams = listOf(
        CompanyTeam(id = "t1", name = "Quotz IT team", bots = listOf("rel", "ops"), lead = "ops"),
        CompanyTeam(id = "t2", name = "Empty", bots = listOf("gone")),
    ))
    private val info = CompanyFloor.Info(asks = { 0 }, working = { false })

    @Test fun aTeamRowOpensItsChatAndItsBots() {
        val opened = mutableListOf<String>()
        rule.setContent {
            Column { TeamKeys(project, bots, info, wide = false, line = { it.description }, chatOf = { id -> { opened += "team:$id" } }, onBot = { opened += "bot:$it" }) { opened += "sheet:$it" } }
        }
        rule.onAllNodesWithTag(TEAM_KEYS).assertCountEquals(1) // the team with no bots left is not shown
        rule.onAllNodesWithTag(LEAD_CROWN).assertCountEquals(1)
        rule.onNodeWithText("Quotz IT team").assertIsDisplayed().performClick()
        rule.onNodeWithText("Release Planner").performClick()
        rule.onNodeWithText("Quotz IT team").performTouchInput { longClick() }
        assertEquals(listOf("team:t1", "bot:rel", "sheet:t1"), opened)
    }

    @Test fun withoutATeamChatTheChipOpensTheTeam() {
        val opened = mutableListOf<String>()
        rule.setContent { Column { TeamKeys(project, bots, info, wide = true, line = { "" }, chatOf = { null }, onBot = {}) { opened += it } } }
        rule.onNodeWithText("Quotz IT team").performClick()
        assertEquals(listOf("t1"), opened)
    }
}
