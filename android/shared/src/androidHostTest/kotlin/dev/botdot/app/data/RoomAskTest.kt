package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A shared room's cards (docs/api.md, "Shared rooms: the owner's mention"), read as the app reads `GET /api/asks`: a
 * tool a run from a room wants to use, and what would go to a room. The server's title, line, rows and yes word, and
 * whether the card takes a yes.
 */
class RoomAskTest {
    private val tool = """{"id":"t1","kind":"room-tool","botId":"b1","bot":{"id":"b1","name":"Scout","color":"#336699"},
        "room":{"id":"r1","name":"Garden club"},"tool":"Bash","title":"Let Scout use Bash?",
        "meta":"For your message in the shared room “Garden club”. Every tool it uses there waits for your OK, one call at a time.",
        "rows":[{"label":"Command","value":"ls plants"}],"yes":"Allow","yesOn":"card","at":"2026-10-22T15:00:00.000Z"}"""
    private val post = """{"id":"p1","kind":"room-post","botId":"b1","bot":{"id":"b1","name":"Scout","color":"#336699"},
        "room":{"id":"r1","name":"Garden club"},"from":"mention","title":"Post Scout's reply in “Garden club”?",
        "meta":"People of other accounts in the room read it. Nothing goes there until you post it.",
        "rows":[{"label":"Room","value":"Garden club"},{"label":"Text","value":"Ferns and hostas."}],"yes":"Post","yesOn":"card","at":"2026-10-22T15:01:00.000Z"}"""

    @Test fun aToolCardShowsTheToolAndTakesAYes() {
        val a = Ask.list("[$tool]").single()
        assertTrue(a.isRoomCard)
        assertEquals("Let Scout use Bash?", a.title)
        assertTrue(a.roomLine.startsWith("For your message in the shared room"))
        assertEquals(listOf("Command"), a.rows.map { it.label })
        assertEquals("Allow", a.yes)
        assertTrue(a.roomYes)
        assertTrue(a.standsInChat("b1"))
    }

    @Test fun aPostCardShowsTheTextAndItsYesIsPost() {
        val a = Ask.list("[$post]").single()
        assertTrue(a.isRoomCard)
        assertEquals(listOf("Room", "Text"), a.rows.map { it.label })
        assertEquals("Post", a.yes)
        assertTrue(a.roomYes)
    }

    @Test fun aCardThatCannotShowItAllTakesNoYes() {
        val long = post.replace("\"yesOn\":\"card\"", "\"yesOn\":\"card\",\"more\":true")
        assertFalse(Ask.list("[$long]").single().roomYes)
        val cut = tool.replace("\"value\":\"ls plants\"}", "\"value\":\"ls…\",\"more\":true}")
        assertFalse(Ask.list("[$cut]").single().roomYes)
    }
}
