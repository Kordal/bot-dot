package dev.botdot.app.data

import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * An account the admin paused (#466, docs/api.md "A suspended account"), for the iPhone: [watch] says which botdot's
 * account is paused ([Session.paused]) on the main thread, and [poll] asks botdot again every minute while its paused
 * screen is up, so a resumed account opens by itself, as on Android.
 */
class PausedWatch(private val session: Session) {
    private val scope = MainScope()

    fun watch(onChange: (String?) -> Unit): Job = scope.launch { session.paused.collect { onChange(it) } }

    fun poll(api: Api): Job = scope.launch {
        while (true) {
            delay(POLL_MS)
            runCatching { api.bots() }
        }
    }

    fun close() = scope.cancel()

    private companion object {
        const val POLL_MS = 60_000L
    }
}
