package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement

/**
 * A Reconnect card under the reply of a job's run (#431, docs/api.md "A Reconnect card"): a connected app the run found
 * signed out, at most once a day per app. Its button connects the app as the Connectors screen does. As the web
 * page draws it (public/connectors.js).
 */
@Serializable
data class ReconnectCard(val app: String = "", val name: String = "") {
    /** What the card names: the app's name, or its slug when the server gave none. */
    val label: String get() = name.ifBlank { app }

    companion object {
        /** The cards of a run, as it lists them; an entry that cannot be read, or has no app, is left out. */
        fun list(v: JsonElement?): List<ReconnectCard> = (v as? JsonArray).orEmpty()
            .mapNotNull { e -> (e as? JsonObject)?.let { runCatching { Api.JSON.decodeFromJsonElement<ReconnectCard>(it) }.getOrNull() } }
            .filter { it.app.isNotBlank() }
    }
}

/** Where a Reconnect card's button is (#464): it says so, and is never stuck. An error stays in the card under it. */
enum class ReconnectStep { Ready, Opening, Failed; val button: String get() = when (this) { Ready -> tr("Reconnect"); Opening -> tr("Opening…"); Failed -> tr("Try again") } }
