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

    /** Every bot's pages in one list (#361): Pages on Settings, from a server whose `features` also name `pages-all`. */
    const val FEATURE_ALL = "pages-all"
    fun showsAll(features: Collection<String>?): Boolean = shows(features) && FEATURE_ALL in features!!

    /**
     * The Chief's pages (#384, ADR 069): at a bot's page routes with this id, from a server whose `features` also name
     * `chief-pages`: a chip under its reply, a list in its settings, a row on the Pages screen.
     */
    const val CHIEF = "chief"
    const val FEATURE_CHIEF = "chief-pages"
    fun showsChief(features: Collection<String>?): Boolean = shows(features) && FEATURE_CHIEF in features!!

    /** Pages on the Board (#451): "On Board" on a page and a switch on each row of the Pages screen. */
    const val FEATURE_BOARD = "pages-board"
    fun showsBoard(features: Collection<String>?): Boolean = shows(features) && FEATURE_BOARD in features!!

    /** A page tile's age at the end of its head: "3s", "5 min", "2 h", as the web page says it. */
    fun age(at: String?, now: java.time.Instant = java.time.Instant.now()): String {
        val t = at?.let { runCatching { java.time.Instant.parse(it) }.getOrNull() } ?: return ""
        val s = maxOf(0L, java.time.Duration.between(t, now).seconds)
        return if (s < 60) "${s}s" else if (s < 3600) "${s / 60} min" else "${s / 3600} h"
    }

    /** The Pages screen's two sections: the pages kept up to date, then the others, each newest first as the server lists them. */
    fun split(pages: List<PageInfo>): Pair<List<PageInfo>, List<PageInfo>> = pages.partition { it.keep != null }

    /** A row's line on the Pages screen: "Ops · updated 5m ago · Daily at 07:00". */
    fun allLine(page: PageInfo, now: java.time.Instant = java.time.Instant.now()): String =
        listOfNotNull(page.bot.ifBlank { null }, line(page, now)).joinToString(" · ")

    /** A page's address: with `?view=1` the viewer reads it, with its `page`. */
    fun src(botId: String, slug: String): String = "/bots/${Api.enc(botId)}/pages/${Api.enc(slug)}"

    /** The pages a run saved, as it lists them; an entry that cannot be read is left out. */
    fun refs(v: JsonElement?): List<PageRef> = (v as? kotlinx.serialization.json.JsonArray).orEmpty()
        .mapNotNull { e -> (e as? JsonObject)?.let { runCatching { Api.JSON.decodeFromJsonElement<PageRef>(it) }.getOrNull() } }
        .filter { it.slug.isNotBlank() }

    /** The viewer's second line on a page: "Page by Ops · updated 5m ago". */
    fun subtitle(from: String, page: PageInfo?, now: java.time.Instant = java.time.Instant.now()): String {
        val what = if (page?.kind == "interactive") "Interactive page" else "Page"
        return listOfNotNull(if (from.isBlank()) what else "$what by $from", page?.let { "updated ${NotesWake.ago(it.updatedAt, now)}" }).joinToString(" · ")
    }

    /** Its line in the bot's settings: "updated 5m ago · Daily at 07:00". */
    fun line(page: PageInfo, now: java.time.Instant = java.time.Instant.now()): String =
        listOfNotNull("updated ${NotesWake.ago(page.updatedAt, now)}", page.keep?.`when`).joinToString(" · ")

    /** How often, on the "Keep up to date" sheet: what the server takes, and its words. */
    val EVERY = listOf("hour" to "Every hour", "day" to "Every morning", "monday" to "Every Monday")

    /** A page's blocks (#395): filled in anew at `?blocks=1`. A page has them only from a server with `page-blocks`. */
    fun blocksSrc(src: String): String = DocumentView.withQuery(src, "blocks=1")

    /**
     * A grid's rows as a phone draws them: at most two side by side (a chart takes a row of its own), on a wider screen
     * as many as its columns say (one to four).
     */
    fun rows(blocks: List<Block>, columns: Int?, wide: Boolean): List<List<Block>> {
        val n = if (wide) (columns ?: 1).coerceIn(1, 4) else (columns ?: 1).coerceIn(1, 2)
        val out = mutableListOf<List<Block>>()
        var row = mutableListOf<Block>()
        for (b in blocks) {
            if (!wide && b.type == "chart") { if (row.isNotEmpty()) out += row; out += listOf(b); row = mutableListOf(); continue }
            row += b
            if (row.size == n) { out += row; row = mutableListOf() }
        }
        if (row.isNotEmpty()) out += row
        return out
    }
}

/** One part of a page with blocks (#395): Markdown, or a block the kit draws (`type` "error": one that cannot be drawn). */
@Serializable
data class PagePart(val md: String? = null, val block: Block? = null)

@Serializable
data class PageBlocks(val parts: List<PagePart> = emptyList(), val tiles: List<String> = emptyList(), val plain: String? = null)

/** The live feed's `dashboard`: a tile's new value (its id), or the Board changed (null), for an open page whose blocks read it (#395). */
class TileTicks {
    private val _value = MutableStateFlow<Pair<String?, Long>>(null to 0L)
    val value: StateFlow<Pair<String?, Long>> = _value.asStateFlow()

    fun tick(tileId: String?) { _value.value = tileId to _value.value.second + 1 }
}

@Serializable
data class PageRef(val slug: String = "", val title: String = "")

/**
 * A bot's interactive page as the viewer gets it (#399, ADR 072): [frame] its address on the sandbox's own origin,
 * signed for a short while (null: this machine has no such address yet), the version [shown] and the one the page
 * shows ([current]), the versions kept, newest first, and the values of the [tiles] it reads, which the app hands it.
 */
@Serializable
data class InteractiveView(
    val current: Int = 0,
    val shown: Int = 0,
    val versions: List<SiteVersion> = emptyList(),
    val frame: String? = null,
    val expires: String? = null,
    val values: JsonObject? = null,
    val tiles: List<String> = emptyList(),
)

@Serializable
data class SiteVersion(val n: Int = 0, val at: String? = null, val bytes: Long = 0, val files: Int = 0)

@Serializable
data class PageValues(val values: JsonObject? = null, val tiles: List<String> = emptyList())

/** An interactive page in its frame (#399): what the app may and may not let through. */
object InteractivePages {
    const val FEATURE = "interactive-pages"
    const val ISOLATED = "Isolated: runs on its own address, cannot see your account, cannot reach the internet."

    /** The address the page's own files are under: its frame's address up to its last /. */
    fun prefix(frame: String): String = frame.substringBeforeLast('/') + "/"

    /** Where a navigation inside the frame goes: its own files stay, a link out is asked about first, anything else stays shut. */
    sealed interface Go {
        data object Stay : Go
        data class Ask(val url: String) : Go
        data object Block : Go
    }

    /** The scheme the frame's one request, a link out, arrives on (the script [LISTENER] turns its message into it). */
    const val OPEN_SCHEME = "botdot-open"

    fun go(frame: String, url: String): Go {
        if (url.startsWith("$OPEN_SCHEME:")) return linkOut(java.net.URLDecoder.decode(url.removePrefix("$OPEN_SCHEME:"), "UTF-8"))
        if (url.startsWith(prefix(frame))) return Go.Stay
        return linkOut(url)
    }

    private fun linkOut(url: String): Go {
        val u = runCatching { java.net.URI(url) }.getOrNull() ?: return Go.Block
        return if ((u.scheme == "https" || u.scheme == "http") && !u.host.isNullOrBlank()) Go.Ask(url.take(2000)) else Go.Block
    }

    /**
     * Run in the page once it has loaded: on a phone it is the WebView's own document, so a page's parent.postMessage
     * comes to itself. Its one request, { botdot: "open", url }, becomes a navigation to [OPEN_SCHEME], which the
     * WebView never loads but asks the owner about. Nothing else of the page reaches the app: there is no bridge.
     */
    const val LISTENER = "(function(){if(window.__botdotOpen)return;window.__botdotOpen=1;window.addEventListener('message',function(e){var d=e.data;" +
        "if(d&&d.botdot==='open'&&typeof d.url==='string')location.href='$OPEN_SCHEME:'+encodeURIComponent(d.url.slice(0,2000));});})();"

    /** The live values handed to the page: the message it listens for, { botdot: "values", values }. */
    fun valuesScript(values: JsonObject): String = "window.postMessage({\"botdot\":\"values\",\"values\":$values},'*');"
}

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
    /** On the list of every bot's pages (#361): whose page it is. */
    val botId: String = "",
    val bot: String = "",
    /** "interactive" for a bot's interactive page (#399); else a page of Markdown. */
    val kind: String = "",
    val version: Int? = null,
    /** On the Board (#451), from a server with `pages-board`; null from one before. */
    val onBoard: Boolean? = null,
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
