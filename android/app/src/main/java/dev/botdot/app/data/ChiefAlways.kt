package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * One of the Chief's lasting grants, "Always allow" on its cards (#381): an action in a connected app (ADR 047,
 * `GET /api/chief/connector-actions`) or a type of change after the web (ADR 055, `GET /api/chief/after-web`).
 * [id] is what Revoke sends back, [label] the owner's words for it. Only a card adds one.
 */
data class ChiefGrant(val kind: Kind, val id: String, val label: String) {
    enum class Kind(val feature: String, val path: String, val key: String, val hint: String) {
        APP("chief-connectors", "/chief/connector-actions", "action", "In a connected app, with any details."),
        WEB("more-always", "/chief/after-web", "type", "Also after it read the web in a chat."),
    }

    companion object {
        const val TITLE = "Always approved"
        const val REVOKED = "Revoked: it asks you again"

        /** The kinds this server has: each only when `features` announces it. None while the features are not known. */
        fun kinds(features: Collection<String>?): List<Kind> = Kind.entries.filter { features != null && it.feature in features }

        /**
         * The grants in an answer of [kind]'s list (also of its DELETE): `{ actions, grants: [{ action, label }] }` or
         * `{ types: [{ type, label }] }`. A server without `grants` gives the action's own name.
         */
        fun of(kind: Kind, body: String): List<ChiefGrant> {
            val o = runCatching { Api.JSON.parseToJsonElement(body) as? JsonObject }.getOrNull() ?: return emptyList()
            fun str(e: Any?) = (e as? JsonPrimitive)?.contentOrNull
            return when (kind) {
                Kind.APP -> (o["grants"] as? JsonArray)?.mapNotNull { g -> (g as? JsonObject)?.let { x -> str(x["action"])?.let { ChiefGrant(kind, it, str(x["label"]) ?: it) } } }
                    ?: (o["actions"] as? JsonArray).orEmpty().mapNotNull { str(it)?.let { a -> ChiefGrant(kind, a, a) } }
                Kind.WEB -> (o["types"] as? JsonArray).orEmpty().mapNotNull { t -> (t as? JsonObject)?.let { x -> str(x["type"])?.let { ChiefGrant(kind, it, (str(x["label"]) ?: it).replaceFirstChar(Char::uppercase)) } } }
            }
        }
    }
}
