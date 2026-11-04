package dev.botdot.app.ui

import dev.botdot.app.data.Queued
import dev.botdot.app.data.Run
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A waiting message whose turn came never leaves a bot's chat: it left the server's list before its run was read, and
 * stands, as it stood and without buttons, until a run with its id (or one it was steered into) is in the chat. One
 * the owner took back is not kept.
 */
class QueuedStartsTest {
    private val ask = Queued("q1", "Why I don't see those files?")
    private val other = Queued("q2", "And the logs?")

    @Test fun aMessageThatLeftTheListStaysUntilItsRunIsThere() {
        val starting = leftQueue(emptyList(), listOf(ask, other), listOf(other), emptySet())
        assertEquals(listOf(ask), starting)
        assertEquals(listOf(ask), stillStarting(starting, listOf(Run(id = "r0", status = "success"))))
        assertEquals(listOf(ask), stillStarting(starting, listOf(Run(id = "q1", status = "queued"))))
        assertEquals(emptyList<Queued>(), stillStarting(starting, listOf(Run(id = "q1", status = "running"))))
    }

    @Test fun aMessageSteeredIntoARunIsThereWithIt() {
        val run = Run(id = "r1", status = "running", steeredValue = Json.parseToJsonElement("""[{"id":"q1","text":"Why I don't see those files?"}]"""))
        assertEquals(emptyList<Queued>(), stillStarting(listOf(ask), listOf(run)))
    }

    @Test fun oneTakenBackIsNotKeptAndNoneIsAddedTwice() {
        assertEquals(emptyList<Queued>(), leftQueue(emptyList(), listOf(ask), emptyList(), setOf("q1")))
        assertEquals(listOf(ask), leftQueue(listOf(ask), listOf(ask), emptyList(), emptySet()))
        assertEquals(emptyList<Queued>(), leftQueue(emptyList(), listOf(ask), listOf(ask), emptySet()))
    }
}
