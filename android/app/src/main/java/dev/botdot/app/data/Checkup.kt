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
    /** The line under the Checkup switch: the server's words for when, then who changes it. */
    val caption: String get() = listOf(whenWords.trim().trimEnd('.'), ASK_THE_CHIEF).filter { it.isNotEmpty() }.joinToString(". ")

    /** Web search is shown but not usable while checkups are off. */
    val webSearchUsable: Boolean get() = on

    companion object {
        const val FEATURE = "checkup"
        const val LABEL = "Checkup"
        const val WEB_SEARCH = "Web search"
        const val WEB_SEARCH_HINT = "Lets a checkup search the web to check a proposal. It never opens a page."
        private const val ASK_THE_CHIEF = "Ask the Chief to change it."

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
