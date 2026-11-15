package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.datetime.toLocalDateTime

/**
 * One run as a chat draws it: what started it ([asked] the owner's words, or a [chip]: a job, a schedule, the main
 * assignment) and what came of it ([reply] Markdown, the [draft] while it works, [ended] when it did not finish), as
 * Android's bot chat decides them (ui/BotChatScreen.kt YourSide, TheirSide).
 */
class RunView(
    val run: Run,
    /** The owner's own message, with its files; null when they asked nothing in words. */
    val asked: String?,
    val askedFiles: List<Attachment>,
    /** What started it when it was not the owner's words: "Morning mail · 07:00", "⏰ Scheduled run · 07:00", … */
    val chip: String?,
    /** It is working: its line says what it does ([line]); its reply as written so far stands in [draft]. */
    val working: Boolean,
    val line: String,
    val draft: String?,
    /** The reply, Markdown ("Done." for an empty one with nothing else to show). */
    val reply: String?,
    /** What a run that did not finish says, and whether it is a problem (drawn as one) or only "Stopped.". */
    val ended: String?,
    val problem: Boolean,
    /** The files it attached to its reply. */
    val files: List<Attachment>,
)

/** Everything a bot's chat draws, at one moment. */
class BotChatState(
    val bot: Bot?,
    /** A file path in its replies opens in the viewer (`document-viewer` and chat files, [DocumentView.opensChatFiles]). */
    val opensFiles: Boolean = false,
    /** Newest first. */
    val runs: List<RunView>,
    /** The owner's messages that wait until the bot is free, oldest first (with the "Take back" and "Steer" buttons). */
    val queued: List<Queued>,
    /** Messages whose turn came, until their runs are in the chat: drawn as they stood, without buttons. */
    val started: List<Queued>,
    val loaded: Boolean,
    /** A run is going: Stop is offered. */
    val running: Boolean,
    /**
     * Stop takes Send's place in the message box ([boxStops]): this botdot takes no message while one works. Else
     * Send stays and each working line has its own Stop, as on Android.
     */
    val boxStops: Boolean,
    /** The owner's message on its way, drawn until the server's version of it is in the chat. */
    val sent: SentMessage?,
    val sending: Boolean,
    /** The line above the message box: why the last send failed, until the owner sends or edits. */
    val note: String?,
    /** A message that failed and waits for the box to take it back (the box puts it back). */
    val back: FailedSend?,
    /** Files picked for the next message, uploaded. */
    val files: List<Attachment>,
    val uploading: Boolean,
    /** Something to say once at the bottom of the screen ("Couldn't load", "Stopping…"), with a count that tells a new one. */
    val notice: String?,
    val noticeCount: Int,
    /** Above the message box while a reply is picked ([BotChat.replyTo]): "Reply to: Plan my week"; null for none. */
    val replying: String? = null,
)

/**
 * A bot's chat, kept while it is on screen, for both phones (ADR 242): its newest runs first, older ones as it is
 * scrolled up, what waits, the message on its way and what a failed send keeps, the drafts of its runs at work, and
 * Stop. It follows the live feed's [events] for this bot. The rules are Android's BotChatModel's (ui/ChatModels.kt);
 * Android's BotChatModel moves onto this in #1391.
 */
@OptIn(FlowPreview::class)
class BotChat(
    private val scope: CoroutineScope,
    private val api: Api,
    private val store: Store,
    private val events: Flow<FeedEvent>,
    val botId: String,
) {
    private var all: List<Run> = emptyList() // newest first, quiet ones too (they anchor the pages)
    private var queued: List<Queued> = emptyList()
    private var starting: List<Queued> = emptyList()
    private val takenBack = HashSet<String>()
    private val taking = HashSet<String>()
    private var loaded = false
    private var noOlder = false
    private var loadingOlder = false
    private var drafts: Map<String, String> = emptyMap()
    private var files: List<Attachment> = emptyList()
    /** The run the next message replies to (#627), and its first line. */
    private var replying: Pair<String, String>? = null
    private var uploading = false
    private var notice: String? = null
    private var noticeCount = 0
    private val outbox = Outbox.of("bot:$botId")
    private val kicks = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private val jobs = mutableListOf<Job>()
    private var stopped = false

    // After every field it reads: Kotlin sets a class's properties in order.
    private val _state = MutableStateFlow(snapshot())
    val state: StateFlow<BotChatState> = _state

    /** Calls [onChange] with the chat now and after every change, on the scope's thread. */
    fun watch(onChange: (BotChatState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    /** The chat came on screen: its newest page, what waits for it, and the feed's events for it. */
    fun start() {
        if (jobs.isNotEmpty()) return
        stopped = false
        jobs += scope.launch { load() }
        jobs += scope.launch {
            store.bots.value.collect { bots ->
                bots?.firstOrNull { it.id == botId }?.let { b ->
                    val left = leftQueue(starting, queued, b.queued, taking + takenBack)
                    queued = b.queued
                    if (left.size > starting.size) { starting = left; scope.launch { findStarted() } }
                    publish()
                }
            }
        }
        jobs += scope.launch {
            events.collect { ev ->
                when {
                    ev.type == "reset" -> load()
                    ev.type.startsWith("run_") && ev.data.str("botId") == botId -> kicks.tryEmit(Unit)
                    ev.type == "bot_message" && (ev.data["to"] as? kotlinx.serialization.json.JsonObject)?.str("id") == botId -> kicks.tryEmit(Unit)
                    ev.type == "notes_held" && ev.data.str("botId") == botId -> kicks.tryEmit(Unit)
                    ev.type == "asks" && all.any { it.isRunning } -> kicks.tryEmit(Unit)
                }
            }
        }
        jobs += scope.launch { kicks.debounce(250).collect { refresh() } }
    }

    /** The chat was left: what it follows stops (a send under way goes on). */
    fun stop() {
        stopped = true
        jobs.forEach { it.cancel() }
        jobs.clear()
        streams.values.forEach { it.cancel() }
        streams.clear()
    }

    /** The newest page, from scratch. */
    @Throws(Exception::class)
    suspend fun load() {
        val r = runCatching { api.runs(botId, PAGE) }
        r.exceptionOrNull()?.let { if (it is CancellationException) throw it }
        r.onSuccess { all = it; noOlder = it.size < PAGE; loaded = true; follow() }.onFailure { say(it.message ?: tr("Couldn't load")) }
        publish()
    }

    /** Only its newest runs, put in place of what the chat had (pull to refresh, the feed). */
    @Throws(Exception::class)
    suspend fun refresh() {
        if (!loaded) return load()
        val fresh = runCatching { api.runs(botId, NEWEST) }.getOrNull() ?: return
        all = mergeNewest(all, fresh, NEWEST) ?: return load() // more new runs than one look brings: start over
        follow()
        publish()
    }

    /** The next page of older runs: the chat was scrolled to its top. */
    fun loadOlder() {
        if (noOlder || loadingOlder || !loaded) return
        val oldest = all.lastOrNull()?.id ?: return
        loadingOlder = true
        scope.launch {
            runCatching { api.runs(botId, PAGE, before = oldest) }.onSuccess { page ->
                val known = all.mapTo(HashSet()) { it.id }
                // An older botdot sends the newest again: nothing older to show then.
                if (page.isEmpty() || page.first().id in known) noOlder = true
                else { all = all + page.filter { it.id !in known }; noOlder = page.size < PAGE }
            }.onFailure { say(it.message ?: tr("The connection dropped")) } // scrolling back up asks again
            loadingOlder = false
            publish()
        }
    }

    /**
     * Sends [text] with the picked files; true once it went. When it failed the message waits in [BotChatState.back]
     * for the box, and the line says why. The request outlives the chat's screen.
     */
    @Throws(Exception::class)
    suspend fun send(text: String): Boolean {
        // Out of the box with the message, as Android's box takes them: a failed send gives them back (takeFailed),
        // and a file picked meanwhile stays for the next message.
        val attachments = files
        files = emptyList()
        val known = ownWords(all, queued).mapTo(HashSet()) { it.id }
        val replyTo = replying?.first
        var waits = false
        val went = outbox.send(text, attachments, box = true, once = takesOnce(store.version.value.value?.features), known = known) { k ->
            publish() // the message on its way is drawn at once
            val run = api.runBot(botId, text, attachments, k, replyTo = replyTo)
            waits = run.isQueued
            took(run, text, attachments)
        }
        if (went && replyTo != null && replying?.first == replyTo) replying = null
        publish()
        refresh()
        if (waits) store.bots.refresh()
        return went
    }

    /**
     * Whether [runId] takes a reply (#627, `reply-to`): a run of the bot's own work, not a script's, a side question or
     * one still waiting.
     */
    fun replies(runId: String): Boolean {
        if ("reply-to" !in store.version.value.value?.features.orEmpty()) return false
        val r = all.firstOrNull { it.id == runId } ?: return false
        return r.kind != "script" && !r.btw && !r.isQueued
    }

    /** "Reply to this task": the next message replies to [runId], its first line above the box until it is sent. */
    fun replyTo(runId: String) {
        if (!replies(runId)) return
        val r = all.first { it.id == runId }
        replying = runId to RunSteps.firstLine(r.prompt).ifEmpty { tr("this task") }
        publish()
    }

    /** ✕ on the reply above the box: the next message is a new one. */
    fun clearReply() { replying = null; publish() }

    /** The box took the failed message back: its text is returned, its files are picked again. */
    fun takeFailed(): String? {
        val back = outbox.take() ?: return null
        files = back.attachments + files.filterNot { it in back.attachments }
        publish()
        return back.text
    }

    /** The chat was left with [typed] in the box, not sent (#1068): it is kept for when the chat opens again. */
    fun leave(typed: String) = outbox.leave(typed)

    /** What was typed and not sent when the chat was last left, once; "" for none. */
    fun takeUnsent(): String = outbox.takeUnsent()

    /** The owner edited the message: the line goes. */
    fun edited() { outbox.edited(); publish() }

    /** A picked file (Photos, Files): uploaded for the next message; what failed says so. */
    @Throws(Exception::class)
    suspend fun attach(file: OutgoingFile) {
        uploading = true
        publish()
        try {
            pick(api.upload(file, "bot:$botId"))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say("${file.name}: ${e.message ?: tr("Couldn't upload")}")
        } finally {
            uploading = false
            publish()
        }
    }

    /** A file uploaded for the next message. */
    internal fun pick(file: Attachment) { files = files + file; publish() }

    /** A picked file the phone couldn't read or copy ([name]): said as an upload that failed is ("name: why"). */
    fun attachFailed(name: String) = say("$name: ${tr("Couldn't read that file.")}")

    /** A picked file the owner took off the message before sending. */
    fun drop(file: Attachment) { files = files - file; publish() }

    /** "Take back" on a message that waits: it leaves the server and its words come back in the box. */
    fun takeBack(q: Queued) {
        if (!taking.add(q.id)) return
        scope.launch {
            if (outbox.takeBack { api.takeBack(botId, q.id) }) {
                takenBack.add(q.id)
                store.bots.update { bots -> bots.map { if (it.id == botId) it.copy(queuedValue = without(it.queuedValue, q.id)) else it } }
            }
            taking.remove(q.id)
            publish()
            refresh(); store.bots.refresh()
        }
    }

    /** Stop the run [runId] (its working line's Stop), or the one that is going (the message box's). */
    fun stopRun(runId: String? = null) {
        val r = all.firstOrNull { it.isRunning && (runId == null || it.id == runId) } ?: return
        scope.launch {
            say(stopNote(runCatching { api.stopRun(r.id) }))
            refresh()
        }
    }

    private suspend fun findStarted() {
        refresh()
        for (q in stillStarting(starting, all)) {
            val run = runCatching { api.run(q.id) }.getOrNull()
            if (run != null && run.id == q.id && !run.isQueued) all = withAnswer(all, run)
            else starting = starting.filterNot { it.id == q.id }
        }
        starting = stillStarting(starting, all)
        publish()
    }

    private fun took(run: Run, text: String, attachments: List<Attachment>) {
        if (!run.isQueued) { all = withAnswer(all, run); follow(); publish(); return }
        val q = Queued(run.id, text, attachments)
        queued = withWaiting(queued, q)
        store.bots.update { bots -> bots.map { if (it.id == botId) it.copy(queuedValue = withWaiting(it.queuedValue, q)) else it } }
        publish()
    }

    // Each run that goes on now is followed: its line, its draft, its end.
    private val streams = mutableMapOf<String, Job>()
    private fun follow() {
        // Left: a send, a take back or a turn that ends after it follows no run, so no stream outlives the screen.
        if (stopped) return
        store.lines.sync(OpeningLine.live(all, store.lines.features)) { it == "bot:$botId" }
        val ids = all.filter { it.isRunning }.map { it.id }.toSet()
        streams.keys.filter { it !in ids }.forEach { streams.remove(it)?.cancel() }
        if (drafts.keys.any { it !in ids }) drafts = drafts.filterKeys { it in ids }
        for (id in ids) {
            if (streams[id]?.isActive == true) continue
            streams[id] = scope.launch {
                runCatching {
                    api.runStream(id).collect { ev ->
                        when (ev) {
                            is RunEvent.Draft -> if (ReplyDraft.shows(store.version.value.value?.features)) { drafts = if (ev.text.isEmpty()) drafts - id else drafts + (id to ev.text); publish() }
                            is RunEvent.End, is RunEvent.File -> kicks.tryEmit(Unit)
                            is RunEvent.Line -> { store.lines.streamed("bot:$botId", ev, id); publish() }
                            else -> Unit
                        }
                    }
                }
            }
        }
    }

    private fun say(words: String) { notice = words; noticeCount++; publish() }

    private fun publish() { _state.value = snapshot() }

    private fun snapshot(): BotChatState {
        val runs = all.filterNot { it.quiet || it.isQueued }
        val features = store.version.value.value?.features
        val line = store.lines.lines.value["bot:$botId"]
        return BotChatState(
            bot = store.bots.value.value?.firstOrNull { it.id == botId },
            opensFiles = DocumentView.opensChatFiles(features),
            runs = runs.map { view(it, features, line) },
            queued = queued,
            started = stillStarting(starting, all),
            loaded = loaded,
            running = runs.any { it.isRunning },
            boxStops = boxStops(runs.any { it.isRunning }, features),
            sent = outbox.sent?.unlessIn(ownWords(all, queued)),
            sending = outbox.sending,
            note = outbox.note,
            back = outbox.back,
            files = files,
            uploading = uploading,
            notice = notice,
            noticeCount = noticeCount,
            replying = replying?.let { tr("Reply to: {text}", "text" to it.second) },
        )
    }

    private fun view(r: Run, features: Collection<String>?, line: String?): RunView {
        val asked = Unread.asked(r)
        val chip = when (asked) {
            Unread.Asked.JOB -> "${Unread.jobChip(r)} · ${chatClock(r.startedAt)}"
            Unread.Asked.SCHEDULE -> "⏰ " + tr("Scheduled run") + " · ${chatClock(r.startedAt)}"
            Unread.Asked.USUAL -> "▶ " + tr("Ran its main assignment")
            else -> null
        }
        val ended = if (r.status == "running" || r.status == "success" || r.isRunning) null else endedWords(r, features)
        val nothingElse = r.files.isNullOrEmpty() && r.pages.isEmpty() && r.reconnect.isEmpty()
        return RunView(
            run = r,
            asked = if (asked == Unread.Asked.MINE) r.prompt else null,
            askedFiles = if (asked == Unread.Asked.MINE) r.attachments.orEmpty() else emptyList(),
            chip = chip,
            working = r.isRunning,
            line = if (r.isRunning) OpeningLine.status(line, working = true) else "",
            draft = drafts[r.id]?.let { markdownDraft(it) },
            reply = if (r.status == "success") r.result.orEmpty().ifBlank { if (nothingElse) tr("Done.") else "" } else null,
            ended = ended?.text,
            problem = ended is Ended.Problem,
            files = r.files.orEmpty(),
        )
    }

    companion object {
        const val PAGE = 40
        const val NEWEST = 8
    }
}

/** A draft as it can be drawn while it grows (the Markdown package's draftSource). */
private fun markdownDraft(text: String): String = dev.botdot.app.markdown.draftSource(text)

/** A message's time in a chat: "13:52" today, "5 Oct, 13:52" another day (Android's shortTime); "" for none. */
fun chatClock(iso: String?): String = runCatching {
    val at = kotlin.time.Instant.parse(iso ?: return "")
    val zone = kotlinx.datetime.TimeZone.currentSystemDefault()
    val today = kotlin.time.Clock.System.now().toLocalDateTime(zone).date
    if (at.toLocalDateTime(zone).date == today) formatDate(at, "HH:mm", null, zone) else formatDate(at, "d MMM, HH:mm", I18n.language, zone)
}.getOrDefault("")
