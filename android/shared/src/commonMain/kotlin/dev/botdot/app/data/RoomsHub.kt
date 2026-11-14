package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Shared rooms as this app holds them (ADR 060, #318): whether the front door has them on for this account, the
 * account it is signed in as, the rooms and the invitations, kept up to date from the front door's live events while
 * the app is in front ([inFront]). The room screens read the same events ([events]) for their messages.
 */
class RoomsHub(private val scope: CoroutineScope, private val api: StateFlow<Api?>, features: StateFlow<VersionInfo?>, inFront: StateFlow<Boolean>) {
    private val _on = MutableStateFlow(false)
    /** The front door says Rooms are on for this account. */
    val on: StateFlow<Boolean> = _on.asStateFlow()
    private val _account = MutableStateFlow<String?>(null)
    /** The account this app is signed in as, as the front door says; null until it does. */
    val account: StateFlow<String?> = _account.asStateFlow()
    private val _links = MutableStateFlow(false)
    /** The front door makes invite links for rooms (ADR 068). */
    val links: StateFlow<Boolean> = _links.asStateFlow()
    private val _list = MutableStateFlow<RoomsAnswer?>(null)
    /** The rooms and the invitations; null until read. */
    val list: StateFlow<RoomsAnswer?> = _list.asStateFlow()
    private val _events = MutableSharedFlow<FeedEvent>(extraBufferCapacity = 64)
    /** The front door's room events as they come, and a `reset` after the stream came back. */
    val events: SharedFlow<FeedEvent> = _events

    init {
        // Asked again for each server, and when its features change (an update may turn Rooms on).
        scope.launch {
            combine(api, features.map { it?.features?.contains("accounts") == true }.distinctUntilChanged()) { a, accounts -> a to accounts }.collectLatest { (a, accounts) ->
                _on.value = false
                _links.value = false
                _account.value = null
                _list.value = null
                if (a == null || !accounts) return@collectLatest
                val session = runCatching { a.frontDoorSession() }.getOrNull()
                _account.value = Rooms.account(session)
                _on.value = Rooms.on(listOf("accounts"), session)
                _links.value = _on.value && Rooms.links(session)
                if (_on.value) refresh()
            }
        }
        // The live events, while the app is in front and Rooms are on: tried again a little later when they drop.
        scope.launch {
            combine(api, on, inFront) { a, isOn, front -> a.takeIf { isOn && front } }.collectLatest { a ->
                if (a == null) return@collectLatest
                var first = true
                while (true) {
                    try {
                        a.roomEvents().collect { ev -> apply(ev); _events.emit(ev) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                    }
                    delay(if (first) 2_000 else 10_000)
                    first = false
                    refresh() // what happened meanwhile
                    _events.emit(FeedEvent(null, "reset", kotlinx.serialization.json.JsonObject(emptyMap())))
                }
            }
        }
    }

    /** Reads the rooms and invitations again. */
    suspend fun refresh() {
        val a = api.value ?: return
        if (!_on.value) return
        runCatching { a.rooms() }.onSuccess { _list.value = it }
    }

    /** A room as an answer gave it: in the list, in its place, or first when new. */
    fun took(room: Room) { _list.value = _list.value?.let { Rooms.withRoom(it, room) } ?: RoomsAnswer(listOf(room)) }

    /** A room this account is no longer in, and no invitation to it either. */
    fun gone(id: String) { _list.value = _list.value?.let { Rooms.withoutRoom(it, id) } }

    private fun apply(ev: FeedEvent) { _list.value = Rooms.applied(_list.value ?: return, ev) }
}
