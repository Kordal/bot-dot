package dev.botdot.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A group's notes as the botdot server hands them out (ADR 139; docs/api.md, "Groups"): `GET /api/group-chats/:id/notes`
 * as test/group-notes.test.js reads it.
 */
class GroupNotesTest {
    @Test fun notesAreDecisionsThenToDoThenFactsEachOldestFirstAndOnlyNotes() {
        val answer = Json.parseToJsonElement("""{"items":[
            {"id":"f1","kind":"fact","text":"Staging is botdot-staging","by":"botdot","at":"2026-11-01T10:00:00Z"},
            {"id":"d2","kind":"decision","text":"Price is 9 EUR","by":"bot","bot":"coder","at":"2026-11-02T10:00:00Z"},
            {"id":"o1","kind":"open","text":"Coder: fix login","by":"botdot","at":"2026-11-01T11:00:00Z"},
            {"id":"d1","kind":"decision","text":"Polish first","by":"owner","at":"2026-11-01T09:00:00Z"},
            {"id":"x1","kind":"idea","text":"Not a kind","by":"owner","at":"2026-11-01T09:00:00Z"},
            {"id":"","kind":"fact","text":"No id","by":"owner","at":"2026-11-01T09:00:00Z"},
            {"id":"e1","kind":"fact","text":"  ","by":"owner","at":"2026-11-01T09:00:00Z"}
        ]}""")
        val notes = GroupNotes.of(answer)
        assertEquals(listOf("d1", "d2", "o1", "f1"), notes.map { it.id })
        assertEquals("owner", notes.first().by)
        assertEquals(emptyList<GroupNote>(), GroupNotes.of(Json.parseToJsonElement("""{"error":"x"}""")))
    }

    @Test fun aNoteIsSavedOnOneLineAndCut() {
        assertEquals("Launch in Polish first", GroupNotes.clean("  Launch\n in  Polish first "))
        assertEquals(GroupNotes.TEXT_MAX, GroupNotes.clean("a".repeat(300)).length)
    }
}
