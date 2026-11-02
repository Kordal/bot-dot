package dev.botdot.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import java.text.BreakIterator

/**
 * The part of a reply draft that is shown while it grows (#860): each new draft (the target) is revealed from what is
 * shown, in whole graphemes, at a rate that catches up with what is left in about [catchUpNanos] and at least one
 * grapheme a frame, so a slow stream reads letter by letter and a fast one never falls far behind. A draft that does
 * not start with what is shown (a tool call cleared it, a held marker changed it) is shown at once.
 */
internal class DraftPace(private val catchUpNanos: Long = 250_000_000L) {
    var shown: String = ""
        private set
    private var target = ""
    private var rate = 0.0 // graphemes a nanosecond
    private var owed = 0.0 // graphemes due and not shown yet
    private var last = -1L // the time of the last frame, or -1 when caught up

    /** A new draft from the server. */
    fun aim(next: String) {
        target = next
        if (!next.startsWith(shown)) { shown = next; owed = 0.0; last = -1L }
        rate = graphemes(next, shown.length).toDouble() / catchUpNanos
    }

    /** One frame at [now] (nanoseconds): more of the target is shown. False once all of it is. */
    fun frame(now: Long): Boolean {
        if (shown.length >= target.length) { last = -1L; owed = 0.0; return false }
        val dt = if (last < 0) FRAME_NANOS else (now - last).coerceAtLeast(0L)
        last = now
        owed += rate * dt
        val n = owed.toInt().coerceAtLeast(1)
        owed = (owed - n).coerceAtLeast(0.0)
        shown = target.substring(0, after(target, shown.length, n))
        if (shown.length < target.length) return true
        last = -1L; owed = 0.0 // caught up: the next draft starts from a frame, not from the time it waited
        return false
    }

    companion object {
        const val FRAME_NANOS = 16_666_667L

        /** How many graphemes [s] has from [from] on. */
        fun graphemes(s: String, from: Int): Int {
            if (from >= s.length) return 0
            val it = BreakIterator.getCharacterInstance().apply { setText(s) }
            var n = 0
            var at = it.following(from)
            while (at != BreakIterator.DONE) { n++; at = it.next() }
            return n
        }

        /** Where [n] graphemes after [from] in [s] end. */
        fun after(s: String, from: Int, n: Int): Int {
            val it = BreakIterator.getCharacterInstance().apply { setText(s) }
            var at = from
            repeat(n) { val next = it.following(at); if (next == BreakIterator.DONE) return s.length; at = next }
            return at
        }
    }
}

/**
 * The part of [target], a reply draft, to draw now ([DraftPace]): it grows each frame towards the target. With the
 * system's "Remove animations" on, the target is drawn as it comes.
 */
@Composable
internal fun rememberPacedDraft(target: String): String {
    val still = LocalFigureClock.current.still
    val pace = remember { DraftPace() }
    var shown by remember { mutableStateOf("") }
    if (!still) LaunchedEffect(target) {
        pace.aim(target)
        shown = pace.shown
        while (pace.frame(withFrameNanos { it })) shown = pace.shown
        shown = pace.shown
    }
    // At once, not a frame later: every draft when still, and one that does not go on from what is shown.
    return if (still || !target.startsWith(shown)) target else shown
}
