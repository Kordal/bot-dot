package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.botdot.app.data.Company
import dev.botdot.app.data.Proposed
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w411dp-h891dp")
class ProjectCreationUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun aLongFirstStepCannotHideTheReviewAction() {
        var reviews = 0
        val c = Company(id = "p", conversation = true, start = "Plan the launch", firstStep = "A long first step. ".repeat(100), proposal = listOf(buildJsonObject {}))
        rule.setContent { ProjectCreationIntro(c, onChat = {}, onReview = { reviews++ }) {} }
        rule.onNodeWithText("Review first step").performScrollTo().assertIsDisplayed().performClick()
        assertEquals(1, reviews)
    }

    @Test fun theReviewShowsTheEffectiveAssignmentToolsAndSchedule() {
        val b = Proposed(key = "p", prompt = "Read drafts. Never publish.", tools = listOf("Read", "Write"), cron = "0 9 * * *", schedule = "Every day at 09:00")
        rule.setContent { Column { CreationBotDetails(b, "UTC") } }
        rule.onNodeWithText("Read drafts. Never publish.").assertIsDisplayed()
        rule.onNodeWithText("Read").assertIsDisplayed()
        rule.onNodeWithText("Write").assertIsDisplayed()
        rule.onNodeWithText("Every day at 09:00 · UTC").assertIsDisplayed()
    }
}
