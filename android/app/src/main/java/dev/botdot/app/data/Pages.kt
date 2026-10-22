package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement

/**
 * A bot's pages (#346, ADR 065; docs/api.md, "Pages"): what a bot saved with save_page, a chip under its reply, a list
 * in its settings, opened in the document viewer with who made it and when it was updated, and "Keep up to date":
 * the owner's tap makes a job that rewrites it, with no card to approve. As the web page draws them (public/pages.js).
 * Only from a server whose `features` name `pages`.
 */
object Pages {
    const val FEATURE = "pages"

    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features && DocumentView.FEATURE in features

    /** A page's address: with `?view=1` the viewer reads it, with its `page`. */
    fun src(botId: String, slug: String): String = "/bots/${Api.enc(botId)}/pages/${Api.enc(slug)}"

    /** The pages a run saved, as it lists them; an entry that cannot be read is left out. */
    fun refs(v: JsonElement?): List<PageRef> = (v as? kotlinx.serialization.json.JsonArray).orEmpty()
        .mapNotNull { e -> (e as? JsonObject)?.let { runCatching { Api.JSON.decodeFromJsonElement<PageRef>(it) }.getOrNull() } }
        .filter { it.slug.isNotBlank() }

    /** The viewer's second line on a page: "Page by Ops · updated 5m ago". */
    fun subtitle(from: String, page: PageInfo?, now: java.time.Instant = java.time.Instant.now()): String =
        listOfNotNull(if (from.isBlank()) "Page" else "Page by $from", page?.let { "updated ${NotesWake.ago(it.updatedAt, now)}" }).joinToString(" · ")

    /** Its line in the bot's settings: "updated 5m ago · Daily at 07:00". */
    fun line(page: PageInfo, now: java.time.Instant = java.time.Instant.now()): String =
        listOfNotNull("updated ${NotesWake.ago(page.updatedAt, now)}", page.keep?.`when`).joinToString(" · ")

    /** How often, on the "Keep up to date" sheet: what the server takes, and its words. */
    val EVERY = listOf("hour" to "Every hour", "day" to "Every morning", "monday" to "Every Monday")
}

@Serializable
data class PageRef(val slug: String = "", val title: String = "")

/** What keeps a page up to date: its job, the schedule in words, and the sheet's own words for it when it has them. */
@Serializable
data class PageKeep(val jobId: String = "", val `when`: String = "", val every: String? = null, val time: String? = null, val notify: String = "report-only", val check: String = "")

@Serializable
data class PageInfo(
    val slug: String = "",
    val title: String = "",
    val sources: String = "",
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val file: String = "",
    val keep: PageKeep? = null,
)

@Serializable
data class PageList(val pages: List<PageInfo> = emptyList())

@Serializable
data class PageKept(val page: PageInfo? = null)

/** The live feed's `page`: a bot saved one, or what keeps it up to date changed. Each page's newest event, by "<botId>/<slug>", for an open page and the list to follow. */
class PageSaves {
    private val _value = MutableStateFlow<Map<String, String>>(emptyMap())
    val value: StateFlow<Map<String, String>> = _value.asStateFlow()

    fun handle(ev: FeedEvent) {
        if (ev.type != "page") return
        val bot = ev.data.str("botId")
        val slug = ev.data.str("slug")
        if (bot.isEmpty() || slug.isEmpty()) return
        _value.value = _value.value + ("$bot/$slug" to (ev.id ?: ev.data.str("updatedAt")))
    }

    fun clear() { _value.value = emptyMap() }
}
