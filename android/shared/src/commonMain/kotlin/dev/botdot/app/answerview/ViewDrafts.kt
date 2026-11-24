package dev.botdot.app.answerview

import dev.botdot.app.data.messageKey
import kotlinx.serialization.json.JsonElement

/**
 * What the owner typed into the inputs of answer views and has not sent, and what each view sent (#1628, ADR 265): kept
 * for as long as the app runs, so that a view drawn again (the chat scrolls, the screen turns) has what was typed in its
 * inputs, until it is sent. A view is named by its reply and its place in it. At most [CAP] views are kept.
 */
class ViewDrafts {
    private class Entry(val values: MutableMap<String, JsonElement> = LinkedHashMap(), var last: Pair<String, String>? = null)
    private val views = LinkedHashMap<String, Entry>()

    val size get() = views.size

    private fun entry(view: String): Entry {
        val h = views.remove(view) ?: Entry()
        views[view] = h
        while (views.size > CAP) views.remove(views.keys.first())
        return h
    }

    /** What was typed into [view], by the path of each input. */
    fun of(view: String): Map<String, JsonElement> = views[view]?.values.orEmpty()

    fun put(view: String, path: String, raw: JsonElement) { entry(view).values[path] = raw }

    /** The key of the message [text] of [view]: the same while its text is the same, a new one once it changed (as a card of questions does). */
    fun keyFor(view: String, text: String): String {
        val h = entry(view)
        return (h.last?.takeIf { it.first == text } ?: (text to messageKey()).also { h.last = it }).second
    }

    /** [view] went: its typed values are dropped. */
    fun sent(view: String) { entry(view).values.clear() }

    companion object { const val CAP = 300 }
}
