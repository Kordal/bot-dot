package dev.botdot.app.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

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

    @Test fun theFirstSendIsHeldForTheNoticeAndContinueSendsIt() = runTest {
        val settings = Settings(Memory())
        val gate = AiNotice.Gate(settings)
        assertNull(gate.send("Hi"), "held: the notice shows first")
        assertTrue(gate.asking)
        assertNull(gate.send("Hi again"), "a tap while it shows does nothing")
        assertEquals("Hi", gate.accept(), "Continue: the held words go")
        assertFalse(gate.asking)
        assertFalse(AiNotice.asks(settings), "accepted for good")
        assertEquals("Next", gate.send("Next"), "never held again")
    }

    @Test fun aDismissedNoticeSendsNothingAndAsksAgainNextTime() = runTest {
        val settings = Settings(Memory())
        val gate = AiNotice.Gate(settings)
        assertNull(gate.send("Hi"))
        gate.dismiss() // swiped away
        assertFalse(gate.asking)
        assertNull(gate.accept(), "nothing held: nothing to send")
        assertTrue(AiNotice.asks(settings), "not accepted")
        assertNull(gate.send("Hi"), "the next Send asks again")
    }

    @Test fun aSecondTapWhileTheFirstIsCheckedDoesNothing() = runTest {
        val slow = CompletableDeferred<Unit>()
        val settings = Settings(object : DataStore<Preferences> {
            private val now = MutableStateFlow(emptyPreferences())
            override val data = flow { slow.await(); emitAll(now) }
            override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences = transform(now.value).also { now.value = it }
        })
        val gate = AiNotice.Gate(settings)
        val first = async { gate.send("Hi") }
        runCurrent() // the first one is being checked
        assertNull(gate.send("Hi"), "a double tap: ignored, no second check or sheet")
        slow.complete(Unit)
        assertNull(first.await(), "the first is held for the notice")
        assertTrue(gate.asking)
    }

    @Test fun aBoxWithoutSettingsSendsAtOnce() = runTest {
        assertEquals("Hi", AiNotice.Gate(null).send("Hi"))
    }
}
