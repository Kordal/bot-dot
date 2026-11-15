package dev.botdot.app.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The notice before the first message (AiNotice, #1374): asked until it is accepted, then never again on the device. */
class AiNoticeTest {
    /** Preferences kept in memory, as a phone keeps them in its file. */
    private class Memory : DataStore<Preferences> {
        private val now = MutableStateFlow(emptyPreferences())
        override val data = now
        override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences = transform(now.value).also { now.value = it }
    }

    @Test fun theNoticeIsAskedUntilItIsAcceptedThenNeverAgain() = runTest {
        val settings = Settings(Memory())
        assertTrue(AiNotice.asks(settings), "a new device: the notice comes before the first message")
        settings.setAiNoticeSeen()
        assertFalse(AiNotice.asks(settings))
        assertFalse(AiNotice.asks(settings), "and stays accepted")
        assertEquals("Your bots run on Claude by Anthropic. What you send them goes to Anthropic.", AiNotice.text)
        assertEquals("Continue", AiNotice.go)
    }
}
