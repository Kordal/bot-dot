package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Every bot's pages as the Pages list draws them (#361), for both phones: the pages kept up to date first, then the
 * others; [board] when each row has its On the Board switch (#451). [loaded] once read; [error] when it couldn't be.
 */
class PagesState(
    val kept: List<PageInfo> = emptyList(),
    val other: List<PageInfo> = emptyList(),
    val loaded: Boolean = false,
    val error: String? = null,
    val board: Boolean = false,
) {
    /** Read, and there are none. */
    val empty: String? get() = if (loaded && kept.isEmpty() && other.isEmpty())
        tr("No pages yet. Ask a bot for a page, a report or an overview: it shows here, and under the bot's reply.") else null
    /** The heading over the pages not kept up to date. */
    val otherTitle: String get() = if (kept.isEmpty()) tr("All pages") else tr("Other pages")

    internal fun withBoard(on: Boolean) = if (on == board) this else PagesState(kept, other, loaded, error, on)

    /** Each page's line under its title ([Pages.allLine]). */
    fun line(page: PageInfo): String = Pages.allLine(page)
}

/**
 * The Pages list: read from botdot, again when a bot saves a page (the feed's `page`) or the viewer closes ([load]);
 * a row's On the Board switch shown at once and put back when botdot says no. Whether rows have that switch follows
 * the botdot's features as they come (also after the list was read).
 */
class PagesDesk(private val scope: CoroutineScope, private val api: Api, private val store: Store) {
    private val _state = MutableStateFlow(PagesState())
    val state: StateFlow<PagesState> = _state.asStateFlow()
    private var all: List<PageInfo> = emptyList()

    init {
        // The features may come after the list: its rows get their switches then.
        scope.launch { store.version.value.collect { v -> _state.value = _state.value.withBoard(Pages.showsBoard(v?.features)) } }
    }

    fun watch(onChange: (PagesState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    /** Read every bot's pages. */
    @Throws(Exception::class)
    suspend fun load() {
        try {
            all = api.allPages()
            publish(null)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            val s = _state.value
            _state.value = PagesState(s.kept, s.other, loaded = s.loaded, error = tr("Couldn't load the pages."), board = board())
        }
    }

    /** A row's switch: on the Board or off it, shown at once; put back, with botdot's words, when it says no. */
    @Throws(Exception::class)
    suspend fun setOnBoard(page: PageInfo, on: Boolean) {
        fun set(v: Boolean?) { all = all.map { if (it.botId == page.botId && it.slug == page.slug) it.copy(onBoard = v) else it } }
        set(on)
        publish(null)
        try {
            set(api.setPageOnBoard(page.botId, page.slug, on)?.onBoard ?: on)
            publish(null)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            set(page.onBoard)
            publish(e.message ?: tr("Couldn't change it"))
        }
    }

    private fun board() = Pages.showsBoard(store.version.value.value?.features)

    private fun publish(error: String?) {
        val (kept, other) = Pages.split(all)
        _state.value = PagesState(kept, other, loaded = true, error = error, board = board())
    }
}
