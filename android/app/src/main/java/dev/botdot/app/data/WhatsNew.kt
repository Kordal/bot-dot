package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * What's new (#219): after an update, the notes of the releases this person has not seen, newest first, in a small
 * dialog with one button. The server keeps what was seen per account, so a note closed on the web page is gone here
 * too, and the reverse. Against a server without `whats-new` in `features` nothing is asked.
 */
object WhatsNew {
    const val FEATURE = "whats-new"
    val TITLE: String get() = tr("What's new")
    val GOT_IT: String get() = tr("Got it")
    /** Every note since the last one seen comes (#380): the newest this many show in full, the rest as titles that open. */
    const val OPEN = 3

    @Serializable data class Entry(val id: String = "", val title: String = "", val points: List<String> = emptyList())
    @Serializable data class Answer(val entries: List<Entry> = emptyList())

    /** Whether to ask: the server announces What's new. While its features are not known yet: no. */
    fun asks(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** The notes worth a dialog: those with an id and a title, as the server sent them (newest first). */
    fun shown(answer: Answer): List<Entry> = answer.entries.filter { it.id.isNotBlank() && it.title.isNotBlank() }

    /** The line above more than [OPEN] notes, as on the web page; none for fewer. */
    fun countLine(entries: List<Entry>): String? =
        if (entries.size > OPEN) tr("{n} changes, newest first. Tap a title for more.", "n" to entries.size) else null

    /** Whether a note shows its points before a tap: the newest [OPEN] do. */
    fun openAtFirst(index: Int): Boolean = index < OPEN

    /** What closing the dialog sends, any way it is closed: everything up to the newest note shown is seen. */
    fun seenBody(entries: List<Entry>): JsonObject = buildJsonObject { put("id", entries.first().id) }
}
