package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * 👍 and 👎 under an unasked Chief message (docs/api.md "The Chief writes first"). The botdot server stores the
 * rating and announces it on the live feed (`rating`); this says what a tap makes of it, which message gets the
 * thumbs, and how a rating is put into the chat on screen. `public/ratings.js` is the web page's side.
 */
object Ratings {
    const val UP = "up"
    const val DOWN = "down"
    const val FEATURE = "ratings"

    /** A rating as the server has it: "up", "down", or null for anything else. */
    fun value(r: String?): String? = r?.takeIf { it == UP || it == DOWN }

    /** What a tap on [tapped] makes of the [current] rating: the filled one clears, the other one moves it. */
    fun next(current: String?, tapped: String): String? = when {
        value(tapped) == null -> value(current)
        value(current) == tapped -> null
        else -> tapped
    }

    /** Whether a message gets the thumbs: an unasked, finished Chief message with its place in the chat, from a server that rates. */
    fun shows(m: ChiefMessage, features: Collection<String>?, index: Int): Boolean =
        features != null && FEATURE in features && m.role == "chief" && m.unasked && !m.pending && index >= 0

    /** The rating of the message at [index] of the whole chat, when it is loaded. */
    fun of(chat: ChiefChat, index: Int): String? = chat.messages.getOrNull(index - chat.offset)?.let { value(it.rating) }

    /** The chat with the message at [index] of the whole chat rated [rating]; as it was when that message isn't loaded. */
    fun set(chat: ChiefChat, index: Int, rating: String?): ChiefChat {
        val at = index - chat.offset
        if (at !in chat.messages.indices) return chat
        return chat.copy(messages = chat.messages.mapIndexed { i, m -> if (i == at) m.copy(rating = value(rating)) else m })
    }

    /** A rating that wasn't saved: [before] again, unless a later tap or the feed has changed it since [sent]. */
    fun undo(chat: ChiefChat, index: Int, sent: String?, before: String?): ChiefChat =
        if (of(chat, index) == value(sent)) set(chat, index, before) else chat

    /** The feed's `rating` event: `{ chatId, index, rating }`. null when it isn't one this app can read. */
    fun event(data: JsonObject): Rated? {
        val chatId = runCatching { data["chatId"]?.jsonPrimitive?.contentOrNull }.getOrNull()?.takeIf { it.isNotEmpty() } ?: return null
        val index = runCatching { data["index"]?.jsonPrimitive?.intOrNull }.getOrNull()?.takeIf { it >= 0 } ?: return null
        val rating = runCatching { data["rating"]?.jsonPrimitive?.contentOrNull }.getOrNull()
        return Rated(chatId, index, value(rating))
    }

    data class Rated(val chatId: String, val index: Int, val rating: String?)
}
