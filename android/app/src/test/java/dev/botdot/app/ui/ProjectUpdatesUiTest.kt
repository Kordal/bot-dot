package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.botdot.app.data.Company
import dev.botdot.app.data.ProjectUpdateSetting
import dev.botdot.app.data.ProjectUpdates
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w411dp-h891dp")
class ProjectUpdatesUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun onePreferenceShowsPreservedSchedulesAndSavesAChoice() {
        var picked = ""
        val c = Company(id = "garden", updates = ProjectUpdateSetting(schedules = listOf("Every Friday at 17:00 (UTC)")))
        rule.setContent { Column { ProjectUpdateRows(c) { picked = it } } }
        rule.onNodeWithText("Existing schedules").assertIsDisplayed()
        rule.onNodeWithText("Every Friday at 17:00 (UTC)").assertIsDisplayed()
        rule.onNodeWithText("Weekly").performClick()
        assertEquals("weekly", picked)
    }

    @Test fun replacedSchedulesDoNotAddAnotherPreferenceToTheNormalFlow() {
        assertEquals(listOf("off", "daily", "twice-weekly", "weekly"), ProjectUpdates.choices(ProjectUpdateSetting(every = "weekly")))
    }
}
