package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Settings → Updates (#259, ADR 053): when this account switches to a new version. The owner's "Update automatically",
 * and "Update now" for a version the admin installed, which the account waits for until the admin's deadline. Both are
 * the front door's own routes (`/front-door/update`), never botdot's; shown only where the front door says this
 * account chooses (its session's `updates`): not on a machine of one account.
 */
data class OwnUpdate(
    val autoUpdate: Boolean = true,
    val asked: Boolean = false,
    val canUpdate: Boolean = false,
    /** The version that waits: its short revision, if known, and the deadline (ISO 8601) it is switched by. */
    val readyVersion: String? = null,
    val deadline: String? = null,
    /** How the last switch went: `switching`, `updated`, `kept` or `failed`, and why when it didn't happen. */
    val last: String? = null,
    val error: String? = null,
) {
    val ready get() = deadline != null
    val moving get() = asked || last == "switching"

    /** What the section says, in the web page's words. */
    fun text(zone: ZoneId = ZoneId.systemDefault()): String = when {
        moving -> "Moving to the new version. Your bots restart in a minute or two."
        ready -> "A new version${readyVersion?.let { " ($it)" } ?: ""} is ready. Your account moves to it by itself on ${day(deadline!!, zone)}, or now if you choose."
        last == "kept" || last == "failed" -> "The last move to a new version didn't happen: ${error?.ifBlank { null } ?: "the admin can see why"}."
        autoUpdate -> "Your account moves to each new version when the admin updates botdot."
        else -> "Your account is on the newest version the admin installed."
    }

    companion object {
        /** Whether to show the section: behind a front door (`accounts`) that says this account chooses. */
        fun on(features: List<String>?, session: JsonObject?): Boolean =
            features?.contains("accounts") == true && (session?.get("updates") as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true

        /** The front door's answer, read field by field: what it leaves out, or sends wrong, is left out. */
        fun of(j: JsonObject): OwnUpdate {
            fun flag(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true
            fun text(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content
            val ready = j["ready"] as? JsonObject
            val last = j["last"] as? JsonObject
            return OwnUpdate(
                autoUpdate = (j["autoUpdate"] as? JsonPrimitive)?.let { !it.isString && it.content == "false" } != true,
                asked = flag(j, "asked"),
                canUpdate = flag(j, "canUpdate"),
                readyVersion = text(ready, "version"),
                deadline = text(ready, "deadline")?.takeIf { runCatching { Instant.parse(it) }.isSuccess },
                last = text(last, "state"),
                error = text(last, "error"),
            )
        }

        fun body(autoUpdate: Boolean): JsonObject = buildJsonObject { put("autoUpdate", autoUpdate) }

        private fun day(iso: String, zone: ZoneId): String =
            DateTimeFormatter.ofPattern("EEEE, MMM d", Locale.ENGLISH).format(Instant.parse(iso).atZone(zone))
    }
}
