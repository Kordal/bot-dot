package dev.botdot.app.ui

import dev.botdot.app.data.Block
import dev.botdot.app.data.Dashboard
import dev.botdot.app.data.Tile

/** The Board's own words, the same as the web page's (public/app.js). */
object BoardWords {
    const val NAME = "Board"
    /** In the list's strip, after the name, while no tile is there to show. */
    const val NOTHING = "Nothing on it yet"
    /** The empty page, its first line: what the Board is for. */
    const val WHAT_FOR = "Tiles for the things you use most: a light switch, the temperature, a shopping list, a morning summary."
    /** The empty page, its second line, up to the example. */
    const val TELL = "Nothing is on it yet. Tell the Chief or any bot, for example: "
    const val EXAMPLE = "“Put a shopping list on my board.”"
    /** Over the switches and buttons of a heading, drawn as rows of one box (#394). */
    const val CONTROLS = "Controls"
    /** On a tile whose value a bot or the Chief wrote (#394). */
    const val WRITTEN_BY_AI = "written by AI"
}

/**
 * What the list's strip shows: null before the Board has loaded (no strip), no tiles when none is there to
 * show (the strip says so), else the tiles on home ([dev.botdot.app.data.HomeTiles.on]).
 */
fun stripTiles(dash: Dashboard?): List<Tile>? = dash?.let { dev.botdot.app.data.HomeTiles.on(it) }

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
    return if (short.isNotEmpty()) Block(type = "kpi", label = t.title, text = short) else null
}

/**
 * What a tile says for a moment after a tap that asks its bot: "Asked <Bot>", or, when the bot was busy and the
 * server kept the request ([queued]), "<Bot> will do it when it is free". [bot]: its name, or null when it is not known.
 */
fun tileAsked(bot: String?, queued: Boolean): String =
    if (queued) "${bot ?: "Its bot"} will do it when it is free" else "Asked ${bot ?: "its bot"}"

/**
 * How often a tile refreshes, in words, for its pop-up (#42), as the web page says it: [Tile.every] as the owner
 * chose it, 0 for only when tapped; null for a tile that reads nothing, or from a server that doesn't say.
 */
fun refreshLine(t: Tile): String? {
    val n = t.every ?: return null
    fun unit(k: Int, one: String) = if (k == 1) "every $one" else "every $k ${one}s"
    val now = when {
        n == 0 -> "only when tapped"
        n % 86400 == 0 -> "${unit(n / 86400, "day")} while the Board is open"
        n % 3600 == 0 -> "${unit(n / 3600, "hour")} while the Board is open"
        n % 60 == 0 -> "${unit(n / 60, "minute")} while the Board is open"
        else -> "${unit(n, "second")} while the Board is open"
    }
    return "Refreshes $now. Ask the Chief of Staff to change it."
}
