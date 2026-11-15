package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The live feed of [api] into [store] while a screen that needs it is open (Needs you, the Board): each event refreshes
 * what it changed, as on Android. A dropped connection tries again after a moment.
 */
internal fun CoroutineScope.followFeed(api: Api, store: Store): Job = launch {
    var last: String? = null
    while (true) {
        try {
            api.feed(last).collect { ev -> ev.id?.let { last = it }; store.handle(ev) }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
        delay(FEED_RETRY_MS)
    }
}

private const val FEED_RETRY_MS = 3_000L
