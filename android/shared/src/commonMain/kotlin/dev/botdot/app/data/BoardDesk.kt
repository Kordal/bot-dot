package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

// The Board as a phone draws it and nothing more (ADR 242, #1372): its cells in the order the Android app's
// DashboardScreen lays them out (BoardKit), each tile's colour, span, note and age, and what a tap does (BoardTap). The
// iPhone draws [BoardState] and hands each tap back to [BoardDesk].

/** What a cell of the Board is: a heading, a tile as a card, a switch or button as a row of a Controls box, the top or the end of an open group's tiles. */
enum class BoardCellKind { HEADING, TILE, CONTROL, GROUP_TOP, GROUP_END }

/** One dot of a group's card: a tile inside it, filled when on ([filled] null: not known), in its colour. */
data class BoardDot(val filled: Boolean?, val color: String)

/**
 * One cell of the Board. [span]: the columns it takes, of [BoardState.columns]. [readAt]: when the values whose age it
 * says came, in epoch ms; 0 when it says none ([BoardKit.ageWords] of the time since). [first] and [last]: a control
 * row that starts or ends its Controls box. [empty]: an open group with nothing in it.
 */
data class BoardCell(
    val key: String,
    val kind: BoardCellKind,
    val tile: Tile? = null,
    val heading: String = "",
    val bots: String = "",
    val readAt: Long = 0,
    val color: String = CHIEF_COLOR,
    val span: Int = 1,
    val where: String = "face",
    val waiting: Boolean = false,
    val note: String? = null,
    val open: Boolean = false,
    val inside: List<BoardDot> = emptyList(),
    val first: Boolean = false,
    val last: Boolean = false,
    val empty: Boolean = false,
    /** "written by AI" at the end of its head: a bot or the Chief wrote its note. */
    val ai: Boolean = false,
    /** Ask for a change on a hold, beside Remove (`tile-ask`); a botdot before it offers only Remove. */
    val askable: Boolean = false,
    /** A group: how many tiles are in it, which its Remove asks about. */
    val holds: Int = 0,
)

/** A tile a bot suggested: its title, who suggested it and why, in that bot's colour, and its scripts. */
data class BoardSuggestion(val id: String, val title: String, val who: String?, val color: String, val reason: String, val scripts: List<String>)

/** The Board at one moment. [rows]: its cells, packed into rows of [columns] by their spans. [filters]: "" (All) and the headings, when there are two or more. */
data class BoardState(
    val loaded: Boolean = false,
    val empty: Boolean = false,
    val columns: Int = 2,
    val rows: List<List<BoardCell>> = emptyList(),
    val filters: List<String> = emptyList(),
    val filter: String = "",
    val suggestions: List<BoardSuggestion> = emptyList(),
    /** The refresh button shows: a tile reads its value from somewhere. [newestAt]: when the newest value came. */
    val refreshable: Boolean = false,
    val newestAt: Long = 0,
    val refreshing: Boolean = false,
    val notice: String? = null,
    val noticeId: Int = 0,
)

/**
 * The Board for a phone, on the shared [Store]: [state] after every change, and the taps, as the Android app's
 * DashboardScreen does them. While it is open and the app in front ([active]) the stale tiles are read again every
 * [EVERY_MS]. [close] it when the screen goes.
 */
class BoardDesk(
    private val store: Store,
    private val api: Api,
    scope: CoroutineScope,
    /** The wait between two reads while it is in front ([EVERY_MS]); the tests tick it themselves. */
    private val again: suspend () -> Unit = { delay(EVERY_MS) },
) {
    private val job = SupervisorJob(scope.coroutineContext[Job])
    private val own = CoroutineScope(scope.coroutineContext + job)

    private data class Local(
        val filter: String = "",
        val open: Set<String> = emptySet(),
        val flash: Map<String, String> = emptyMap(),
        val columns: Int = 2,
        val refreshing: Boolean = false,
        val notice: String? = null,
        val noticeId: Int = 0,
    )

    private val local = MutableStateFlow(Local())

    val state: StateFlow<BoardState> = combine(store.dashboard.value, store.bots.value, store.version.value, local) { d, b, v, l -> build(d, b.orEmpty(), v?.features, l) }
        .stateIn(own, SharingStarted.Eagerly, BoardState())

    // Called on the main thread (the screen's), so one at a time.
    private var poll: Job? = null

    init { active(true) }

    /**
     * The app went to the background ([on] false: nothing is read, as Android reads only while the screen is resumed)
     * or came back to the front: the Board is read at once, then every [EVERY_MS].
     */
    fun active(on: Boolean) {
        if (!on) { poll?.cancel(); poll = null; return }
        if (poll?.isActive == true) return
        poll = own.launch { while (true) { load(); again() } }
    }

    /** The phone's width, in points: the Board has [BoardKit.columns] of it. */
    fun width(points: Float) { val c = BoardKit.columns(points); if (c != local.value.columns) local.update { it.copy(columns = c) } }

    /** One heading, or all of them (""). */
    fun filter(name: String) = local.update { it.copy(filter = name) }

    /**
     * Reads the Board; botdot reads its stale tiles again first. [all] (the refresh button, a pull): every tile, but one
     * read seconds ago. A failure is said, and what was there stays.
     */
    @Throws(Exception::class)
    suspend fun load(all: Boolean = false) {
        if (all) { if (local.value.refreshing) return; local.update { it.copy(refreshing = true) } }
        try {
            store.dashboard.set(api.dashboard(quiet = false, all = all))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            tell(e.message ?: tr("Couldn't load"))
        } finally {
            if (all) local.update { it.copy(refreshing = false) }
        }
    }

    /**
     * A tap on the tile [key] ([BoardTap.of]). A group opens or closes here, and a tap that sends is sent here; the
     * rest is for the screen: the chat, Needs you, the pop-up, the page, or the question first ([BoardTap.Ask], whose
     * yes is [tap] again with [asked]).
     */
    @Throws(Exception::class)
    suspend fun tap(key: String, asked: Boolean = false): BoardTap {
        val d = store.dashboard.value.value ?: return BoardTap.Quiet
        val t = d.tiles.firstOrNull { it.id == key } ?: return BoardTap.Quiet
        val a = BoardTap.of(t, d.pending.any { it.id == key }, store.bots.value.value.orEmpty().map { it.id }, asked)
        when (a) {
            BoardTap.Group -> local.update { it.copy(open = if (key in it.open) it.open - key else it.open + key) }
            is BoardTap.Send -> send(t, a.on)
            else -> {}
        }
        return a
    }

    private suspend fun send(t: Tile, on: Boolean?) {
        // At once; the answer says whether it took.
        if (on != null) replace(t.copy(value = JsonPrimitive(on), look = t.look?.let { l -> l.copy(dot = l.dot?.copy(filled = on)) }))
        val bot = store.bots.value.value?.firstOrNull { it.id == t.bot }?.name
        if (t.asks) flash(t.id, tileAsked(bot, queued = false))
        try {
            val a = api.tapTile(t.id, on)
            a.tile?.let { replace(it) }
            // Its bot was busy: the tile says so in place of "Asked …".
            if (a.queued) flash(t.id, tileAsked(bot, queued = true))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            tell(e.message ?: tr("That didn't work"))
            quietly()
        }
    }

    /** A switch of a tile's blocks ([Block.key] [block]) set to [on]. */
    @Throws(Exception::class)
    suspend fun setSwitch(key: String, block: String, on: Boolean) = act(key, block, JsonPrimitive(on))

    /** A slider let go at [value]: on its steps ([BoardKit.snap]). */
    @Throws(Exception::class)
    suspend fun setNumber(key: String, block: String, value: Double) {
        val b = find(store.dashboard.value.value?.tiles?.firstOrNull { it.id == key }?.look, block)
        act(key, block, JsonPrimitive(b?.let { BoardKit.snap(it, value) } ?: value))
    }

    /** A choice's option, by its place in [Block.options]. */
    @Throws(Exception::class)
    suspend fun choose(key: String, block: String, option: Int) {
        val b = find(store.dashboard.value.value?.tiles?.firstOrNull { it.id == key }?.look, block) ?: return
        act(key, block, b.options.getOrNull(option)?.value ?: return)
    }

    /** A button of a tile's blocks. */
    @Throws(Exception::class)
    suspend fun press(key: String, block: String) = act(key, block, null)

    private suspend fun act(key: String, block: String, value: JsonElement?) {
        val bot = store.dashboard.value.value?.tiles?.firstOrNull { it.id == key }?.bot?.let { b -> store.bots.value.value?.firstOrNull { it.id == b }?.name }
        try {
            val a = api.actTile(key, block, value)
            a.tile?.let { replace(it) }
            if (a.queued) flash(key, tileAsked(bot, queued = true))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            tell(e.message ?: tr("That didn't work"))
            quietly()
        }
    }

    /**
     * Drag to move: the tile [from] let go where [onto] is (on the Board as it is laid out now). False when it can't
     * go there (a group into a group); else it is saved and the Board read again; a refusal is said.
     */
    @Throws(Exception::class)
    suspend fun drop(from: String, onto: String): Boolean {
        val d = store.dashboard.value.value ?: return false
        val l = local.value
        val keys = BoardKit.layout(d, l.filter.takeIf { it in BoardKit.headings(d) }.orEmpty(), l.open)
        val rows = BoardKit.moved(keys, from, onto, d.tiles) ?: return false
        val at = BoardKit.placeOf(rows, from)
        try { api.moveTile(from, at.section, at.parent, at.before) } catch (e: CancellationException) { throw e } catch (e: Exception) { tell(e.message ?: tr("Couldn't move it")) }
        quietly()
        return true
    }

    /** Remove: off the Board; a group alone ([withTiles] false, its tiles stay, loose) or with its tiles. */
    @Throws(Exception::class)
    suspend fun remove(key: String, withTiles: Boolean) {
        try { api.removeTile(key, withTiles) } catch (e: CancellationException) { throw e } catch (e: Exception) { tell(e.message ?: tr("Couldn't remove")) }
        quietly()
    }

    /** What should change in a tile, sent to the Chief (#430): whether it went; the tile says so for a moment. */
    @Throws(Exception::class)
    suspend fun askChange(key: String, text: String): Boolean {
        if (text.isBlank()) return false
        return try {
            api.askTileChange(key, text.trim())
            flash(key, TileAsk.sent(store.chiefName.value))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            tell(e.message ?: tr("Couldn't send"))
            false
        }
    }

    /** Add (true) or ✕ on a suggested tile. */
    @Throws(Exception::class)
    suspend fun answer(suggestion: String, add: Boolean) {
        try { api.answerSuggestion(suggestion, add) } catch (e: CancellationException) { throw e } catch (e: Exception) { tell(e.message ?: tr("That didn't work")) }
        quietly()
    }

    fun close() = job.cancel()

    private suspend fun quietly() = try { store.dashboard.refresh() } catch (e: CancellationException) { throw e } catch (_: Exception) { }

    private fun replace(t: Tile) = store.dashboard.update { d -> d.copy(tiles = d.tiles.map { if (it.id == t.id) t else it }) }

    /** A tile's word for a moment after a tap; a later word stays its own time. */
    private fun flash(id: String, text: String) {
        local.update { it.copy(flash = it.flash + (id to text)) }
        own.launch { delay(FLASH_MS); local.update { if (it.flash[id] == text) it.copy(flash = it.flash - id) else it } }
    }

    private fun tell(text: String) = local.update { it.copy(notice = text, noticeId = it.noticeId + 1) }

    private fun find(look: TileLook?, key: String): Block? {
        fun inList(list: List<Block>): Block? { for (b in list) { if (b.key == key) return b; inList(b.blocks)?.let { return it } }; return null }
        return look?.let { inList(it.face) ?: inList(it.panel.orEmpty()) }
    }

    private fun build(d: Dashboard?, bots: List<Bot>, features: List<String>?, l: Local): BoardState {
        if (d == null) return BoardState(columns = l.columns, notice = l.notice, noticeId = l.noticeId)
        val headings = BoardKit.headings(d)
        val filter = l.filter.takeIf { it in headings }.orEmpty()
        val keys = BoardKit.layout(d, filter, l.open)
        val byId = d.tiles.associateBy { it.id }
        val waiting = d.pending.map { it.id }.toSet()
        fun under(name: String) = d.tiles.filter { it.parent == null && it.section == name }
        fun ctl(k: String?) = k != null && byId[k]?.let { it.parent == null && BoardKit.isControlRow(it) } == true
        val askable = TileAsk.shows(features)
        val cells = keys.mapIndexed { i, k ->
            when {
                k.startsWith(BoardKit.HEADING) -> {
                    val name = k.removePrefix(BoardKit.HEADING)
                    val ts = under(name)
                    val at = if (BoardKit.sectionSource(ts).isNotEmpty()) BoardKit.newestAt(ts.filter { it.source != null }) else 0
                    BoardCell(k, BoardCellKind.HEADING, heading = name, bots = BoardKit.sectionBots(ts, bots), readAt = at, span = l.columns)
                }
                k.startsWith(BoardKit.GROUP_TOP) -> BoardCell(k, BoardCellKind.GROUP_TOP, span = l.columns, empty = d.tiles.none { it.parent == k.removePrefix(BoardKit.GROUP_TOP) })
                k.startsWith(BoardKit.GROUP_END) -> BoardCell(k, BoardCellKind.GROUP_END, span = l.columns)
                else -> {
                    val t = byId.getValue(k)
                    val inGroup = t.parent != null
                    val sourced = !inGroup && t.section.isNotEmpty() && BoardKit.sectionSource(under(t.section)).isNotEmpty()
                    val kpi = BoardKit.isKpiTile(t)
                    val ai = t.ai && BoardKit.hasMarkdown(t.look?.face.orEmpty())
                    val control = ctl(k)
                    BoardCell(
                        k, if (control) BoardCellKind.CONTROL else BoardCellKind.TILE, t,
                        readAt = if (!ai && t.source != null && !kpi && !sourced) BoardKit.newestAt(listOf(t)) else 0,
                        color = tileColor(t, d.tiles, bots),
                        span = if (control) l.columns else BoardKit.span(t, l.columns),
                        where = BoardKit.where(t, l.columns),
                        waiting = t.id in waiting,
                        note = BoardKit.note(t, t.id in waiting, l.flash[t.id]),
                        open = inGroup || t.id in l.open,
                        inside = if (t.kind == "group") d.tiles.filter { it.parent == t.id }.map { x -> BoardDot(x.look?.dot?.filled, x.look?.dot?.color ?: tileColor(x, d.tiles, bots)) } else emptyList(),
                        first = control && !ctl(keys.getOrNull(i - 1)),
                        last = control && !ctl(keys.getOrNull(i + 1)),
                        ai = ai,
                        askable = askable,
                        holds = d.tiles.count { it.parent == t.id },
                    )
                }
            }
        }
        return BoardState(
            loaded = true,
            empty = d.tiles.isEmpty(),
            columns = l.columns,
            rows = pack(cells, l.columns),
            filters = if (headings.size > 1) listOf("") + headings else emptyList(),
            filter = filter,
            suggestions = d.suggestions.map { x ->
                val b = bots.firstOrNull { it.id == x.bot }
                BoardSuggestion(x.id, x.tile.title, b?.name, b?.color ?: CHIEF_COLOR, x.reason, x.tile.scripts)
            },
            refreshable = d.tiles.any { it.source != null },
            newestAt = BoardKit.newestAt(d.tiles),
            refreshing = l.refreshing,
            notice = l.notice,
            noticeId = l.noticeId,
        )
    }

    companion object {
        /** While the Board is open and the app in front, its stale tiles are read again this often, as on Android. */
        const val EVERY_MS = 15_000L
        /** How long a tile says "Asked …" after a tap. */
        const val FLASH_MS = 2_500L

        /** [cells] in rows of [columns], each cell taking its span; one that doesn't fit what is left starts the next row. */
        fun pack(cells: List<BoardCell>, columns: Int): List<List<BoardCell>> {
            val rows = mutableListOf<List<BoardCell>>()
            var row = mutableListOf<BoardCell>()
            var used = 0
            for (c in cells) {
                val span = c.span.coerceIn(1, columns)
                if (used + span > columns && row.isNotEmpty()) { rows += row; row = mutableListOf(); used = 0 }
                row += c
                used += span
            }
            if (row.isNotEmpty()) rows += row
            return rows
        }
    }
}
