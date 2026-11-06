package dev.botdot.app.ui

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Send, the most tapped control in the app, and Stop in its place on an older botdot, are tapped over Android's 48 dp
 * least (#1113), while the circle drawn stays 36 dp.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w400dp-h800dp")
class SendTargetTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun sendAndStopAreTappedOver48dp() {
        var busy by mutableStateOf(false)
        rule.setContent { Composer("Message", files = null, busy = busy, outbox = Outbox(), onSend = { _, _ -> }, onStop = {}, onError = {}) }
        rule.onNodeWithContentDescription("Send").assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        busy = true
        rule.onNodeWithContentDescription("Stop").assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
    }
}
