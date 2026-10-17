package dev.botdot.app.ui

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
}

/**
 * What the list's strip shows: null before the Board has loaded (no strip), no tiles when none is there to
 * show (the strip says so), else the tiles: those not inside a group and not waiting for your OK.
 */
fun stripTiles(dash: Dashboard?): List<Tile>? = dash?.tiles?.filter { it.parent == null && it.approved }

/**
 * What a tile says for a moment after a tap that asks its bot: "Asked <Bot>", or, when the bot was busy and the
 * server kept the request ([queued]), "<Bot> will do it when it is free". [bot]: its name, or null when it is not known.
 */
fun tileAsked(bot: String?, queued: Boolean): String =
    if (queued) "${bot ?: "Its bot"} will do it when it is free" else "Asked ${bot ?: "its bot"}"
