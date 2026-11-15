package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What was entered in "Keep up to date" (#346): how often, at what time, whether to hear of every update, what to check. */
data class KeepDraft(val every: String, val time: String, val notify: String, val check: String) {
    companion object {
        /** The sheet as it opens: what keeps the page up to date now, else every morning at 7, only when something needs the owner, from its sources. */
        fun of(page: PageInfo): KeepDraft =
            KeepDraft(page.keep?.every ?: "day", page.keep?.time ?: "07:00", page.keep?.notify ?: "report-only", page.keep?.check ?: page.sources)
    }
}

/** A page's action that runs on after the tap (#475): [kind] busy, ok or err, and its words. */
data class PageWork(val kind: String, val text: String)

/** A Markdown page's bar at one moment: on the Board or not ([board] when the botdot has it), what keeps it up to date, the action that runs on. */
class PageBarState(
    val onBoard: Boolean?, val board: Boolean, val keep: PageKeep?, val work: PageWork?, val reopen: KeepDraft? = null, val boarding: Boolean = false,
    /** Counts each save or Stop that changed what keeps the page: the viewer reads the page again then (Refresh now runs a job and changes nothing here). */
    val pageChanged: Int = 0,
)

/**
 * A bot's page in the viewer, for both phones (#346, #451, #475; Android's PageBar): Board and On Board flip at once
 * and back with botdot's words; Keep up to date, Refresh now and Stop run on after the tap, their words under the bar
 * while they do, then a moment's ok or the error, which [retry] tries again ("Keep up to date" opens its sheet again
 * with what was entered, [PageBarState.reopen]). One action at a time.
 */
class PageDesk(private val scope: CoroutineScope, private val api: Api, private val botId: String, private val slug: String, private val from: String, features: Collection<String>?) {
    private val board = Pages.showsBoard(features)
    private var page: PageInfo? = null
    private var onBoard: Boolean? = null
    private var boarding = false
    private var work: PageWork? = null
    private var retrying: (() -> Unit)? = null
    private var reopen: KeepDraft? = null
    private var pageChanged = 0
    private val _state = MutableStateFlow(PageBarState(null, false, null, null))
    val state: StateFlow<PageBarState> = _state.asStateFlow()

    fun watch(onChange: (PageBarState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    /** The page as the viewer read it: its keep and whether it is on the Board. */
    fun show(p: PageInfo?) { page = p; onBoard = p?.onBoard; publish() }

    /** "Keep up to date" or Change: the sheet opens on what keeps the page now, as the last save or Stop left it. */
    fun draft(): KeepDraft? = page?.let(KeepDraft::of)

    /** Board or On Board: shown flipped at once, back with botdot's words when it says no. */
    fun toggleBoard() {
        val was = onBoard ?: return
        if (!board || boarding) return
        onBoard = !was; boarding = true; publish()
        scope.launch {
            try { onBoard = api.setPageOnBoard(botId, slug, !was)?.onBoard ?: onBoard }
            catch (e: CancellationException) { throw e } catch (e: Exception) { onBoard = was; work = PageWork("err", e.message ?: tr("Couldn't change it")); retrying = null }
            boarding = false; publish()
        }
    }

    /** "Keep it up to date": the schedule saved; a failure opens the sheet again with [draft]. */
    fun keep(draft: KeepDraft) {
        inBackground(tr("Saving schedule…"), tr("It keeps up to date now"), { reopen = draft; publish() }, changes = true) {
            api.keepPage(botId, slug, draft.every, draft.time, draft.notify, draft.check)
        }
    }

    /** Refresh now: its job run at once. */
    fun refresh() {
        val k = page?.keep ?: return
        inBackground(tr("Starting the refresh…"), tr("{name} is refreshing it", "name" to from.ifBlank { tr("The bot") }), ::refresh, changes = false) { api.runJob(botId, k.jobId); null }
    }

    /** Stop: it no longer keeps up to date. */
    fun stop() {
        inBackground(tr("Stopping…"), tr("It no longer keeps up to date"), ::stop, changes = true) { api.stopKeepingPage(botId, slug) }
    }

    /** The error's tap: the action again. */
    fun retry() { val r = retrying ?: return; work = null; retrying = null; publish(); r() }

    /** The line closed, or the sheet opened again ([reopen] taken). */
    fun dismissWork() { work = null; retrying = null; publish() }
    fun reopened() { reopen = null; publish() }

    /** [changes]: whether it changes what keeps the page ([PageBarState.pageChanged] then counts it). */
    private fun inBackground(words: String, ok: String, again: () -> Unit, changes: Boolean, act: suspend () -> PageInfo?) {
        if (work?.kind == "busy") return
        work = PageWork("busy", words); retrying = null; publish()
        scope.launch {
            try {
                act()?.let { page = it; onBoard = it.onBoard ?: onBoard }
                if (changes) pageChanged++
                val w = PageWork("ok", ok)
                work = w; publish()
                delay(OK_MS)
                if (work === w) { work = null; publish() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                work = PageWork("err", e.message ?: tr("Couldn't do it")); retrying = again; publish()
            }
        }
    }

    private fun publish() { _state.value = PageBarState(onBoard, board && onBoard != null, page?.keep, work, reopen, boarding, pageChanged) }

    companion object {
        /** How long an action's ok stays under the bar. */
        const val OK_MS = 2_500L
    }
}
