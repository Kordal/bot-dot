package dev.botdot.app.data

/**
 * Choosing the Board tiles on home (#447, docs/api.md "The Board"): a long press on the strip over the keys opens a
 * sheet with every approved tile of the Board, those on home first in their order. A check puts one on or takes it
 * off, a handle drags a checked one to another place, and each change is saved at once (PUT /dashboard/layout
 * { home }). A botdot from before it has no `home-tiles` and no `home`: the strip shows every tile at the top.
 */
object HomeTiles {
    const val FEATURE = "home-tiles"

    fun shows(features: Collection<String>?): Boolean = FEATURE in features.orEmpty()

    /** The tiles on home, in their order: those the server names, else every approved tile without a group. */
    fun on(dash: Dashboard): List<Tile> {
        val byId = dash.tiles.associateBy { it.id }
        return dash.home?.mapNotNull { byId[it] } ?: dash.tiles.filter { it.parent == null && it.approved }
    }

    /** The sheet's rows: the ids on home in their order, then every other approved tile in the Board's order. */
    fun rows(dash: Dashboard): Pair<List<String>, List<String>> {
        val on = on(dash).map { it.id }
        return on to dash.tiles.filter { it.approved && it.id !in on }.map { it.id }
    }

    /** A check: off home when it was on, else last on it. */
    fun toggle(on: List<String>, id: String): List<String> = if (id in on) on - id else on + id

    /** A dragged row passes another: they swap places. */
    fun move(on: List<String>, from: String, to: String): List<String> {
        val a = on.indexOf(from)
        val b = on.indexOf(to)
        if (a < 0 || b < 0) return on
        return on.toMutableList().apply { add(b, removeAt(a)) }
    }
}
