package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import dev.botdot.app.markdown.draftSource
import kotlinx.serialization.json.JsonNull

/** One message of the Chief's chat as a phone draws it. */
data class ChiefLine(
    /** Its place in the whole chat (what a rating names). */
    val index: Int,
    /** "user", "chief", "suggestion" (a bot's for the Chief) or "report" (a bot's answer to the Chief). */
    val role: String,
    /** Its words, Markdown; for a reply being written, its draft so far (ReplyDraft); "" for none. */
    val text: String,
    /** The problem of a reply that failed or was stopped, under its text; null for none. */
    val error: String?,
    val files: List<Attachment>,
    /** Above a bot's suggestion or report: "Suggestion from Fleet Doctor". */
    val from: String?,
    /** What it is about (ADR 223): the team in its colour, the project before it; null for none. */
    val team: String?,
    val teamColor: String?,
    val project: String?,
    /** 👍 and 👎 under it (Ratings): an unasked message of the Chief's, on a botdot that takes them. */
    val rates: Boolean,
    /** Ratings.UP, Ratings.DOWN or null. */
    val rating: String?,
    /** A reply still being written. */
    val pending: Boolean,
    /** "13:52", or "5 Oct, 13:52" another day; "" for the owner's own and a reply still being written. */
    val time: String,
    /** A bot's suggestion that waits: Approve and Decline under it. */
    val suggests: Boolean = false,
    /** A bot's suggestion the owner declined: it says so in place of the buttons. */
    val declined: Boolean = false,
    /** Several questions at once, a box under each ([ChiefDesk.answer]); only under the newest finished reply. */
    val questions: List<String> = emptyList(),
    /** Each question's choices, drawn under its box (empty for one without). */
    val choices: List<List<String>> = emptyList(),
    /** What it did while replying, a chip each; the bot whose run wrote a mail draft is in the draft's card instead. */
    val chips: List<ChiefChip> = emptyList(),
    /** A mail draft under the Chief's reply, its card; null for none. */
    val mail: MailView? = null,
)

/**
 * What the Chief did while replying, as its chip draws it: [text] ("→ Started Coder"), what still waits for the owner's
 * OK in the warning colour ([waits]), then [after] (" · View live screen" for a run on a Linux computer).
 */
data class ChiefChip(val text: String, val waits: String?, val after: String, val kind: String, val botId: String?, val runId: String?) {
    /** A tap opens its bot ([ChiefDesk.chipBot]): a chip that names a bot or one of its runs. */
    val opens: Boolean get() = botId != null || runId != null
}

/**
 * A mail draft's card (docs/api.md, "A mail draft", #415; Android's MailDraftCard): To and Subject, [state] ("Sent
 * 13:52", "In Drafts · not sent"), the text, its files, its buttons ([actions], each sent as the owner's words with
 * [ChiefDesk.mail]) and in its footer the bot whose run wrote it, with its screen for one on a Linux computer. An
 * [earlier] version folds to one line; a sent mail's text folds under "Show the text".
 */
data class MailView(
    val to: String,
    val subject: String,
    val text: String,
    val sent: Boolean,
    val state: String,
    val earlier: Boolean,
    val actions: List<String>,
    val files: List<Attachment>,
    val bot: String?,
    /** The bot whose run wrote it, as the draft names it: [ChiefDesk.mailBot] finds it, also once it is gone. */
    val botId: String?,
    val runId: String?,
    val screen: Boolean,
)

/** The Chief's chat as the phone shows it, for one draw ([ChiefDesk.state]). */
data class ChiefState(
    val chatId: String?,
    /** Oldest first. */
    val messages: List<ChiefLine>,
    val loaded: Boolean,
    /** Why the chat couldn't be read when it opened: drawn in its place, with Try again; null for none. */
    val failed: String?,
    /** The Chief replies: its working line is drawn, with Stop. */
    val busy: Boolean,
    /** What it is doing, in the server's words or its opening line ("Reading nytimes.com…"); "" when it rests. */
    val line: String,
    /** As [BotChatState.boxStops]. */
    val boxStops: Boolean,
    /** The owner's messages that wait until the Chief's reply ends, oldest first. */
    val queued: List<Queued>,
    val steers: Boolean,
    val sent: SentMessage?,
    val note: String?,
    val back: FailedSend?,
    val files: List<Attachment>,
    val uploading: Boolean,
    val notice: String?,
    val noticeCount: Int,
    /** The Chief's name (ChiefName): the chat's title. */
    val name: String,
    /** Its conversations, newest first ([ChiefDesk.open] one; null: a new one). */
    val chats: List<ChiefChatSummary> = emptyList(),
    /** The dock above the message box: the reply being written's plan, or the last reply's that failed before its plan was done. */
    val plan: DockPlan? = null,
)

/**
 * The Chief of Staff's chat, kept while it is on screen, for both phones (ADR 242): its latest conversation (or a new
 * one, made by the first message), older messages as it is scrolled up, what the Chief is doing while it replies and
 * the reply as it is written, what waits, 👍 and 👎 under its unasked messages. It follows the live feed's [events]
 * for this chat. The rules are Android's ChiefChatModel's (ui/ChatModels.kt).
 */
@OptIn(FlowPreview::class)
class ChiefDesk(
    private val scope: CoroutineScope,
    private val api: Api,
    private val store: Store,
    private val events: Flow<FeedEvent>,
    /** The conversation to open (a notification's `"chief:<chatId>"`); null: the latest. */
    startChat: String? = null,
    /** Each chat's plan fold and the stopped plans dismissed, on this phone. */
    private val plans: PlanMemory = PlanMemory(),
) {
    private var chatId: String? = startChat
    // Opening on the latest conversation, until one is picked or a new one asked for ([open]).
    private var pickLatest = startChat == null
    // One key per card while it is shown: a second tap on the same answer is taken once.
    private val cardKeys = HashMap<String, Pair<String, String>>()
    private var chat: ChiefChat? = null
    private var loaded = false
    private var failed: String? = null
    private var loadingOlder = false
    private var activity: String? = null
    private var draft = ""
    private var files: List<Attachment> = emptyList()
    private var uploading = false
    private var notice: String? = null
    private var noticeCount = 0
    private val taking = HashSet<String>()
    /** One for all the Chief's chats: they share the message box. */
    private val outbox = Outbox.of("chief")
    private val kicks = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private var wholeDue = false
    private val jobs = mutableListOf<Job>()
    private var stopped = false
    private var following: String? = null
    private var stream: Job? = null

    // After every field it reads: Kotlin sets a class's properties in order.
    private val _state = MutableStateFlow(snapshot())
    val state: StateFlow<ChiefState> = _state

    /** Calls [onChange] with the chat now and after every change, on the scope's thread. */
    fun watch(onChange: (ChiefState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    /** The chat came on screen: the latest conversation, and the feed's events for it. */
    fun start() {
        if (jobs.isNotEmpty()) return
        stopped = false
        jobs += scope.launch { load() }
        jobs += scope.launch {
            events.collect { ev ->
                when {
                    ev.type == "reset" -> load()
                    // A rating made here or in another app: its thumbs, if that message is loaded.
                    ev.type == "rating" -> Ratings.event(ev.data)?.let { r -> chat?.takeIf { it.id == r.chatId }?.let { chat = Ratings.set(it, r.index, r.rating); publish() } }
                    // What waits in this chat changed: the event carries the list as it stands now.
                    ev.type == "queued" -> Queued.event(ev)?.let { (c, list) -> chat?.takeIf { c == "chief:${it.id}" }?.let { chat = it.copy(queuedValue = list); publish(); kick(false) } }
                    ev.type.startsWith("chief_") || ev.type == "plan_closed" ->
                        if (chatId != null && ev.data.str("chatId") == chatId) kick(ev.type == "chief_suggestion" || ev.type == "plan_closed")
                }
            }
        }
        jobs += scope.launch { kicks.debounce(250).collect { val whole = wholeDue; wholeDue = false; refresh(whole) } }
        jobs += scope.launch { store.lines.lines.map { it["chief:${chatId.orEmpty()}"] }.distinctUntilChanged().collect { publish() } }
        jobs += scope.launch { store.chiefName.collect { publish() } }
        jobs += scope.launch { store.chief.value.collect { publish() } } // its conversations, as the list draws them
        // The bots, for the chips' live screen and a mail card's bot: drawn again when the list comes or changes, and
        // read once when nothing has read it yet.
        jobs += scope.launch { store.bots.value.collect { publish() } } // a StateFlow: only changes come
        if (store.bots.value.value == null) jobs += scope.launch {
            try { store.bots.refresh() } catch (e: CancellationException) { throw e } catch (_: Exception) {}
        }
    }

    /** The chat was left: what it follows stops (a send under way goes on). */
    fun stop() {
        stopped = true
        jobs.forEach { it.cancel() }
        jobs.clear()
        stream?.cancel()
        stream = null
        following = null
    }

    private fun kick(whole: Boolean) { if (whole) wholeDue = true; kicks.tryEmit(Unit) }

    /** Its last page, from scratch: the latest conversation's when none is open yet. */
    @Throws(Exception::class)
    suspend fun load() {
        if (chatId == null && pickLatest) {
            val chats = store.chief.value.value ?: run { store.chief.refresh(); store.chief.value.value }
            // Its list unread: not a botdot without conversations. Nothing is drawn as new, so a message can't start one.
            if (chats == null) { failed = store.chief.error.value ?: tr("Couldn't load"); publish(); return }
            // A first message may have made a conversation meanwhile: that one stays.
            if (chatId == null) chatId = chats.chats.firstOrNull()?.id
            pickLatest = false
        }
        val id = chatId ?: run { loaded = true; failed = null; publish(); return }
        val r = runCatching { api.chiefChat(id, limit = PAGE) }
        r.exceptionOrNull()?.let { if (it is CancellationException) throw it }
        r.onSuccess { if (id == chatId) { chat = it; loaded = true; failed = null; follow() } }.onFailure { if (!loaded) failed = it.message ?: tr("Couldn't load") else say(it.message ?: tr("Couldn't load")) }
        publish()
    }

    /**
     * Another of the Chief's conversations ([id]), or a new one (null), made when the first message goes, as Android's
     * list and New chat open them. What the last one followed stops; the new one is read from its end.
     */
    fun open(id: String?) {
        pickLatest = false
        if (id == chatId && chat != null) return
        chatId = id
        chat = null
        loaded = id == null
        failed = null
        cardKeys.clear()
        follow()
        publish()
        if (id != null) scope.launch { load() }
    }

    /**
     * A bot's suggestion approved: the Chief is told to go ahead ([PLAN_APPROVAL]), once for each tap on the same card.
     * Whether it went.
     */
    @Throws(Exception::class)
    suspend fun approve(index: Int): Boolean = sendFrom("approve:$index", PLAN_APPROVAL)

    // The chat drawn: the latest one has no id picked (chatId) until it is read, and its fold is kept under its own.
    private val planChat get() = "chief:${chat?.id ?: chatId.orEmpty()}"

    /** The dock folded to its one line, or open: kept for this chat. */
    fun foldPlan(folded: Boolean) { plans.setFolded(planChat, folded); publish() }

    /** A stopped plan's Dismiss: it shows no more. */
    fun dismissPlan() { state.value.plan?.let { plans.dismiss(it.view.id) }; publish() }

    /** A bot's suggestion declined: botdot is told, and the chat is read again with it so. */
    @Throws(Exception::class)
    suspend fun decline() {
        val id = chatId ?: return
        try { api.dismissSuggestion(id) } catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("That didn't work")) }
        refresh(whole = true)
    }

    /**
     * Several questions answered at once, in one message ([questionsAnswer]): each box's words, "–" for one left empty.
     * Nothing is sent with every box empty. The same answers tapped again keep their key. Whether it went.
     */
    @Throws(Exception::class)
    suspend fun answer(index: Int, answers: List<String>): Boolean {
        val line = state.value.messages.firstOrNull { it.index == index } ?: return false
        if (line.questions.isEmpty() || answers.none { it.isNotBlank() }) return false
        return sendFrom("questions:$index", questionsAnswer(line.questions, answers))
    }

    /**
     * A mail card's button ([MailView.actions]: Send now, Not now) sent as the owner's words, with the card's key while
     * it is shown: a second tap is taken once. Whether it went.
     */
    @Throws(Exception::class)
    suspend fun mail(index: Int, words: String): Boolean {
        val line = state.value.messages.firstOrNull { it.index == index } ?: return false
        if (words !in line.mail?.actions.orEmpty()) return false
        return sendFrom("mail:$index:$words", words)
    }

    /** Where a chip's tap goes: the bot, and whether to its screen (a run on a Linux computer). */
    data class ChipBot(val id: String, val name: String, val screen: Boolean)

    /**
     * The bot a chip opens: the one it names, or the one whose run it names. Null when it is gone or couldn't be read:
     * the chat says so.
     */
    @Throws(Exception::class)
    suspend fun chipBot(chip: ChiefChip): ChipBot? = openBot(chip.botId, chip.runId) { it.computer == "linux" && chip.kind == "run" }

    /**
     * The bot a mail card's footer opens: the one whose run wrote the draft, its screen when it has a Linux computer.
     * Null when it is gone or couldn't be read: the chat says so.
     */
    @Throws(Exception::class)
    suspend fun mailBot(index: Int): ChipBot? {
        val mail = state.value.messages.firstOrNull { it.index == index }?.mail ?: return null
        return openBot(mail.botId, mail.runId) { it.computer == "linux" }
    }

    /** The bot [botId], or the one whose run is [runId]: the list read again when it isn't in it (made just now). */
    private suspend fun openBot(botId: String?, runId: String?, screen: (Bot) -> Boolean): ChipBot? = try {
        val id = botId ?: runId?.let { api.run(it).botId }
        fun known() = store.bots.value.value?.firstOrNull { it.id == id }
        // Not in the list read so far (a bot made in this reply): read once more before it is said to be gone.
        val bot = known() ?: id?.let { store.bots.refresh(); known() }
        if (bot == null) { say(tr("This bot is no longer available")); null }
        else ChipBot(bot.id, bot.name, screen(bot))
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        say(e.message ?: tr("Couldn't open bot")); null
    }

    /**
     * Where a file the mail carries opens ([MailCard.opens]): the owner's upload in this chat, from a botdot that opens a
     * chat's files; a bot's file as under its reply. Null for a file named only.
     */
    fun mailFile(f: Attachment): DocumentView.Opening? = when (MailCard.opens(f)) {
        MailCard.Opens.OWN -> chatId?.takeIf { DocumentView.opensChatFiles(store.version.value.value?.features) }
            ?.let { DocumentView.chiefUpload(it, f.file) }?.let { DocumentView.Opening(it, f.name) }
        MailCard.Opens.RUN -> DocumentView.Opening(DocumentView.runFile(f.file), f.name)
        MailCard.Opens.NONE -> null
    }

    /** A card's words sent as a message of their own (not the box's), with its card's key while the words stay the same. */
    private suspend fun sendFrom(card: String, text: String): Boolean {
        val key = (cardKeys[card]?.takeIf { it.first == text } ?: (text to newMessageKey()).also { cardKeys[card] = it }).second
        val known = ownWords(chat).mapTo(HashSet()) { it.id }
        val went = outbox.send(text, emptyList(), box = false, key = key, once = takesOnce(store.version.value.value?.features), chat = chatId, known = known) { k ->
            publish()
            val id = chatId ?: try {
                api.newChiefChat().id.also { chatId = it; outbox.sentIn(it) }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { throw notSent(e) }
            api.sendToChief(id, text, emptyList(), k)?.takeIf { it.id == chatId }?.let { now ->
                withAnswer(chat?.takeIf { it.id == now.id }, now)?.let { chat = it; follow() }
            }
        }
        publish()
        if (chat == null) load() else refresh()
        return went
    }

    /** Its end again (or all of the loaded part: [whole]), put in place. */
    @Throws(Exception::class)
    suspend fun refresh(whole: Boolean = false) {
        val had = chat ?: return load()
        if (had.total < 0) return load() // an older botdot: it sends all of it anyway
        val id = had.id
        val from = if (whole) had.offset else maxOf(had.offset, had.offset + had.messages.size - TAIL)
        val r = runCatching { api.chiefChat(id, offset = from) }
        r.exceptionOrNull()?.let { if (it is CancellationException) throw it }
        r.onSuccess { part ->
            val now = chat ?: return@onSuccess
            if (id != chatId || now.id != id) return@onSuccess
            chat = part.copy(offset = now.offset, messages = now.messages.take(from - now.offset) + part.messages)
            follow()
        }.onFailure { say(it.message ?: tr("Couldn't load")) }
        publish()
    }

    /** The page before what's loaded: the chat was scrolled to its top. */
    fun loadOlder() {
        val c = chat ?: return
        if (c.offset <= 0 || loadingOlder) return
        loadingOlder = true
        scope.launch {
            val from = maxOf(0, c.offset - PAGE)
            runCatching { api.chiefChat(c.id, offset = from, limit = c.offset - from) }.onSuccess { older ->
                val now = chat
                if (now != null && now.id == c.id && now.offset == c.offset) chat = now.copy(offset = older.offset, messages = older.messages + now.messages)
            }.onFailure { if (it !is CancellationException) say(it.message ?: tr("The connection dropped")) }
            loadingOlder = false
            publish()
        }
    }

    /**
     * Sends [text] with the picked files; true once it went. A first message makes the chat; when it then fails, the
     * chat stays for the next try, and the message waits in [ChiefState.back] for the box.
     */
    @Throws(Exception::class)
    suspend fun send(text: String): Boolean {
        // Out of the box with the message, as Android's box takes them (BotChat.send).
        val attachments = files
        files = emptyList()
        val known = ownWords(chat).mapTo(HashSet()) { it.id }
        val went = outbox.send(text, attachments, box = true, once = takesOnce(store.version.value.value?.features), chat = chatId, known = known) { k ->
            publish() // the message on its way is drawn at once
            val id = chatId ?: try {
                api.newChiefChat().id.also { chatId = it; outbox.sentIn(it) }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { throw notSent(e) }
            // The answer is the chat: the message is in it at once, or in its list while it waits for the reply to end.
            api.sendToChief(id, text, attachments, k)?.takeIf { it.id == chatId }?.let { now ->
                withAnswer(chat?.takeIf { it.id == now.id }, now)?.let { chat = it; follow() }
            }
        }
        publish()
        if (chat == null) load() else refresh()
        return went
    }

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
            pick(api.upload(file, "chief"))
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

    /** A picked file the phone couldn't read or copy ([name]): said as an upload that failed is ([BotChat.attachFailed]). */
    fun attachFailed(name: String) = say("$name: ${tr("Couldn't read that file.")}")

    /** A picked file the owner took off the message before sending. */
    fun drop(file: Attachment) { files = files - file; publish() }

    /** "Take back" on a message that waits: it leaves the server and its words come back in the box. */
    fun takeBack(q: Queued) {
        val id = chatId ?: return
        if (!taking.add(q.id)) return
        scope.launch {
            if (outbox.takeBack { api.takeBackFromChief(id, q.id) }) chat?.takeIf { it.id == id }?.let { c -> chat = c.copy(queuedValue = without(c.queuedValue, q.id)) }
            taking.remove(q.id)
            publish()
            refresh()
        }
    }

    /** "Steer" on a message that waits: the Chief's reply that is going reads it. */
    fun steer(q: Queued) {
        val id = chatId ?: return
        if (!taking.add(q.id)) return
        scope.launch {
            try {
                api.steerChief(id, q.id)
                chat?.takeIf { it.id == id }?.let { c -> chat = c.copy(queuedValue = steered(c.queuedValue, q.id)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                outbox.steerFailed(e)
            } finally {
                taking.remove(q.id)
            }
            publish()
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
        publish()
        scope.launch {
            runCatching { api.rate(c.id, index, rating) }.onFailure {
                if (it is CancellationException) return@onFailure
                chat?.takeIf { now -> now.id == c.id }?.let { now -> chat = Ratings.undo(now, index, rating, before) }
                say(tr("Couldn't save your rating"))
            }
        }
    }

    /** Stop the Chief's reply. */
    fun stopReply() {
        val id = chatId ?: return
        scope.launch {
            say(stopNote(runCatching { api.stopChief(id) }))
            refresh()
        }
    }

    private val busy: Boolean get() = chat?.busy == true || chat?.messages?.lastOrNull()?.pending == true

    // While the Chief replies: what it's doing, from its stream.
    private fun follow() {
        // Left: a send or a take back that ends after it follows no reply, so no stream outlives the screen (BotChat).
        if (stopped) return
        // Its opening line while the Chief replies, as the chat just read has it; none once the reply is there.
        chat?.let { c -> if (c.busy) store.lines.say("chief:${c.id}", c.openingLine) else store.lines.end("chief:${c.id}") }
        val id = chatId?.takeIf { busy }
        if (id == following) {
            if (id == null) { activity = null; draft = "" }
            return
        }
        following = id
        stream?.cancel()
        activity = null
        draft = ""
        if (id == null) return
        activity = OpeningLine.chiefActivity(chat?.messages?.lastOrNull { it.pending }?.activity).ifEmpty { null }
        stream = scope.launch {
            runCatching {
                api.chiefStream(id).collect { (type, o) ->
                    when (type) {
                        "activity" -> { activity = OpeningLine.chiefActivity(o); publish() }
                        "opening_line" -> store.lines.say("chief:$id", o.str("text"))
                        "reply_draft" -> if (ReplyDraft.shows(store.version.value.value?.features)) { draft = o.str("text"); publish() }
                        "plan" -> { chat = chat?.let { c -> c.copy(messages = c.messages.map { m -> if (m.pending && m.role == "chief") m.copy(planValue = o["plan"]?.takeIf { it !is JsonNull }) else m }) }; publish() }
                        "done" -> { activity = null; store.lines.end("chief:$id"); publish() } // its draft stands until the reply is read
                        "action", "steered", "btw" -> kick(false)
                    }
                }
            }
            // A stream replaced by another (follow() cancelled it) leaves that one be.
            if (!isActive || following != id) return@launch
            following = null
            refresh(whole = chat?.messages?.any { it.draft != null } == true)
        }
    }

    private fun say(words: String) { notice = words; noticeCount++; publish() }

    private fun publish() { _state.value = snapshot() }

    private fun snapshot(): ChiefState {
        val c = chat
        val features = store.version.value.value?.features
        val messages = c?.messages.orEmpty()
        val last = messages.lastIndex
        val sent = outbox.sent?.takeIf { it.chat == chatId }?.unlessIn(ownWords(c))
        val line = OpeningLine.chiefLine(store.lines.lines.value["chief:${chatId.orEmpty()}"], activity, busy)
        // The questions' card: under the newest message, past the project updates after it, a finished reply of the Chief's.
        // A mail draft's card has its own buttons in their place.
        val newest = messages.indexOfLast { it.projectUpdate == null }.takeIf { i -> i >= 0 && messages[i].role == "chief" && !messages[i].pending }
        val asking = newest?.takeIf { i -> !busy && messages[i].draft == null }
        val bots = store.bots.value.value.orEmpty()
        return ChiefState(
            chatId = chatId,
            messages = messages.mapIndexed { i, m ->
                // An older reply's card is closed: its questions are part of its text (chiefText).
                val shown = if (i == newest || m.questions.isNullOrEmpty()) m else m.copy(text = chiefText(m, open = false))
                val l = chiefLine(shown, c!!.offset + i, if (i == last) draft else "", features, bots)
                if (i != asking || m.questions.isNullOrEmpty()) l
                else l.copy(questions = m.questions.orEmpty(), choices = m.questions.orEmpty().indices.map { q -> m.questionChoices?.getOrNull(q).orEmpty() })
            },
            loaded = loaded,
            failed = failed,
            busy = busy,
            line = lineWith(line, sent.takeIf { busy }),
            boxStops = boxStops(busy, features),
            queued = c?.queued.orEmpty(),
            steers = canSteerChief(features),
            sent = sent,
            note = outbox.note,
            back = outbox.back,
            files = files,
            uploading = uploading,
            notice = notice,
            noticeCount = noticeCount,
            name = store.chiefName.value,
            chats = store.chief.value.value?.chats.orEmpty(),
            plan = c?.let { PlanView.ofChief(it.id, messages, plans::dismissed) }?.let { DockPlan(it, plans.folded(planChat)) },
        )
    }

    companion object {
        const val PAGE = 40
        const val TAIL = 6 // the last few can still change (a reply finishing, its actions)
    }
}

/** How the Chief's chat draws [m], the message at [index] of the whole chat ([draft]: a pending reply's so far). */
internal fun chiefLine(m: ChiefMessage, index: Int, draft: String, features: Collection<String>?, bots: List<Bot> = emptyList()): ChiefLine {
    val team = m.about?.team?.takeIf { it.name.isNotBlank() }
    fun bot(id: String?) = id?.let { bots.firstOrNull { b -> b.id == it } }
    // The mail draft's card: under the Chief's finished reply.
    val card = MailCard.card(m)
    return ChiefLine(
        index = index,
        role = m.role,
        text = if (m.pending) draftSource(draft) else m.text,
        error = m.error?.takeIf { it.isNotBlank() },
        files = if (m.pending) emptyList() else if (m.role == "user") m.attachments.orEmpty() else m.files.orEmpty(),
        from = when (m.role) {
            "suggestion" -> "${tr("Suggestion from")} ${m.from?.name ?: tr("a bot")}"
            "report" -> "${tr("Message from")} ${m.from?.name ?: tr("a bot")}"
            else -> null
        },
        team = team?.name,
        teamColor = team?.color,
        project = team?.let { m.about?.project?.name?.takeIf { it.isNotBlank() } },
        rates = Ratings.shows(m, features, index),
        rating = Ratings.value(m.rating),
        pending = m.pending,
        time = if (m.role == "user" || m.pending) "" else chatClock(m.endedAt ?: m.at),
        suggests = m.role == "suggestion" && m.status == "pending",
        declined = m.role == "suggestion" && m.status == "dismissed",
        // The draft's bot is in its card's footer only while the card shows: a reply still being written keeps its chip.
        chips = m.actions.orEmpty().filterNot { MailCard.takesChip(card, it) }.map { a ->
            val screen = a.kind == "run" && bot(a.botId)?.computer == "linux"
            ChiefChip(a.label, a.waits, if (screen) " · " + tr("View live screen") else "", a.kind, a.botId, a.runId)
        },
        mail = card?.let { d ->
            val by = bot(d.botId)
            MailView(
                to = d.to, subject = d.subject, text = d.text, sent = d.state == "sent",
                state = if (d.state == "sent") tr("Sent {time}", "time" to chatClock(d.sentAt)).trimEnd() else MailCard.state(d),
                earlier = d.earlier, actions = MailCard.actions(d), files = d.attachments,
                bot = d.bot ?: by?.name, botId = d.botId, runId = d.runId, screen = by?.computer == "linux",
            )
        },
    )
}
