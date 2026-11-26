package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.botdot.app.data.ProjectUpdateCard
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A project update drawn as a card of the block kit (#1755; web: test/project-update-card-web.test.js): folded to its head
 * and pills at first, then, unfolded, only the sections that have something, in the design's order, with the faint line for
 * the rest. The data it is read from is [dev.botdot.app.data.ProjectUpdateCardTest].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w411dp-h891dp")
class ProjectUpdateCardUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val busy = """{"project":{"id":"p1","name":"Qwotz Development"},"since":"2026-11-24T09:00:00.000Z","summary":"1 needs you, 1 blocker, 2 done, 2 in progress",
        "pills":[{"level":"warn","text":"1 needs you"},{"level":"err","text":"1 blocker"},{"level":"ok","text":"2 done"},{"level":"info","text":"2 in progress"}],
        "needs":[{"botId":"qa","cardId":"ask9","name":"QA Tester","text":"May I sign in to staging?"}],
        "blockers":[{"botId":"infra","runId":"r5","name":"Infra Admin","text":"No access to OVH"}],
        "goals":[{"id":"v1","name":"Version 1.0","value":"4","of":"of 6 steps","ratio":0.6667,"level":"ok"}],
        "done":[{"id":"a","text":"Groq removed"},{"id":"b","text":"QA tests written up"}],"decisions":[{"id":"d1","text":"Mail goes through Brevo"}],
        "work":[{"botId":"infra","name":"Infra Admin","text":"Plan the **database** copy","state":"working"},{"name":"Mail","text":"Decide on Brevo","state":"planned"}],
        "replies":[{"botId":"qa","runId":"r9","name":"QA Tester","text":"Three new issues","at":"2026-11-25T08:41:00.000Z"}]}"""
    private val quiet = """{"project":{"id":"p1","name":"Qwotz Development"},"since":"","summary":"Nothing needs you",
        "pills":[{"level":"ok","text":"Nothing needs you"},{"level":"ok","text":"No blockers"}],"needs":[],"blockers":[],"goals":[],"done":[],"decisions":[],"work":[],"replies":[],
        "quiet":"Nothing marked done, no goal figures, no new decisions, nothing in progress, no new replies or reports."}"""
    private fun card(s: String) = ProjectUpdateCard.of(Json.parseToJsonElement(s))!!
    private val opened = mutableListOf<String>()
    private val projects = mutableListOf<String>()
    private fun show(c: ProjectUpdateCard, key: String = "k1") = rule.setContent {
        CompositionLocalProvider(LocalProjectUpdateWays provides ProjectUpdateWays(null, { opened += it }, { projects += it })) { Column { ProjectUpdateCardUi(c, key) } }
    }

    @Test fun theCardStartsFoldedToItsHeadAndPills() {
        show(card(busy))
        rule.onNodeWithText("Qwotz Development").assertExists()
        rule.onNodeWithText("1 needs you").assertExists()
        rule.onNodeWithText("1 blocker").assertExists()
        rule.onNodeWithText("2 in progress").assertExists()
        rule.onAllNodesWithText("May I sign in to staging?").assertCountEquals(0)
        rule.onAllNodesWithText("Needs you").assertCountEquals(0)
    }

    @Test fun aTapUnfoldsTheSectionsInTheDesignsOrderAndAnotherFoldsThem() {
        show(card(busy))
        rule.onNodeWithText("Qwotz Development").performClick()
        for (t in listOf("Needs you", "May I sign in to staging?", "QA Tester asks", "Blockers", "Infra Admin failed", "Goals", "Version 1.0", "of 6 steps", "Done", "Groq removed", "In progress", "Working", "To-do", "Decisions", "Mail goes through Brevo", "Latest replies"))
            rule.onNodeWithText(t).assertExists()
        rule.onNodeWithText("Qwotz Development").performClick()
        rule.onAllNodesWithText("Needs you").assertCountEquals(0)
    }

    @Test fun theButtonsOpenTheCardTheChatAndTheBoard() {
        show(card(busy))
        rule.onNodeWithText("Qwotz Development").performClick()
        rule.onNodeWithText("Open card").performClick()
        rule.onNodeWithText("Open chat").performClick()
        rule.onNodeWithText("Board").performClick()
        assertEquals(listOf("needs", "bot/infra"), opened)
        assertEquals(listOf("p1"), projects)
    }

    @Test fun anUpdateWithNothingInItsSectionsIsOneLineUnderItsPills() {
        show(card(quiet))
        rule.onNodeWithText("Nothing needs you").assertExists()
        rule.onNodeWithText("No blockers").assertExists()
        rule.onNodeWithText("Qwotz Development").performClick()
        rule.onNodeWithText("Nothing marked done", substring = true).assertExists()
    }

    @Test fun aBlockerWithNowhereToGoHasNoButtonAndTheNotesStandAtTheFoot() {
        show(card(busy.replace("\"blockers\":[{\"botId\":\"infra\",\"runId\":\"r5\",\"name\":\"Infra Admin\",\"text\":\"No access to OVH\"}]", "\"notes\":[\"No new recorded team report: Ops.\"],\"blockers\":[{\"name\":\"Members\",\"text\":\"HubSpot is not connected\"}]")))
        rule.onNodeWithText("Qwotz Development").performClick()
        rule.onNodeWithText("Members failed").assertExists()
        rule.onAllNodesWithText("Open chat").assertCountEquals(0)
        rule.onNodeWithText("No new recorded team report: Ops.").assertExists()
    }

    @Test fun nothingABotWroteBecomesMarkup() {
        val evil = card(busy.replace("Plan the **database** copy", "<img src=x onerror=alert(1)> **bold**"))
        show(evil)
        rule.onNodeWithText("Qwotz Development").performClick()
        rule.onNodeWithText("<img src=x onerror=alert(1)> bold", substring = true).assertExists()
    }
}
