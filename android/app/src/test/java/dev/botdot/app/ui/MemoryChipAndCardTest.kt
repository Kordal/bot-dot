package dev.botdot.app.ui

import dev.botdot.app.data.Ask
import org.junit.Assert.assertEquals
import org.junit.Test

/** How a chip is cut, and the title of the card of a skill a bot wrote (MEM-008). */
class MemoryChipAndCardTest {
    @Test fun whatARunLearnedIsPrintedWholeAndAnyOtherChipIsCutAsBefore() {
        val long = "🧠 Remembered until Sun 11 Oct, its own conclusion: " + "The owner is in Berlin this week. ".repeat(5)
        assertEquals(long, chipShown(long, whole = true).text)
        val cut = chipShown(long, whole = false).text
        assertEquals(CHIP_CHARS, cut.length)
        assertEquals(long.take(CHIP_CHARS - 1) + "…", cut)
        assertEquals("a short one is whole either way", "✨ Created Web Surfer", chipShown("✨ Created Web Surfer", whole = false).text)
    }

    @Test fun theCardOfASkillABotWroteIsTitledByTheServersLine() {
        val ask = { json: String -> Ask.list("[$json]").single() }
        assertEquals("Wants to change its skill “weekly-roundup”",
            skillTitle(ask("""{"id":"a1","kind":"skill","written":true,"text":" Wants to change its skill “weekly-roundup” ","skill":{"name":"weekly-roundup","exists":true,"instructions":"1. Read."}}""")))
        assertEquals("the app's own where the server sent none", "Wants to keep a skill it wrote: “weekly-roundup”",
            skillTitle(ask("""{"id":"a1","kind":"skill","written":true,"skill":{"name":"weekly-roundup","instructions":"1. Read."}}""")))
    }
}
