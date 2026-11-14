package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock
import kotlin.time.Instant

// Shared rooms as a phone draws them and nothing more (ADR 060, ADR 242, #1372): the list with its invitations, a
// room's chat, and its settings, with the Android app's rules and words (ui/RoomsScreens.kt). The iPhone draws what
// these hand out and gives each tap back.

/** A room in the list: its name, what its line says (who is writing, else its last message), and when that was. */
data class RoomRowView(val id: String, val name: String, val line: String, val time: String)

/** An invitation in the list: the room's name, and who invites. */
data class RoomInviteView(val id: String, val name: String, val line: String)

/**
 * The Rooms screen at one moment. [on]: the front door has them on for this account; Home's row shows only then,
 * saying [row] after its name. [links]: rooms are joined by invite link (Join is offered).
 */
data class RoomsState(
    val on: Boolean = false,
    val links: Boolean = false,
    val loaded: Boolean = false,
    val invites: List<RoomInviteView> = emptyList(),
    val rooms: List<RoomRowView> = emptyList(),
    val row: String? = null,
) {
    /** "No rooms yet": read, and nothing in it. */
    val empty: Boolean get() = on && loaded && rooms.isEmpty() && invites.isEmpty()
}

/** What an action on the list came to: the room to open ([room]), or why it did not go ([failed]); both null: done. */
data class RoomsDone(val room: String? = null, val failed: String? = null)

/**
 * A pasted invite link, read: the room it opens ([title], [says]; Join is [join] with [token]), the room to open
 * at once when this account is in it ([open]), or why not ([failed]).
 */
data class RoomsJoin(val token: String? = null, val title: String = "", val says: String = "", val open: String? = null, val failed: String? = null)

/**
 * The list of shared rooms for a phone, on the app's [RoomsHub]: the invitations with Accept and Decline, the rooms,
 * New room (made with its invite link, ADR 076) and Join by link (ADR 068), as Android's RoomsScreen does them.
 */
class RoomsDesk(private val hub: RoomsHub, private val api: Api, scope: CoroutineScope, private val time: (String?) -> String = { listClock(it) }) {
    private val job = SupervisorJob(scope.coroutineContext[Job])
    private val own = CoroutineScope(scope.coroutineContext + job)

    val state: StateFlow<RoomsState> = combine(hub.on, hub.links, hub.list) { on, links, list -> build(on, links, list) }
        .stateIn(own, SharingStarted.Eagerly, RoomsState())

    /** Calls [onChange] with the list now and after every change, on the scope's thread. */
    fun watch(onChange: (RoomsState) -> Unit): Job = own.launch { state.collect { onChange(it) } }

    private fun build(on: Boolean, links: Boolean, list: RoomsAnswer?): RoomsState = RoomsState(
        on = on,
        links = on && links,
        loaded = list != null,
        invites = list?.invites.orEmpty().map { RoomInviteView(it.room.id, it.room.name, RoomWords.invites(it)) },
        rooms = list?.rooms.orEmpty().map { r -> RoomRowView(r.id, r.name, Rooms.workingLine(r).ifEmpty { Rooms.summary(r) }, time(r.last?.at)) },
        row = RoomWords.rowLine(list?.invites?.size ?: 0),
    )

    /** Reads the rooms and the invitations again (the screen opened, a pull). */
    @Throws(Exception::class)
    suspend fun refresh() = hub.refresh()

    /** New room named [name]: made, with its invite link where the front door makes them; it opens on its settings. */
    @Throws(Exception::class)
    suspend fun make(name: String): RoomsDone = done {
        val room = api.makeRoom(name.trim())
        hub.took(room)
        // Without one, the settings offer "Make an invite link".
        if (hub.links.value) try { api.makeRoomLink(room.id) } catch (e: CancellationException) { throw e } catch (_: Exception) {}
        room.id
    }

    /** Accept on an invitation: the room is this account's, and opens. */
    @Throws(Exception::class)
    suspend fun accept(id: String): RoomsDone = done { hub.took(api.acceptRoom(id)); id }

    /** Decline on an invitation: it goes. */
    @Throws(Exception::class)
    suspend fun decline(id: String): RoomsDone = done { api.declineRoom(id); hub.gone(id); null }

    /** The link pasted in Join: what it opens, or the room itself when this account is in it already. */
    @Throws(Exception::class)
    suspend fun look(link: String): RoomsJoin {
        val token = Rooms.linkToken(link) ?: return RoomsJoin(failed = RoomWords.NOT_A_LINK)
        return try {
            val seen = api.roomByLink(token)
            if (seen.member) RoomsJoin(open = seen.room.id) else RoomsJoin(token, RoomWords.joinTitle(seen), RoomWords.joinSays(seen))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            RoomsJoin(failed = RoomWords.failed(e))
        }
    }

    /** Join, on the room a link opens ([RoomsJoin.token]): this account is in it, and it opens. */
    @Throws(Exception::class)
    suspend fun join(token: String): RoomsDone = done { val joined = api.joinRoomByLink(token); hub.took(joined); joined.id }

    private suspend fun done(block: suspend () -> String?): RoomsDone = try {
        RoomsDone(room = block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        RoomsDone(failed = RoomWords.failed(e))
    }

    fun close() = job.cancel()
}

/** Who wrote a line of a room's chat: the front door ([NOTICE]), this account ([MINE]), or someone else or a bot ([THEIRS]). */
enum class RoomLineKind { NOTICE, MINE, THEIRS }

/**
 * One message of a room's chat as a phone draws it: a notice as a quiet line, this account's own on the right, and
 * the others under who wrote them ([author]), a bot in its [color] as the room has it now ([bot]: it has a head).
 * [mentioned]: who it named, under it.
 */
data class RoomLine(
    val id: String,
    val kind: RoomLineKind,
    val author: String,
    val text: String,
    val time: String,
    val mentioned: String,
    val bot: Boolean,
    val color: String?,
)

/** A room's chat at one moment. [lines]: oldest first. [gone]: the room is no longer this account's: the chat closes. */
data class RoomChatState(
    val name: String = "",
    val lines: List<RoomLine> = emptyList(),
    val loaded: Boolean = false,
    /** Why the first page could not be read. */
    val error: String? = null,
    /** "Nothing here yet…": read, and nothing in it. */
    val empty: String? = null,
    /** "Scout · ann is writing…", with Stop beside it; "" for nobody. */
    val working: String = "",
    /** This account's message on its way, drawn until the front door's version of it is in the chat. */
    val sent: String? = null,
    val sending: Boolean = false,
    /** The line above the message box: why the last send failed, until the owner sends or edits. */
    val note: String? = null,
    /** A message that did not go, for the box to take back ([RoomChatDesk.takeFailed]). */
    val back: String? = null,
    val placeholder: String = "",
    val gone: Boolean = false,
)

/**
 * A room's chat for a phone, while it is on screen: its messages as the front door hands them out, oldest first, the
 * newer ones from the room's live [events] ([RoomsHub.events]), older pages as it is scrolled up, this account's
 * message on its way, and Stop for the turns that wait. The rules are Android's RoomChatModel's (ui/RoomsScreens.kt).
 *
 * [start] it when it comes on screen and [stop] it when it goes: once stopped nothing follows the events again, not a
 * load that answers late nor one asked after, so nothing it opened outlives the screen.
 */
class RoomChatDesk(
    private val scope: CoroutineScope,
    private val api: Api,
    private val hub: RoomsHub,
    val roomId: String,
    private val events: Flow<FeedEvent> = hub.events,
    private val time: (String?) -> String = { shortClock(it) },
) {
    private var messages: List<RoomMessage> = emptyList()
    private var loaded = false
    private var error: String? = null
    private var more = false
    private var loadingOlder = false
    private var gone = false
    private var sending = false
    private var sent: Pair<String, Set<String>>? = null // its words, and the ids of this account's messages on Send
    private var note: String? = null
    private var back: String? = null
    private var failed: Pair<String, String>? = null // the message from the box that failed last, with its key
    private val jobs = mutableListOf<Job>()
    private var following: Job? = null
    private var stopped = false

    // After every field it reads: Kotlin sets a class's properties in order.
    private val _state = MutableStateFlow(snapshot())
    val state: StateFlow<RoomChatState> = _state

    /** Calls [onChange] with the chat now and after every change, on the scope's thread. */
    fun watch(onChange: (RoomChatState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    /** The chat came on screen: its newest page, then the room's events; the room itself as the list has it. */
    fun start() {
        if (jobs.isNotEmpty()) return
        stopped = false
        follow() // first: a message that comes while the first page loads is not lost
        jobs += scope.launch { load() }
        jobs += scope.launch {
            // The room's name, its bots and who is writing, from the list; left or deleted, here or elsewhere: the
            // chat closes, once the list was read again.
            hub.list.collect { list ->
                if (list != null && list.rooms.none { it.id == roomId } && !gone) {
                    hub.refresh()
                    if (hub.list.value?.rooms?.none { it.id == roomId } == true) gone = true
                }
                publish()
            }
        }
        jobs += scope.launch { hub.account.collect { publish() } }
    }

    /** The chat was left: it follows nothing from here on (a send under way goes on). */
    fun stop() {
        stopped = true
        following?.cancel()
        following = null
        jobs.forEach { it.cancel() }
        jobs.clear()
    }

    /** The newest page, merged with what the chat holds; the room's events are followed from then on. */
    @Throws(Exception::class)
    suspend fun load() {
        try {
            val page = api.roomMessages(roomId)
            messages = Rooms.merge(messages, page.messages)
            if (!loaded) more = page.more
            loaded = true
            error = null
            follow()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (!loaded) error = RoomWords.failed(e)
        }
        publish()
    }

    private fun follow() {
        // Left: a load that answers late, or one asked after, follows nothing, so nothing outlives the screen.
        if (stopped || following?.isActive == true) return
        following = scope.launch {
            events.collect { ev ->
                if (ev.type == "reset") load()
                else Rooms.messageOf(ev, roomId)?.let { messages = Rooms.merge(messages, listOf(it)); publish() }
            }
        }
    }

    /** The page before the oldest message held: the chat was scrolled up. */
    fun loadOlder() {
        val oldest = messages.firstOrNull()?.id ?: return
        if (!more || loadingOlder || stopped) return
        loadingOlder = true
        scope.launch {
            try {
                val page = api.roomMessages(roomId, before = oldest)
                if (!stopped) { messages = Rooms.merge(page.messages, messages); more = page.more }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // scrolling back up asks again
            } finally {
                loadingOlder = false
            }
            publish()
        }
    }

    /**
     * This account writes [text] in the room; true once it went. One at a time: while one is on its way another goes
     * back to the box. A message that did not go waits in [RoomChatState.back] with the line that says why, and sent
     * again as it was it keeps its key, so the front door takes it once.
     */
    @Throws(Exception::class)
    suspend fun send(text: String): Boolean {
        if (sending) { giveBack(text); publish(); return false }
        val mine = hub.account.value
        val k = failed?.takeIf { it.first == text }?.second ?: newMessageKey()
        sending = true
        note = null
        sent = text to Rooms.own(messages, mine).mapTo(HashSet()) { it.id }
        publish()
        try {
            val m = api.sendToRoom(roomId, text, k)
            messages = Rooms.merge(messages, listOf(m))
            failed = null
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (delivered(e)) { failed = null; return true }
            giveBack(text)
            failed = text to k
            note = sendNote(e)
            return false
        } finally {
            sending = false
            sent = null
            publish()
        }
    }

    private fun giveBack(text: String) {
        val had = back.orEmpty()
        back = if (text.isNotEmpty() && had.isNotBlank()) "$text\n$had" else text.ifEmpty { had }
    }

    /** The box takes the message that did not go back. */
    fun takeFailed(): String? = back.also { back = null; publish() }

    /** The owner edited the message: the line goes, and what is in the box is a new message. */
    fun edited() { note = null; failed = null; publish() }

    /** Stop beside who is writing: the turns of this room that wait are dropped. */
    @Throws(Exception::class)
    suspend fun stopTurns() { runCatching { api.stopRoom(roomId) }.exceptionOrNull()?.let { if (it is CancellationException) throw it } }

    private fun publish() { _state.value = snapshot() }

    private fun snapshot(): RoomChatState {
        val room = hub.list.value?.rooms?.firstOrNull { it.id == roomId }
        val mine = hub.account.value
        // Never drawn twice: the front door's version of the message on its way can come with the events first.
        val shown = sent?.takeUnless { (text, known) -> Rooms.own(messages, mine).any { it.id !in known && it.text.trim() == text.trim() } }?.first
        return RoomChatState(
            name = room?.name.orEmpty(),
            lines = messages.map { line(it, room, mine) },
            loaded = loaded,
            error = error,
            empty = if (loaded && messages.isEmpty() && shown == null) RoomChat.EMPTY else null,
            working = room?.let { Rooms.workingLine(it) }.orEmpty(),
            sent = shown,
            sending = sending,
            note = note,
            back = back,
            placeholder = RoomChat.placeholder(room?.name),
            gone = gone,
        )
    }

    private fun line(m: RoomMessage, room: Room?, mine: String?): RoomLine = RoomLine(
        id = m.id,
        kind = when { m.notice -> RoomLineKind.NOTICE; RoomChat.isMine(m, mine) -> RoomLineKind.MINE; else -> RoomLineKind.THEIRS },
        author = Rooms.author(m),
        text = m.text,
        time = time(m.at),
        mentioned = Rooms.mentionLine(m),
        bot = m.bot != null,
        color = m.bot?.let { b -> room?.bots?.firstOrNull { it.account == m.account && it.id == b.id }?.color },
    )

    companion object {
        private val STILL_HERE: String get() = tr("Your message is still here.")

        /** The send went after all: an answer that says so, or one that could not be read. */
        internal fun delivered(e: Throwable): Boolean = when (e) {
            is ApiException -> e.status in 200..299
            else -> e is SerializationException
        }

        /**
         * The line above the box after a send that failed, in the Android app's words (sendNote, ui/ChatModels.kt,
         * with a key the front door takes once): the front door's own sentence; "can't reach botdot" when nothing
         * answered or a gateway did in its place; "it may have been sent" when nobody can tell.
         */
        internal fun sendNote(e: Throwable): String {
            val a = e as? ApiException ?: return tr("It may have been sent: check the chat.") + " " + STILL_HERE
            val said = a.message?.trim().orEmpty()
            return when {
                a.said && said.isNotEmpty() -> notSent(said)
                a.status == 0 || a.status == 502 || a.status == 503 -> tr("Not sent: can't reach botdot.") + " " + STILL_HERE
                a.status >= 500 -> tr("It may have been sent: check the chat.") + " " + STILL_HERE
                else -> notSent(statusWords(a.status))
            }
        }

        private fun notSent(said: String) = tr("Not sent: {why}", "why" to said + if (said.last() in ".!?…") "" else ".") + " " + STILL_HERE
    }
}

/**
 * When a room last had something, as short as the list needs it, as Android's list says it (listTime): the time today,
 * "Yesterday", then the day; "" for a moment that cannot be read.
 */
fun listClock(iso: String?, zone: TimeZone = TimeZone.currentSystemDefault(), now: Instant = Clock.System.now()): String {
    if (iso.isNullOrBlank()) return ""
    val t = runCatching { Instant.parse(iso).toLocalDateTime(zone) }.getOrNull() ?: return ""
    val today = now.toLocalDateTime(zone).date
    return when {
        t.date >= today -> "${t.hour.toString().padStart(2, '0')}:${t.minute.toString().padStart(2, '0')}"
        t.date == today.minus(1, DateTimeUnit.DAY) -> tr("Yesterday")
        else -> "${t.day} ${monthShort(t.month.ordinal)}"
    }
}

/** One of the room's bots in its settings: its label ("name · account"), its colour and look, and whether Remove is offered (this account's). */
data class RoomBotView(val id: String, val label: String, val color: String?, val outfit: JsonElement?, val removable: Boolean)

/** A room's settings at one moment. [room]: false until the room is known. [gone]: left or deleted: back to the list. */
data class RoomSettingsState(
    val room: Boolean = false,
    val name: String = "",
    val people: List<String> = emptyList(),
    val invited: List<String> = emptyList(),
    /** The invite link section shows: this account made the room and its link was read ([link] null: none yet). */
    val linkShown: Boolean = false,
    val link: RoomLink? = null,
    val bots: List<RoomBotView> = emptyList(),
    /** This account's bots that may join, with Add. */
    val addable: List<RoomBotView> = emptyList(),
    val mayDelete: Boolean = false,
    val busy: Boolean = false,
    val notice: String? = null,
    val noticeId: Int = 0,
    val gone: Boolean = false,
)

/**
 * A room's settings for a phone: its name, its people and who is still invited, the maker's invite link (the only way
 * in, ADR 076), its bots with Remove on this account's own, adding one of this account's bots ([Store.bots]), and
 * Leave (Delete for the account that made it), as Android's RoomSettingsScreen does them. [close] it when it goes.
 */
class RoomSettingsDesk(private val hub: RoomsHub, private val api: Api, private val store: Store, val roomId: String, scope: CoroutineScope) {
    private val job = SupervisorJob(scope.coroutineContext[Job])
    private val own = CoroutineScope(scope.coroutineContext + job)

    private data class Local(val link: RoomLink? = null, val linkRead: Boolean = false, val busy: Boolean = false, val notice: String? = null, val noticeId: Int = 0, val gone: Boolean = false)

    private val local = MutableStateFlow(Local())

    val state: StateFlow<RoomSettingsState> = combine(hub.list, hub.account, hub.links, store.bots.value, local) { list, mine, links, bots, l -> build(list, mine, links, bots, l) }
        .stateIn(own, SharingStarted.Eagerly, RoomSettingsState())

    init {
        own.launch { runCatching { api.room(roomId) }.onSuccess(hub::took) }
        own.launch {
            // The maker's link, once it is known that this account made the room.
            combine(hub.list, hub.account, hub.links) { list, mine, links -> Rooms.maker(list?.rooms?.firstOrNull { it.id == roomId }, mine, links) }
                .collect { maker -> if (maker && !local.value.linkRead) runCatching { api.roomLink(roomId) }.onSuccess { l -> local.value = local.value.copy(link = l, linkRead = true) } }
        }
    }

    /** Calls [onChange] with the settings now and after every change, on the scope's thread. */
    fun watch(onChange: (RoomSettingsState) -> Unit): Job = own.launch { state.collect { onChange(it) } }

    private fun build(list: RoomsAnswer?, mine: String?, links: Boolean, bots: List<Bot>?, l: Local): RoomSettingsState {
        val r = list?.rooms?.firstOrNull { it.id == roomId } ?: return RoomSettingsState(busy = l.busy, notice = l.notice, noticeId = l.noticeId, gone = l.gone)
        return RoomSettingsState(
            room = true,
            name = r.name,
            people = r.members.map { RoomWords.person(it, mine) },
            invited = r.invites.map { RoomWords.invited(it) },
            linkShown = Rooms.maker(r, mine, links) && l.linkRead,
            link = l.link,
            bots = r.bots.map { RoomBotView(it.id, Rooms.label(it.name, it.account), it.color, null, it.account == mine) },
            addable = Rooms.addable(r, bots.orEmpty(), mine).map { RoomBotView(it.id, it.name, it.color, it.outfit, false) },
            mayDelete = Rooms.mayDelete(r, mine),
            busy = l.busy,
            notice = l.notice,
            noticeId = l.noticeId,
            gone = l.gone,
        )
    }

    /** Save on the name: the room is called [name] for everyone in it; nothing is sent for a blank or the same name ([Rooms.renamed]). */
    @Throws(Exception::class)
    suspend fun rename(name: String) {
        val now = state.value.name
        val to = Rooms.renamed(name, now) ?: return
        act(tr("Saved")) { hub.took(api.renameRoom(roomId, to)) }
    }

    /** Whether Save shows for the name [typed] in the box. */
    fun saves(typed: String): Boolean = state.value.room && Rooms.renamed(typed, state.value.name) != null

    /** Make an invite link, or New link (the one before stops working). */
    @Throws(Exception::class)
    suspend fun makeLink(again: Boolean) = act(if (again) tr("A new link: the one before no longer works") else null) { val l = api.makeRoomLink(roomId); local.value = local.value.copy(link = l) }

    /** Take back on the link: it no longer works. */
    @Throws(Exception::class)
    suspend fun dropLink() = act(tr("Taken back")) { api.dropRoomLink(roomId); local.value = local.value.copy(link = null) }

    /** Add on one of this account's bots. */
    @Throws(Exception::class)
    suspend fun add(bot: String) = act { hub.took(api.addRoomBot(roomId, bot)) }

    /** Remove on one of this account's bots in the room. */
    @Throws(Exception::class)
    suspend fun remove(bot: String) = act { hub.took(api.removeRoomBot(roomId, bot)) }

    /** Leave, or Delete ([delete]) for the account that made it, once asked ([RoomWords.askTitle]): the room is gone from here. */
    @Throws(Exception::class)
    suspend fun leave(delete: Boolean) = act {
        if (delete) api.deleteRoom(roomId) else api.leaveRoom(roomId)
        hub.gone(roomId)
        local.value = local.value.copy(gone = true)
    }

    private suspend fun act(done: String? = null, block: suspend () -> Unit) {
        if (local.value.busy) return
        local.value = local.value.copy(busy = true)
        val said = try {
            block()
            done
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            RoomWords.failed(e)
        } finally {
            local.value = local.value.copy(busy = false)
        }
        if (said != null) local.value = local.value.copy(notice = said, noticeId = local.value.noticeId + 1)
    }

    fun close() = job.cancel()
}
