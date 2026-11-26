package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * A project update as data (`update` beside the message's `text`, docs/api.md "Consolidated project updates",
 * `project-update-card`, #1755): the head, the status pills, and only the sections that have something. The apps draw it as one
 * card of the block kit; an older server's has none and its text is drawn as it always was. The words of the pills, a goal's
 * figure and the faint line come in the owner's language from the server. Row texts are Markdown as their author wrote
 * it, drawn as a reply's preview is, never as markup (ADR 004). Read as the web page reads it (public/project-update.js):
 * what is not what it should be is left out, a level is held to the kit's and a ratio to 0..1.
 */
data class ProjectUpdateCard(
    val projectId: String,
    val projectName: String,
    /** The start of the period the update covers, an ISO time, or "". */
    val since: String,
    /** The outcome in a few words: the list's line for the Project Manager and the Chief chat. */
    val summary: String,
    val pills: List<Pill>,
    val needs: List<Row>,
    val blockers: List<Row>,
    val goals: List<Goal>,
    val done: List<String>,
    val work: List<Row>,
    val decisions: List<String>,
    val replies: List<Row>,
    /** The one faint line naming the empty sections, or null when none is empty. */
    val quiet: String?,
    /** The teams whose report is missing or unavailable, one faint line each, worded by the server. */
    val notes: List<String> = emptyList(),
) {
    data class Pill(val level: String, val text: String)

    /** A goal: [value] with [of] after it ("of 6 steps", "/ 10") and a bar filled to [ratio], when it has one. */
    data class Goal(val name: String, val value: String, val of: String, val ratio: Float?, val level: String)

    /** One row of a section: its bot, group or Chief chat to open, the run or card it is about, and its words. [state] is `working`, `planned` or `asks` for a row in progress. */
    data class Row(
        val botId: String?, val groupId: String?, val chatId: String?, val runId: String?, val cardId: String?,
        val name: String, val text: String, val state: String, val at: String?,
    ) {
        /** Where it opens, as [Overviews.open] reads it: a team's chat, the Chief's chat, a bot's chat, or none. */
        val destination: String? get() = when {
            groupId != null -> "group/$groupId"
            chatId != null -> "chief/$chatId"
            botId != null -> "bot/$botId"
            else -> null
        }
    }

    companion object {
        const val FEATURE = "project-update-card"
        private val LEVELS = setOf("ok", "warn", "err", "info", "plan")

        /** The update as the server sends it, or null for none (or for anything that is not one). */
        fun of(e: JsonElement?): ProjectUpdateCard? {
            val o = e as? JsonObject ?: return null
            val project = o["project"] as? JsonObject ?: return null
            fun rows(key: String) = (o[key] as? JsonArray).orEmpty().mapNotNull { r ->
                val x = r as? JsonObject ?: return@mapNotNull null
                Row(
                    botId = x["botId"].string(), groupId = x["groupId"].string(), chatId = x["chatId"].string(), runId = x["runId"].string(), cardId = x["cardId"].string(),
                    name = x["name"].string().orEmpty(), text = x["text"].string().orEmpty(),
                    state = x["state"].string()?.takeIf { it == "planned" || it == "asks" } ?: "working", at = x["at"].string(),
                )
            }
            fun texts(key: String) = (o[key] as? JsonArray).orEmpty().mapNotNull { ((it as? JsonObject)?.get("text")).string() }
            return ProjectUpdateCard(
                projectId = project["id"].string().orEmpty(), projectName = project["name"].string().orEmpty(),
                since = o["since"].string().orEmpty(), summary = o["summary"].string().orEmpty(),
                pills = (o["pills"] as? JsonArray).orEmpty().mapNotNull { p ->
                    val x = p as? JsonObject ?: return@mapNotNull null
                    Pill(level(x["level"].string()), x["text"].string() ?: return@mapNotNull null)
                },
                needs = rows("needs"), blockers = rows("blockers"),
                goals = (o["goals"] as? JsonArray).orEmpty().mapNotNull { g ->
                    val x = g as? JsonObject ?: return@mapNotNull null
                    Goal(x["name"].string().orEmpty(), x["value"].string().orEmpty(), x["of"].string().orEmpty(),
                        ((x["ratio"] as? JsonPrimitive)?.doubleOrNull)?.toFloat()?.coerceIn(0f, 1f), level(x["level"].string()))
                },
                done = texts("done"), work = rows("work"), decisions = texts("decisions"), replies = rows("replies"),
                quiet = o["quiet"].string(),
                notes = (o["notes"] as? JsonArray).orEmpty().mapNotNull { it.string() },
            )
        }

        /** The block kit's level, `ok` for what it does not know. */
        fun level(l: String?): String = l?.takeIf { it in LEVELS } ?: "ok"

        private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.let { p -> if (p.isString) p.content else p.content.takeIf { it != "null" } }?.ifEmpty { null }
    }
}
