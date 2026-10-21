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
    const val TITLE = "What's new"
    const val GOT_IT = "Got it"

    @Serializable data class Entry(val id: String = "", val title: String = "", val points: List<String> = emptyList())
    @Serializable data class Answer(val entries: List<Entry> = emptyList())

    /** Whether to ask: the server announces What's new. While its features are not known yet: no. */
    fun asks(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** The notes worth a dialog: those with an id and a title, as the server sent them (newest first). */
    fun shown(answer: Answer): List<Entry> = answer.entries.filter { it.id.isNotBlank() && it.title.isNotBlank() }

    /** What closing the dialog sends, any way it is closed: everything up to the newest note shown is seen. */
    fun seenBody(entries: List<Entry>): JsonObject = buildJsonObject { put("id", entries.first().id) }
}
