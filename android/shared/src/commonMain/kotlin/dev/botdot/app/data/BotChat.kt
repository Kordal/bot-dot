package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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
    /**
     * Its quick answers, while they can be answered ([BotChat.answer]): under the bot's open question, or the newest
     * reply when it asks none; [yes] is the one that says yes, filled with the bot's colour (-1 for none).
     */
    val choices: List<String> = emptyList(),
    val yes: Int = -1,
    /** The small × after [choices] is offered ([QuickAnswers]), and the owner put them away: drawn without them, with Undo for [QuickAnswers.UNDO_MS]. */
    val canDismiss: Boolean = false,
    val dismissed: Boolean = false,
    /** Several questions at once there: a box and its choices under each ([BotChat.answerQuestions]). */
    val questions: List<String> = emptyList(),
    val questionChoices: List<List<String>> = emptyList(),
    /** Its step line ([RunSteps.shows]; Android's StepLine), with its steps to unfold; null where it has none. */
    val steps: StepLine? = null,
    /** The pages it made or changed, a chip each under its reply that opens it ([Pages.chips]). */
    val pages: List<PageRef> = emptyList(),
    /** What it learned, a chip each under its reply ([LearnedChips]). */
    val learned: List<LearnedChip> = emptyList(),
)

/** A run's step line (#625, #636): [label] in words, [count] steps so far, [held] while it waits for an OK, its [timeline]. */
class StepLine(val label: String, val now: String, val count: Int, val held: Boolean, val timeline: List<RunSteps.Row>)

/** Everything a bot's chat draws, at one moment. */
class BotChatState(
    val bot: Bot?,
    /** A file path in its replies opens in the viewer (`document-viewer` and chat files, [DocumentView.opensChatFiles]). */
    val opensFiles: Boolean = false,
    /** The runs as botdot sent them, newest first, quiet ones and those that wait left out: what a screen that draws a run itself reads. */
    val shown: List<Run> = emptyList(),
    /** How [runs] are made: only when read, so a screen that draws [shown] itself pays for no view of each run. */
    views: () -> List<RunView>,
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
    /** The dock above the message box: its run at work's plan, or its newest run's that stopped before its plan was done. */
    val plan: DockPlan? = null,
    /** The run the next message replies to and the first line of its block's request, as [replying] says it unformatted. */
    val reply: ReplyingTo? = null,
    /** The notes waiting for its next run (the bot's inbox); an older botdot has none. */
    val waiting: List<InboxNote> = emptyList(),
    /** What it watches (ADR 248); an older botdot has none. */
    val watches: List<Watch> = emptyList(),
    /** The run the "New" line is drawn at: the server's first new reply when the chat came on screen ([BotChat.arrive]). */
    val newFirst: String? = null,
    /** The reply of each run at work as it is written so far, by its run id, as the server sent it. */
    val drafts: Map<String, String> = emptyMap(),
) {
    /** Each run of [shown] as a chat draws it. */
    val runs: List<RunView> by lazy(views)
}

/** The run the next message replies to (#627), until the message goes or ✕: [text] names its block's request. */
data class ReplyingTo(val runId: String, val text: String)

/**
 * A bot's chat, kept while it is on screen, for both phones (ADR 242): its newest runs first, older ones as it is
 * scrolled up, what waits, the message on its way and what a failed send keeps, the drafts of its runs at work, and
 * Stop. It follows the live feed's [events] for this bot. Android's BotChatModel (ui/ChatModels.kt) is a thin adapter
 * of this: it reads [state] and calls what the owner does, and the files picked in its message box are its own.
 * [apiOf] is botdot as the app has it now (null while it is not connected); a [scope] that outlives the screen lets a
 * send, a Take back or a Stop go on when the chat is left.
 */
@OptIn(FlowPreview::class)
class BotChat(
    private val scope: CoroutineScope,
    private val apiOf: () -> Api?,
    private val store: Store,
    private val events: Flow<FeedEvent>,
    val botId: String,
    /** Each chat's plan fold and the stopped plans dismissed, on this phone. */
    private val plans: PlanMemory = PlanMemory(),
) {
    constructor(scope: CoroutineScope, api: Api, store: Store, events: Flow<FeedEvent>, botId: String, plans: PlanMemory = PlanMemory()) :
        this(scope, { api }, store, events, botId, plans)

    private val api: Api get() = apiOf() ?: throw ApiException(NOT_CONNECTED)
    private val planChat = "bot:$botId"
    private var all: List<Run> = emptyList() // newest first, quiet ones too (they anchor the pages)
    private var queued: List<Queued> = emptyList()
    private var waiting: List<InboxNote> = emptyList()
    private var watches: List<Watch> = emptyList()
    private var newFirst: String? = null
    private var starting: List<Queued> = emptyList()
    private val takenBack = HashSet<String>()
    private val taking = HashSet<String>()
    private var loaded = false
    private var noOlder = false
    private var loadingOlder = false
    private var drafts: Map<String, String> = emptyMap()
    private var files: List<Attachment> = emptyList()
    /** The run the next message replies to (#627), and its first line. */
    private var replying: ReplyingTo? = null
    private var uploading = false
    private var notice: String? = null
    private var noticeCount = 0
    // What the owner chose with the small × here, by run: it wins over a list the server has not changed yet.
    private val choicesPut = HashMap<String, Boolean>()
    private val _notices = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** Every [BotChatState.notice] as it is said, none missed when two come at once. */
    val notices: SharedFlow<String> = _notices
    /** What its message box is told about a send: under way, failed and why, the message to take back. */
    val outbox = Outbox.of("bot:$botId")
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
                    // Its plan as it changes (#629): from the feed too, which reconnects, so a run's stream that
                    // dropped leaves no plan behind. On the running run as this chat holds it; nothing is read again.
                    ev.type == "run_plan" && ev.data.str("botId") == botId -> ev.data.str("runId").let { id ->
                        val plan = ev.data["plan"]?.takeIf { it !is JsonNull }
                        all = all.map { if (it.id == id && it.isRunning) it.copy(planValue = plan) else it }
                        publish()
                    }
                    // Its steps so far, rows and all (#633), each time it takes one: an open step line grows as it goes.
                    ev.type == "run_steps" && ev.data.str("botId") == botId -> ev.data.str("runId").let { id ->
                        val steps = (ev.data["steps"] as? JsonObject) ?: return@let
                        if (all.any { it.id == id && it.isRunning && it.stepsValue != steps }) { all = all.map { if (it.id == id && it.isRunning) it.copy(stepsValue = steps) else it }; publish() }
                    }
                    ev.type.startsWith("run_") && ev.data.str("botId") == botId -> kicks.tryEmit(Unit)
                    ev.type == "bot_message" && (ev.data["to"] as? JsonObject)?.str("id") == botId -> kicks.tryEmit(Unit)
                    ev.type == "notes_held" && ev.data.str("botId") == botId -> kicks.tryEmit(Unit) // the wake gate held a note (ADR 083)
                    ev.type == "watches" && ev.data.str("botId") == botId -> scope.launch { readWatches() } // set, read, ended or stopped (ADR 248)
                    // While it works, a card came, went or changed: an action in a connected app may have begun or
                    // ended its wait for the owner's OK, which the run says in this list (`waitingFor`).
                    ev.type == "asks" && all.any { it.isRunning } -> kicks.tryEmit(Unit)
                }
            }
        }
        jobs += scope.launch { kicks.debounce(250).collect { refresh() } }
        // A run's step line follows its line, its count of steps and whether it waits for an OK.
        jobs += scope.launch {
            kotlinx.coroutines.flow.combine(store.lines.runLines, store.lines.runSteps, store.lines.heldRuns) { _, _, _ -> }.collect { if (all.any { it.isRunning }) publish() }
        }
    }

    /** The chat was left: what it follows stops (a send under way goes on). */
    fun stop() {
        stopped = true
        jobs.forEach { it.cancel() }
        jobs.clear()
        streams.values.forEach { it.cancel() }
        streams.clear()
    }

    /** The newest page, from scratch, and the notes and watches beside it. */
    @Throws(Exception::class)
    suspend fun load() {
        val a = apiOf() ?: return
        val (r, w) = coroutineScope { async { runCatching { a.runs(botId, PAGE) } } to async { runCatching { a.inbox(botId) } } }
        val runs = r.await()
        runs.exceptionOrNull()?.let { if (it is CancellationException) throw it }
        runs.onSuccess { all = it; noOlder = it.size < PAGE; loaded = true; follow() }.onFailure { say(it.message ?: tr("Couldn't load")) }
        w.await().onSuccess { waiting = it } // an older botdot has no inbox to show
        readWatches()
        publish()
    }

    /** What it watches (ADR 248); an older botdot has none to show. */
    private suspend fun readWatches() {
        val a = apiOf() ?: return
        if ("watches" !in store.version.value.value?.features.orEmpty()) return
        runCatching { a.watches(botId) }.onSuccess { watches = it; publish() }
    }

    /** Stop on a watch: gone at once here, and on the server. */
    fun stopWatch(id: String) {
        watches = watches.filterNot { it.id == id }
        publish()
        scope.launch {
            try { api.stopWatch(botId, id) } catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("Couldn't stop it")); readWatches() } // as the server has them
        }
    }

    /** Only its newest runs, put in place of what the chat had (pull to refresh, the feed). */
    @Throws(Exception::class)
    suspend fun refresh() {
        val a = apiOf() ?: return
        if (!loaded) return load()
        val (r, w) = coroutineScope { async { runCatching { a.runs(botId, NEWEST) } } to async { runCatching { a.inbox(botId) } } }
        w.await().onSuccess { waiting = it }
        readWatches()
        val fresh = r.await().getOrNull() ?: return publish()
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
            runCatching { apiOf()?.runs(botId, PAGE, before = oldest) }.onSuccess { page ->
                val known = all.mapTo(HashSet()) { it.id }
                // An older botdot sends the newest again: nothing older to show then.
                if (page == null || page.isEmpty() || page.first().id in known) noOlder = true
                else { all = all + page.filter { it.id !in known }; noOlder = page.size < PAGE }
            } // a page that failed says nothing: scrolling back up asks again
            loadingOlder = false
            publish()
        }
    }

    /** Older pages until this run is in the chat (a search match), a few at most. True when it is. */
    suspend fun reach(runId: String): Boolean {
        repeat(10) {
            if (all.any { it.id == runId }) return true
            if (noOlder) return false
            val oldest = all.lastOrNull()?.id ?: return false
            val page = runCatching { apiOf()?.runs(botId, PAGE, before = oldest) }.getOrNull().orEmpty()
            val known = all.mapTo(HashSet()) { it.id }
            if (page.isEmpty() || page.first().id in known) { noOlder = true; return false }
            all = all + page.filter { it.id !in known }
            publish()
        }
        return all.any { it.id == runId }
    }

    /**
     * The chat came on screen, with the app in front: the "New" line goes where the server says the new replies begin
     * now, asked before the app reports the chat as read. True when the line was placed or moved.
     */
    suspend fun arrive(): Boolean {
        // Not answered in a moment (a poor connection): what the app knows, so the report isn't kept waiting.
        val asked = runCatching { withTimeoutOrNull(ASK_MS) { apiOf()?.bot(botId) } }.getOrNull()
        currentCoroutineContext().ensureActive() // the chat was left meanwhile: nothing is placed, nothing reported
        val now = asked ?: store.bots.value.value?.firstOrNull { it.id == botId } ?: return false
        val first = Unread.line(newFirst, now.unread, now.firstUnread)
        if (first == newFirst) return false
        newFirst = first
        publish()
        return true
    }

    /** The chat was left: its "New" line goes. */
    fun clearNew() { newFirst = null; publish() }

    /** Waits for the chat, and brings in the run the "New" line is at: a reply from while the app was away, or an older page. */
    suspend fun reachNew(): Boolean {
        val id = newFirst ?: return false
        state.first { it.loaded }
        refresh() // what came while the app was away, all of it, before the chat is scrolled
        return reach(id)
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
        return submit(text, attachments, replyTo = replying?.runId)
    }

    /**
     * Sends [text] with [attachments] that are the caller's own (Android's message box keeps its files itself); true
     * once it went. [box]: it came from the message box, and goes back there when it failed ([Outbox.send]); [key]
     * is the one it is taken once by, [replyTo] the run it replies to (#627) and [answers] the reply whose question it
     * answers, so that with two questions open it ends that one alone (#1380).
     */
    @Throws(Exception::class)
    suspend fun submit(text: String, attachments: List<Attachment>, box: Boolean = true, key: String? = null, replyTo: String? = null, answers: String? = null): Boolean {
        var waits = false // the answer was a message that waits its turn: it is in the bot's list, not among its runs
        val known = ownWords(all, queued).mapTo(HashSet()) { it.id }
        val went = outbox.send(text, attachments, box, key, once = takesOnce(store.version.value.value?.features), known = known) { k ->
            publish() // the message on its way is drawn at once
            val run = api.runBot(botId, text, attachments, k, replyTo, answers)
            if (replyTo != null && replying?.runId == replyTo) replying = null
            waits = run.isQueued
            took(run, text, attachments)
        }
        publish()
        refresh()
        if (waits) store.bots.refresh()
        return went
    }

    /**
     * The small × under [runId]'s quick answers ([dismissed] true), or Undo (false): the row goes or comes back at once,
     * then it is kept on the server with the reply; when that fails it goes back and the error is thrown. The bot is told nothing.
     */
    @Throws(Exception::class)
    suspend fun dismissChoices(runId: String, dismissed: Boolean) {
        val before = choicesPut[runId]
        choicesPut[runId] = dismissed
        publish()
        try { api.dismissChoices(runId, dismissed) } catch (e: Exception) {
            if (before == null) choicesPut.remove(runId) else choicesPut[runId] = before
            publish()
            throw e
        }
    }

    /** A quick answer tapped under [runId]: its words go to the bot as the answer to that run. Whether it went. */
    @Throws(Exception::class)
    suspend fun answer(runId: String, choice: String): Boolean = sendFrom(runId, choice)

    /**
     * Several questions under [runId] answered at once, in one message ([questionsAnswer]): nothing with every box
     * empty. Whether it went.
     */
    @Throws(Exception::class)
    suspend fun answerQuestions(runId: String, answers: List<String>): Boolean {
        val r = all.firstOrNull { it.id == runId } ?: return false
        val questions = r.questions.orEmpty()
        if (questions.isEmpty() || answers.none { it.isNotBlank() }) return false
        return sendFrom(runId, questionsAnswer(questions, answers))
    }

    // One key per card while its words stay the same: a second tap is taken once.
    private val cardKeys = HashMap<String, Pair<String, String>>()

    /** A card's words sent as their own message (not the box's), answering [runId], with the card's key. */
    private suspend fun sendFrom(runId: String, text: String): Boolean {
        val key = (cardKeys[runId]?.takeIf { it.first == text } ?: (text to newMessageKey()).also { cardKeys[runId] = it }).second
        return submit(text, emptyList(), box = false, key = key, answers = runId)
    }

    /**
     * Whether [runId] takes a reply (#627, `reply-to`): a run of the bot's own work, not a script's, a side question or
     * one still waiting.
     */
    fun replies(runId: String): Boolean = replyTarget(runId) != null

    /**
     * "Reply to this task" on [runId] or any round of its block (ChatOrder.rounds, #627): the next message replies to
     * the block's newest round, and above the box until it is sent stands the first line of the block's first request,
     * as on Android.
     */
    fun replyTo(runId: String) {
        replying = replyTarget(runId) ?: return
        publish()
    }

    /** The newest round of [runId]'s block and the first request's line, when it takes a reply; else null. */
    private fun replyTarget(runId: String): ReplyingTo? {
        if ("reply-to" !in store.version.value.value?.features.orEmpty()) return null
        val rounds = ChatOrder.rounds(all.filterNot { it.quiet || it.isQueued }).firstOrNull { b -> b.any { it.id == runId } } ?: return null
        val last = rounds.last()
        if (last.kind == "script" || last.btw || last.isQueued) return null
        return ReplyingTo(last.id, RunSteps.firstLine(rounds.first().prompt).ifEmpty { tr("this task") })
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

    /**
     * "Steer" on a message that waits (ADR 040): the run that is going reads it at its next tool call, and until then
     * it shows "Steering…". When botdot refused (the run can't take it, or it has started), the box's line says why.
     */
    fun steer(q: Queued) {
        if (!taking.add(q.id)) return
        scope.launch {
            try {
                api.steer(botId, q.id)
                store.bots.update { bots -> bots.map { if (it.id == botId) it.copy(queuedValue = steered(it.queuedValue, q.id)) else it } }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                outbox.steerFailed(e)
                publish()
                refresh()
            } finally {
                taking.remove(q.id)
            }
            store.bots.refresh()
        }
    }

    /** "Run now" under the notes that wait (#225): the bot starts with them, or once it is free; the chat says which. */
    fun runNotes() {
        scope.launch {
            try {
                val r = api.runNotes(botId)
                if (r.status == "queued") say(tr("It's busy: it reads them once it's free."))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                say(e.message ?: tr("Couldn't start it"))
            }
            refresh(); store.bots.refresh()
        }
    }

    /** Stop the run [runId] (its working line's Stop), or the one that is going (the message box's). */
    fun stopRun(runId: String? = null) {
        val id = runId ?: all.firstOrNull { it.isRunning }?.id ?: return
        scope.launch {
            say(stopNote(runCatching { api.stopRun(id) }))
            refresh()
        }
    }

    private suspend fun findStarted() {
        refresh()
        val a = apiOf()
        for (q in stillStarting(starting, all)) {
            val run = runCatching { a?.run(q.id) }.getOrNull()
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
                    apiOf()?.runStream(id)?.collect { ev ->
                        when (ev) {
                            is RunEvent.Draft -> if (ReplyDraft.shows(store.version.value.value?.features)) { drafts = if (ev.text.isEmpty()) drafts - id else drafts + (id to ev.text); publish() }
                            is RunEvent.End, is RunEvent.File -> kicks.tryEmit(Unit)
                            is RunEvent.Line -> { store.lines.streamed("bot:$botId", ev, id); publish() }
                            // Its plan as it changes: on the run as this chat holds it, until the run is read again.
                            is RunEvent.Planned -> { all = all.map { if (it.id == id) it.copy(planValue = ev.value?.takeIf { v -> v !is JsonNull }) else it }; publish() }
                            else -> Unit
                        }
                    }
                }
            }
        }
    }

    private fun say(words: String) { notice = words; noticeCount++; _notices.tryEmit(words); publish() }

    private fun publish() { _state.value = snapshot() }

    private fun snapshot(): BotChatState {
        val runs = all.filterNot { it.quiet || it.isQueued }
        // What asks can be answered where it stands: the bot's open questions, and the newest reply that asks none
        // (Android's bot chat, ADR 211).
        val askedIn = store.bots.value.value?.firstOrNull { it.id == botId }?.asks?.runs.orEmpty()
        val newest = runs.firstOrNull()?.id
        val features = store.version.value.value?.features
        // What a run is drawn from, as it stands now: the views are made when read, and read what was true here.
        val inputs = ViewInputs(features, store.lines.lines.value["bot:$botId"], store.lines.runSteps.value, store.lines.runLines.value, store.lines.heldRuns.value, drafts, HashMap(choicesPut))
        return BotChatState(
            bot = store.bots.value.value?.firstOrNull { it.id == botId },
            opensFiles = DocumentView.opensChatFiles(features),
            shown = runs,
            views = { runs.map { r -> view(r, inputs, answerable = (r.id in askedIn || (r.id == newest && !r.asks)) && r.status == "success") } },
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
            replying = replying?.let { tr("Reply to: {text}", "text" to it.text) },
            plan = PlanView.ofBot(runs, plans::dismissed)?.let { DockPlan(it, plans.folded(planChat)) },
            reply = replying,
            waiting = waiting,
            watches = watches,
            newFirst = newFirst,
            drafts = drafts,
        )
    }

    /** The dock folded to its one line, or open: kept for this chat. */
    fun foldPlan(folded: Boolean) { plans.setFolded(planChat, folded); publish() }

    /** A stopped plan's Dismiss: it shows no more. */
    fun dismissPlan() { state.value.plan?.let { plans.dismiss(it.view.id) }; publish() }

    private class ViewInputs(
        val features: Collection<String>?,
        val line: String?,
        val runSteps: Map<String, Int>,
        val runLines: Map<String, String>,
        val heldRuns: Set<String>,
        val drafts: Map<String, String>,
        val choicesPut: Map<String, Boolean>,
    )

    private fun view(r: Run, x: ViewInputs, answerable: Boolean = false): RunView {
        val features = x.features
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
            line = if (r.isRunning) OpeningLine.status(x.line, working = true) else "",
            draft = x.drafts[r.id]?.let { markdownDraft(it) },
            reply = if (r.status == "success") r.result.orEmpty().ifBlank { if (nothingElse) tr("Done.") else "" } else null,
            ended = ended?.text,
            problem = ended is Ended.Problem,
            files = r.files.orEmpty(),
            choices = if (answerable) r.choices.orEmpty() else emptyList(),
            yes = if (answerable) r.yes ?: -1 else -1,
            canDismiss = answerable && !r.choices.isNullOrEmpty() && hasChoicesDismiss(features),
            dismissed = QuickAnswers.away(x.choicesPut, r.id, r.choicesDismissed),
            questions = if (answerable) r.questions.orEmpty() else emptyList(),
            questionChoices = if (answerable) r.questions.orEmpty().indices.map { r.questionChoices?.getOrNull(it).orEmpty() } else emptyList(),
            steps = if (!RunSteps.shows(r)) null else {
                val count = maxOf(x.runSteps[r.id] ?: 0, r.steps?.count ?: 0)
                val held = r.waitsForOk || r.id in x.heldRuns
                val at = x.runLines[r.id]
                StepLine(RunSteps.label(r, at, count, held), RunSteps.now(at, held), count, held, RunSteps.timeline(r))
            },
            pages = if (r.status == "success") Pages.chips(r.botId, r.pages, features) else emptyList(),
            learned = if (r.isRunning) emptyList() else LearnedChips.of(r, features),
        )
    }

    companion object {
        const val PAGE = 40
        const val NEWEST = 8
    }
}

/** How long a chat that came on screen waits for botdot to say what is new in it, before it goes by what the app knows. */
private const val ASK_MS = 3_000L

/** A draft as it can be drawn while it grows (the Markdown package's draftSource). */
private fun markdownDraft(text: String): String = dev.botdot.app.markdown.draftSource(text)

/** A message's time in a chat: "13:52" today, "5 Oct, 13:52" another day; "" for none. Android's shortTime and iOS's clock. */
fun chatClock(iso: String?): String = runCatching {
    val at = kotlin.time.Instant.parse(iso ?: return "")
    val zone = kotlinx.datetime.TimeZone.currentSystemDefault()
    val today = kotlin.time.Clock.System.now().toLocalDateTime(zone).date
    if (at.toLocalDateTime(zone).date == today) formatDate(at, "HH:mm", null, zone) else formatDate(at, "d MMM, HH:mm", I18n.language, zone)
}.getOrDefault("")

/** The time of day of a step in a run's details: "13:52", the day dropped from [chatClock]'s "5 Oct, 13:52". */
fun stepClock(iso: String?): String = chatClock(iso).substringAfterLast(", ")
