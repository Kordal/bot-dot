package dev.botdot.app.ui

import dev.botdot.app.data.mergeNewest
import dev.botdot.app.data.takesOnce
import dev.botdot.app.data.without
import dev.botdot.app.data.withWaiting
import dev.botdot.app.data.withAnswer
import dev.botdot.app.data.stopNote
import dev.botdot.app.data.stillStarting
import dev.botdot.app.data.steered
import dev.botdot.app.data.ownWords
import dev.botdot.app.data.notSent
import dev.botdot.app.data.leftQueue
import dev.botdot.app.data.SentMessage
import dev.botdot.app.data.Outbox
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
import dev.botdot.app.data.TakenBack
import dev.botdot.app.data.Ratings
import dev.botdot.app.data.Run
import dev.botdot.app.data.ReplyDraft
import dev.botdot.app.data.RunEvent
import dev.botdot.app.data.str
import dev.botdot.app.data.statusWords
import dev.botdot.app.data.tr
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
    /**
     * The owner's messages whose turn came: they left [queued], and their runs (the same ids) are not in the chat yet,
     * which reads them again only after the feed said so. Drawn as they stood until then, without buttons: a message
     * never leaves the chat in between.
     */
    private var starting by mutableStateOf<List<Queued>>(emptyList())
    val started: List<Queued> by derivedStateOf { stillStarting(starting, all) }
    private val takenBack = HashSet<String>() // the messages this chat took back: they leave the list without starting
    private val taking = HashSet<String>() // being taken back now
    var waiting by mutableStateOf<List<InboxNote>>(emptyList()) // notes for its next run
        private set
    var loaded by mutableStateOf(false)
        private set
    private var noOlder = false
    private var loadingOlder = false

    /** The run the "New" line is drawn at: the server's first new reply when the chat came on screen. Kept until the chat is left. */
    var newFirst by mutableStateOf<String?>(null)
        private set

    /** The run the owner picked Reply on (#627), until the message goes or ✕: [text] names its block's request. */
    data class Replying(val runId: String, val text: String)
    var replying by mutableStateOf<Replying?>(null)

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
        viewModelScope.launch {
            app.store.bots.value.collect { bots ->
                bots?.firstOrNull { it.id == botId }?.let { b ->
                    val left = leftQueue(starting, queued, b.queued, taking + takenBack)
                    queued = b.queued
                    if (left.size > starting.size) { starting = left; viewModelScope.launch { findStarted() } }
                }
            }
        }
        // What changed for this bot: its newest runs again, once a burst is over.
        viewModelScope.launch {
            app.feed.events.collect { ev ->
                when {
                    ev.type == "reset" -> load()
                    // Its plan as it changes (#629): from the feed too, which reconnects, so a run's stream that
                    // dropped leaves no plan behind. On the running run as this chat holds it; nothing is read again.
                    ev.type == "run_plan" && ev.data.str("botId") == botId -> ev.data.str("runId").let { id ->
                        val plan = ev.data["plan"]?.takeIf { it !is kotlinx.serialization.json.JsonNull }
                        all = all.map { if (it.id == id && it.isRunning) it.copy(planValue = plan) else it }
                    }
                    // Its steps so far, rows and all (#633), each time it takes one: an open step line grows as it goes.
                    ev.type == "run_steps" && ev.data.str("botId") == botId -> ev.data.str("runId").let { id ->
                        val steps = (ev.data["steps"] as? JsonObject) ?: return@let
                        if (all.any { it.id == id && it.isRunning && it.stepsValue != steps }) all = all.map { if (it.id == id && it.isRunning) it.copy(stepsValue = steps) else it }
                    }
                    ev.type.startsWith("run_") && ev.data.str("botId") == botId -> kicks.tryEmit(Unit)
                    ev.type == "bot_message" && (ev.data["to"] as? JsonObject)?.str("id") == botId -> kicks.tryEmit(Unit)
                    ev.type == "notes_held" && ev.data.str("botId") == botId -> kicks.tryEmit(Unit) // the wake gate held a note (ADR 083)
                    // While it works, a card came, went or changed: an action in a connected app may have begun or
                    // ended its wait for the owner's OK, which the run says in this list (`waitingFor`).
                    ev.type == "asks" && all.any { it.isRunning } -> kicks.tryEmit(Unit)
                }
            }
        }
        viewModelScope.launch { kicks.debounce(250).collect { refresh() } }
    }

    /** The runs of the messages that started, into the chat: one botdot has no run for (taken back elsewhere) goes. */
    private suspend fun findStarted() {
        refresh()
        val a = app.api.value
        for (q in stillStarting(starting, all)) {
            val run = runCatching { a?.run(q.id) }.getOrNull()
            if (run != null && run.id == q.id && !run.isQueued) all = withAnswer(all, run)
            else starting = starting.filterNot { it.id == q.id }
        }
        starting = stillStarting(starting, all)
    }

    /** The newest page, from scratch. */
    suspend fun load() {
        val a = app.api.value ?: return
        val (r, w) = coroutineScope { async { runCatching { a.runs(botId, PAGE) } } to async { runCatching { a.inbox(botId) } } }
        r.await().onSuccess { all = it; noOlder = it.size < PAGE; loaded = true; follow() }.onError { _notes.tryEmit(it.message ?: tr("Couldn't load")) }
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
    fun send(text: String, attachments: List<Attachment>, box: Boolean = true, key: String? = null, replyTo: String? = null, answers: String? = null): Deferred<Boolean> {
        var waits = false // the answer was a message that waits its turn: it is in the bot's list, not among its runs
        val known = ownWords(all, queued).mapTo(HashSet()) { it.id }
        // Begun in the tap itself: the message is in the chat before anything else is drawn.
        return app.scope.async(start = CoroutineStart.UNDISPATCHED) {
            outbox.send(text, attachments, box, key, once = takesOnceIn(app), known = known) { k ->
                val run = (app.api.value ?: throw ApiException(NOT_CONNECTED)).runBot(botId, text, attachments, k, replyTo, answers)
                if (replyTo != null && replying?.runId == replyTo) replying = null
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

    /**
     * "Take back" on a message that waits: it leaves the server, and its text and files are in the message box
     * again, as after a failed send. When it has started meanwhile, the box's line says so and the chat shows its run.
     */
    fun takeBack(q: Queued) {
        if (!taking.add(q.id)) return
        val taken = app.scope.async { outbox.takeBack { (app.api.value ?: throw ApiException(NOT_CONNECTED)).takeBack(botId, q.id) } }
        viewModelScope.launch {
            // Gone from the list the app keeps, before the server's list says so: this chat's follows it.
            if (taken.await()) { takenBack.add(q.id); app.store.bots.update { all -> all.map { if (it.id == botId) it.copy(queuedValue = without(it.queuedValue, q.id)) else it } } }
            taking.remove(q.id)
            refresh(); app.store.bots.refresh()
        }
    }

    /** "Run now" under the notes that wait (#225): the bot starts with them, or once it is free; the chat says which. */
    fun runNotes() {
        viewModelScope.launch {
            try {
                val r = (app.api.value ?: throw ApiException(NOT_CONNECTED)).runNotes(botId)
                if (r.status == "queued") _notes.tryEmit(tr("It's busy: it reads them once it's free."))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _notes.tryEmit(e.message ?: tr("Couldn't start it"))
            }
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
        stop(r.id)
    }

    /** Stop one of its runs: Stop in its block (RunBlock). */
    fun stop(runId: String) {
        viewModelScope.launch {
            _notes.tryEmit(stopNote(runCatching { (app.api.value ?: throw ApiException(NOT_CONNECTED)).stopRun(runId) }))
            refresh()
        }
    }

    /** The reply of each run at work as it is written so far, by its run (ReplyDraft): drawn in its place. */
    var drafts by mutableStateOf<Map<String, String>>(emptyMap())
        private set

    // Follow every run that's going on now (a message to a busy bot starts beside the run that is going, ADR 062):
    // what each attaches, its line as it changes, its draft, its end.
    private val streams = mutableMapOf<String, Job>()
    private fun follow() {
        // The lines of its runs that still go on, as this list has them; those of runs that ended go.
        app.store.lines.sync(OpeningLine.live(all, app.store.lines.features)) { it == "bot:$botId" }
        val going = all.filter { it.isRunning }
        val ids = going.map { it.id }.toSet()
        // The runs that ended: their streams go, and their drafts, whose replies stand in their place.
        streams.keys.filter { it !in ids }.forEach { streams.remove(it)?.cancel() }
        if (drafts.keys.any { it !in ids }) drafts = drafts.filterKeys { it in ids }
        for (r in going) {
            if (streams[r.id]?.isActive == true) continue // a stream that dropped while the run goes on is followed again
            streams[r.id] = viewModelScope.launch {
                runCatching {
                    app.api.value?.runStream(r.id)?.collect { ev ->
                        when (ev) {
                            is RunEvent.Step -> Unit // a working bot is its status line: the steps are in the run's details
                            is RunEvent.Text -> Unit // the reply shows when it's done, or grows as its draft
                            is RunEvent.Draft -> if (ReplyDraft.shows(app.store.version.value.value?.features)) drafts = if (ev.text.isEmpty()) drafts - r.id else drafts + (r.id to ev.text)
                            is RunEvent.End -> kicks.tryEmit(Unit) // the draft stays until the reply that takes its place is read (follow)
                            is RunEvent.File -> kicks.tryEmit(Unit) // show it now: a QR code to scan can't wait for the reply
                            is RunEvent.Line -> app.store.lines.streamed("bot:$botId", ev, r.id)
                            // Its plan as it changes: on the run as this chat holds it, until the run is read again.
                            is RunEvent.Planned -> all = all.map { if (it.id == r.id) it.copy(planValue = ev.value?.takeIf { v -> v !is kotlinx.serialization.json.JsonNull }) else it }
                        }
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
