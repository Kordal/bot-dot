package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A project's folder on the account's computer (#702, ADR 122): its name in Projects' list and its path. */
@Serializable
data class ProjectFolder(val name: String = "", val path: String = "")

/**
 * Several projects (#689, #703; docs/api.md "The Company", ADR 120): from a botdot with `projects-many` the Projects
 * place holds a list. The app shows one, the one this device last showed (else the first); "New project" shows the
 * start screen for another. Every `/api/company…` call names the project shown ([at]). The feed's `project` event
 * says one project changed or is gone; `company` then only speaks of the first, for older apps, and is ignored.
 * The tree (project > teams > bots) is drawn from here: a team with none of its bots left is not shown.
 */
object ProjectList {
    const val SETTINGS = "project-settings"
    const val FOLDER = "project-folder"
    /** lib/company.js PROJECT_COLORS: the swatches of a project's colour. */
    val COLORS = listOf("#ff6b35", "#34c759", "#3aa0ff", "#8e7cff", "#ffb020", "#ff5c8a", "#2ec4b6", "#b07cff")
    const val DEFAULT_COLOR = "#8e7cff"
    const val MAX_OBJECTIVES = 6
    const val MAX_NEVER = 10
    /** How often a lead reports (#696): "" is Off. */
    val RHYTHMS = listOf("", "daily", "twice-weekly", "weekly")

    fun many(features: Collection<String>?): Boolean = features != null && CompanySetup.MANY in features

    /** [path] of the project [id]: `?project=<id>` added, or as it is without one. */
    fun at(path: String, id: String?): String =
        if (id.isNullOrEmpty()) path else "$path${if ('?' in path) '&' else '?'}project=${Api.enc(id)}"

    /** `GET /api/company/list`: `{ projects }`, in the order they were made. */
    fun list(answer: String): List<Company> =
        ((Api.JSON.parseToJsonElement(answer) as? JsonObject)?.get("projects") as? JsonArray)
            ?.mapNotNull { (it as? JsonObject)?.let { o -> runCatching { Api.JSON.decodeFromJsonElement(Company.serializer(), o) }.getOrNull() } }
            .orEmpty()

    /** The project shown: none while a new one is started, else the one [chosen] (when it is still there), else the first. */
    fun shown(list: List<Company>, chosen: String?, adding: Boolean): Company? =
        if (adding) null else list.firstOrNull { it.id == chosen } ?: list.firstOrNull()

    /** The list once [id] changed: [project] in its place (or after the others when new), or left out once deleted. */
    fun changed(list: List<Company>, id: String, project: Company?): List<Company> = when {
        project == null -> list.filter { it.id != id }
        list.any { it.id == id } -> list.map { if (it.id == id) project else it }
        else -> list + project
    }

    /** The feed's `project` event: the id and the project as it is now (null once deleted); null for another event. */
    fun event(ev: FeedEvent): Pair<String, Company?>? {
        if (ev.type != "project") return null
        val id = ev.data.str("id").ifEmpty { return null }
        val p = ev.data["project"].takeIf { it != null && it !is JsonNull } as? JsonObject
        return id to p?.let { runCatching { Api.JSON.decodeFromJsonElement(Company.serializer(), it) }.getOrNull() }
    }

    /** A project's name as the list shows it: its name, else what it started from. */
    fun nameOf(c: Company): String = c.name.ifEmpty { c.start }.ifEmpty { tr("New project") }

    /** The list as drawn: the open projects in order, then the archived ones (folded under Archived). */
    fun open(list: List<Company>): List<Company> = list.filter { !it.archived }
    fun archived(list: List<Company>): List<Company> = list.filter { it.archived }

    /** A team as the tree shows it: its bots that are still there, the lead first. */
    data class Branch(val team: CompanyTeam, val bots: List<Bot>)

    fun branches(c: Company, bots: List<Bot>): List<Branch> {
        val byId = bots.associateBy { it.id }
        return c.teams.map { t -> Branch(t, t.bots.mapNotNull { byId[it] }.sortedBy { if (it.id == t.lead) 0 else 1 }) }.filter { it.bots.isNotEmpty() }
    }

    /** What waits for the owner in a project: the sum of its bots' [asks]. */
    fun waits(c: Company, bots: List<Bot>, asks: (String) -> Int): Int = branches(c, bots).sumOf { b -> b.bots.sumOf { asks(it.id) } }

    /** Whether a node of the tree is open: as the owner left it, else a project while it is the one shown, a team always. */
    fun isOpen(folds: Map<String, Boolean>, key: String, shown: String?): Boolean =
        folds[key]?.let { !it } ?: if (':' in key) true else key == shown

    /** [folds] with [key] turned the other way. */
    fun fold(folds: Map<String, Boolean>, key: String, shown: String?): Map<String, Boolean> = folds + (key to isOpen(folds, key, shown))

    // ---------- the settings page (#701) ----------

    /** A team's editor as it is saved: its name, its bots, a lead among them (else the first). Null while it cannot be saved. */
    fun teamBody(name: String, bots: List<String>, lead: String?): JsonObject? {
        val n = name.replace(Regex("\\s+"), " ").trim()
        if (n.isEmpty() || bots.isEmpty()) return null
        return buildJsonObject {
            put("name", n)
            put("bots", JsonArray(bots.map(::JsonPrimitive)))
            put("lead", lead?.takeIf { it in bots } ?: bots.first())
        }
    }

    /** A bot picked in a team's editor, or picked again (left out). */
    fun toggle(bots: List<String>, id: String): List<String> = if (id in bots) bots - id else bots + id

    /** The objectives as PATCH saves them after one was changed in place: a name left empty drops it. */
    fun objectivesAfter(list: List<Objective>, id: String, name: String? = null, current: Double? = null, target: Double? = null): List<Objective> =
        list.map { if (it.id == id) it.copy(name = name ?: it.name, current = current ?: it.current, target = target ?: it.target) else it }.filter { it.name.isNotBlank() }

    /** A number as the owner typed it: a comma is a point; null for no number. */
    fun number(typed: String): Double? = typed.trim().replace(',', '.').toDoubleOrNull()

    /** A number as a field shows it: 12, not 12.0. */
    fun shownNumber(n: Double): String = if (n == Math.floor(n) && !n.isInfinite() && kotlin.math.abs(n) < 1e15) n.toLong().toString() else n.toString()

    /** The day its 90 days started, as `YYYY-MM-DD`, or "". */
    fun startDay(c: Company): String = c.startedAt?.take(10).orEmpty()

    /** `DELETE /api/company`: with `?folder=delete` the folder goes with it. */
    fun deletePath(dropFolder: Boolean): String = if (dropFolder) "/company?folder=delete" else "/company"
}
