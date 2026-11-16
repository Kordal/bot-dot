package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

/**
 * A page's blocks read again while it is open (#395), for both phones: when a tile they read has a new value (the
 * feed's `dashboard` [ticks]; no id: the Board changed), a moment later, and each minute, which reads its tiles that
 * are due. A page whose blocks read no tile is never read again.
 */
class PageReblock(private val api: Api, private val ticks: StateFlow<Pair<String?, Long>>, private val scope: CoroutineScope, private val every: Long = EVERY_MS, private val settle: Long = SETTLE_MS) {
    companion object {
        /** Each minute while it is open. */
        const val EVERY_MS = 60_000L
        /** A tile's new value: read this long after, so several at once are one read. */
        const val SETTLE_MS = 400L

        /** A tick of tile [tick] (null: any) reaches a page whose blocks read [tiles]. */
        fun reads(tiles: List<String>?, tick: String?): Boolean = !tiles.isNullOrEmpty() && (tick == null || tick in tiles)
    }

    /** Reads [src]'s blocks again while its blocks read [tiles], each read handed to [onBlocks]; cancel the job to stop. */
    fun follow(src: String, tiles: List<String>, onBlocks: (PageBlocks) -> Unit): Job = scope.launch {
        if (tiles.isEmpty()) return@launch
        suspend fun read() { try { onBlocks(api.pageBlocks(src)) } catch (e: CancellationException) { throw e } catch (_: Exception) {} }
        launch { while (true) { delay(every); read() } }
        ticks.drop(1).collectLatest { (id, n) -> if (n > 0 && reads(tiles, id)) { delay(settle); read() } }
    }
}
