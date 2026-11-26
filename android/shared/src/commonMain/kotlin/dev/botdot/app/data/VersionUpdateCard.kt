package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The Chief's note of a new version as data (`versionUpdate` beside the message's `text`, docs/api.md "A new version in the
 * Chief's chat", `version-update-card`, #1759): the head, the line saying when the account moves to it, the What's new titles
 * and the card in Needs you, when there is one. The apps draw it as one card of the block kit; an older server's has none and
 * its text is drawn as it always was. Every word comes in the owner's language from the server; a title is plain text, never
 * markup (ADR 004). Read as the web page reads it (public/version-update.js).
 */
data class VersionUpdateCard(
    /** "A new version of botdot is ready": the line the list shows for the Chief's chat. */
    val head: String,
    val version: String?,
    /** When the account moves to it. */
    val body: String,
    /** The heading over [notes], "What's new". */
    val heading: String,
    val notes: List<String>,
    /** The `update` card in Needs you the button opens, or null when there is none. */
    val cardId: String?,
) {
    companion object {
        const val FEATURE = "version-update-card"
        private val CARD = Regex("^[0-9a-fA-F]{8}$")

        /** The note as the server sends it, or null for none (or for anything that is not one). */
        fun of(e: JsonElement?): VersionUpdateCard? {
            val o = e as? JsonObject ?: return null
            val head = o["head"].string()?.trim()?.ifEmpty { null } ?: return null
            return VersionUpdateCard(
                head = head, version = o["version"].string()?.trim()?.ifEmpty { null }, body = o["body"].string()?.trim().orEmpty(),
                heading = o["heading"].string().orEmpty(),
                notes = (o["notes"] as? JsonArray).orEmpty().mapNotNull { ((it as? JsonObject)?.get("title")).string()?.trim()?.ifEmpty { null } },
                cardId = o["cardId"].string()?.takeIf { CARD.matches(it) },
            )
        }

        private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content?.ifEmpty { null }
    }
}
