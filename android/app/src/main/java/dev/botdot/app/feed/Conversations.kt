package dev.botdot.app.feed

import dev.botdot.app.data.Bot

/**
 * Chats as Android conversations (#1116): each bot's chat, each group's, and the Chief's chats as one, have a
 * long-lived shortcut, so the system's notification settings can make one a priority or silence it, and the launcher
 * offers it on a long press. No control in the app: the system's settings do the per-chat choices.
 */
internal object Conversations {
    /** The Chief's chats are one conversation. */
    const val CHIEF = "chief"
    /** Pinned bots the launcher offers beside the Chief: a long press shows about four. */
    const val PINNED_OFFERED = 3

    /** The conversation a chat ("bot:<id>", "chief:<chatId>", "group:<id>") belongs to; null for anything else. */
    fun of(chat: String): String? = when {
        chat.startsWith("chief:") -> CHIEF
        chat.startsWith("bot:") && chat.length > 4 -> chat
        chat.startsWith("group:") && chat.length > 6 -> chat
        else -> null
    }

    /** What the conversation's shortcut opens (Notifier.EXTRA_OPEN): the Chief's latest chat, or the chat. */
    fun opens(id: String): String = if (id == CHIEF) "chief:" else id

    /** The conversations the launcher offers before any chat notified: the Chief, then the first pinned bots. */
    fun offered(bots: List<Bot>): List<String> =
        listOf(CHIEF) + bots.filter { it.pinned > 0 }.sortedBy { it.pinned }.take(PINNED_OFFERED).map { "bot:${it.id}" }

    /** Of the shortcuts there are, those whose bot or group is gone. [groups] null: the groups are not known, none goes. */
    fun gone(have: Collection<String>, bots: Collection<String>, groups: Collection<String>?): List<String> = have.filter { id ->
        when {
            id.startsWith("bot:") -> id.removePrefix("bot:") !in bots
            id.startsWith("group:") -> groups != null && id.removePrefix("group:") !in groups
            else -> false
        }
    }
}
