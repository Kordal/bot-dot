package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A reply draft revealed at a steady pace (#860, #862): DraftPace, the rule rememberPacedDraft draws by. */
class PacedDraftTest {
    private val frame = DraftPace.FRAME_NANOS

    /** Frames of 60 a second from [start], until the pace has shown all of its target: how many it took. */
    private fun framesToCatchUp(pace: DraftPace, start: Long = 0L): Int {
        var n = 0
        while (pace.frame(start + (n + 1) * frame)) n++
        return n + 1
    }

    @Test
    fun aBacklogIsCaughtUpInAbout250ms() {
        val pace = DraftPace()
        pace.aim("x".repeat(90))
        val frames = framesToCatchUp(pace)
        assertEquals("x".repeat(90), pace.shown)
        assertTrue("$frames frames", frames in 14..16) // 250 ms at 60 frames a second
    }

    @Test
    fun aSmallBacklogShowsOneGraphemeAFrame() {
        val pace = DraftPace()
        pace.aim("abc")
        assertTrue(pace.frame(frame)); assertEquals("a", pace.shown)
        assertTrue(pace.frame(2 * frame)); assertEquals("ab", pace.shown)
        assertFalse(pace.frame(3 * frame)); assertEquals("abc", pace.shown)
        assertFalse(pace.frame(4 * frame))
    }

    @Test
    fun theRateFollowsTheBacklogOfEachNewDraft() {
        val pace = DraftPace()
        pace.aim("a".repeat(30))
        repeat(5) { pace.frame((it + 1) * frame) }
        val before = pace.shown.length
        pace.aim("a".repeat(30) + "b".repeat(300)) // a fast stream: more is left, so more is shown a frame
        pace.frame(6 * frame)
        assertTrue(pace.shown.length - before > 15)
        assertTrue(pace.shown.startsWith("a".repeat(before)))
    }

    @Test
    fun aDraftThatDoesNotGoOnFromWhatIsShownIsShownAtOnce() {
        val pace = DraftPace()
        pace.aim("Checking the logs")
        repeat(10) { pace.frame((it + 1) * frame) }
        pace.aim("Done.")
        assertEquals("Done.", pace.shown)
        assertFalse(pace.frame(20 * frame))
        pace.aim("")
        assertEquals("", pace.shown)
    }

    @Test
    fun aGraphemeIsNeverSplit() {
        val pace = DraftPace()
        val text = "Ok 👍🏽 and 🇵🇱 and e\u0301"
        pace.aim(text)
        val seen = mutableListOf<String>()
        var t = 0L
        while (pace.frame(++t * frame)) seen += pace.shown
        seen += pace.shown
        assertEquals(text, seen.last())
        assertTrue(seen.none { it.endsWith("\uD83D") || it.endsWith("👍") || it.endsWith("🇵") || it.endsWith("e") })
    }

    @Test
    fun aPauseIsNotSpentAllAtOnce() {
        val pace = DraftPace()
        pace.aim("abc")
        framesToCatchUp(pace)
        pace.aim("abc" + "d".repeat(60))
        pace.frame(10_000_000_000L) // the first frame after ten idle seconds counts as one frame
        assertTrue(pace.shown.length < 20)
    }

    @Test
    fun graphemesAreCountedFromWhereTheShownTextEnds() {
        assertEquals(3, DraftPace.graphemes("ab👍🏽cd", 2))
        assertEquals(0, DraftPace.graphemes("ab", 2))
        assertEquals(6, DraftPace.after("ab👍🏽cd", 2, 1))
    }
}
