package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A notification botdot pushed to a phone (docs/api.md "Notifications on this device", ADR 150), as the app acts on
 * it: what a tap opens, what Reply, Approve and Decline send, and the phone's registration. The server decides what
 * rings and which buttons a notification has (`buttons` in the seal); the iOS app's extension opens the seal and
 * draws them, and the app hands a tap or a button here. The Android app answers its own notifications the same way.
 */
object PushNotices {
    /** The feature a botdot announces when it sends to iPhones: its push relay is set (`BOT_DOT_PUSH_RELAY`). */
    const val FEATURE = "apns-push"

    /** The buttons' ids, as the server names them in `buttons`: Reply on a chat, Decline (`no`) and Approve (`yes`) on a card. */
    const val REPLY = "reply"
    const val NO = "no"
    const val YES = "yes"

    /** Whether this botdot sends to iPhones, so the app asks for the permission and registers. [features]: null while unknown. */
    fun sendsToPhones(features: Collection<String>?): Boolean = features?.contains(FEATURE) == true

    /**
     * What a tap on a notification opens. [target] is the payload's (`"bot:<id>"`, `"chief:<chatId>"`, `"group:<id>"`,
     * `"needs"`, …); [thread] the notification's thread, the target too (the relay's `thread-id`), which a notification
     * whose seal could not be opened still has. A shared room and anything else open the app.
     */
    fun opens(target: String?, thread: String? = null): Opens {
        val t = target?.trim()?.ifEmpty { null } ?: thread?.trim()?.ifEmpty { null } ?: return Opens.App
        if (t == "needs") return Opens.NeedsYou
        return if (chatOf(t) != null) Opens.Chat(t) else Opens.App
    }

    sealed class Opens {
        /** A bot's chat, a Chief chat or a group's: [chat] is `"bot:<id>"`, `"chief:<chatId>"` or `"group:<id>"`. */
        data class Chat(val chat: String) : Opens()
        data object NeedsYou : Opens()
        data object App : Opens()
    }

    /** Where a reply typed in the notification of [chat] goes; null for what is no chat. */
    fun replyTo(chat: String): ReplyTo? = chatOf(chat)

    sealed class ReplyTo {
        data class Bot(val id: String) : ReplyTo()
        data class Chief(val chatId: String) : ReplyTo()
        /** An answer to a group's question is a message to the group: the member that asked has the first turn. */
        data class Group(val id: String) : ReplyTo()
    }

    /** What the Chief is told when the owner approves a bot's plan from its notification, as from its card. */
    const val PLAN_APPROVAL = dev.botdot.app.data.PLAN_APPROVAL // Needs you's words (NeedsCards.kt)

    /** What Decline ([yes] false) or Approve on the notification of what waits ([tag]: `"job:<bot>/<job>"`, `"ask:<id>"`, …) does; null: nothing. */
    fun answer(tag: String, yes: Boolean): Answer? {
        val id = tag.substringAfter(':', "")
        if (id.isEmpty()) return null
        return when (tag.substringBefore(':')) {
            "job" -> if ('/' in id) Answer.Job(id.substringBefore('/'), id.substringAfter('/'), yes) else null
            "ask" -> if (id.startsWith("batch:")) null else Answer.Ask(id, yes) // a card of several is answered on its card
            "tile" -> Answer.Tile(id, yes)
            "memory" -> Answer.Memory(id, yes)
            "plan" -> if (yes) Answer.PlanApproved(id) else Answer.PlanDismissed(id)
            else -> null
        }
    }

    sealed class Answer {
        data class Job(val botId: String, val jobId: String, val yes: Boolean) : Answer()
        data class Ask(val id: String, val yes: Boolean) : Answer()
        data class Tile(val id: String, val yes: Boolean) : Answer()
        data class Memory(val id: String, val yes: Boolean) : Answer()
        /** The Chief chat [chatId] is told [PLAN_APPROVAL]. */
        data class PlanApproved(val chatId: String) : Answer()
        data class PlanDismissed(val chatId: String) : Answer()
    }

    /** Sends a reply typed in the notification of [chat], with the message key [key], as its message box sends it. */
    @Throws(Exception::class)
    suspend fun reply(api: Api, chat: String, text: String, key: String?) {
        when (val to = replyTo(chat)) {
            is ReplyTo.Chief -> api.sendToChief(to.chatId, text, emptyList(), key)
            is ReplyTo.Bot -> api.runBot(to.id, text, emptyList(), key)
            is ReplyTo.Group -> api.sendToGroup(to.id, text, emptyList(), key)
            null -> Unit
        }
    }

    /** Sends Decline or Approve from the notification of [tag] ([answer]). */
    @Throws(Exception::class)
    suspend fun answer(api: Api, tag: String, yes: Boolean) {
        when (val a = answer(tag, yes)) {
            is Answer.Job -> api.approveJob(a.botId, a.jobId, a.yes)
            is Answer.Ask -> api.answerAsk(a.id, a.yes)
            is Answer.Tile -> api.approveTile(a.id, a.yes)
            is Answer.Memory -> api.settleMemoryChange(a.id, a.yes)
            is Answer.PlanApproved -> api.sendToChief(a.chatId, PLAN_APPROVAL, emptyList())
            is Answer.PlanDismissed -> api.dismissSuggestion(a.chatId)
            null -> Unit
        }
    }

    /** The APNs environment a build's device token is of: `development` for a build from Xcode, else `production`. */
    fun environment(fromXcode: Boolean): String = if (fromXcode) "development" else "production"

    /**
     * What `POST /api/push/apns` takes: the device [token] in hex, the [key] its notifications are sealed with (32
     * bytes, base64url), the [environment] and a few words of the [device].
     */
    fun registration(token: String, key: String, environment: String, device: String?): JsonObject = buildJsonObject {
        put("token", token.trim().lowercase())
        put("key", key)
        put("environment", environment)
        device?.trim()?.ifEmpty { null }?.let { put("device", it.take(80)) }
    }

    private val ID = Regex("""[\w.-]{1,80}""")

    private fun chatOf(t: String): ReplyTo? {
        val id = t.substringAfter(':', "")
        if (!ID.matches(id)) return null
        return when (t.substringBefore(':')) {
            "bot" -> ReplyTo.Bot(id)
            "chief" -> ReplyTo.Chief(id)
            "group" -> ReplyTo.Group(id)
            else -> null
        }
    }
}
