package dev.botdot.app.ui

import dev.botdot.app.data.takesOnce
import dev.botdot.app.data.without
import dev.botdot.app.data.withAnswer
import dev.botdot.app.data.stopNote
import dev.botdot.app.data.steered
import dev.botdot.app.data.ownWords
import dev.botdot.app.data.notSent
import dev.botdot.app.data.SentMessage
import dev.botdot.app.data.Outbox
import dev.botdot.app.data.BotChat
import dev.botdot.app.data.PlanView
import dev.botdot.app.data.ReplyingTo
import dev.botdot.app.data.NOT_CONNECTED
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
import dev.botdot.app.data.Ratings
import dev.botdot.app.data.Run
import dev.botdot.app.data.ReplyDraft
import dev.botdot.app.data.str
import dev.botdot.app.data.tr
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * A bot's chat on screen, kept while it's open (and while the phone turns): the shared [BotChat] has its runs, the
 * notes waiting for its next run, what it's doing now and every rule of sending, taking back and stopping (ADR 242),
 * and this reads its [state] for the screen. What is its own is the files attached in the message box, which are
 * Android's (a Uri, and a line for each while it uploads).
 */
class BotChatModel(private val app: BotDotApp, val botId: String) : ViewModel() {
    // The app's scope, not the screen's: a send, a Take back or a Stop goes on when the chat is left.
    private val chat = BotChat(app.scope, { app.api.value }, app.store, app.feed.events, botId, app.plans)
    private val own = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** Something to say at the bottom of the screen ("Couldn't send…"). */
    val notes: Flow<String> = merge(chat.notices, own)

    val files = PendingFiles(viewModelScope, app, { app.api.value }, { "bot:$botId" }) { own.tryEmit(it) }
    private var sharedTaken = false
    /** Files shared from another app: into the message box once (not again when the phone turns). */
    fun addShared(uris: List<Uri>) { if (!sharedTaken && uris.isNotEmpty()) { sharedTaken = true; files.add(uris) } }

    /** The chat as the shared [BotChat] says it. Each part below changes the screen only when it changes itself. */
    var state by mutableStateOf(chat.state.value)
        private set
    /** Its runs as the chat shows them (quiet ones are only in its run history, and one that waits is in [queued], not a run yet). */
    val runs: List<Run> by derivedStateOf { state.shown }
    /** The owner's messages that wait until the bot is free, oldest first: the server's list (`queued` on the bot). */
    val queued: List<Queued> by derivedStateOf { state.queued }
    /** The owner's messages whose turn came, until their runs are in the chat: drawn as they stood, without buttons. */
    val started: List<Queued> by derivedStateOf { state.started }
    /** Notes for its next run. */
    val waiting: List<InboxNote> by derivedStateOf { state.waiting }
    /** What it watches (ADR 248). */
    val watches: List<dev.botdot.app.data.Watch> by derivedStateOf { state.watches }
    val loaded: Boolean by derivedStateOf { state.loaded }
    /** The run the "New" line is drawn at: the server's first new reply when the chat came on screen. Kept until the chat is left. */
    val newFirst: String? by derivedStateOf { state.newFirst }
    /** The reply of each run at work as it is written so far, by its run (ReplyDraft): drawn in its place. */
    val drafts: Map<String, String> by derivedStateOf { state.drafts }
    /** The run the owner picked Reply on (#627), until the message goes or ✕. */
    val reply: ReplyingTo? by derivedStateOf { state.reply }
    /** The owner's message on its way, drawn until the server's version of it is in the chat ([SentMessage]). */
    val sent: SentMessage? by derivedStateOf { state.sent }
    /** Its plan above the message box (docs/api.md, "The plan"), and whether it is folded to its one line. */
    val plan: PlanView? by derivedStateOf { state.plan?.view }
    val planFolded: Boolean by derivedStateOf { state.plan?.folded ?: false }

    /** What its message box is told about a send: under way, failed and why, the message to take back. */
    val outbox get() = chat.outbox

    init {
        viewModelScope.launch { chat.state.collect { state = it } }
        // Nothing is asked before the app is connected.
        viewModelScope.launch { app.api.filterNotNull().first(); chat.start() }
    }

    override fun onCleared() { chat.stop() }

    /**
     * The chat came on screen, with the app in front: the line goes where the server says the new replies begin now,
     * asked before the app reports the chat as read. True when the line was placed or moved.
     */
    suspend fun arrive(): Boolean = chat.arrive()

    /** The chat was left: its line goes. */
    fun leave() = chat.clearNew()

    /** Waits for the chat, and brings in the run the line is at: a reply from while the app was away, or an older page. */
    suspend fun reachNew(): Boolean = chat.reachNew()

    /** Older pages until this run is in the chat (a search match), a few at most. True when it is. */
    suspend fun reach(runId: String): Boolean = chat.reach(runId)

    /** Only its newest runs, put in place of what the chat had. */
    suspend fun refresh() = chat.refresh()

    /** The next page of older runs (the chat was scrolled up). */
    fun loadOlder() = chat.loadOlder()

    /** What it watches: Stop on one. */
    fun stopWatch(id: String) = chat.stopWatch(id)

    /**
     * Sends a message; true once it went. [box]: it came from the message box, and goes back there when it failed.
     * The request outlives this chat's screen: leaving the chat neither stops it nor loses a message it could not send.
     */
    fun send(text: String, attachments: List<Attachment>, box: Boolean = true, key: String? = null, replyTo: String? = null, answers: String? = null): Deferred<Boolean> =
        // Begun in the tap itself: the message is in the chat before anything else is drawn.
        app.scope.async(start = CoroutineStart.UNDISPATCHED) { chat.submit(text, attachments, box, key, replyTo, answers) }

    /** "Take back" on a message that waits: it leaves the server, and its text and files are in the message box again. */
    fun takeBack(q: Queued) = chat.takeBack(q)

    /** "Steer" on a message that waits (ADR 040). */
    fun steer(q: Queued) = chat.steer(q)

    /** "Run now" under the notes that wait (#225). */
    fun runNotes() = chat.runNotes()

    /** Stop the run that is going: the message box's. */
    fun stop() = chat.stopRun()

    /** Stop one of its runs: Stop in its block (RunBlock). */
    fun stop(runId: String) = chat.stopRun(runId)

    /** Whether [runId] takes a reply (`reply-to`, #627). */
    fun replies(runId: String): Boolean = chat.replies(runId)

    /** "Reply" on a block: the next message replies to its newest round. */
    fun replyTo(runId: String) = chat.replyTo(runId)

    /** ✕ on the reply above the box. */
    fun clearReply() = chat.clearReply()

    /** The plan's dock folded to its one line, or open. */
    fun foldPlan(folded: Boolean) = chat.foldPlan(folded)

    /** A stopped plan's Dismiss. */
    fun dismissPlan() = chat.dismissPlan()
}

/** How long a chat that came on screen waits for botdot to say what is new in it, before it goes by what the app knows. */
private const val ASK_MS = 3_000L


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
            .onError { _notes.tryEmit(it.message ?: tr("Couldn't load")) }
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
        }.onError { _notes.tryEmit(it.message ?: tr("Couldn't load")) }
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
            outbox.send(text, attachments, box, key, once = takesOnceIn(app), chat = chatId, known = known) { k ->
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
            runCatching { (app.api.value ?: throw ApiException(tr("Not connected to botdot"))).rate(c.id, index, rating) }.onError {
                chat?.takeIf { it.id == c.id }?.let { now -> chat = Ratings.undo(now, index, rating, before) }
                _notes.tryEmit(tr("Couldn't save your rating"))
            }
        }
    }

    fun stop() {
        chatId?.let { id ->
            viewModelScope.launch {
                _notes.tryEmit(stopNote(runCatching { (app.api.value ?: throw ApiException(NOT_CONNECTED)).stopChief(id) }))
                refresh()
            }
        }
    }
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
            if (id == null) { activity.clear(); draft = "" }
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
                        // Its plan as it changes: on the pending reply as this chat holds it, until the chat is read again.
                        "plan" -> chat = chat?.let { c -> c.copy(messages = c.messages.map { m -> if (m.pending && m.role == "chief") m.copy(planValue = o["plan"]?.takeIf { it !is kotlinx.serialization.json.JsonNull }) else m }) }
                        "done" -> { activity.clear(); app.store.lines.end("chief:$id") } // the reply is here, or it couldn't finish; its draft stands until it is read
                        "action" -> kick(whole = false) // persisted actions are clickable even while the Chief waits
                        "steered" -> kick(whole = false) // the reply read a message the owner steered into it (ADR 040)
                        "btw" -> kick(whole = false) // a "/btw" answer above the reply (#386)
                    }
                }
            }
            following = null
            refresh(whole = chat?.messages?.any { it.draft != null } == true) // it's done: its reply, and a mail draft's card before it may have folded or been kept
        }
    }

    companion object {
        const val PAGE = 40
        const val TAIL = 6 // the last few can still change (a reply finishing, its actions)
    }
}

private fun takesOnceIn(app: BotDotApp): Boolean = takesOnce(app.store.version.value.value?.features)
