package dev.botdot.app.data

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A bot's shared-room settings (ADR 060, #316), kept in its own account: whether it may be in shared rooms at all
 * ([allowRooms]), and who may mention it there ([whoMayMention]: [OWNER], only its owner, or [MEMBERS], anyone in
 * the room). The account refuses a room turn these do not allow, whatever the front door asks.
 */
data class BotRooms(val allowRooms: Boolean = false, val whoMayMention: String = OWNER) {
    companion object {
        /** The feature of a botdot that keeps these settings. */
        const val FEATURE = "room-settings"
        const val OWNER = "owner"
        const val MEMBERS = "room members"

        /** The choices of "Who may mention it", as their wire value and their words. */
        val WHO = listOf(OWNER to "Only you", MEMBERS to "Anyone in the room")

        /** Whether the bot settings show the section: the server keeps them (while its features are not known: no). */
        fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

        /** `rooms` on a bot as the server sent it; null when it sent none. A value it doesn't know is the default. */
        fun of(v: JsonElement?): BotRooms? {
            val o = v as? JsonObject ?: return null
            val allow = (o["allowRooms"] as? JsonPrimitive)?.takeIf { !it.isString }?.content == "true"
            val who = (o["whoMayMention"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it == OWNER || it == MEMBERS } ?: OWNER
            return BotRooms(allow, who)
        }

        /** The change `PUT /api/bots/:id` takes for these settings (a partial object merges), or null when nothing changed. */
        fun change(was: BotRooms, now: BotRooms): JsonObject? {
            if (was == now) return null
            return buildJsonObject {
                if (now.allowRooms != was.allowRooms) put("allowRooms", now.allowRooms)
                if (now.whoMayMention != was.whoMayMention) put("whoMayMention", now.whoMayMention)
            }
        }
    }
}
