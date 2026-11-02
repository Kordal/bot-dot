package dev.botdot.app.data

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * A note of a group (ADR 139): what was settled in its chat, which every member's turn reads above the chat.
 * [kind] is "decision", "open" or "fact"; [by] who wrote it: "owner", "bot" or "botdot". A note the owner wrote
 * or changed stays as they wrote it.
 */
data class GroupNote(val id: String, val kind: String, val text: String, val by: String, val at: String)

object GroupNotes {
    val KINDS = listOf("decision", "open", "fact")
    const val TEXT_MAX = 240
    /** The server's feature that says it keeps a group's notes: an older server has none, and the panel shows none. */
    const val FEATURE = "group-notes"

    /** The word for a kind, as the web page says it. */
    fun kindWord(kind: String): String = when (kind) {
        "decision" -> tr("Decision")
        "open" -> tr("To do")
        "fact" -> tr("Fact")
        else -> kind
    }

    /** The notes the server answered ({ items }), those that are notes: decisions first, then to do, then facts, each oldest first. */
    fun of(answer: JsonElement?): List<GroupNote> {
        val items = ((answer as? JsonObject)?.arr("items")).orEmpty()
        val notes = items.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            GroupNote(o.str("id"), o.str("kind"), o.str("text"), o.str("by"), o.str("at")).takeIf { it.id.isNotEmpty() && it.kind in KINDS && it.text.isNotBlank() }
        }
        return KINDS.flatMap { k -> notes.filter { it.kind == k }.sortedBy { it.at } }
    }

    /** A note's line as it is saved: one line, without the blanks around it, at most [TEXT_MAX] characters. */
    fun clean(typed: String): String = typed.replace(Regex("\\s+"), " ").trim().take(TEXT_MAX)
}
