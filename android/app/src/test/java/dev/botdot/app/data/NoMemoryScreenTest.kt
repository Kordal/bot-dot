package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Memory has no screen (Milestone 9, capability 16): the chip under a reply and the card of a waiting memory change
 * say what the botdot server wrote (docs/api.md, Memory, "The contract"), a guarded change is told apart, and the
 * app calls none of the owner's routes for notes. `test/no-memory-screen-web.test.js` holds the web page's side.
 */
class NoMemoryScreenTest {
    private val now = listOf("memory", "memory-chips", "memory-cards", "memory-forget")
    private val before = listOf("memory", "staged-changes") // a botdot server of Milestone 8
    private fun learned(json: String): Learned = Api.JSON.decodeFromString(json)
    private fun change(json: String): MemoryChange = Api.JSON.decodeFromString(json)

    @Test fun theChipIsTheServersLineWhole() {
        val long = "Remembered until Sun 11 Oct, its own conclusion, not pinned: " + "The owner is in Berlin this week. ".repeat(4).trim() + " · unpinned its own “Use pnpm”"
        for ((kind, chip, icon) in listOf(
            Triple("memory", long, "🧠"),
            Triple("memory", "Updated: Use pnpm.", "🧠"),
            Triple("memory-shared", "Remembered for all bots: The owner lives in Łódź.", "🧠"),
            Triple("memory-pending", "Asked to change what you said: Use npm (waiting for your OK)", "⏳"),
            Triple("memory-pin", "Pinned: Use pnpm.", "🧠"),
            Triple("memory-removed", "Removed: Use npm. (since brought back)", "🧠"),
            Triple("memory-restored", "Restored for all bots: Use npm.", "🧠"),
            Triple("forgot", "Forgot what was said in 2 chats", "🧹"),
            Triple("skill", "Created skill weekly-roundup: it repeats", "✦"),
            Triple("skill-pending", "Asked to add the skill weekly-roundup (waiting for your OK)", "⏳"),
        )) {
            val x = Learned(kind, "what an older app would build its line from", kotlinx.serialization.json.JsonPrimitive(chip))
            assertEquals(kind, "$icon $chip", x.line(now))
            assertEquals("while the features are not known, what the server sent is printed", "$icon $chip", x.line(null))
        }
    }

    @Test fun anItemWithoutChipIsDrawnFromItsKindAndTextAsBefore() {
        // A note in a run from before the chips, and the kinds that never have one.
        assertEquals("🧠 Remembered: Use pnpm.", learned("""{"kind":"memory","text":"Use pnpm."}""").line(now))
        assertEquals("🧠 Remembered for all bots: Lives in Łódź.", learned("""{"kind":"memory-shared","text":"Lives in Łódź."}""").line(now))
        assertEquals("🧹 Forgot: Use npm.", learned("""{"kind":"forgot","text":"Use npm."}""").line(now))
        assertEquals("⏰ Added job Morning news", learned("""{"kind":"job","text":"Added job Morning news"}""").line(now))
        assertEquals("🔌 Used Gmail: send an email", learned("""{"kind":"connector","text":"Used Gmail: send an email"}""").line(now))
        // A `chip` that is no text is none.
        assertEquals("🧠 Remembered: Use pnpm.", learned("""{"kind":"memory","text":"Use pnpm.","chip":["x"]}""").line(now))
        assertEquals("🧠 Remembered: Use pnpm.", learned("""{"kind":"memory","text":"Use pnpm.","chip":"  "}""").line(now))
    }

    @Test fun againstAServerThatDoesNotAnnounceTheChipsTheChipIsBuiltAsToday() {
        assertEquals("🧠 Remembered: Use pnpm.", learned("""{"kind":"memory","text":"Use pnpm.","chip":"Updated: Use pnpm."}""").line(before))
        assertEquals("🧹 Forgot: 1 note", learned("""{"kind":"forgot","text":"1 note"}""").line(before))
        assertEquals("⏳ Asked to add to the shared memory: Lives in Łódź. (waiting for your OK)",
            learned("""{"kind":"memory-pending","text":"Asked to add to the shared memory: Lives in Łódź. (waiting for your OK)"}""").line(before))
        assertEquals("a kind it does not know: the text alone", "🧠 Removed: Use npm.", learned("""{"kind":"memory-removed","text":"Removed: Use npm."}""").line(before))
        assertTrue(announces(null, MEMORY_CHIPS)); assertTrue(announces(now, MEMORY_CARDS)); assertFalse(announces(before, MEMORY_CHIPS))
    }

    @Test fun aChipAboutANoteOpensNothing() {
        for (kind in listOf("memory", "memory-shared", "memory-pending", "memory-pin", "memory-removed", "memory-restored", "forgot", "something-new"))
            assertNull(kind, Learned(kind).opens)
        assertEquals(Learned.Opens.JOBS, Learned("job").opens)
        for (kind in listOf("instructions", "connector", "skill", "skill-updated", "skill-pending")) assertEquals(kind, Learned.Opens.SETTINGS, Learned(kind).opens)
    }

    @Test fun aSkillsChipOpensTheSettingsOnThatSkill() {
        assertEquals("buildr-pr-workflow", learned("""{"kind":"skill-updated","chip":"Changed the skill buildr-pr-workflow","skill":"buildr-pr-workflow"}""").opensSkill)
        assertEquals("a server that does not name it: the Skills alone", "", learned("""{"kind":"skill","text":"Saved the skill x"}""").opensSkill)
        for (kind in listOf("instructions", "connector", "job", "memory")) assertNull(kind, Learned(kind, skill = "x").opensSkill)
    }

    private val add = """{"id":"m1","action":"add","owner":"_shared","text":"The owner flies from Brussels.","botId":"b1","reason":"said in a mail","source":"outside",
        "title":"Add to the shared memory","meta":"after reading outside content","yes":"Approve","no":"Decline","current":null}"""
    private val edit = """{"id":"m2","action":"edit","text":"Lives in Kraków.","botId":"b1","current":{"id":"n1","text":"Lives in Łódź."},
        "title":"Change in the shared memory","meta":"from its memory review","yes":"Approve","no":"Decline"}"""
    private val remove = """{"id":"m3","action":"remove","text":"","botId":"b1","current":{"id":"n1","text":"Lives in Łódź."},
        "title":"Remove from the shared memory","meta":"after reading outside content","yes":"Approve","no":"Decline"}"""
    private val changeSaid = """{"id":"m4","action":"edit","owner":"b1","text":"Use npm.","botId":"b1","current":{"id":"n2","text":"Use pnpm."},"guarded":true,
        "title":"Change what you said","meta":"in a run you did not start","yes":"Change it","no":"Keep it"}"""
    private val removeSaid = """{"id":"m5","action":"remove","owner":"b1","text":"","botId":"b1","current":{"id":"n2","text":"Use pnpm."},"guarded":true,
        "title":"Remove what you said","meta":"in a run you did not start","yes":"Remove it","no":"Keep it"}"""
    private val forget = """{"id":"m6","action":"erase","owner":"b1","text":"Use pnpm. · Lives in Łódź. · and 2 chats","botId":"b1","noteId":"n2","guarded":true,
        "notes":[{"id":"n2","text":"Use pnpm."}],"runs":[{"runId":"r1","at":"2026-10-07T08:00:00.000Z","asked":"hi"}],
        "title":"Forget for good","meta":"in a run you did not start","yes":"Forget for good","no":"Keep"}"""

    @Test fun theCardOfAWaitingChangePrintsTheServersWords() {
        assertEquals(MemoryCard("Add to the shared memory", "after reading outside content · said in a mail", null, "The owner flies from Brussels.", "Approve", "Decline"), memoryCard(change(add), now))
        // A change is one block: what goes above what comes.
        assertEquals(MemoryCard("Change in the shared memory", "from its memory review", "Lives in Łódź.", "Lives in Kraków.", "Approve", "Decline", oneBlock = true), memoryCard(change(edit), now))
        assertEquals(MemoryCard("Remove from the shared memory", "after reading outside content", null, "Lives in Łódź.", "Approve", "Decline"), memoryCard(change(remove), now))
        assertEquals(MemoryCard("Change what you said", "in a run you did not start", "Use pnpm.", "Use npm.", "Change it", "Keep it", oneBlock = true), memoryCard(change(changeSaid), now))
        assertEquals(MemoryCard("Remove what you said", "in a run you did not start", null, "Use pnpm.", "Remove it", "Keep it"), memoryCard(change(removeSaid), now))
        assertEquals(MemoryCard("Forget for good", "in a run you did not start", null, "Use pnpm. · Lives in Łódź. · and 2 chats", "Forget for good", "Keep"), memoryCard(change(forget), now))
        // The same while the features are not known yet: a forget never reads "Add to the shared memory".
        assertEquals("Forget for good", memoryCard(change(forget), null).title)
    }

    @Test fun againstAServerThatDoesNotAnnounceTheCardsTheCardReadsAsToday() {
        val older = { json: String -> memoryCard(change(json), before) }
        assertEquals(MemoryCard("Add to the shared memory", "after reading outside content · said in a mail", null, "The owner flies from Brussels.", "Approve", "Decline"), older(add))
        assertEquals(MemoryCard("Change in the shared memory", "after reading outside content", "Now: Lives in Łódź.", "New: Lives in Kraków.", "Approve", "Decline"), older(edit))
        assertEquals(MemoryCard("Remove from the shared memory", "after reading outside content", "Now: Lives in Łódź.", "", "Forget it", "Decline"), older(remove))
        // What such a server really sends: none of the words. The same card.
        val bare = """{"id":"m2","action":"edit","text":"Lives in Kraków.","botId":"b1","current":{"id":"n1","text":"Lives in Łódź."}}"""
        assertEquals(older(edit), memoryCard(change(bare), before))
        assertEquals(older(edit), memoryCard(change(bare), now))
        // A word that is no text leaves today's card, and the changes are still read.
        assertEquals(older(edit), memoryCard(change(edit.replace("\"yes\":\"Approve\"", "\"yes\":{\"label\":\"Approve\"}")), now))
        assertEquals("Forget it", memoryCard(change(remove.replace("\"no\":\"Decline\"", "\"no\":7")), now).yes)
    }

    @Test fun aGuardedChangeWithoutTheServersWordsNeverReadsApprove() {
        // A server that breaks the contract, or one whose features lack the cards: the contract's words, the app's copy.
        val bare = { action: String -> change("""{"id":"m6","action":"$action","text":"Use npm.","current":{"id":"n2","text":"Use pnpm."},"guarded":true,"yes":"Approve"}""") }
        for (features in listOf(now, before, null)) {
            assertEquals(MemoryCard("Forget for good", "", null, "Use npm.", "Forget for good", "Keep"), memoryCard(bare("erase"), features))
            assertEquals(MemoryCard("Remove what you said", "", null, "Use pnpm.", "Remove it", "Keep it"), memoryCard(bare("remove"), features))
            assertEquals(MemoryCard("Change what you said", "", "Use pnpm.", "Use npm.", "Change it", "Keep it", oneBlock = true), memoryCard(bare("edit"), features))
        }
    }

    @Test fun aGuardedChangeIsToldApart() {
        assertEquals(listOf(false, false, false, true, true, true), listOf(add, edit, remove, changeSaid, removeSaid, forget).map { change(it).guarded })
        assertFalse("only true guards", change("""{"id":"m1","guarded":"true"}""").guarded)
        assertFalse(change("""{"id":"m1","guarded":1}""").guarded)
    }

    @Test fun theListOnTopNamesAGuardedChangeByItsTitle() {
        val coder = Bot(id = "b1", name = "Coder", color = "#378add")
        val waiting = waitingOf(listOf(coder), null, Needs(memory = listOf(change(add), change(forget), change(changeSaid))), null)
        assertEquals(listOf("Coder wants to change the shared memory", "Coder: Forget for good", "Coder: Change what you said"), waiting.map { it.text })
    }

    @Test fun aSkillABotWroteIsReadWithItsWholeText() {
        val text = "# Weekly roundup\n\n1. Read the feeds.\n2. Pick three.\n" + "More steps. ".repeat(200)
        val asks = Ask.list("""[{"id":"a1","kind":"skill","written":true,"url":"","reason":"I keep doing this","text":"Wants to keep a skill it wrote: “weekly-roundup”",
            "bot":{"id":"b1","name":"Coder"},"skill":{"name":"weekly-roundup","description":"The week in three stories","files":1,"exists":false,"instructions":${kotlinx.serialization.json.JsonPrimitive(text)}}},
            {"id":"a2","kind":"skill","url":"https://example.org/pdf","skill":{"name":"pdf","description":"Reads PDFs","files":2,"exists":false}},
            {"id":"a3","kind":"permission","written":true,"permission":"web"}]""")
        assertEquals(listOf(true, false, false), asks.map { it.written })
        assertEquals("Wants to keep a skill it wrote: “weekly-roundup”", asks[0].line)
        assertEquals(text, asks[0].skill?.instructions)
        assertEquals("", asks[1].skill?.instructions)
        val coder = Bot(id = "b1", name = "Coder")
        assertEquals("Coder: Wants to keep a skill it wrote: “weekly-roundup”", waitingOf(listOf(coder), null, Needs(asks = asks.take(1)), null).single().text)
    }

    @Test fun theAppAsksForGuardedChangesAndReadsTheAnswersText() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            val json = { body: String -> MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build() }
            server.enqueue(json("[$add,$forget]"))
            assertEquals(listOf("m1" to false, "m6" to true), api.memoryChanges().map { it.id to it.guarded })
            assertEquals("/api/memory/pending?guarded=1", server.takeRequest().target)
            for ((answer, text) in listOf("""{"erased":["n2"],"leftOut":["r1"],"text":"Forgotten"}""" to "Forgotten", """{"declined":true,"text":"Kept"}""" to "Kept",
                """{"note":{"id":"n1"},"text":"Changed"}""" to "Changed", """{"declined":true}""" to null)) {
                server.enqueue(json(answer))
                assertEquals(text, api.settleMemoryChange("m6", text != "Kept" && text != null).text)
                assertEquals("/api/memory/pending/m6", server.takeRequest().target)
            }
        } finally {
            server.close()
        }
    }

    @Test fun nothingOfTheMemoryScreenIsLeft() {
        assertTrue(runCatching { Class.forName("dev.botdot.app.ui.MemorySectionKt") }.isFailure)
        for (gone in listOf("Note", "BotNotes", "MemoryOverview", "SearchHit", "SearchResults"))
            assertTrue(gone, runCatching { Class.forName("dev.botdot.app.data.$gone") }.isFailure)
        // None of the owner's routes for notes is called: the calls are gone.
        val calls = Api::class.java.declaredMethods.map { it.name }.toSet()
        assertEquals(emptySet<String>(), calls intersect setOf("memory", "searchMemory", "addNote", "editNote", "deleteNote"))
        assertTrue("memoryChanges" in calls && "settleMemoryChange" in calls)
    }
}
