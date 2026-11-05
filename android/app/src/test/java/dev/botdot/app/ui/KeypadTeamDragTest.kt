package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Group
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A team's chat on Home (#697) moves as a bot's key does: pressed, held and dragged to another place, on the keypad
 * and in a phone's sections, with the update the list's drag sends for a group.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w1280dp-h800dp")
class KeypadTeamDragTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val bots = listOf(
        Bot(id = "alfred", name = "Alfred", color = "#378add", pinned = 1),
        Bot(id = "coder", name = "Coder", color = "#1d9e75", group = "Work", order = 1),
        Bot(id = "writer", name = "Writer", color = "#e24b4a", group = "Work", order = 2),
    )
    private val team = Group(id = "g1", name = "Growth Team", membersValue = JsonArray(listOf(JsonPrimitive("coder"), JsonPrimitive("writer"))),
        pinned = 2, team = "t1", lead = "coder")
    // Pinned (one order for bots and groups, pins-shared): Alfred, Growth Team; Work: Coder, Writer.
    private val pages = Keypad.pages(bots, listOf(team), shared = true)
    private fun look(k: Keypad.Key) = when (k) {
        is Keypad.Key.OfBot -> KeyLook(k.bot.name, "Ready", k.bot.color)
        is Keypad.Key.OfGroup -> KeyLook(k.group.name, "Ready", null, members = bots.filter { it.id in k.group.members })
    }
    private fun sent(k: Keypad.Key, place: ListLayout.Place) = "${k.id} ${ListLayout.change(place, group = k is Keypad.Key.OfGroup, pinned = k.pinned)}"

    private fun drag(name: String, onto: String) {
        val from = rule.onNodeWithText(name).fetchSemanticsNode().boundsInRoot
        val to = rule.onNodeWithText(onto).fetchSemanticsNode().boundsInRoot
        rule.onNodeWithText(name).performTouchInput {
            down(center)
            advanceEventTime(viewConfiguration.longPressTimeoutMillis + 100)
            val end = to.center - from.topLeft
            for (step in 1..10) moveTo(center + (end - center) * (step / 10f))
            up()
        }
        rule.waitForIdle()
    }

    @Test @Config(qualifiers = "w840dp-h600dp")
    fun onTheKeypadATeamsKeyMovesAmongThePinnedAndOntoAPage() {
        val moves = mutableListOf<String>()
        rule.setContent {
            Row(Modifier.fillMaxSize()) {
                HomePanes(Keypad.home(840), 840, listShown = true,
                    keypad = { m -> KeypadView(pages, active = null, look = ::look, onKey = {}, onAsk = {}, modifier = m, onMove = { k, p -> moves += sent(k, p) }) },
                    list = {},
                ) { m -> Box(m) { Text("The Chief's chat") } }
            }
        }
        drag("Growth Team", onto = "Alfred")
        assertEquals(listOf("""group:g1 {"pinned":1}"""), moves)
        drag("Growth Team", onto = "Work")
        assertEquals("""group:g1 {"category":"Work","order":1,"pinned":0}""", moves.last())
    }

    @Test @Config(qualifiers = "w390dp-h800dp")
    fun onAPhoneABotsKeyAndATeamsKeyMove() {
        val moves = mutableListOf<String>()
        val opened = mutableListOf<String>()
        rule.setContent {
            KeypadSections(pages, ::look, onKey = { opened += it.id }, onChief = {}, modifier = Modifier.fillMaxSize(), onMove = { k, p -> moves += sent(k, p) })
        }
        drag("Growth Team", onto = "Alfred")
        assertEquals(listOf("""group:g1 {"pinned":1}"""), moves)
        drag("Writer", onto = "Coder")
        assertEquals("""writer {"group":"Work","order":1}""", moves.last())
        assertEquals("a drag opens no chat", emptyList<String>(), opened)
    }
}
