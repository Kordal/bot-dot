package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * The card of a tool the Chief asks to install for a bot, in Needs you and in the chats (docs/api.md "A tool to
 * install"). The botdot server hands the card out as data: `title`, `meta`, `body`, `warning` (only for a tool from a
 * link) and `facts`, rows of label and value. The app draws the fields it knows and decides no wording of the card:
 * its own are the two buttons and the word on an answered card. `public/tool-card.js` is the web page's side.
 */
object ToolCard {
    const val KIND = "tool"
    const val INSTALL = "Install"
    const val DECLINE = "Decline"

    /** Whether an ask is a tool's. */
    fun isTool(a: Ask): Boolean = a.kind == KIND

    /** A field as text: a string, or a number as it is written. Anything else (a list, an object, nothing) is not drawn. */
    fun text(v: JsonElement?): String = when {
        v !is JsonPrimitive -> ""
        v.isString -> v.content.trim()
        v.doubleOrNull?.isFinite() == true -> v.content
        else -> ""
    }

    /** One row of the facts. */
    data class Fact(val label: String, val value: String)

    /** What the card shows; a part the ask lacks is empty and left out. */
    data class Parts(val title: String, val meta: String, val body: String, val warning: String, val facts: List<Fact>)

    /** The rows of facts, in the server's order: every row that has a label or a value, also labels this app never saw. */
    fun facts(a: Ask): List<Fact> = (a.facts as? JsonArray).orEmpty()
        .map { row -> (row as? JsonObject).let { Fact(text(it?.get("label")), text(it?.get("value"))) } }
        .filter { it.label.isNotEmpty() || it.value.isNotEmpty() }

    /** The card's parts: the title, the meta line, what the tool is and why, the warning of a tool from a link, the facts. */
    fun parts(a: Ask): Parts = Parts(a.title.trim(), text(a.meta), text(a.body), text(a.warning), facts(a))

    /** The tool's name ("gh"), from the ask's `tool`; empty when the ask does not say. */
    fun name(a: Ask): String = text((a.tool as? JsonObject)?.get("name"))

    /**
     * What an answered card says. Install answers at once (`{ ok: true, installing: true }`) and the install goes on
     * by itself for minutes; its result arrives later as a Chief message. So not "Installed", a skill's word.
     */
    fun answered(yes: Boolean): String = if (yes) "Installing" else "Declined"
}
