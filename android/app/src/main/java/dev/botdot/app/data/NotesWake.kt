package dev.botdot.app.data

import java.time.Duration
import java.time.Instant

/**
 * Notes other bots left for a bot (#225): a note wakes it as soon as it is free, and the notes that still wait show
 * how long the oldest has waited, with "Run now" (feature `notes-wake`). As the web page draws them (public/app.js
 * waitingNotesHTML).
 */
object NotesWake {
    const val FEATURE = "notes-wake"

    /** When the oldest of them was left, or null when none says. */
    fun oldest(notes: List<InboxNote>): String? = notes.mapNotNull { it.at }.minOrNull()

    /** How long ago that was, short: "just now", "5m ago", "3h ago", "2d ago". */
    fun ago(iso: String?, now: Instant = Instant.now()): String {
        val at = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return ""
        val s = Duration.between(at, now).seconds.coerceAtLeast(0)
        return when {
            s < 60 -> tr("just now")
            s < 3600 -> tr("{n}m ago", "n" to s / 60)
            s < 86400 -> tr("{n}h ago", "n" to s / 3600)
            else -> tr("{n}d ago", "n" to s / 86400)
        }
    }

    /** The line under the notes that wait, without "Run now": "Oldest 3h ago", or empty. */
    fun line(notes: List<InboxNote>, now: Instant = Instant.now()): String = ago(oldest(notes), now).let { if (it.isEmpty()) "" else tr("Oldest {age}", "age" to it) }

    /** "Messaged …" for notes: read when the bot is free, not on some next run. */
    fun messagedHow(one: Boolean): String = " · " + if (one) tr("a note it reads when free") else tr("a note they read when free")
}
