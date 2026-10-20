package dev.botdot.app.ui

import android.net.Uri
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import dev.botdot.app.data.Unread
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.Attachment
import dev.botdot.app.data.ChiefChat
import dev.botdot.app.data.InboxNote
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.Queued
import dev.botdot.app.data.TakenBack
import dev.botdot.app.data.Ratings
import dev.botdot.app.data.Run
import dev.botdot.app.data.ReplyDraft
import dev.botdot.app.data.RunEvent
import dev.botdot.app.data.str
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import java.io.IOException
import java.util.UUID

/**
 * A bot's chat, kept while it's open (and while the phone turns): its runs, the notes waiting for its next run, what
 * it's doing now, the files attached in the message box. After an event only its newest runs are fetched again;
 * older ones come a page at a time as you scroll up.
 */
@OptIn(FlowPreview::class)
class BotChatModel(private val app: BotDotApp, val botId: String) : ViewModel() {
    private val _notes = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** Something to say at the bottom of the screen ("Couldn't send…"). */
    val notes: SharedFlow<String> = _notes

    val files = PendingFiles(viewModelScope, app, { app.api.value }, { "bot:$botId" }) { _notes.tryEmit(it) }
    private var sharedTaken = false
    /** Files shared from another app: into the message box once (not again when the phone turns). */
    fun addShared(uris: List<Uri>) { if (!sharedTaken && uris.isNotEmpty()) { sharedTaken = true; files.add(uris) } }

    private var all by mutableStateOf<List<Run>>(emptyList()) // newest first, quiet ones too (they anchor the pages)
    /** Its runs as the chat shows them (quiet ones are only in its run history). */
    val runs: List<Run> by derivedStateOf { all.filterNot { it.quiet || it.isQueued } } // one that waits is in [queued], not a run yet
    /** The owner's messages that wait until the bot is free, oldest first: the server's list (`queued` on the bot). */
    var queued by mutableStateOf<List<Queued>>(emptyList())
        private set
    var waiting by mutableStateOf<List<InboxNote>>(emptyList()) // notes for its next run
        private set
    var loaded by mutableStateOf(false)
        private set
    private var noOlder = false
    private var loadingOlder = false

    /** The run the "New" line is drawn at: the server's first new reply when the chat came on screen. Kept until the chat is left. */
    var newFirst by mutableStateOf<String?>(null)
        private set

    /**
     * The chat came on screen, with the app in front: the line goes where the server says the new replies begin now,
     * asked before the app reports the chat as read. True when the line was placed or moved.
     */
    suspend fun arrive(): Boolean {
        // Not answered in a moment (a poor connection): what the app knows, so the report isn't kept waiting.
        val asked = runCatching { withTimeoutOrNull(ASK_MS) { app.api.value?.bot(botId) } }.getOrNull()
        currentCoroutineContext().ensureActive() // the chat was left meanwhile: nothing is placed, nothing reported
        val now = asked ?: app.store.bots.value.value?.firstOrNull { it.id == botId } ?: return false
        val first = Unread.line(newFirst, now.unread, now.firstUnread)
        if (first == newFirst) return false
        newFirst = first
        return true
    }

    /** The chat was left: its line goes. */
    fun leave() { newFirst = null }

    /** Waits for the chat, and brings in the run the line is at: a reply from while the app was away, or an older page. */
    suspend fun reachNew(): Boolean {
        val id = newFirst ?: return false
        snapshotFlow { loaded }.first { it }
        refresh() // what came while the app was away, all of it, before the chat is scrolled
        return reach(id)
    }

    private val kicks = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    init {
        viewModelScope.launch { app.api.filterNotNull().first(); load() }
        // What waits for it, from the list of bots the app keeps: fetched while this chat looks at it, and put in
        // place there whenever the feed's `queued` event says the list changed (Store).
        viewModelScope.launch { app.store.bots.value.collect { bots -> bots?.firstOrNull { it.id == botId }?.let { queued = it.queued } } }
        // What changed for this bot: its newest runs again, once a burst is over.
        viewModelScope.launch {
            app.feed.events.collect { ev ->
                when {
                    ev.type == "reset" -> load()
                    ev.type.startsWith("run_") && ev.data.str("botId") == botId -> kicks.tryEmit(Unit)
                    ev.type == "bot_message" && (ev.data["to"] as? JsonObject)?.str("id") == botId -> kicks.tryEmit(Unit)
                    // While it works, a card came, went or changed: an action in a connected app may have begun or
                    // ended its wait for the owner's OK, which the run says in this list (`waitingFor`).
                    ev.type == "asks" && all.any { it.isRunning } -> kicks.tryEmit(Unit)
                }
            }
        }
        viewModelScope.launch { kicks.debounce(250).collect { refresh() } }
    }

    /** The newest page, from scratch. */
    suspend fun load() {
        val a = app.api.value ?: return
        val (r, w) = coroutineScope { async { runCatching { a.runs(botId, PAGE) } } to async { runCatching { a.inbox(botId) } } }
        r.await().onSuccess { all = it; noOlder = it.size < PAGE; loaded = true; follow() }.onError { _notes.tryEmit(it.message ?: "Couldn't load") }
        w.await().onSuccess { waiting = it } // an older botdot has no inbox to show
    }

    /** Only its newest runs, put in place of what the chat had. */
    suspend fun refresh() {
        val a = app.api.value ?: return
        if (!loaded) return load()
        val (r, w) = coroutineScope { async { runCatching { a.runs(botId, NEWEST) } } to async { runCatching { a.inbox(botId) } } }
        w.await().onSuccess { waiting = it }
        val fresh = r.await().getOrNull() ?: return
        val merged = mergeNewest(all, fresh, NEWEST) ?: return load() // more new runs than one look brings: start over
        all = merged
        follow()
    }

    /** The next page of older runs (the chat was scrolled up). */
    fun loadOlder() {
        if (noOlder || loadingOlder || !loaded) return
        val oldest = all.lastOrNull()?.id ?: return
        loadingOlder = true
        viewModelScope.launch {
            runCatching { app.api.value?.runs(botId, PAGE, before = oldest) }.onSuccess { page ->
                val known = all.mapTo(HashSet()) { it.id }
                // An older botdot sends the newest again: nothing older to show then.
                if (page == null || page.isEmpty() || page.first().id in known) noOlder = true
                else { all = all + page.filter { it.id !in known }; noOlder = page.size < PAGE }
            }
            loadingOlder = false
        }
    }

    /** Older pages until this run is in the chat (a search match), a few at most. True when it is. */
    suspend fun reach(runId: String): Boolean {
        repeat(10) {
            if (all.any { it.id == runId }) return true
            if (noOlder) return false
            val oldest = all.lastOrNull()?.id ?: return false
            val page = runCatching { app.api.value?.runs(botId, PAGE, before = oldest) }.getOrNull().orEmpty()
            val known = all.mapTo(HashSet()) { it.id }
            if (page.isEmpty() || page.first().id in known) { noOlder = true; return false }
            all = all + page.filter { it.id !in known }
        }
        return all.any { it.id == runId }
    }

    /** What its message box is told about a send: under way, failed and why, the message to take back. */
    val outbox = Outbox.of("bot:$botId")

    /**
     * Sends a message; true once it went. [box]: it came from the message box, and goes back there when it failed.
     * The request outlives this chat's screen: leaving the chat neither stops it nor loses a message it could not send.
     */
    fun send(text: String, attachments: List<Attachment>, box: Boolean = true, key: String? = null): Deferred<Boolean> {
        var waits = false // the answer was a message that waits its turn: it is in the bot's list, not among its runs
        val known = ownWords(all, queued).mapTo(HashSet()) { it.id }
        // Begun in the tap itself: the message is in the chat before anything else is drawn.
        return app.scope.async(start = CoroutineStart.UNDISPATCHED) {
            outbox.send(text, attachments, box, key, once = takesOnce(app), known = known) { k ->
                val run = (app.api.value ?: throw ApiException(NOT_CONNECTED)).runBot(botId, text, attachments, k)
                waits = run.isQueued
                took(run, text, attachments)
            }
        }.also { sent -> viewModelScope.launch { sent.await(); refresh(); if (waits) app.store.bots.refresh() } }
    }

    /** The owner's message on its way, drawn until the server's version of it is in the chat ([SentMessage]). */
    val sent: SentMessage? by derivedStateOf { outbox.sent?.unlessIn(ownWords(all, queued)) }

    /** botdot's answer to a send, in the chat at once: the run it started, or the message among those that wait. */
    private fun took(run: Run, text: String, attachments: List<Attachment>) {
        if (!run.isQueued) { all = withAnswer(all, run); follow(); return }
        val q = Queued(run.id, text, attachments)
        queued = withWaiting(queued, q)
        app.store.bots.update { bots -> bots.map { if (it.id == botId) it.copy(queuedValue = withWaiting(it.queuedValue, q)) else it } }
    }

    private val taking = HashSet<String>()

    /**
     * "Take back" on a message that waits: it leaves the server, and its text and files are in the message box
     * again, as after a failed send. When it has started meanwhile, the box's line says so and the chat shows its run.
     */
    fun takeBack(q: Queued) {
        if (!taking.add(q.id)) return
        val taken = app.scope.async { outbox.takeBack { (app.api.value ?: throw ApiException(NOT_CONNECTED)).takeBack(botId, q.id) } }
        viewModelScope.launch {
            // Gone from the list the app keeps, before the server's list says so: this chat's follows it.
            if (taken.await()) app.store.bots.update { all -> all.map { if (it.id == botId) it.copy(queuedValue = without(it.queuedValue, q.id)) else it } }
            taking.remove(q.id)
            refresh(); app.store.bots.refresh()
        }
    }

    /**
     * "Steer" on a message that waits (ADR 040): the run that is going reads it at its next tool call, and until then
     * it shows "Steering…". When botdot refused (the run can't take it, or it has started), the box's line says why.
     */
    fun steer(q: Queued) {
        if (!taking.add(q.id)) return
        viewModelScope.launch {
            try {
                (app.api.value ?: throw ApiException(NOT_CONNECTED)).steer(botId, q.id)
                app.store.bots.update { all -> all.map { if (it.id == botId) it.copy(queuedValue = steered(it.queuedValue, q.id)) else it } }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                outbox.steerFailed(e)
                refresh()
            } finally {
                taking.remove(q.id)
            }
            app.store.bots.refresh()
        }
    }

    fun stop() {
        val r = all.firstOrNull { it.isRunning } ?: return
        viewModelScope.launch { runCatching { app.api.value?.stopRun(r.id) }; refresh() }
    }

    /** The reply of the run at work as it is written so far, by its run (ReplyDraft): drawn in its place. */
    var draft by mutableStateOf<Pair<String, String>?>(null)
        private set

    // Follow the run that's going on now: what it attaches, its line as it changes, its draft, its end.
    private var following: String? = null
    private var stream: Job? = null
    private fun follow() {
        // The lines of its runs that still go on, as this list has them; those of runs that ended go.
        app.store.lines.sync(OpeningLine.live(all, app.store.lines.features)) { it == "bot:$botId" }
        val r = all.firstOrNull { it.isRunning }
        if (r?.id == following) return
        following = r?.id
        stream?.cancel()
        draft = null // the run it was of ended: its reply stands in its place
        if (r == null) return
        stream = viewModelScope.launch {
            runCatching {
                app.api.value?.runStream(r.id)?.collect { ev ->
                    when (ev) {
                        is RunEvent.Step -> Unit // a working bot is its status line: the steps are in the run's details
                        is RunEvent.Text -> Unit // the reply shows when it's done, or grows as its draft
                        is RunEvent.Draft -> if (ReplyDraft.shows(app.store.version.value.value?.features)) draft = ev.text.takeIf { it.isNotEmpty() }?.let { r.id to it }
                        is RunEvent.End -> { draft = null; kicks.tryEmit(Unit) }
                        is RunEvent.File -> kicks.tryEmit(Unit) // show it now: a QR code to scan can't wait for the reply
                        is RunEvent.Line -> app.store.lines.streamed("bot:$botId", ev, r.id)
                    }
                }
            }
        }
    }

    companion object {
        const val PAGE = 40
        const val NEWEST = 8
    }
}

/** How long a chat that came on screen waits for botdot to say what is new in it, before it goes by what the app knows. */
private const val ASK_MS = 3_000L

/**
 * The newest runs ([fresh], a look at the [limit] newest) put in place of those in [had] (both newest first).
 * null when they don't meet: more runs came than one look brings, so the chat should start over.
 */
fun mergeNewest(had: List<Run>, fresh: List<Run>, limit: Int): List<Run>? {
    if (fresh.isEmpty()) return if (had.isEmpty()) had else null
    val at = had.indexOfFirst { it.id == fresh.last().id }
    return when {
        at >= 0 -> fresh + had.drop(at + 1)
        fresh.size < limit -> fresh // that's all it has
        had.isEmpty() -> fresh
        else -> null
    }
}

/**
 * A chat with the Chief, kept while it's open (and while the phone turns). A long chat is read in parts: its last
 * messages first, older ones as you scroll up, and after an event only its end again.
 */
@OptIn(FlowPreview::class)
class ChiefChatModel(private val app: BotDotApp, start: String) : ViewModel() {
    private val _notes = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val notes: SharedFlow<String> = _notes

    val files = PendingFiles(viewModelScope, app, { app.api.value }, { "chief" }) { _notes.tryEmit(it) }
    private var sharedTaken = false
    fun addShared(uris: List<Uri>) { if (!sharedTaken && uris.isNotEmpty()) { sharedTaken = true; files.add(uris) } }

    var chatId by mutableStateOf(start.takeIf { it != "latest" && it != "new" })
        private set
    private var pickLatest = start == "latest" // only on first open, not after ＋
    /** The part of the chat that's loaded: its messages from [ChiefChat.offset] to the end. */
    var chat by mutableStateOf<ChiefChat?>(null)
        private set
    /** What the Chief is doing while it replies, in the server's words ("Reading nytimes.com", [OpeningLine.chiefActivity]). */
    val activity = mutableStateListOf<String>()
    private var loadingOlder = false

    /** The place (in the whole chat) of the message the "New" line is drawn at: the server's first new reply when the chat came on screen. */
    var newFirst by mutableStateOf<Int?>(null)
        private set

    /** As [BotChatModel.arrive], for the chat that is open. */
    suspend fun arrive(): Boolean {
        val id = chatId ?: return false
        val now = runCatching { withTimeoutOrNull(ASK_MS) { app.api.value?.chiefChat(id, limit = 1) } }.getOrNull()
        currentCoroutineContext().ensureActive() // the chat was left meanwhile: nothing is placed, nothing reported
        val known = app.store.chief.value.value?.chats?.firstOrNull { it.id == id }
        if (id != chatId) return false
        val first = if (now != null) Unread.line(newFirst, now.unread, now.firstUnread) else Unread.line(newFirst, known?.unread ?: 0, known?.firstUnread)
        if (first == newFirst) return false
        newFirst = first
        return true
    }

    fun leave() { newFirst = null }

    /** Waits for the chat, and brings in the message the line is at: a reply from while the app was away, or an older part. */
    suspend fun reachNew(): Boolean {
        val id = chatId ?: return false
        val at = newFirst ?: return false
        snapshotFlow { chat }.first { it?.id == id }
        refresh() // what came while the app was away, all of it, before the chat is scrolled
        reachIndex(at)
        return chatId == id && newFirst == at
    }

    private val kicks = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private var wholeDue = false
    /** Refresh once a burst is over; whole: all of the loaded part (an answer can change an older message). */
    private fun kick(whole: Boolean) { if (whole) wholeDue = true; kicks.tryEmit(Unit) }

    init {
        viewModelScope.launch { app.api.filterNotNull().first(); load() }
        viewModelScope.launch {
            app.feed.events.collect { ev ->
                when {
                    ev.type == "reset" -> load()
                    // A rating made here or in another app: its thumbs, if that message is loaded.
                    ev.type == "rating" -> Ratings.event(ev.data)?.let { r -> chat?.takeIf { it.id == r.chatId }?.let { chat = Ratings.set(it, r.index, r.rating) } }
                    // What waits in this chat changed: the event carries the list as it stands now.
                    ev.type == "queued" -> Queued.event(ev)?.let { (c, list) -> chat?.takeIf { c == "chief:${it.id}" }?.let { chat = it.copy(queuedValue = list); kick(whole = false) } }
                    ev.type.startsWith("chief_") || ev.type == "plan_closed" ->
                        if (chatId != null && ev.data.str("chatId") == chatId) kick(whole = ev.type == "chief_suggestion" || ev.type == "plan_closed")
                }
            }
        }
        viewModelScope.launch { kicks.debounce(250).collect { val whole = wholeDue; wholeDue = false; refresh(whole) } }
    }

    /** Open another chat (null: a new one, made when you send). */
    fun open(id: String?) {
        pickLatest = false
        if (id == chatId && chat != null) return
        chatId = id
        chat = null
        newFirst = null // another chat: the line was the one before's
        follow()
        viewModelScope.launch { load() }
    }

    /** Its last page, from scratch. */
    suspend fun load() {
        val a = app.api.value ?: return
        if (chatId == null && pickLatest) {
            val chats = app.store.chief.value.value ?: run { app.store.chief.refresh(); app.store.chief.value.value }
            chatId = chats?.chats?.firstOrNull()?.id
            pickLatest = false
        }
        val id = chatId ?: run { chat = null; return }
        runCatching { a.chiefChat(id, limit = PAGE) }.onSuccess { if (id == chatId) { chat = it; follow() } }
            .onError { _notes.tryEmit(it.message ?: "Couldn't load") }
    }

    /** Its end again (or all of the loaded part), put in place. */
    suspend fun refresh(whole: Boolean = false) {
        val a = app.api.value ?: return
        val had = chat ?: return load()
        if (had.total < 0) return load() // an older botdot: it sends all of it anyway
        val id = had.id
        val from = if (whole) had.offset else maxOf(had.offset, had.offset + had.messages.size - TAIL)
        runCatching { a.chiefChat(id, offset = from) }.onSuccess { part ->
            if (id != chatId) return@onSuccess
            val now = chat ?: return@onSuccess
            chat = part.copy(offset = now.offset, messages = now.messages.take(from - now.offset) + part.messages)
            follow()
        }.onError { _notes.tryEmit(it.message ?: "Couldn't load") }
    }

    /** The page before what's loaded (the chat was scrolled up). */
    fun loadOlder() {
        val c = chat ?: return
        if (c.offset <= 0 || loadingOlder) return
        loadingOlder = true
        viewModelScope.launch { reachIndex(maxOf(0, c.offset - PAGE)); loadingOlder = false }
    }

    /** Loads older messages until message [index] is in (a search match). */
    suspend fun reachIndex(index: Int) {
        val c = chat ?: return
        if (index >= c.offset) return
        runCatching { app.api.value?.chiefChat(c.id, offset = index, limit = c.offset - index) }.getOrNull()?.let { older ->
            val now = chat ?: return
            if (now.id != c.id || now.offset != c.offset) return
            chat = now.copy(offset = older.offset, messages = older.messages + now.messages)
        }
    }

    /** One for all the Chief's chats: they share the message box. */
    val outbox = Outbox.of("chief")

    /** As [BotChatModel.send]. A first message makes its chat; when the message then fails, the chat stays for the next try. */
    fun send(text: String, attachments: List<Attachment>, box: Boolean = true, key: String? = null): Deferred<Boolean> {
        val known = ownWords(chat).mapTo(HashSet()) { it.id }
        // Begun in the tap itself: the message is in the chat before anything else is drawn.
        return app.scope.async(start = CoroutineStart.UNDISPATCHED) {
            outbox.send(text, attachments, box, key, once = takesOnce(app), chat = chatId, known = known) { k ->
                val a = app.api.value ?: throw ApiException(NOT_CONNECTED)
                val id = chatId ?: try { a.newChiefChat().id.also { chatId = it; outbox.sentIn(it) } } catch (e: CancellationException) { throw e } catch (e: Exception) { throw notSent(e) }
                // The answer is the chat: the message is in it at once, or in its list while it waits for the reply to end.
                a.sendToChief(id, text, attachments, k)?.takeIf { it.id == chatId }?.let { now ->
                    withAnswer(chat?.takeIf { it.id == now.id }, now)?.let { chat = it; follow() }
                }
            }
        }.also { sent -> viewModelScope.launch { sent.await(); if (chat == null) load() else refresh() } }
    }

    /** As [BotChatModel.sent], in the chat it was sent in: the Chief's chats share one outbox. */
    val sent: SentMessage? by derivedStateOf { outbox.sent?.takeIf { it.chat == chatId }?.unlessIn(ownWords(chat)) }

    /** The owner's messages that wait until the Chief's reply ends, oldest first: the server's list (`queued` on the chat). */
    val queued: List<Queued> get() = chat?.queued.orEmpty()

    private val taking = HashSet<String>()

    /** As [BotChatModel.takeBack], for a message that waits in this chat. */
    fun takeBack(q: Queued) {
        val id = chatId ?: return
        if (!taking.add(q.id)) return
        val taken = app.scope.async { outbox.takeBack { (app.api.value ?: throw ApiException(NOT_CONNECTED)).takeBackFromChief(id, q.id) } }
        viewModelScope.launch {
            if (taken.await()) chat?.takeIf { it.id == id }?.let { c -> chat = c.copy(queuedValue = without(c.queuedValue, q.id)) }
            taking.remove(q.id)
            refresh()
        }
    }

    /** As [BotChatModel.steer], for a message that waits in this chat: the Chief's reply that is going reads it. */
    fun steer(q: Queued) {
        val id = chatId ?: return
        if (!taking.add(q.id)) return
        viewModelScope.launch {
            try {
                (app.api.value ?: throw ApiException(NOT_CONNECTED)).steerChief(id, q.id)
                chat?.takeIf { it.id == id }?.let { c -> chat = c.copy(queuedValue = steered(c.queuedValue, q.id)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                outbox.steerFailed(e)
            } finally {
                taking.remove(q.id)
            }
            refresh()
        }
    }

    /**
     * A tap on 👍 or 👎 under the unasked message at [index] of the whole chat: filled at once, then sent. When botdot
     * refuses it or can't be reached, the thumbs go back to what they were (unless a later tap or the feed has changed
     * them since) and the app says so.
     */
    fun rate(index: Int, tapped: String) {
        val c = chat ?: return
        val before = Ratings.of(c, index)
        val rating = Ratings.next(before, tapped)
        chat = Ratings.set(c, index, rating)
        viewModelScope.launch {
            runCatching { (app.api.value ?: throw ApiException("Not connected to botdot")).rate(c.id, index, rating) }.onError {
                chat?.takeIf { it.id == c.id }?.let { now -> chat = Ratings.undo(now, index, rating, before) }
                _notes.tryEmit("Couldn't save your rating")
            }
        }
    }

    fun stop() { chatId?.let { id -> viewModelScope.launch { runCatching { app.api.value?.stopChief(id) }; refresh() } } }
    fun dismiss() { chatId?.let { id -> viewModelScope.launch { runCatching { app.api.value?.dismissSuggestion(id) }; refresh(whole = true) } } }

    val busy: Boolean get() = chat?.busy == true || chat?.messages?.lastOrNull()?.pending == true

    /** The Chief's reply as it is written so far (ReplyDraft), "" for none: drawn in the place of the reply that is pending. */
    var draft by mutableStateOf("")
        private set

    // While the Chief replies: what it's doing, from its stream.
    private var following: String? = null
    private var stream: Job? = null
    private fun follow() {
        // Its opening line while the Chief replies, as the chat just read has it; none once the reply is there.
        chat?.let { c -> if (c.busy) app.store.lines.say("chief:${c.id}", c.openingLine) else app.store.lines.end("chief:${c.id}") }
        val id = chatId?.takeIf { busy }
        val saved = chat?.messages?.lastOrNull { it.pending }?.activity
        val label = OpeningLine.chiefActivity(saved).ifEmpty { null }
        if (id == following) {
            if (id == null) activity.clear()
            // A refresh may have started before a newer SSE status arrived. Only seed when
            // starting a stream; the existing stream remains authoritative while following.
            return
        }
        following = id
        stream?.cancel()
        activity.clear()
        draft = ""
        if (id == null) return
        label?.let { activity += it }
        stream = viewModelScope.launch {
            runCatching {
                app.api.value?.chiefStream(id)?.collect { (type, o) ->
                    when (type) {
                        "activity" -> activity += OpeningLine.chiefActivity(o)
                        "opening_line" -> app.store.lines.say("chief:$id", o.str("text"))
                        "reply_draft" -> if (ReplyDraft.shows(app.store.version.value.value?.features)) draft = o.str("text")
                        "done" -> { activity.clear(); draft = ""; app.store.lines.end("chief:$id") } // the reply is here, or it couldn't finish
                        "action" -> kick(whole = false) // persisted actions are clickable even while the Chief waits
                        "steered" -> kick(whole = false) // the reply read a message the owner steered into it (ADR 040)
                    }
                }
            }
            following = null
            refresh() // it's done: its reply
        }
    }

    companion object {
        const val PAGE = 40
        const val TAIL = 6 // the last few can still change (a reply finishing, its actions)
    }
}

// ---------- a message that is there at once ----------

/**
 * The owner's message as its chat draws it from Send until the botdot server answered: their own words and files,
 * in the look of a message that waits. It is the one thing an app draws before the server spoke, and it decides
 * nothing. [key] is the message's key ([messageKey]): the answer to the request that carried it is the server's
 * version of this message, and takes its place. [chat]: the chat it was sent in, where one outbox serves several
 * (the Chief's chats). [known]: the ids of the owner's messages the chat held on Send.
 */
data class SentMessage(val key: String, val text: String, val attachments: List<Attachment> = emptyList(), val chat: String? = null, val known: Set<String> = emptySet()) {
    /**
     * This message, or null once the server's own version of it is among [theirs], the owner's messages the chat
     * holds now. The feed can bring it before the request answers, or when its answer was lost: it is then one the
     * chat did not hold on Send, with these words and these files. Never drawn twice.
     */
    fun unlessIn(theirs: List<Queued>): SentMessage? = takeUnless { m ->
        theirs.any { it.id !in m.known && it.text.trim() == m.text.trim() && it.attachments.map { a -> a.file } == m.attachments.map { a -> a.file } }
    }
}

/** The working line under a message that is on its way, until the server has words of its own. */
internal const val WORKING = "Working…"

/** A chat's working line: the line it has ([line], "" for none), or "Working…" while a message of the owner's is on its way ([sent]). */
internal fun lineWith(line: String, sent: SentMessage?): String = line.ifEmpty { if (sent != null) WORKING else "" }

/** The owner's own messages among a bot's [runs] and those that wait for it: what [SentMessage.unlessIn] looks through. */
internal fun ownWords(runs: List<Run>, queued: List<Queued>): List<Queued> =
    runs.filter { Unread.mine(it) }.map { Queued(it.id, it.prompt, it.attachments.orEmpty()) } + queued

/** As [ownWords], of a Chief chat: a message there has no id, and is named by its place in the whole chat. */
internal fun ownWords(chat: ChiefChat?): List<Queued> = chat?.let { c ->
    c.messages.mapIndexedNotNull { i, m -> if (m.role == "user") Queued("at:${c.offset + i}", m.text, m.attachments.orEmpty()) else null } + c.queued
}.orEmpty()

/**
 * A bot's runs (newest first) with the run a send answered: on top, where the chat does not hold it yet. One the
 * chat holds already stays as it is: the feed brought it, or the same message was sent again and botdot took it once.
 */
internal fun withAnswer(had: List<Run>, run: Run): List<Run> = if (had.any { it.id == run.id }) had else listOf(run) + had

/** What waits for a bot with the message a send answered as waiting: last, as the newest. One that is there already is not added. */
internal fun withWaiting(had: List<Queued>, q: Queued): List<Queued> = if (had.any { it.id == q.id }) had else had + q

/** As [withWaiting], for the list as the server sent it (`queued` on a bot), which the app keeps as it came. */
internal fun withWaiting(list: kotlinx.serialization.json.JsonElement?, q: Queued): kotlinx.serialization.json.JsonElement {
    val all = (list as? kotlinx.serialization.json.JsonArray).orEmpty()
    if (all.any { (it as? JsonObject)?.str("id") == q.id }) return kotlinx.serialization.json.JsonArray(all)
    return kotlinx.serialization.json.JsonArray(all + kotlinx.serialization.json.buildJsonObject {
        put("id", kotlinx.serialization.json.JsonPrimitive(q.id))
        put("text", kotlinx.serialization.json.JsonPrimitive(q.text))
        put("attachments", dev.botdot.app.data.Api.JSON.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(Attachment.serializer()), q.attachments))
        q.at?.let { put("at", kotlinx.serialization.json.JsonPrimitive(it)) }
    })
}

/**
 * A Chief chat with what a send answered: the whole chat as it is now, with the owner's message in it, or among
 * those that wait while the Chief replies. [had]: the part of the chat that is loaded, which keeps where it starts
 * and what it knows of new replies. null: nothing was loaded, and the answer is the chat, all of it, as a botdot
 * from before parts sends one (the next look reads its last page). An answer that holds fewer messages than are
 * loaded is no whole chat: only what waits is taken from it. null when there is nothing to draw.
 */
internal fun withAnswer(had: ChiefChat?, answer: ChiefChat): ChiefChat? {
    if (had == null) return answer.takeIf { it.messages.isNotEmpty() || it.queued.isNotEmpty() }
    val waits = answer.queuedValue ?: had.queuedValue
    if (answer.messages.size < had.offset + had.messages.size) return had.copy(queuedValue = waits)
    return had.copy(title = answer.title, messages = answer.messages.drop(had.offset), busy = answer.busy, total = if (had.total < 0) had.total else answer.messages.size, queuedValue = waits)
}

/**
 * Whether these words are "Go on" and nothing else, as the botdot server reads them (docs/api.md, "The limit"): in
 * any case, with the signs typed around them. Sent while a group is stopped at the limit they are no message.
 */
internal fun isGoOn(text: String): Boolean = Regex("""^[\s*_`"'.!]*go\s+on[\s*_`"'.!]*$""", RegexOption.IGNORE_CASE).matches(text)

// ---------- a message that could not be sent ----------

private const val NOT_CONNECTED = "Not connected to botdot"
private const val STILL_HERE = "Your message is still here."

/** The feature of a botdot that takes a message's key once (docs/api.md, "A message sent twice"). */
const val MESSAGE_KEY = "message-key"

/** A key for a message the owner sends: new for each message, and sent again with it when its send failed. */
fun messageKey(): String = UUID.randomUUID().toString()

/** Whether the botdot this app talks to takes a key once, by the features it last named (not known yet: no). */
internal fun takesOnce(features: Collection<String>?): Boolean = features != null && MESSAGE_KEY in features
private fun takesOnce(app: BotDotApp): Boolean = takesOnce(app.store.version.value.value?.features)

/** The feature of a botdot that keeps the owner's message while a bot works or the Chief replies (docs/api.md). */
const val MESSAGE_WAITS = "message-waits"

/**
 * Whether the message box keeps Send while something works: the botdot this app talks to takes a message then and
 * lets it wait ([MESSAGE_WAITS]), and Stop is the word at the end of the working line. Against a botdot from before
 * (and while its features are not known yet) the box is as it was: Stop while busy, nothing sent meanwhile.
 */
internal fun sendStays(features: Collection<String>?): Boolean = features != null && MESSAGE_WAITS in features

/** Whether the message box shows Stop in Send's place: something works, and this botdot would not take a message meanwhile. */
internal fun boxStops(busy: Boolean, features: Collection<String>?): Boolean = busy && !sendStays(features)

/** Under a message that waits: what it waits for. [who]: the bot's name, or "the Chief". */
internal fun waitsUntil(who: String): String = "Waits until $who is free"

/** The box's line when "Take back" came too late: the message's run or turn has begun (the server's 409). */
internal const val ALREADY_STARTED = "It has already started."

/**
 * The line above the message box after a "Take back" that failed. 409: it has already started. Else botdot's own
 * sentence; a 404 without one: it no longer waits; no answer, or a gateway's that botdot is not there (502, 503):
 * botdot was not reached; any other answer with its status, as a failed send says it. The message is where it was.
 */
internal fun takeBackNote(e: Throwable): String {
    val api = e as? ApiException
    val said = api?.message?.trim().orEmpty()
    return when {
        api?.status == 409 -> ALREADY_STARTED
        api != null && api.said && said.isNotEmpty() -> said
        api?.status == 404 -> "It is no longer waiting."
        api == null || api.status == 0 || api.status == 502 || api.status == 503 -> "Not taken back: can't reach botdot."
        else -> "Not taken back: botdot couldn't do that (${api.status})."
    }
}

/** The feature of "Steer" under a bot's waiting message (ADR 040): without it there is no button. */
const val STEER = "steer"

/** Whether a bot's waiting message has "Steer": the botdot this app talks to announces it. */
internal fun canSteer(features: Collection<String>?): Boolean = features != null && STEER in features

/** The feature of "Steer" under a message that waits in a Chief chat (ADR 040). */
const val CHIEF_STEER = "chief-steer"

/** Whether a Chief chat's waiting message has "Steer". */
internal fun canSteerChief(features: Collection<String>?): Boolean = features != null && CHIEF_STEER in features

/** Under a message that the owner steered into the run that is going, until that run read it. */
internal const val STEERING = "Steering…"

/**
 * The line above the message box after a "Steer" that did not go. 409: botdot's own sentence (the run can't take it,
 * or it has already started), else "It has already started."; a 404: it no longer waits; no answer: botdot was not
 * reached; any other answer with its status. The message waits as it did.
 */
internal fun steerNote(e: Throwable): String {
    val api = e as? ApiException
    val said = api?.message?.trim().orEmpty()
    return when {
        api != null && api.said && said.isNotEmpty() -> said
        api?.status == 409 -> ALREADY_STARTED
        api?.status == 404 -> "It is no longer waiting."
        api == null || api.status == 0 || api.status == 502 || api.status == 503 -> "Not steered: can't reach botdot."
        else -> "Not steered: botdot couldn't do that (${api.status})."
    }
}

/** A list of what waits, as it came, with the entry [id] marked as steered: here, before the server's list says so. */
internal fun steered(list: kotlinx.serialization.json.JsonElement?, id: String): kotlinx.serialization.json.JsonElement? =
    (list as? kotlinx.serialization.json.JsonArray)?.let { all ->
        kotlinx.serialization.json.JsonArray(all.map { e ->
            val o = e as? JsonObject
            if (o != null && o.str("id") == id) JsonObject(o + ("steering" to kotlinx.serialization.json.JsonPrimitive(true))) else e
        })
    } ?: list

/** A list of what waits, as it came, without the entry [id]: taken back here, before the server's list says so. */
internal fun without(list: kotlinx.serialization.json.JsonElement?, id: String): kotlinx.serialization.json.JsonElement? =
    (list as? kotlinx.serialization.json.JsonArray)?.let { all ->
        kotlinx.serialization.json.JsonArray(all.filterNot { (it as? JsonObject)?.str("id") == id })
    } ?: list

/** A failure before the message was sent that botdot answered with a [status] and no sentence: see [notSent]. */
internal class NotSent(val status: Int) : IOException("botdot couldn't do that ($status).")

/**
 * A failure before the message itself was sent (its chat could not be made), in the web page's words. botdot's own
 * refusal or its answer that it could not (a 4xx) as it is; an answer of the 500s without botdot's sentence that is
 * no gateway's "not there" (502, 503) with its status; else botdot not reached. Never "it may have been sent": the
 * message did not leave.
 */
internal fun notSent(e: Throwable): IOException {
    val api = e as? ApiException ?: return ApiException(NOT_CONNECTED)
    return when {
        api.said || api.status in 400..499 -> api
        api.status >= 500 && api.status != 502 && api.status != 503 -> NotSent(api.status)
        else -> ApiException(NOT_CONNECTED)
    }
}

/**
 * Whether a send that threw was taken by botdot all the same: it answered with a success, and only reading that
 * answer failed. Such a message is in the chat, and is not put back in the box.
 */
internal fun delivered(e: Throwable): Boolean = when (e) {
    is ApiException -> e.status in 200..299
    else -> e is SerializationException
}

/**
 * The line above the message box after a send that failed, in the web page's words (`sendNoteText`, public/app.js):
 * why, and that nothing is lost. botdot's own sentence for a refusal. "Can't reach botdot" when no answer came, or a
 * gateway answered in botdot's place that it is not there (502, 503). "It may have been sent" when nobody can tell: a
 * gateway gave up waiting (504), or another answer of the 500s without botdot's sentence.
 *
 * [once]: botdot takes a message's key once ([MESSAGE_KEY]), so sending again is safe also where the request had
 * gone out before the connection dropped. Against a botdot from before, that case still reads "It may have been sent".
 */
internal fun sendNote(e: Throwable, once: Boolean = false): String {
    if (e is NotSent) return notSentBecause(e.message.orEmpty())
    val api = e as? ApiException ?: return "It may have been sent: check the chat. $STILL_HERE"
    val said = api.message?.trim().orEmpty()
    return when {
        api.said && said.isNotEmpty() -> notSentBecause(said)
        api.status == 502 || api.status == 503 || (api.status == 0 && (once || !api.sent)) -> "Not sent: can't reach botdot. $STILL_HERE"
        api.status == 0 || api.status >= 500 -> "It may have been sent: check the chat. $STILL_HERE"
        else -> notSentBecause("botdot couldn't do that (${api.status}).") // an answer without a sentence, as the web page says it
    }
}

private fun notSentBecause(said: String) = "Not sent: $said${if (said.last() in ".!?…") "" else "."} $STILL_HERE"

/** A failed message back in the box, in front of what was typed since. */
internal fun withFailed(failed: String, typedSince: String): String =
    if (failed.isNotEmpty() && typedSince.isNotBlank()) "$failed\n$typedSince" else failed.ifEmpty { typedSince }

/** A message whose send failed, on its way back into the message box. */
data class FailedSend(val text: String, val attachments: List<Attachment>)

/**
 * What a chat's message box is told about its sends, kept by chat ("bot:<id>", or "chief" for all the Chief's chats)
 * for as long as the app runs: a send goes on after its chat was left, and a message that then fails is back in the
 * box when the chat is opened again. One message at a time: while one is under way, another sends nothing.
 *
 * Every message goes with a key ([messageKey]). A message from the box that failed keeps its key until it went or
 * the owner changes it: sent again as it is, botdot takes it once.
 */
class Outbox {
    /** A send is under way. */
    var sending by mutableStateOf(false)
        private set
    /** The line above the box: why the last send failed. It stays until the owner sends or edits. */
    var note by mutableStateOf<String?>(null)
        private set
    /** A failed message the box has not taken back yet. */
    var back by mutableStateOf<FailedSend?>(null)
        private set
    /** The message from the box that failed last, as it was sent, with its key. */
    private var failed: Pair<FailedSend, String>? = null
    /**
     * The message that is on its way, as its chat draws it from Send until botdot answered ([SentMessage]). It goes
     * with the answer: the chat has botdot's own version by then, or the message is back in the box.
     */
    var sent by mutableStateOf<SentMessage?>(null)
        private set

    /** The message on its way belongs to [chat] now: a first message, whose Chief chat was just made. */
    fun sentIn(chat: String) { sent = sent?.copy(chat = chat) }

    /**
     * Sends with [request], which gets the message's key; true once botdot took the message. When it failed, the line
     * says why, and a message from the message box ([box]) waits in [back], in front of one that already waits there.
     * A quick answer or a question card ([box] false) keeps what was tapped or typed by staying on screen, and gives
     * its own [key], the same for every send of it. A message from the box has the key it failed with when its text
     * and files are those that failed, else a new one. [once]: see [sendNote].
     *
     * From here until [request] ends the message stands in [sent], for its chat to draw: [chat] is the chat it was
     * sent in, where one outbox serves several, and [known] the ids of the owner's messages that chat had already
     * ([SentMessage]). [request] puts botdot's answer in the chat before it returns, so the two change places in one
     * step. [draw] false: these words are no message (a typed "Go on" in a group that stopped), and nothing is drawn.
     */
    suspend fun send(
        text: String, attachments: List<Attachment>, box: Boolean, key: String? = null, once: Boolean = false,
        chat: String? = null, known: Set<String> = emptySet(), draw: Boolean = true, request: suspend (String) -> Unit,
    ): Boolean {
        if (sending) {
            if (box) giveBack(text, attachments) // the box emptied for it: nothing typed is lost
            return false
        }
        val message = FailedSend(text, attachments)
        val k = key ?: failed?.takeIf { box && it.first == message }?.second ?: messageKey()
        sending = true
        note = null
        sent = if (draw) SentMessage(k, text, attachments, chat, known) else null
        try {
            request(k)
            if (box) failed = null
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (delivered(e)) { if (box) failed = null; return true }
            if (box) { giveBack(text, attachments); failed = message to k }
            note = sendNote(e, once)
            return false
        } finally {
            sending = false
            sent = null
        }
    }

    private fun giveBack(text: String, attachments: List<Attachment>) {
        back = FailedSend(withFailed(text, back?.text.orEmpty()), attachments + back?.attachments.orEmpty())
    }

    /**
     * "Take back" on a message that waits, with [request], which answers its text and files; true once it is back.
     * It then waits in [back] for the message box, as a failed send does, in front of what waits there, and the line
     * goes: what is in the box is another message now, as after an edit. When it could not be taken back the line
     * says why ([takeBackNote]), and nothing comes back: the message is where it was.
     */
    suspend fun takeBack(request: suspend () -> TakenBack): Boolean {
        try {
            val m = request()
            giveBack(m.text, m.attachments)
            edited()
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            note = takeBackNote(e)
            return false
        }
    }

    /** "Steer" on a message that waits did not go ([steerNote]): the line says why; the message waits as it did. */
    fun steerFailed(e: Throwable) { note = steerNote(e) }

    /** The box takes the failed message back. */
    fun take(): FailedSend? = back.also { back = null }

    /** The owner edited the message: the line goes, and what is in the box is a new message. */
    fun edited() { note = null; failed = null }

    companion object {
        private val byChat = mutableMapOf<String, Outbox>()
        fun of(chat: String): Outbox = synchronized(byChat) { byChat.getOrPut(chat) { Outbox() } }
    }
}
