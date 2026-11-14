package dev.botdot.app.data

import kotlinx.datetime.TimeZone
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.datetime.toLocalDateTime
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.time.Instant

/*
 * The Board's rules, for every phone (ADR 242): what the block kit says (like the web page's public/blocks.js), the
 * order the Board's tiles are drawn in, its words, and what a tap on a tile does. The Android app's DashboardScreen
 * and the iPhone's BoardView draw from them; lib/tile-blocks.js fills the blocks in.
 */
object BoardKit {
    /** A time as the owner's clock shows it: "08:00". */
    fun clock(ms: Long): String = Instant.fromEpochMilliseconds(ms).toLocalDateTime(TimeZone.currentSystemDefault()).let {
        "${it.hour.toString().padStart(2, '0')}:${it.minute.toString().padStart(2, '0')}"
    }

    fun num(n: Double): String = ((n * 100).roundToInt() / 100.0).let { if (it == floor(it)) it.toLong().toString() else it.toString() }

    /** "3s ago", "2 min ago", "2 h ago": the age of a value, as the web page says it. */
    fun ageWords(secs: Long): String {
        val s = maxOf(0L, secs)
        return tr("{age} ago", "age" to when { s < 60 -> "${s}s"; s < 3600 -> "${s / 60} min"; else -> "${s / 3600} h" })
    }

    /** When the newest value came, in epoch ms; 0 while none has. */
    fun newestAt(tiles: List<Tile>): Long = tiles.maxOfOrNull { t -> t.at?.let { runCatching { Instant.parse(it).toEpochMilliseconds() }.getOrNull() } ?: 0L } ?: 0L

    private val number = Regex("^[-+−]?[\$€£¥]?\\d[\\d\\s.,:/'%]*[\\p{L}°%]{0,3}$")

    /** A value in words ("Eco until 17:00") rather than a number ("21.5", "−3", "62%", "17:00", "1.2k"): drawn at 20,
     *  so it fits one line, while a number stays big. kitIsWords on the web page says the same. */
    fun isWords(text: String?): Boolean = text.orEmpty().trim().let { it.isNotEmpty() && !number.matches(it) }

    /** A tile whose face is one number (a value or a kpi): a kpi's head; a small one goes two across on a phone. */
    fun isKpiTile(t: Tile): Boolean = t.kind != "group" && t.look?.face?.singleOrNull()?.type in setOf("value", "kpi")

    /** A switch or a button as it comes (no blocks of its own): a row of a Controls box. */
    fun isControlRow(t: Tile): Boolean = t.kind in setOf("switch", "button") && t.look?.face.orEmpty().isEmpty() && t.size == "small" && !t.wide

    /** Beside a heading: the bots its tiles come from. */
    fun sectionBots(tiles: List<Tile>, bots: List<Bot>): String = tiles.mapNotNull { t -> bots.firstOrNull { it.id == t.bot }?.name }.distinct().joinToString(", ")

    /** Where a heading's tiles' values come from, when that is one for all of them (its end then says how long ago they read); else "". */
    fun sectionSource(tiles: List<Tile>): String = tiles.mapNotNull { it.source }.distinct().singleOrNull() ?: ""

    /** How a number changed: "▲ 0.8 since 08:00", or "" when it doesn't say. */
    fun deltaLine(b: Block, clock: (Long) -> String = ::clock): String {
        val d = b.delta ?: return ""
        val arrow = when (d.dir) { "up" -> "▲"; "down" -> "▼"; else -> "–" }
        val since = b.since?.let { runCatching { Instant.parse(it).toEpochMilliseconds() }.getOrNull() }?.let { " " + tr("since {time}", "time" to clock(it)) } ?: ""
        return "$arrow ${d.text}$since"
    }

    /** How many columns a tile takes in a grid of [cols]: a kpi two across on a phone, the rest one across there. */
    fun span(t: Tile, cols: Int): Int = when {
        t.size == "row" -> cols
        t.size == "wide" || t.size == "big" || t.wide -> minOf(2, cols)
        cols <= 2 && isKpiTile(t) -> 1
        cols <= 2 -> cols
        else -> 1
    }

    /** The columns of the Board at a width in dp: four wide, three on a tablet, two on a phone. */
    fun columns(widthDp: Float): Int = when { widthDp >= 840 -> 4; widthDp >= 600 -> 3; else -> 2 }

    /** Whether blocks have Markdown text in them (a note): a value a bot wrote shows "written by AI" there. */
    fun hasMarkdown(list: List<Block>): Boolean = list.any { (it.type == "text" && it.markdown) || hasMarkdown(it.blocks) }

    fun level(l: String?): String = if (l in setOf("ok", "warn", "err", "info", "plan")) l!! else "info"

    /** A control's value as a number, or as text (a choice's, a colour's); null when it has none. */
    fun numberOf(v: JsonElement?): Double? = (v as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull
    fun textOf(v: JsonElement?): String? = (v as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull

    private fun fmt(n: Double): String = ((n * 100).roundToInt() / 100.0).let { if (it == it.toLong().toDouble()) it.toLong().toString() else it.toString() }

    /** What a slider says beside its label at [v]: "40 %", or the number and its unit. */
    fun sliderText(b: Block, v: Double): String = if (b.percent) "${(((v - b.min) / (b.max - b.min)) * 100).roundToInt()} %" else fmt(v) + (b.unit?.let { " $it" } ?: "")

    /** Where a slider let go at [v] lands: on its steps from its min. */
    fun snap(b: Block, v: Double): Double = ((v - b.min) / b.step).roundToInt() * b.step + b.min

    /** Markdown, flattened for a few lines on a tile. */
    fun plain(md: String): String = md.replace("**", "").replace(Regex("(?m)^\\s*[-*#]+\\s+"), "").replace(Regex("\\n\\s*\\n+"), "\n").trim()

    /** A heading's key in [layout]: "h:<heading>". The top and the end of an open group's tiles: "in:<group>", "out:<group>". */
    const val HEADING = "h:"
    const val GROUP_TOP = "in:"
    const val GROUP_END = "out:"

    /** The headings that have a loose tile under them, in the Board's order: the filter offers them. */
    fun headings(d: Dashboard?): List<String> = d?.sections.orEmpty().filter { s -> d?.tiles.orEmpty().any { it.parent == null && it.section == s } }

    /**
     * The Board as a list of keys: each heading's key, its loose tiles' ids, and around an open group's tiles its
     * [GROUP_TOP] and [GROUP_END]. Only the heading [filter] ("" for all of them); [open]: the groups opened.
     */
    fun layout(d: Dashboard?, filter: String, open: Set<String>): List<String> {
        val all = d?.tiles.orEmpty()
        val loose = all.filter { it.parent == null }
        val out = mutableListOf<String>()
        for ((name, ts) in listOf("" to loose.filter { it.section.isEmpty() }) + d?.sections.orEmpty().map { s -> s to loose.filter { it.section == s } }) {
            if (ts.isEmpty() || (filter.isNotEmpty() && name != filter)) continue
            if (name.isNotEmpty()) out += "$HEADING$name"
            for (t in ts) {
                out += t.id
                if (t.kind == "group" && t.id in open) { out += "$GROUP_TOP${t.id}"; out += all.filter { it.parent == t.id }.map { it.id }; out += "$GROUP_END${t.id}" }
            }
        }
        return out
    }

    /** How a tile's face is drawn in a grid of [cols]: "wide" (its axes too), "compact" (a kpi half a phone wide) or "face". */
    fun where(t: Tile, cols: Int): String = when { t.size != "small" || t.wide -> "wide"; cols <= 2 && isKpiTile(t) -> "compact"; else -> "face" }

    /** The line under a tile: that it waits for the owner's OK, what a tap just said ([flash]), or that it couldn't update. */
    fun note(t: Tile, waiting: Boolean, flash: String?): String? =
        if (waiting) tr("Waiting for your OK") else flash ?: if (t.error != null) tr("Couldn't update") else null

    /** How long ago a page tile's page was saved ([Pages.age]), as of now; "" for a tile without that time. */
    fun pageAge(t: Tile): String = t.at?.let { Pages.age(it) }.orEmpty()

    /** The question before a tap of a tile that asks first ([BoardTap.Ask]), and its yes. */
    fun askTitle(t: Tile, on: Boolean?): String = when (on) { true -> tr("Turn on “{title}”?", "title" to t.title); false -> tr("Turn off “{title}”?", "title" to t.title); null -> "${t.title}?" }
    fun askYes(on: Boolean?): String = when (on) { true -> tr("Turn on"); false -> tr("Turn off"); null -> "OK" }
}

/** The Board's own words, the same as the web page's (public/app.js). */
object BoardWords {
    val NAME: String get() = tr("Board")
    /** In the list's strip, after the name, while no tile is there to show. */
    val NOTHING: String get() = tr("Nothing on it yet")
    /** The empty page, its first line: what the Board is for. */
    val WHAT_FOR: String get() = tr("Tiles for the things you use most: a light switch, the temperature, a shopping list, a morning summary.")
    /** The empty page, its second line, up to the example. */
    val TELL: String get() = tr("Nothing is on it yet. Tell the Chief or any bot, for example: ")
    val EXAMPLE: String get() = tr("“Put a shopping list on my board.”")
    /** Over the switches and buttons of a heading, drawn as rows of one box (#394). */
    val CONTROLS: String get() = tr("Controls")
    /** On a tile whose value a bot or the Chief wrote (#394). */
    val WRITTEN_BY_AI: String get() = tr("written by AI")
}

/**
 * What a tile says for a moment after a tap that asks its bot: "Asked <Bot>", or, when the bot was busy and the
 * server kept the request ([queued]), "<Bot> will do it when it is free". [bot]: its name, or null when it is not known.
 */
fun tileAsked(bot: String?, queued: Boolean): String =
    if (queued) tr("{bot} will do it when it is free", "bot" to (bot ?: tr("Its bot"))) else tr("Asked {bot}", "bot" to (bot ?: tr("its bot")))

/**
 * How often a tile refreshes, in words, for its pop-up (#42), as the web page says it: [Tile.every] as the owner
 * chose it, 0 for only when tapped; null for a tile that reads nothing, or from a server that doesn't say.
 */
fun refreshLine(t: Tile): String? {
    val n = t.every ?: return null
    fun open(every: String) = tr("{every} while the Board is open", "every" to every)
    val now = when {
        n == 0 -> tr("only when tapped")
        n % 86400 == 0 -> open(trn(n / 86400, "every day", "every {n} days"))
        n % 3600 == 0 -> open(trn(n / 3600, "every hour", "every {n} hours"))
        n % 60 == 0 -> open(trn(n / 60, "every minute", "every {n} minutes"))
        else -> open(trn(n, "every second", "every {n} seconds"))
    }
    return tr("Refreshes {when}. Ask the Chief of Staff to change it.", "when" to now)
}

/** A tile's dot colour: its own, else its bot's. A group has no bot: it takes the one whose tiles are in it (the Chief's when they're mixed). */
fun tileColor(t: Tile, tiles: List<Tile>, bots: List<Bot>): String {
    val owner = t.bot ?: tiles.filter { it.parent == t.id }.mapNotNull { it.bot }.toSet().singleOrNull().takeIf { t.kind == "group" }
    return t.color ?: bots.firstOrNull { it.id == owner }?.color ?: CHIEF_COLOR
}

/** Whether a tap on a tile asks "are you sure" first (its confirm, docs/api.md "A tile that asks first"). */
fun tileAsksFirst(confirm: String?, tap: String, on: Boolean?): Boolean = when {
    confirm.isNullOrEmpty() -> false
    tap == "toggle" -> confirm == "always" || confirm == (if (on == true) "on" else "off")
    tap == "act" -> confirm == "always"
    else -> false
}

/**
 * What a tap on a tile does (its `look.tap`, docs/api.md): open the page it is ([Page]), open or close a group
 * ([Group]), Needs you while it waits for the owner's OK ([Needs]), its pop-up ([Panel]), its bot's chat ([Chat]),
 * nothing ([Quiet]), ask first ([Ask]) or send the tap ([Send]: switched to [Send.on], or run, or read again).
 */
sealed class BoardTap {
    data class Page(val bot: String, val slug: String) : BoardTap()
    data object Group : BoardTap()
    data object Needs : BoardTap()
    data object Panel : BoardTap()
    data class Chat(val bot: String) : BoardTap()
    data object Quiet : BoardTap()
    data class Ask(val on: Boolean?) : BoardTap()
    data class Send(val on: Boolean?) : BoardTap()

    companion object {
        /** A tap on [t]; [waiting]: it waits for the owner's OK; [bots]: the ids of the bots there are; [asked]: its question was answered yes. */
        fun of(t: Tile, waiting: Boolean, bots: Collection<String>, asked: Boolean = false): BoardTap {
            if (t.kind == "page") return t.page?.let { Page(it.bot, it.slug) } ?: Quiet
            val how = t.look?.tap ?: if (t.kind == "group") "group" else "none"
            if (how == "group") return Group
            if (waiting) return Needs
            when (how) {
                "panel" -> return Panel
                "chat" -> return t.bot?.takeIf { it in bots }?.let { Chat(it) } ?: Quiet
                "none" -> return Quiet
            }
            val on = if (how == "toggle") t.look?.dot?.filled != true else null
            return if (!asked && tileAsksFirst(t.confirm, how, on)) Ask(on) else Send(on)
        }
    }
}
