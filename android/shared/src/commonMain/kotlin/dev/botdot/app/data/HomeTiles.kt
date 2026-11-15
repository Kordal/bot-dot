package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

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

/** One row of the tiles-on-home sheet: a Board tile and its title. */
data class HomeTileRow(val id: String, val title: String)

/** The tiles-on-home sheet at one moment (#447): those on home in their order, then the other approved tiles. */
class HomeTilesState(val on: List<HomeTileRow> = emptyList(), val rest: List<HomeTileRow> = emptyList(), val notice: String? = null, val noticeCount: Int = 0)

/**
 * The tiles-on-home sheet for both phones (#447; Android's HomeTilesSheet): [toggle] and a [drop] after [move]s save
 * the whole list at once, shown at once and put back, with botdot's words, when it says no. While it is open, a
 * change of the Board's list from elsewhere (a save of ours coming back, the Chief's) takes the place of the rows;
 * a read that brings the same list (Home's minute) leaves a drag or a save on its way as it is.
 */
class HomeTilesDesk(private val scope: CoroutineScope, private val api: Api, private val store: Store) {
    private var on: List<String>? = null
    /** The server's list last seen: the rows take a new one only, so a refresh of the same keeps a drag or a save on its way. */
    private var seen: List<String>? = null
    private var notice: String? = null
    private var noticeCount = 0
    private val _state = MutableStateFlow(HomeTilesState())
    val state: StateFlow<HomeTilesState> = _state.asStateFlow()

    init {
        scope.launch {
            store.dashboard.value.collect { d ->
                val home = d?.let { HomeTiles.rows(it).first }
                if (home != seen) { seen = home; on = home }
                publish() // the titles and the rest follow every read
            }
        }
    }

    fun watch(onChange: (HomeTilesState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    /** A row's check: on home last, or off it; saved at once. */
    @Throws(Exception::class)
    suspend fun toggle(id: String) { val now = on ?: return; save(now, HomeTiles.toggle(now, id)) }

    /** A dragged row passes another ([HomeTiles.move]): shown, saved when it is let go ([drop]). */
    fun move(from: String, to: String) { on = on?.let { HomeTiles.move(it, from, to) }; publish() }

    /** The order of the rows on home as [ids] (a whole list from a drag the phone did itself): shown, saved at [drop]. */
    fun order(ids: List<String>) { if (on != null && ids.toSet() == on!!.toSet()) { on = ids; publish() } }

    /** A drag let go: the order saved. */
    @Throws(Exception::class)
    suspend fun drop() { val now = on ?: return; save(HomeTiles.rows(store.dashboard.value.value ?: return).first, now) }

    private suspend fun save(before: List<String>, next: List<String>) {
        on = next
        publish()
        try {
            api.setHomeTiles(next)
            runCatching { store.dashboard.refresh() }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            on = before
            notice = e.message ?: tr("Couldn't save")
            noticeCount++
            publish()
        }
    }

    private fun publish() {
        val d = store.dashboard.value.value
        val now = on
        if (d == null || now == null) { _state.value = HomeTilesState(notice = notice, noticeCount = noticeCount); return }
        val titles = d.tiles.associate { it.id to it.title }
        _state.value = HomeTilesState(
            on = now.map { HomeTileRow(it, titles[it].orEmpty()) },
            rest = d.tiles.filter { it.approved && it.id !in now }.map { HomeTileRow(it.id, it.title) },
            notice = notice, noticeCount = noticeCount,
        )
    }
}
