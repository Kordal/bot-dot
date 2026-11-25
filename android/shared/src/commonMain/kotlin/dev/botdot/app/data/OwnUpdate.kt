package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.time.Instant
import kotlinx.datetime.TimeZone

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
    /** The owner's `when` (ADR 271): `ready`, `night` or `manual`; null from a front door that doesn't have it. */
    val updateWhen: String? = null,
    /** `night` when the owner chose "Tonight" for the version that waits. */
    val plan: String? = null,
) {
    val ready get() = deadline != null
    val moving get() = asked || last == "switching"

    /** What the section says, in the web page's words: nothing while nothing waits or moves. */
    fun text(zone: TimeZone = TimeZone.currentSystemDefault()): String = when {
        moving -> tr("Moving to the new version. Your bots restart in a minute or two.")
        ready -> {
            val version = readyVersion?.let { " ($it)" } ?: ""
            val on = day(deadline!!, zone)
            when {
                updateWhen == "ready" -> tr("A new version{version} is ready. Your account moves to it as soon as your bots are idle.", "version" to version)
                updateWhen == "night" || (updateWhen == "manual" && plan == "night") -> tr("A new version{version} is ready. Your account moves to it at night, when your bots are idle.", "version" to version)
                updateWhen == "manual" -> tr("A new version{version} is ready. Your account moves to it when you say, or by itself from {day}.", "version" to version, "day" to on)
                else -> tr("A new version{version} is ready. Your account moves to it by itself on {day}, or now if you choose.", "version" to version, "day" to on)
            }
        }
        last == "kept" || last == "failed" -> tr("The last move to a new version didn't happen: {why}.", "why" to (error?.ifBlank { null } ?: tr("the admin can see why")))
        else -> ""
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
                updateWhen = text(j, "when")?.takeIf { it == "ready" || it == "night" || it == "manual" },
                plan = text(j, "plan")?.takeIf { it == "night" },
            )
        }

        fun body(autoUpdate: Boolean): JsonObject = buildJsonObject { put("autoUpdate", autoUpdate) }

        private fun day(iso: String, zone: TimeZone): String =
            formatDate(Instant.parse(iso), if (I18n.language == "pl") "EEEE, d MMMM" else "EEEE, MMM d", I18n.language, zone)
    }
}
