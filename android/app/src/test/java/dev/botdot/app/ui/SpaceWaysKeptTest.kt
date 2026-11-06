package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import dev.botdot.app.data.Spaces
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A bot's work changes the bot list every second, not the spaces (#1114): the window keeps its SpaceWays, so the
 * NavHost that captures it keeps its graph, and a tap still reaches what the window does now.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SpaceWaysKeptTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun keptWhileTheSpacesAreTheSameAndNewWhenTheyChange() {
        var tick by mutableIntStateOf(0) // what a working bot changes
        var list by mutableStateOf(listOf(Spaces.Space("p1", "Launch", "#378add", 0)))
        val seen = mutableListOf<SpaceWays>()
        val picked = mutableListOf<String>()
        rule.setContent {
            val t = tick
            seen += rememberSpaceWays(list.map { it.copy() }, Spaces.HOME, on = true, pick = { picked += "$it@$t" }, new = {}, newBot = {})
        }
        rule.runOnIdle { tick = 1 }
        rule.runOnIdle { tick = 2 }
        rule.runOnIdle {
            assertEquals(3, seen.size)
            assertSame(seen[0], seen[1])
            assertSame(seen[0], seen[2])
            seen.last().pick("p1")
            assertEquals("the latest pick", listOf("p1@2"), picked)
            list = listOf(Spaces.Space("p1", "Launch", "#378add", 1)) // a question waits in the project
        }
        rule.runOnIdle { assertNotSame(seen[0], seen.last()) }
    }
}
