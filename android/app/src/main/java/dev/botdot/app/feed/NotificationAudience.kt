package dev.botdot.app.feed

import dev.botdot.app.data.FeedEvent
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Recipient policy for incoming feed events, independent of chat visibility and Android delivery. */
fun shouldNotifyOwner(event: FeedEvent): Boolean {
    val data = event.data
    fun value(key: String) = data[key]?.jsonPrimitive?.content
    return when (event.type) {
        "run_finished" -> {
            if (value("quiet") == "true" || value("passedOn") == "true") false
            else when (value("notificationAudience")) {
                "owner" -> true
                "internal" -> false
                // Older servers only identify direct bot messages. Keep owner follow-ups working
                // when their recipient is unavailable; new servers disambiguate nested follow-ups.
                else -> value("trigger") != "bot" && value("startedBy") != "chief" && data["fromBot"] !is JsonObject
            }
        }
        "chief_reply" -> value("status") != "stopped"
        else -> true // approvals and requests for owner input have their own notification handlers
    }
}
