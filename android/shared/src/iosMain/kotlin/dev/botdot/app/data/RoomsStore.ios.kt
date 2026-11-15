package dev.botdot.app.data

import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Shared rooms on the iPhone, for the botdot of [home] (ADR 060): its [RoomsHub], which asks the front door whether
 * Rooms are on and follows their live events while the app is in front ([front]), as Android's does while it is
 * resumed, and the screens' desks: the list ([watch] and its calls), a room's chat ([chat]) and its settings
 * ([settings]). Home keeps one for as long as it shows that botdot; [close] it when it goes.
 */
class RoomsStore(private val home: HomeStore) {
    private val scope = MainScope()
    private val inFront = MutableStateFlow(true)
    private val hub = RoomsHub(scope, MutableStateFlow(home.api), home.store.version.value, inFront)
    private val desk = RoomsDesk(hub, home.api, scope)

    /** The app came to front, or went behind: the rooms' live events are followed only in front. */
    fun front(on: Boolean) { inFront.value = on }

    /** Calls [onChange] with the list now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (RoomsState) -> Unit): Job = desk.watch(onChange)

    @Throws(Exception::class)
    suspend fun refresh() = desk.refresh()

    @Throws(Exception::class)
    suspend fun make(name: String): RoomsDone = desk.make(name)

    @Throws(Exception::class)
    suspend fun accept(id: String): RoomsDone = desk.accept(id)

    @Throws(Exception::class)
    suspend fun decline(id: String): RoomsDone = desk.decline(id)

    @Throws(Exception::class)
    suspend fun look(link: String): RoomsJoin = desk.look(link)

    @Throws(Exception::class)
    suspend fun join(token: String): RoomsDone = desk.join(token)

    /** The chat of the room [id]: [RoomChatDesk.start] it when it comes on screen, [RoomChatDesk.stop] it when it goes. */
    fun chat(id: String): RoomChatDesk = RoomChatDesk(scope, home.api, hub, id)

    /** The settings of the room [id]: close them when they go. */
    fun settings(id: String): RoomSettingsDesk = RoomSettingsDesk(hub, home.api, home.store, id, scope)

    fun close() {
        desk.close()
        scope.cancel()
    }
}
