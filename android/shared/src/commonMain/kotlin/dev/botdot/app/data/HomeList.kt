package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Home's list, for both phones (ADR 242): the rows in the owner's order, where a dragged row lands, and what a bot's
// row says under its name.

/** The list: the big figures on top, then each category's heading, its bots and, after them, its groups (ADR 018). */
object ListLayout {
    const val PINS = "pins" // the row of big figures: drag a bot or a group above it to pin it
    private const val HEADING = "g:"
    private const val GROUP = "group:"

    fun heading(category: String) = "$HEADING$category"
    fun isHeading(key: String) = key.startsWith(HEADING)
    fun categoryOf(key: String) = key.removePrefix(HEADING)
    fun groupRow(id: String) = "$GROUP$id"
    fun isGroup(key: String) = key.startsWith(GROUP)
    fun groupOf(key: String) = key.removePrefix(GROUP)

    /** [pins]: the pinned bots' ids and the pinned groups' rows, in their order. [layout]: every row's key, top to bottom. */
    class Rows(val pins: List<String>, val layout: List<String>)

    /**
     * The rows as the server's places say them. A category is one of the bots' or of the groups': it can hold groups
     * and no bot. Bots never placed show A to Z. [folded]: the categories whose heading alone shows. [shared]: the
     * server counts the pinned bots and groups in one order (`pins-shared`, #276); else the pinned bots come first.
     */
    fun rows(bots: List<Bot>, groups: List<Group>, folded: Set<String>, shared: Boolean = false): Rows {
        val (pinned, rest) = bots.partition { it.pinned > 0 }
        val loose = groups.filter { it.pinned <= 0 }
        val categories = (rest.map { it.group } + loose.map { it.category }).distinct().sortedWith(compareBy<String> { it.isEmpty() }.thenBy { it.lowercase() })
        val layout = buildList {
            add(PINS)
            for (category in categories) {
                val named = categories.size > 1 || category.isNotEmpty()
                if (named) add(heading(category))
                if (named && category in folded) continue // dropped on its heading, a bot still lands in it
                addAll(rest.filter { it.group == category }.sortedWith(compareBy<Bot> { if (it.order > 0) it.order else Int.MAX_VALUE }.thenBy { it.name.lowercase() }).map { it.id })
                addAll(Groups.inCategory(groups, category).map { groupRow(it.id) })
            }
        }
        val pins = if (!shared) pinned.sortedBy { it.pinned }.map { it.id } + Groups.pinned(groups).map { groupRow(it.id) }
        // One order; a bot and a group on the same place (kept from before it): the bot first, as the server sorts them.
        else (pinned.map { Triple(it.pinned, 0, it.id) } + Groups.pinned(groups).map { Triple(it.pinned, 1, groupRow(it.id)) })
            .sortedWith(compareBy({ it.first }, { it.second })).map { it.third }
        return Rows(pins, layout)
    }

    /** Where a dragged row was let go: pinned at a place, or in a category at a place. Both count from 1, among its own
     *  kind, except a pinned place where the server shares one order: among the pinned bots and groups together. */
    sealed interface Place {
        data class Pinned(val at: Int) : Place
        data class In(val category: String, val at: Int) : Place
    }

    /**
     * The place of the row [key] in the list as it is drawn while dragging. A bot's place is among the bots and a
     * group's among the groups (docs/api.md, Groups): a group let go between two bots is the first group of that
     * category, and a bot let go under a group is the last bot there. Among the big figures, with [shared] (one order
     * for the pinned bots and groups, #276), either kind is counted among all of them. null for a row that is not in
     * the list.
     */
    fun dropped(layout: List<String>, pins: List<String>, key: String, shared: Boolean = false): Place? {
        val group = isGroup(key)
        val same = { k: String -> k != PINS && !isHeading(k) && isGroup(k) == group }
        val pinned = { k: String -> shared || same(k) }
        val pin = pins.indexOf(key)
        if (pin >= 0) return Place.Pinned(pins.take(pin).count(pinned) + 1) // a big figure, moved among the others
        val at = layout.indexOf(key)
        val line = layout.indexOf(PINS)
        if (at < 0) return null
        if (at < line) return Place.Pinned(pins.count(pinned) + 1) // above the big figures: the last of the pinned ones
        val head = (at - 1 downTo line + 1).firstOrNull { isHeading(layout[it]) }
        return Place.In(head?.let { categoryOf(layout[it]) }.orEmpty(), layout.subList((head ?: line) + 1, at).count(same) + 1)
    }

    /**
     * The update that puts a bot ([group] false) or a group at [place], as the list's drag and the keypad's send it:
     * `pinned` for a place among the pinned ones, else its category (a bot's `group`, a group's `category`) and its
     * `order` there, and `pinned: 0` when it was [pinned] and leaves the pinned ones.
     */
    fun change(place: Place, group: Boolean, pinned: Boolean): JsonObject = buildJsonObject {
        when (place) {
            is Place.Pinned -> put("pinned", place.at)
            is Place.In -> {
                put(if (group) "category" else "group", place.category)
                put("order", place.at)
                if (pinned) put("pinned", 0)
            }
        }
    }

    /** A row's move to save: the bot's id or the group's, and its [change]. */
    class Move(val bot: String?, val group: String?, val change: JsonObject)

    /**
     * What to save when the row [key] was let go in [order], the list as drawn while dragging: the pinned rows, then
     * [PINS], then the rest (the order the iPhone's list moves its rows in). null when it stays where it was, or is
     * not a row; as Android's list decides it on letting go.
     */
    fun moved(order: List<String>, key: String, bots: List<Bot>, groups: List<Group>, shared: Boolean): Move? {
        val line = order.indexOf(PINS)
        if (line < 0) return null
        val place = dropped(order.subList(line, order.size), order.subList(0, line), key, shared) ?: return null
        val group = if (isGroup(key)) groups.firstOrNull { it.id == groupOf(key) } else null
        val bot = if (group == null) bots.firstOrNull { it.id == key } else null
        if (group == null && bot == null) return null
        val pinned = group?.pinned ?: bot?.pinned ?: 0
        val category = group?.category ?: bot?.group.orEmpty()
        val at = group?.order ?: bot?.order ?: 0
        val stays = when (place) {
            is Place.Pinned -> place.at == pinned
            is Place.In -> pinned == 0 && place.category == category && place.at == at
        }
        if (stays) return null
        return Move(bot?.id, group?.id, change(place, group = group != null, pinned = pinned > 0))
    }
}

/**
 * What a bot's row says of its open question (`asks` on the bot, docs/api.md): "Asks: <question>", in one line. null
 * when it asks nothing, the server says nothing of it, or it is working: the row then says what it does. [r]: its latest run.
 */
fun botAsks(b: Bot, r: Run?): String? =
    b.asks?.takeIf { !(b.running || r?.isRunning == true) }?.let { tr("Asks:") + " " + plainText(it.text).replace('\n', ' ').take(120) }

/**
 * What a bot's row says under its name: what it's doing (its [line] as the server says it, "Working…" without
 * one: the words under its chat and the web page's), what it asks the owner ([botAsks]), or the last thing it said.
 * [r]: its latest run.
 */
fun botSub(b: Bot, r: Run?, line: String?): String = when {
    b.running || r?.isRunning == true -> OpeningLine.status(line, working = true)
    b.asks != null -> botAsks(b, r).orEmpty()
    b.jobs.any { it.waits } -> jobWaits(b.jobs.first { it.waits })
    r == null -> b.description
    r.status == "success" -> plainText(r.result.orEmpty()).replace('\n', ' ').take(120).ifBlank { b.description }
    r.status == "stopped" -> tr("Stopped")
    else -> tr("Couldn't finish")
}

/**
 * What the list's strip shows: null before the Board has loaded (no strip), no tiles when none is there to
 * show (the strip says so), else the tiles on home ([HomeTiles.on]).
 */
fun stripTiles(dash: Dashboard?): List<Tile>? = dash?.let { HomeTiles.on(it) }

/**
 * A tile as a card of the strip over the keys (#397), the web page's rule (list.js, stripKpi): a kpi of its title over
 * its first number (a value, a kpi, a bar or a gauge on its face, also inside a row or a column) with that block's
 * recent values and bar; with none, its one-line value; null for a tile with neither, which shows its dot (a switch
 * On or Off).
 */
fun stripKpi(t: Tile): Block? {
    fun find(list: List<Block>): Block? {
        for (b in list) {
            if (b.type in setOf("kpi", "value", "progress", "gauge")) return b
            find(b.blocks)?.let { return it }
        }
        return null
    }
    val b = find(t.look?.face.orEmpty())
    if (b != null) return Block(type = "kpi", label = t.title, text = b.text.orEmpty(), unit = b.unit.takeIf { b.type == "kpi" || b.type == "value" }, of = b.of, points = b.points, ratio = b.ratio, color = b.color)
    val short = t.look?.short.orEmpty()
    if (short.isNotEmpty()) return Block(type = "kpi", label = t.title, text = short)
    // A page without a number (#451): its age, as the web page's strip.
    return if (t.kind == "page" && t.at != null) Block(type = "kpi", label = t.title, text = Pages.age(t.at)) else null
}

/**
 * A note's text on the strip over the keys (#1505), the web page's rule (list.js, stripKpi, #1502): the markdown text
 * block of a tile that has no number ([stripKpi] is null), the title's text under it, folded to its block's `lines`
 * ([NOTE_LINES] when it says none). Null for a tile with a number, for one with no text block with text (a note with
 * empty text keeps its dot), and for any other kind of face.
 */
fun stripNote(t: Tile): Block? =
    if (stripKpi(t) != null) null else t.look?.face.orEmpty().firstOrNull { it.type == "text" && it.markdown && !it.text.isNullOrEmpty() }

/** How many lines a note's text is folded to on the strip when its block says none: the Board's fold. */
const val NOTE_LINES = 3
