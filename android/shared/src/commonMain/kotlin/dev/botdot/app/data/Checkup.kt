package dev.botdot.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * The Chief's checkup as the Chief's settings show it (docs/api.md "The Chief's checkup"): whether checkups run,
 * whether one may search the web, and the server's words for its days and time. The days and the time have no
 * control here: the owner tells the Chief. Against a server without `checkup` in `features` nothing is asked and
 * neither switch is shown.
 */
@Serializable
data class Checkup(
    val on: Boolean = false,
    val webSearch: Boolean = false,
    @SerialName("when") val whenWords: String = "", // "Weekdays at 08:00", written by the server
) {
    /** The Checkup switch's value (#636): the server's words for when, nothing for none. It is changed by chat. */
    val caption: String get() = whenWords.trim().trimEnd('.')

    /** Web search is shown but not usable while checkups are off. */
    val webSearchUsable: Boolean get() = on

    companion object {
        const val FEATURE = "checkup"
        val LABEL: String get() = tr("Checkup")
        val WEB_SEARCH: String get() = tr("Web search")

        /** Whether the switches are shown: the server announces the checkup. While its features are not known yet: no. */
        fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

        /** The setting as the feed's `checkup` event and `checkup` of an answer carry it. null when it isn't one this app can read. */
        fun of(e: JsonElement?): Checkup? {
            val o = e as? JsonObject ?: return null
            if ((o["on"] as? JsonPrimitive)?.booleanOrNull == null) return null
            return runCatching { Api.JSON.decodeFromJsonElement(serializer(), o) }.getOrNull()
        }

        /** The answer of `GET` and `PUT /api/settings/checkup`: `{ checkup }`. null from a server that sent none. */
        fun answer(body: String): Checkup? = of(runCatching { Api.JSON.parseToJsonElement(body) as? JsonObject }.getOrNull()?.get("checkup"))

        /** The feed's `checkup` event: the setting as it now is. null for any other event. */
        fun event(ev: FeedEvent): Checkup? = if (ev.type == FEATURE) of(ev.data) else null
    }
}
