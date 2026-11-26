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
import dev.botdot.app.data.VersionUpdateCard
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Chief's note of a new version as a card (#1759; web: test/version-update-card-web.test.js). The data it is read from is [dev.botdot.app.data.VersionUpdateCardTest]. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w411dp-h891dp")
class VersionUpdateCardUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val full = """{"head":"A new version of botdot is ready","version":"abc1234","body":"Your account moves to it tonight, when your bots are idle.",
        "heading":"What's new","notes":[{"title":"A project update is a card"},{"title":"<b>Plain</b> text"}],"cardId":"deadbeef"}"""
    private fun card(s: String) = VersionUpdateCard.of(Json.parseToJsonElement(s))!!
    private val opened = mutableListOf<String>()
    private fun show(c: VersionUpdateCard) = rule.setContent {
        CompositionLocalProvider(LocalProjectUpdateWays provides ProjectUpdateWays(null, { opened += it }, { })) { Column { VersionUpdateCardUi(c) } }
    }

    @Test fun theCardSaysTheHeadTheVersionWhenItMovesAndTheTitlesAsPlainText() {
        show(card(full))
        rule.onNodeWithText("A new version of botdot is ready").assertExists()
        rule.onNodeWithText("abc1234").assertExists()
        rule.onNodeWithText("Your account moves to it tonight, when your bots are idle.").assertExists()
        rule.onNodeWithText("What's new").assertExists()
        rule.onNodeWithText("A project update is a card").assertExists()
        rule.onNodeWithText("<b>Plain</b> text").assertExists()
        rule.onAllNodesWithText("Now").assertCountEquals(0)
        rule.onAllNodesWithText("Tonight").assertCountEquals(0)
    }

    @Test fun theOneButtonOpensNeedsYou() {
        show(card(full))
        rule.onNodeWithText("Open card").performClick()
        assertEquals(listOf("needs"), opened)
    }

    @Test fun withNoCardInNeedsYouThereIsNoButton() {
        show(card("""{"head":"A new version of botdot is ready","body":"Your account moves to it as soon as your bots are idle.","notes":[]}"""))
        rule.onAllNodesWithText("Open card").assertCountEquals(0)
        rule.onAllNodesWithText("What's new").assertCountEquals(0)
        rule.onNodeWithText("Your account moves to it as soon as your bots are idle.").assertExists()
    }
}
