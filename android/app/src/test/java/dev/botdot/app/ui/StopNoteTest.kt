package dev.botdot.app.ui

import dev.botdot.app.data.ApiException
import org.junit.Assert.assertEquals
import org.junit.Test

/** Stop on a bot's run or the Chief's reply says what came of it (#1070), as the web page's Stop does. */
class StopNoteTest {
    @Test fun itSaysItIsStoppingOrWhyNot() {
        assertEquals("Stopping…", stopNote(Result.success(Unit)))
        assertEquals("Not connected to botdot", stopNote(Result.failure<Unit>(ApiException("Not connected to botdot"))))
        assertEquals("That run has already ended.", stopNote(Result.failure<Unit>(ApiException("That run has already ended.", 409, said = true))))
        assertEquals("Couldn't stop", stopNote(Result.failure<Unit>(IllegalStateException())))
    }
}
