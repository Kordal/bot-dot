package dev.botdot.app.feed

import android.content.SharedPreferences
import dev.botdot.app.data.Api
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.FeedEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The one open connection to botdot's live feed (/api/events). It reconnects by itself, resuming
 * after the last event it saw, so nothing is missed while the phone was in a tunnel. Where it was is
 * kept in [prefs], so that holds when Android restarts the app too. Screens listen to [events] to
 * refresh; [Notifier] turns them into notifications.
 */
class Feed(private val scope: CoroutineScope, private val prefs: SharedPreferences? = null) {
    enum class State { Off, Connecting, Connected, Retrying }

    private val _state = MutableStateFlow(State.Off)
    val state: StateFlow<State> = _state
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private val _events = MutableSharedFlow<FeedEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<FeedEvent> = _events

    private var job: Job? = null
    private var api: Api? = null
    private var lastId: String? = null
    private val nudge = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Connect to this botdot (or stop, with null). */
    fun connect(api: Api?) {
        if (api?.baseUrl == this.api?.baseUrl && job?.isActive == true) return
        job?.cancel()
        this.api = api
        lastId = prefs?.takeIf { api != null && it.getString("server", null) == api.baseUrl }?.getString("lastId", null)
        if (api == null) { _state.value = State.Off; return }
        job = scope.launch { loop(api) }
    }

    /** Try again now (e.g. the network came back), instead of waiting for the next retry. */
    fun retryNow() { nudge.tryEmit(Unit) }

    private fun remember(api: Api, id: String?) {
        lastId = id
        prefs?.edit()?.putString("server", api.baseUrl)?.putString("lastId", id)?.apply()
    }

    private suspend fun loop(api: Api) {
        var wait = 2_000L
        while (scope.isActive) {
            _state.value = if (_state.value == State.Retrying) State.Retrying else State.Connecting
            try {
                api.feed(lastId, onOpen = { _state.value = State.Connected; _error.value = null }).collect { ev ->
                    wait = 2_000L
                    if (ev.id != null) remember(api, ev.id)
                    if (ev.type == "reset") remember(api, null)
                    _events.emit(ev)
                }
                // The server closed the stream (e.g. botdot restarting for an update).
            } catch (e: ApiException) {
                _error.value = e.message
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _error.value = e.message
            }
            _state.value = State.Retrying
            // Back off up to a minute; a nudge (network back, app opened) skips the wait.
            withTimeoutOrNull(wait) { nudge.first() }
            wait = (wait * 2).coerceAtMost(60_000L)
        }
    }
}
