package dev.botdot.app.ui

import dev.botdot.app.data.Block
import dev.botdot.app.data.Dashboard
import dev.botdot.app.data.Tile
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn

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
