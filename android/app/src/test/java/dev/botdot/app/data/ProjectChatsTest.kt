package dev.botdot.app.data

import dev.botdot.app.data.ProjectChats.Height.CLOSED
import dev.botdot.app.data.ProjectChats.Height.FULL
import dev.botdot.app.data.ProjectChats.Height.HALF
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A bot's or a team's chat over the Projects screen (#705): what is kept across a turn of the phone, and where a drag takes the sheet. */
class ProjectChatsTest {
    @Test fun anOpenChatIsKeptAsItsKindAndId() {
        for (o in listOf(ProjectChats.Open(ProjectChats.BOT, "coder"), ProjectChats.Open(ProjectChats.TEAM, "g7"))) assertEquals(o, ProjectChats.of(o.key))
        assertEquals("bot:coder", ProjectChats.Open(ProjectChats.BOT, "coder").key)
        for (bad in listOf(null, "", "coder", "bot:", "room:r1", ":x")) assertNull("$bad", ProjectChats.of(bad))
    }

    @Test fun aDragUpMakesItFullAndDownHalfThenClosed() {
        assertEquals(FULL, ProjectChats.settle(HALF, -60f))
        assertEquals(FULL, ProjectChats.settle(FULL, -60f))
        assertEquals(HALF, ProjectChats.settle(FULL, 60f))
        assertEquals(CLOSED, ProjectChats.settle(HALF, 60f))
        assertEquals("a short drag leaves it", HALF, ProjectChats.settle(HALF, -20f))
        assertEquals(FULL, ProjectChats.settle(FULL, 47f))
    }

    @Test fun aTapOnTheHandleSwitchesHalfAndFull() {
        assertEquals(FULL, ProjectChats.settle(HALF, 0f, tap = true))
        assertEquals(HALF, ProjectChats.settle(FULL, 0f, tap = true))
    }
}
