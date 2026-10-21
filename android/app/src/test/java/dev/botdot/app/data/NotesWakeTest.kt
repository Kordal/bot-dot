package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/** The notes that wait in a bot's chat (#225), as `test/notes-wake-web.test.js` has them on the web page. */
class NotesWakeTest {
    private val now = Instant.parse("2026-10-21T09:00:00Z")
    private fun note(at: String?) = InboxNote(fromId = "ia", from = "Infra Admin", text = "Add my key.", at = at)

    @Test fun theLineSaysHowLongTheOldestHasWaited() {
        assertEquals("Oldest 3h ago", NotesWake.line(listOf(note("2026-10-21T07:00:00Z"), note("2026-10-21T06:00:00Z")), now))
        assertEquals("Oldest 5m ago", NotesWake.line(listOf(note("2026-10-21T08:55:00Z")), now))
        assertEquals("Oldest 2d ago", NotesWake.line(listOf(note("2026-10-19T08:00:00Z")), now))
        assertEquals("Oldest just now", NotesWake.line(listOf(note("2026-10-21T08:59:30Z")), now))
        assertEquals("no time, no line", "", NotesWake.line(listOf(note(null)), now))
        assertEquals("", NotesWake.line(listOf(note("not a time")), now))
    }

    @Test fun messagedSaysANoteIsReadWhenTheBotIsFree() {
        assertEquals(" · a note it reads when free", NotesWake.messagedHow(true))
        assertEquals(" · a note they read when free", NotesWake.messagedHow(false))
    }

    @Test fun runNowReadsWhatBotdotDid() {
        assertEquals("queued", Api.JSON.decodeFromString(NotesRun.serializer(), """{"status":"queued"}""").status)
        assertEquals("an older answer without it", "", Api.JSON.decodeFromString(NotesRun.serializer(), "{}").status)
    }
}
