package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** A Reconnect card under the reply of a job's run (#431): what the run lists, read leniently, and what the card names. */
class ReconnectTest {
    @Test fun aRunListsItsCards() {
        val run = Api.JSON.decodeFromString(Run.serializer(), """{"id":"r1","reconnect":[{"app":"gmail","name":"Gmail"},{"app":"slack"},{"name":"no app"},"x"]}""")
        assertEquals(listOf(ReconnectCard("gmail", "Gmail"), ReconnectCard("slack", "")), run.reconnect)
        assertEquals(listOf("Gmail", "slack"), run.reconnect.map { it.label })
    }

    @Test fun aServerOlderThanTheCardSendsNone() {
        assertTrue(Api.JSON.decodeFromString(Run.serializer(), """{"id":"r1"}""").reconnect.isEmpty())
        assertTrue(Api.JSON.decodeFromString(Run.serializer(), """{"id":"r1","reconnect":{"app":"gmail"}}""").reconnect.isEmpty())
    }

    @Test fun theButtonSaysWhereItIs() {
        assertEquals(listOf("Reconnect", "Opening…", "Try again"), ReconnectStep.entries.map { it.button })
    }
}
