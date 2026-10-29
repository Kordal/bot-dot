package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The Company (#669, #674; docs/api.md "The Company", ADR 110-112): a place of its own beside the bots, behind the
 * switch "Bots | Company". The owner says what they work on (a site, or an idea in one sentence) with its sources,
 * then goes through the setup's steps About, Team and Start; the server holds every answer, and the app saves each
 * one with PATCH as it is given. Everything here is somebody's text: drawn as text, never as markup.
 */
@Serializable
data class Company(
    val id: String,
    val name: String = "",
    val kind: String = "idea",
    val start: String = "",
    val phase: String = "setup",
    val day: Int? = null,
    val sources: List<CompanySource> = emptyList(),
    val about: List<AboutCard> = emptyList(),
    val stories: List<StoryGroup> = emptyList(),
    val swot: Swot? = null,
    val goal: String = "",
    val never: List<String> = emptyList(),
    val time: String = "",
    val suggestions: Suggestions? = null,
    /** The Chief's proposed bots, kept whole: a PATCH of the proposal sends each as it came, with what the app does not draw. */
    val proposal: List<JsonObject>? = null,
    val teams: List<CompanyTeam> = emptyList(),
    val teamChat: List<TeamLine> = emptyList(),
    val canUndo: Boolean = false,
    val facts: Int = 0,
) {
    val running: Boolean get() = phase == "running"
    val site: Boolean get() = kind == "site"
    fun card(key: String): AboutCard? = about.firstOrNull { it.key == key }
    /** The proposal as the Team step draws it. */
    fun proposed(): List<Proposed>? = proposal?.map { Api.JSON.decodeFromJsonElement(Proposed.serializer(), it) }
}

@Serializable
data class CompanySource(val id: String = "", val kind: String = "file", val name: String = "", val url: String? = null, val size: Long = 0)

@Serializable
data class AboutCard(val key: String, val question: String = "", val answer: String = "", val chips: List<String>? = null, val open: Boolean = false)

@Serializable
data class StoryGroup(val who: String, val items: List<Story> = emptyList())

@Serializable
data class Story(val text: String, val start: Boolean = true)

@Serializable
data class Swot(
    val strengths: List<String> = emptyList(),
    val weaknesses: List<String> = emptyList(),
    val opportunities: List<String> = emptyList(),
    val threats: List<String> = emptyList(),
    val firstTest: String = "",
)

@Serializable
data class Suggestions(val goal: List<String> = emptyList(), val never: List<String> = emptyList(), val time: List<String> = emptyList())

@Serializable
data class CompanyTeam(val id: String = "", val name: String = "", val color: String? = null, val bots: List<String> = emptyList(), val lead: String? = null)

@Serializable
data class TeamLine(val who: String = "chief", val text: String = "", val undo: Boolean = false)

/** A bot the Chief proposed for the team (#671): its card on the Team step. */
@Serializable
data class Proposed(
    val key: String,
    val name: String = "",
    val description: String = "",
    val owns: List<String> = emptyList(),
    val connects: List<String> = emptyList(),
    val routines: String = "",
    val routinesOn: Boolean = true,
    val asksFirst: String = "rules",
    val preview: String = "",
    val team: String = "",
    val color: String? = null,
    val from: String? = null,
    val bot: String? = null,
)

/** What the Chief suggests for one group's stories: `POST /api/company/stories/suggest`. */
@Serializable
data class StoryIdeas(val stories: List<String> = emptyList(), val group: String = "")

/** The company as the app holds it: [company] null when the account has none, or the server has no Company. */
data class CompanyHeld(val company: Company?)

/** A source picked on the start screen before Go: a link, or a file on its way up ([upload] once it is there). */
data class SourceDraft(val id: String, val kind: String, val name: String, val url: String? = null, val size: Long = 0, val upload: Attachment? = null, val failed: Boolean = false) {
    val uploading: Boolean get() = kind == "file" && upload == null && !failed
}

/** Where a new idea's setup stands on the About step: one of the five questions, the stories, or the review. */
sealed interface AboutScreen {
    data class Question(val index: Int) : AboutScreen
    data object Stories : AboutScreen
    data object Review : AboutScreen
}

object CompanySetup {
    const val FEATURE = "company"
    const val ABOUT = "company-about"
    const val TEAM = "company-team"
    /** The setup's steps, as the bar shows them. */
    val STEPS = listOf("about", "team", "start")
    /** The five questions of a new idea, as the server asks them (lib/company-chief.js). */
    val IDEA = listOf("who", "today", "why", "signal", "test")
    /** The words for the groups of "I want my <who> to…". */
    val WHO = listOf("users", "customers", "clients", "members", "students", "team", "partners")
    /** What "Asks first" may be. */
    val ASKS = listOf("rules", "every", "never")
    /** Several chips picked for one answer are joined with this. */
    const val SEP = "; "
    const val MAX_SOURCES = 20
    const val MAX_FILE = 25L * 1024 * 1024
    /** The start screen's two examples: a site and an idea. */
    val EXAMPLES = listOf("fernhill.app", "A meal-planning app for busy parents")

    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    private val OUT = Json { encodeDefaults = true; explicitNulls = false }

    fun of(answer: String): Company = Api.JSON.decodeFromString(Company.serializer(), answer)
    /** `GET /api/company` and the feed's `company` event: `{ company }`, the company or null. */
    fun held(element: JsonElement?): CompanyHeld =
        CompanyHeld((element as? JsonObject)?.let { Api.JSON.decodeFromJsonElement(Company.serializer(), it) })
    fun held(answer: String): CompanyHeld = held((Api.JSON.parseToJsonElement(answer) as? JsonObject)?.get("company"))

    /** `POST /api/company`: what the owner works on, and the sources that are ready (a file still on its way is left out). */
    fun startBody(start: String, sources: List<SourceDraft>): JsonObject = buildJsonObject {
        put("start", start.trim())
        put("sources", buildJsonArray {
            sources.forEach { s ->
                when {
                    s.kind == "link" && s.url != null -> add(buildJsonObject { put("kind", "link"); put("url", s.url); put("name", s.name) })
                    s.kind == "file" && s.upload != null -> add(buildJsonObject { put("kind", "file"); put("name", s.name); put("upload", OUT.encodeToJsonElement(Attachment.serializer(), s.upload)) })
                }
            }
        })
    }

    /** A link as the owner typed it, named without its scheme. */
    fun link(id: String, typed: String): SourceDraft? {
        val url = typed.trim().takeIf { it.isNotEmpty() } ?: return null
        return SourceDraft(id, "link", url.replace(Regex("^https?://", RegexOption.IGNORE_CASE), ""), url)
    }

    /** The step on screen: Start once the team is made, else the one last chosen, else About. */
    fun stepOf(c: Company, chosen: String?): String = if (c.running) "start" else chosen?.takeIf { it in STEPS } ?: "about"

    /** Where a new idea starts on the About step: the first question neither answered nor skipped, then the stories, then the review. */
    fun startScreen(c: Company): AboutScreen {
        if (c.site) return AboutScreen.Review
        val i = IDEA.indexOfFirst { c.card(it)?.open == true }
        if (i >= 0) return AboutScreen.Question(i)
        return if (c.swot != null) AboutScreen.Review else AboutScreen.Stories
    }

    fun split(answer: String): List<String> = answer.split(SEP).map { it.trim() }.filter { it.isNotEmpty() }

    /** [about] with [key] answered ("" is skipped): closed, and added when the read did not have it. */
    fun answered(about: List<AboutCard>, key: String, answer: String, question: String): List<AboutCard> =
        if (about.any { it.key == key }) about.map { if (it.key == key) it.copy(answer = answer, open = false) else it }
        else about + AboutCard(key, question, answer)

    /** A chip question's picks after a tap on [chip]: on or off, one at a time unless [multi]. */
    fun pick(picked: List<String>, chip: String, multi: Boolean): List<String> =
        if (chip in picked) picked - chip else if (multi) picked + chip else listOf(chip)

    /** The chips a question shows: the Chief's, then what is picked and what the owner wrote, each once. */
    fun chips(chief: List<String>, picked: List<String>, own: List<String>): List<String> = (chief + picked + own).distinct()

    /** [groups] with a story for [who] (a new group when it has none); the first three of a group Start. Null: nothing to add. */
    fun addStory(groups: List<StoryGroup>, who: String, typed: String): List<StoryGroup>? {
        val text = typed.replace(Regex("\\s+"), " ").trim()
        if (text.isEmpty()) return null
        val g = groups.firstOrNull { it.who == who }
        if (g != null && g.items.any { it.text.equals(text, ignoreCase = true) }) return null
        return if (g == null) groups + StoryGroup(who, listOf(Story(text, true)))
        else groups.map { if (it.who == who) it.copy(items = it.items + Story(text, it.items.size < 3)) else it }
    }

    fun flipStart(groups: List<StoryGroup>, gi: Int, si: Int): List<StoryGroup> =
        groups.mapIndexed { x, g -> if (x != gi) g else g.copy(items = g.items.mapIndexed { y, s -> if (y == si) s.copy(start = !s.start) else s }) }

    fun dropStory(groups: List<StoryGroup>, gi: Int, si: Int): List<StoryGroup> =
        groups.mapIndexed { x, g -> if (x != gi) g else g.copy(items = g.items.filterIndexed { y, _ -> y != si }) }.filter { it.items.isNotEmpty() }

    /** The Chief's ideas for [who] that are not written yet. */
    fun ideas(ideas: List<String>, groups: List<StoryGroup>, who: String): List<String> {
        val have = groups.filter { it.who == who }.flatMap { g -> g.items.map { it.text.lowercase() } }.toSet()
        return ideas.filter { it.lowercase() !in have }
    }

    /** The words the "<who>" chooser offers: the group the Chief finds missing first, then the usual ones not used yet. */
    fun whoWords(groups: List<StoryGroup>, who: String, missing: String): List<String> {
        val used = groups.map { it.who }.toSet()
        return (listOfNotNull(missing.takeIf { it.isNotEmpty() && it != who }) + WHO).distinct().filter { it != who && !(it in used && it != missing) }
    }

    /** The proposal with one bot changed: the fields of [change] laid over it, the rest as it came. */
    fun edited(proposal: List<JsonObject>, key: String, change: Map<String, JsonElement>): List<JsonObject> =
        proposal.map { if (it.keyOf() == key) JsonObject(it + change) else it }

    fun removed(proposal: List<JsonObject>, key: String): List<JsonObject> = proposal.filter { it.keyOf() != key }

    private fun JsonObject.keyOf(): String? = (this["key"] as? JsonPrimitive)?.content

    /** The PATCH of a proposal, about cards or stories: the list as the server keeps it. */
    fun patch(proposal: List<JsonObject>): JsonObject = JsonObject(mapOf("proposal" to JsonArray(proposal)))
    fun patchAbout(about: List<AboutCard>): JsonObject = JsonObject(mapOf("about" to OUT.encodeToJsonElement(ListSerializer(AboutCard.serializer()), about)))
    fun patchStories(groups: List<StoryGroup>): JsonObject = JsonObject(mapOf("stories" to OUT.encodeToJsonElement(ListSerializer(StoryGroup.serializer()), groups)))
    fun patchText(field: String, value: String): JsonObject = buildJsonObject { put(field, value) }
    fun patchLines(field: String, value: List<String>): JsonObject = JsonObject(mapOf(field to JsonArray(value.map(::JsonPrimitive))))

    /** The connected apps a proposed bot needs and the account has not connected: [connected] null while not known. */
    fun missing(p: Proposed, connected: Set<String>?): List<String> = if (connected == null) emptyList() else p.connects.filter { it !in connected }

    /** A bot's copy is in the team already ("Added"). */
    fun added(proposal: List<Proposed>, bot: String): Boolean = proposal.any { it.from == bot }

    /** The account's bots "Add existing bot" lists: not the ones Create made of this proposal. */
    fun existing(bots: List<Bot>, proposal: List<Proposed>): List<Bot> = bots.filter { b -> proposal.none { it.bot == b.id } }

    private val APP_NAMES = mapOf("gmail" to "Gmail", "googlecalendar" to "Google Calendar", "github" to "GitHub", "slack" to "Slack", "notion" to "Notion",
        "googledocs" to "Google Docs", "googlesheets" to "Google Sheets", "linkedin" to "LinkedIn", "hubspot" to "HubSpot", "stripe" to "Stripe")
    fun appName(slug: String): String = APP_NAMES[slug] ?: slug.replaceFirstChar { it.uppercase() }

    /** A value of the feed's `company` event, or null for an event of another kind. */
    fun event(ev: FeedEvent): CompanyHeld? = if (ev.type == FEATURE && "company" in ev.data) held(ev.data["company"].takeIf { it !is JsonNull }) else null
}
