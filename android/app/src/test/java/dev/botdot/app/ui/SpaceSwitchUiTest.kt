package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.botdot.app.data.Spaces
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The spaces on screen (#840): the rail from 840 dp marks the space on screen, shows each project's count and opens a
 * space, "+" starts a project; on a phone the title opens the sheet of spaces. Before the first project both are there
 * with Home and New project (#853); on a botdot without projects the title is the logo alone and nothing switches.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w1280dp-h800dp")
class SpaceSwitchUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val list = listOf(Spaces.Space("p1", "Quotz IT", "#34c759", 1), Spaces.Space("p2", "My Gym", "#ff6b35", 0))

    @Test fun theRailMarksTheSpaceAndOpensAnother() {
        val picked = mutableListOf<String>()
        var news = 0
        var searched = 0
        rule.setContent {
            var current by remember { mutableStateOf(Spaces.HOME) }
            Row { SpaceRail(SpaceWays(list, current, pick = { picked += it; current = it }, new = { news++ }), busy = false, onSearch = { searched++ }, onSettings = {}) }
        }
        rule.onNodeWithTag(SPACE_RAIL).assertIsDisplayed()
        rule.onNodeWithContentDescription("Home").assertIsSelected()
        rule.onNodeWithContentDescription("Quotz IT").assertIsNotSelected()
        rule.onNodeWithText("1").assertIsDisplayed() // Quotz IT's ask
        rule.onNodeWithContentDescription("Quotz IT").performClick()
        rule.onNodeWithContentDescription("Quotz IT").assertIsSelected()
        rule.onNodeWithContentDescription("Home").assertIsNotSelected()
        rule.onNodeWithContentDescription("New project").performClick()
        rule.onNodeWithContentDescription("Search").performClick()
        assertEquals(listOf("p1"), picked)
        assertEquals(1, news)
        assertEquals(1, searched)
    }

    @Test fun thePhonesTitleOpensTheSheetOfSpaces() {
        val picked = mutableListOf<String>()
        rule.setContent {
            var open by remember { mutableStateOf(false) }
            val ways = SpaceWays(list, "p1", pick = { picked += it }, new = {})
            SpaceTitle(ways, busy = false, onOpen = { open = true })
            if (open) SpaceSheet(ways) { open = false }
        }
        rule.onNodeWithText("Quotz IT").assertIsDisplayed()
        rule.onNodeWithTag(SPACE_TITLE).performClick()
        rule.onNodeWithTag(SPACE_SHEET).assertIsDisplayed()
        rule.onNodeWithText("Home").assertIsDisplayed()
        rule.onNodeWithText("My Gym").assertIsDisplayed()
        rule.onNodeWithText("New project").assertIsDisplayed()
        rule.onNodeWithText("Home").performClick()
        rule.waitForIdle()
        assertEquals(listOf(Spaces.HOME), picked)
    }

    @Test fun beforeTheFirstProjectTheSpacesStartOne() {
        var news = 0
        rule.setContent {
            var open by remember { mutableStateOf(false) }
            val ways = SpaceWays(emptyList(), Spaces.HOME, pick = {}, new = { news++ }, on = true)
            Row { SpaceRail(ways, busy = false, onSearch = {}, onSettings = {}) }
            SpaceTitle(ways, busy = false, onOpen = { open = true })
            if (open) SpaceSheet(ways) { open = false }
        }
        rule.onNodeWithTag(SPACE_RAIL).assertIsDisplayed()
        rule.onNodeWithContentDescription("New project").performClick()
        rule.onNodeWithTag(SPACE_TITLE).performClick()
        rule.onNodeWithTag(SPACE_SHEET).assertIsDisplayed()
        rule.onNodeWithText("Home").assertIsDisplayed()
        rule.onNodeWithText("New project").performClick()
        rule.waitForIdle()
        assertEquals(2, news)
    }

    @Test fun withoutProjectsTheTitleIsTheLogoAlone() {
        rule.setContent { SpaceTitle(SpaceWays(emptyList(), Spaces.HOME, pick = {}, new = {}, on = false), busy = false, onOpen = {}) }
        rule.onNodeWithContentDescription("botdot").assertIsDisplayed()
        rule.onNodeWithTag(SPACE_TITLE).assertDoesNotExist()
    }
}
