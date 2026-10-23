package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The list's "Shared rooms" row (#493): after its name only the invitations that wait, so it stays one short line. */
class RoomWordsTest {
    @Test fun nothingWaitsSaysNothing() = assertNull(RoomWords.rowLine(0))

    @Test fun invitationsCount() {
        assertEquals("1 invitation", RoomWords.rowLine(1))
        assertEquals("3 invitations", RoomWords.rowLine(3))
    }
}
