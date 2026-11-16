package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import dev.botdot.app.markdown.draftSource

// A group's chat for both phones (ADR 242), with the rules of Android's GroupChatModel (ui/GroupChatScreen.kt) and
// the words of its GroupWords.kt. Android's group chat moves onto this in #1391; until then the two say the same.

/** A member's reply in a group, under its member's name and in its colour. */
class GroupReplyView(
    val id: String,
    val run: Run,
    /** Its member as it is now; null when the bot is gone: [name] and [color] are then the run's. */
    val bot: Bot?,
    val name: String,
    val color: String,
    /** What its head shows: "failed" for a reply that failed, else "idle". */
    val figureState: String,
    /** The reply, Markdown ("Done." for an empty one with no files), when it ended well; else null. */
    val reply: String?,
    /** What a reply that did not finish says, and whether it is a problem (drawn as one) or only "Stopped.". */
    val ended: String?,
    val problem: Boolean,
    val files: List<Attachment>,
    /** Its answer buttons, while it is the group's open question: a tap is the owner's message to the group. */
    val choices: List<String>,
    /** The index of the choice that says yes, filled with the member's colour; -1 for none. */
    val yes: Int,
    /** Several questions at once, while it is the group's open question: a box under each ([GroupChat.answerQuestions]). */
    val questions: List<String> = emptyList(),
    /** Each question's choices, drawn under its box (empty for one without). */
    val questionChoices: List<List<String>> = emptyList(),
)

/**
 * The owner's message in a group. [question]: the member's question it answers with one of its buttons, drawn above
 * it unless the reply that asked stands right before it. [byName], [byColor], [byBot]: the Project Manager wrote it
 * (ADR 217), as the Chief or as the project's lead; null for the owner's own. [waits]: under it, the members whose
 * turn waits because they are busy ("" for none).
 */
class GroupMessageView(
    val message: GroupMessage,
    val question: GroupQuestion?,
    val questionColor: String,
    val questionBot: Bot?,
    val byName: String?,
    val byColor: String?,
    val byBot: Bot?,
    /** What the writer's head wears: the lead's outfit, or the Chief's. */
    val byOutfit: JsonElement?,
    val waits: String,
)

/** One row of a group's chat: the owner's message or a member's reply. */
class GroupRow(val id: String, val message: GroupMessageView?, val reply: GroupReplyView?, val fold: GroupFoldView? = null)

/**
 * The row a team's answer folds its members' replies under (ADR 201): who replied, in their colours, how many replies,
 * and whether it is open ([GroupChat.toggleFold]). Android's FoldRow.
 */
class GroupFoldView(val messageId: String, val heads: List<GroupFoldHead>, val words: String, val open: Boolean)

/** One member whose reply a fold holds. */
class GroupFoldHead(val bot: Bot?, val color: String)

/** A member at work in the group: its line, "Name · what it does…", in the server's words. */
class GroupTurnView(val runId: String, val botId: String, val bot: Bot?, val name: String, val color: String, val line: String, val held: Boolean)

/**
 * The plan of a member at work, above the message box (docs/api.md, "The plan"; Android's PlanDock): whose it is, the
 * step it is at in words ("step 2 of 4"), what that step does, and every step with its status (Plan.DONE, DOING, TODO).
 */
class GroupPlanView(val name: String, val color: String, val stepLine: String, val doneLine: String, val now: String, val steps: List<Plan.Step>)

/** A member's reply as it is written (ReplyDraft), in the bubble its reply will have. */
class GroupDraftView(val runId: String, val bot: Bot?, val name: String, val color: String, val text: String)

/** A message none of whose turns has started, that waits for a busy member or for Claude's sign-in: with "Take back". */
class GroupWaitingView(val message: GroupMessage, val words: String)

/** Everything a group's chat and its members panel draw, at one moment. */
class GroupChatState(
    /** The group; null before the list has it, or once it is gone ([gone]). */
    val group: Group?,
    val gone: Boolean,
    /** Its members that exist, in the group's order. */
    val members: List<Bot>,
    /** The chat's rows, oldest first; the messages that wait whole stand in [waiting] instead. */
    val rows: List<GroupRow>,
    /** The members at work, in the order they started: one line each, the last with "Stop all". */
    val turns: List<GroupTurnView>,
    val drafts: List<GroupDraftView>,
    /** The plan of the member at work that has one; null for none. */
    val plan: GroupPlanView? = null,
    /** Who is next: the members whose turn has not come, in that order, and what a screen reader says of them. */
    val next: List<Bot>,
    val nextWords: String,
    /** The line that the group stopped at the limit of replies, with "Go on"; null when it goes. */
    val limit: String?,
    val waiting: List<GroupWaitingView>,
    /** The owner's message on its way, drawn until the server's version of it is in the chat. */
    val sent: SentMessage?,
    val sending: Boolean,
    /** The line above the message box: why the last send failed. */
    val note: String?,
    /** A message that failed or was taken back, waiting for the box to take it. */
    val back: FailedSend?,
    val files: List<Attachment>,
    val uploading: Boolean,
    val loaded: Boolean,
    /** What an empty group says ([showsEmpty]: nothing is in it yet): its members, and that all of them read it. */
    val empty: String,
    val showsEmpty: Boolean,
    val notice: String?,
    val noticeCount: Int,
    /** What the members panel's last change came to when botdot refused it, said in the panel; null for none. */
    val panelError: String? = null,
    /** Its notes (ADR 139); null from a botdot without them, or before they are read. */
    val notes: List<GroupNote>?,
    /** The members panel: the bots that can be added, and what it can change. */
    val addable: List<Bot>,
    /** How many more bots it takes: six in a group, a team's many in a team's chat. */
    val room: Int,
    val changesMembers: Boolean,
    val canTakeOut: Boolean,
    val renames: Boolean,
    val deletes: Boolean,
    /** A team's chat of two bots or more picks its lead here ([GroupChat.makeLead]): its row says Lead, the others Make lead. */
    val picksLead: Boolean = false,
    /** Pinned below the Chief on Home ([GroupChat.pin]), as a bot's switch: a team's chat too. */
    val pinned: Boolean = false,
)

/**
 * A group's chat, kept while it is on screen, for both phones (ADR 242): its newest items and older ones as it is
 * scrolled up, each member's reply under its own name, the members at work with their lines (TurnLines) and drafts,
 * who is next, the stopped line, the messages that wait, the group's open question with its answer buttons, the
 * question a tapped answer answers, the owner's message on its way, and the members panel: its name, its members and
 * its notes. It follows the live feed's [events] for this group.
 */
@OptIn(FlowPreview::class)
class GroupChat(
    private val scope: CoroutineScope,
    private val api: Api,
    private val store: Store,
    private val events: Flow<FeedEvent>,
    val groupId: String,
) {
    private val held = GroupChatItems()
    private var working: List<GroupWorking> = emptyList()
    private var asks: GroupAsks? = null
    private var limit: GroupLimit? = null
    private var loaded = false
    private var loadingOlder = false
    private var asked = 0
    private var taken = 0
    private val heldDrafts = ReplyDraft.Group()
    private var files: List<Attachment> = emptyList()
    // The messages whose folded replies the owner opened, while the chat is on screen.
    private var openFolds: Set<String> = emptySet()
    private var uploading = false
    private var notice: String? = null
    private var panelError: String? = null
    private var noticeCount = 0
    private var notes: List<GroupNote>? = null
    private var notesAsked = false
    private val taking = HashSet<String>()
    private val outbox = Outbox.of(groupKey(groupId))
    private val kicks = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private val jobs = mutableListOf<Job>()
    private val streams = mutableMapOf<String, Job>()
    private var stopped = false

    // After every field it reads: Kotlin sets a class's properties in order.
    private val _state = MutableStateFlow(snapshot())
    val state: StateFlow<GroupChatState> = _state

    /** Calls [onChange] with the chat now and after every change, on the scope's thread. */
    fun watch(onChange: (GroupChatState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    /** The chat came on screen: its newest page, its notes, and the feed's events for it. */
    fun start() {
        if (jobs.isNotEmpty()) return
        stopped = false
        jobs += scope.launch { load() }
        // The bots, the group, the turns' lines, Claude's sign-in and the Chief's name are drawn as they change.
        jobs += scope.launch {
            combine(store.bots.value, store.groups.value, store.turnLines.value, store.claude.signedOut, store.version.value) { _, _, _, _, v -> v }.collect { v ->
                if (GroupNotes.FEATURE in v?.features.orEmpty() && !notesAsked) { notesAsked = true; scope.launch { readNotes() } }
                publish()
            }
        }
        jobs += scope.launch { store.chiefName.collect { publish() } }
        jobs += scope.launch { events.collect { on(it) } }
        jobs += scope.launch { kicks.debounce(250).collect { load() } }
    }

    /** The chat was left: what it follows stops (a send under way goes on). */
    fun stop() {
        stopped = true
        jobs.forEach { it.cancel() }
        jobs.clear()
        streams.values.forEach { it.cancel() }
        streams.clear()
        heldDrafts.clear()
        notesAsked = false
    }

    private fun on(ev: FeedEvent) {
        val d = ev.data
        when {
            ev.type == "reset" -> kicks.tryEmit(Unit)
            !ev.type.startsWith("group_") || d.str("groupId") != groupId -> Unit
            // A page asked a moment before answers as the chat was then: the chat is read again after it.
            ev.type == "group_message" -> { GroupMessage.of(d["message"])?.let { if (held.hold(it)) publish() }; kicks.tryEmit(Unit) }
            ev.type == "group_message_gone" -> { if (held.remove(d.str("id"))) publish(); kicks.tryEmit(Unit) }
            ev.type == "group_run_started" -> {
                val run = d.str("id")
                if (run.isNotEmpty() && d.str("botId").isNotEmpty() && working.none { it.runId == run }) {
                    working = working + GroupWorking(d.str("botId"), run, d.str("groupMessageId").ifEmpty { null }, d.str("startedAt").ifEmpty { null })
                    follow()
                    publish()
                }
                kicks.tryEmit(Unit)
            }
            ev.type == "group_run_finished" -> {
                working = working.filterNot { it.runId == d.str("id") }
                if (isTrue(d["passed"])) heldDrafts.passed(d.str("id")) // a pass leaves nothing, not even its draft
                follow()
                publish()
                kicks.tryEmit(Unit)
            }
            ev.type == "group_asks" -> { asks = GroupAsks.of(d["asks"]); publish() }
            ev.type == "group_limit" -> { limit = GroupLimit.of(d["limit"]); publish(); kicks.tryEmit(Unit) }
            ev.type == "group_notes" -> scope.launch { readNotes() }
        }
    }

    /** The chat's newest items (again). */
    @Throws(Exception::class)
    suspend fun load() {
        val mine = ++asked
        val page = try { api.groupChat(groupId, PAGE) } catch (e: CancellationException) { throw e } catch (e: Exception) {
            if (!loaded) say(e.message ?: tr("Couldn't load"))
            return
        }
        if (mine < taken) return // a later answer is drawn already
        taken = mine
        held.take(page)
        working = page.working
        asks = page.asks
        limit = page.limit
        store.turnLines.read(groupId, page.working) // each member's line, as the chat has it now
        loaded = true
        follow()
        publish()
    }

    /** The page before the oldest item held: the chat was scrolled to its top. */
    fun loadOlder() {
        if (!held.more || loadingOlder || !loaded) return
        val oldest = held.oldest?.id ?: return
        loadingOlder = true
        scope.launch {
            runCatching { api.groupChat(groupId, PAGE, before = oldest) }.onSuccess { held.take(it, older = true) }
            loadingOlder = false
            publish()
        }
    }

    /**
     * The owner writes in the group from the message box, with the picked files: one message, and the server gives
     * the turns. True once it went; when it failed it waits in [GroupChatState.back] for the box, and the line says
     * why. The request outlives the chat's screen.
     */
    @Throws(Exception::class)
    suspend fun send(text: String): Boolean {
        val attachments = files
        files = emptyList()
        return sendWith(text, attachments, box = true)
    }

    /** An answer button under the group's open question was tapped: its words are the owner's message to the group. */
    @Throws(Exception::class)
    suspend fun answer(choice: String): Boolean = sendWith(choice, emptyList(), box = false)

    /**
     * A member's several questions answered at once, in one message to the group ([questionsAnswer]): nothing with every
     * box empty; the same answers tapped again keep their key, so the group takes them once. Whether it went.
     */
    @Throws(Exception::class)
    suspend fun answerQuestions(runId: String, answers: List<String>): Boolean {
        val r = state.value.rows.firstNotNullOfOrNull { it.reply?.takeIf { v -> v.run.id == runId } } ?: return false
        if (r.questions.isEmpty() || answers.none { it.isNotBlank() }) return false
        val text = questionsAnswer(r.questions, answers)
        val key = (cardKeys[runId]?.takeIf { it.first == text } ?: (text to newMessageKey()).also { cardKeys[runId] = it }).second
        return sendWith(text, emptyList(), box = false, key = key)
    }

    // One key per question card while its answers stay the same.
    private val cardKeys = HashMap<String, Pair<String, String>>()

    private suspend fun sendWith(text: String, attachments: List<Attachment>, box: Boolean, key: String? = null): Boolean {
        val known = ownWords().mapTo(HashSet()) { it.id }
        // "Go on", typed while the group is stopped at the limit, is no message: nothing is drawn for it.
        val draw = !(limit != null && isGoOn(text))
        val went = outbox.send(text, attachments, box, key, once = takesOnce(store.version.value.value?.features), known = known, draw = draw) { k ->
            publish() // the message on its way is drawn at once
            took(api.sendToGroup(groupId, text, attachments, k))
        }
        publish()
        load()
        return went
    }

    private fun took(sent: GroupSent) {
        sent.held.forEach { held.hold(it) }
        if (sent.wentOn) limit = null // "Go on", typed: no message of its own, and the line is no longer stopped
        publish()
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

    /** A picked file: uploaded to the group for the next message (each member with a turn gets a copy). */
    @Throws(Exception::class)
    suspend fun attach(file: OutgoingFile) {
        uploading = true
        publish()
        try {
            files = files + api.upload(file, groupKey(groupId))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say("${file.name}: ${e.message ?: tr("Couldn't upload")}")
        } finally {
            uploading = false
            publish()
        }
    }

    /** A picked file the phone couldn't read or copy ([name]): said as an upload that failed is. */
    fun attachFailed(name: String) = say("$name: ${tr("Couldn't read that file.")}")

    /** A picked file the owner took off the message before sending. */
    fun drop(file: Attachment) { files = files - file; publish() }

    /** "Take back" on a message none of whose turns has started: it leaves the group and its words come back in the box. */
    fun takeBack(m: GroupMessage) {
        if (!taking.add(m.id)) return
        scope.launch {
            if (outbox.takeBack { api.takeBackFromGroup(groupId, m.id) }) held.remove(m.id)
            taking.remove(m.id)
            publish()
            load()
        }
    }

    /** "Stop all": every run of the group at work ends, and the turns that would have followed never start. */
    fun stopAll() {
        scope.launch {
            runCatching { api.stopGroup(groupId) }.onFailure { if (it is CancellationException) throw it; say(it.message ?: tr("Couldn't stop")) }
            load()
        }
    }

    /** Stop on one member's working line: that run ends, the others at work go on, and its line goes on with the next member. */
    fun stopMember(runId: String) {
        scope.launch {
            say(stopNote(runCatching { api.stopRun(runId) }))
            load()
        }
    }

    /** "Go on": the group stopped at the limit gets its next replies; one no longer stopped says so in the server's words. */
    fun goOn() {
        scope.launch {
            runCatching { api.goOn(groupId) }.onSuccess { if (it.wentOn) took(it) }.onFailure { if (it is CancellationException) throw it; say(it.message ?: tr("That didn't work")) }
            load()
        }
    }

    // ---------- the members panel ----------

    /** Its name, as typed: one line without the blanks around it; an empty one changes nothing. */
    fun rename(typed: String) {
        val to = typed.replace(SPACES, " ").trim()
        val g = group() ?: return
        if (to.isEmpty() || to == g.name) return
        change { api.updateGroup(groupId, buildJsonObject { put("name", JsonPrimitive(to)) }) }
    }

    /** The member [botId] leaves the group (a group left with none is deleted by botdot). */
    fun takeOut(botId: String) {
        val g = group() ?: return
        change { api.updateGroup(groupId, api.membersOf(g.members - botId)) }
    }

    /** Make lead, in a team chat's panel: that bot leads the team in its project. */
    fun makeLead(botId: String) {
        val g = group() ?: return
        if (g.lead == botId || botId !in g.members) return
        change { api.updateGroup(groupId, buildJsonObject { put("lead", JsonPrimitive(botId)) }) }
    }

    /** Pinned below the Chief on Home, last among the pinned ones (dragged on Home to move it); off: back in its category. */
    fun pin(on: Boolean) {
        val body = Groups.pinChange(group() ?: return, on) ?: return
        change {
            api.updateGroup(groupId, body)
            store.bots.refresh() // the pinned bots after it move up when it leaves: one order (#276)
        }
    }

    /** These bots join the group, after its members. */
    fun add(botIds: List<String>) {
        val g = group() ?: return
        change { api.updateGroup(groupId, api.membersOf(g.members + botIds.filterNot { it in g.members })) }
    }

    /** "Delete this group": the group and its chat go, no bot. True once it is gone. */
    @Throws(Exception::class)
    suspend fun delete(): Boolean {
        panelError = null; publish()
        val r = runCatching { api.deleteGroup(groupId) }
        r.exceptionOrNull()?.let { if (it is CancellationException) throw it; failedInPanel(it.message ?: tr("Couldn't delete")); return false }
        store.groups.update { all -> all.filterNot { it.id == groupId } }
        scope.launch { store.groups.refresh() }
        return true
    }

    /** A new note of [kind] ("decision", "open", "fact"): true once it is saved, so the box keeps what was typed until then. */
    @Throws(Exception::class)
    suspend fun addNote(kind: String, typed: String): Boolean {
        val t = GroupNotes.clean(typed)
        if (t.isEmpty()) return false
        panelError = null; publish()
        val r = runCatching { api.addGroupNote(groupId, kind, t) }
        r.exceptionOrNull()?.let { if (it is CancellationException) throw it; failedInPanel(it.message ?: tr("Couldn't save")); return false }
        notes = r.getOrNull()
        publish()
        return true
    }

    /** A tap on a fold's row: the members' replies it holds open under it, or close again. */
    fun toggleFold(messageId: String) {
        openFolds = if (messageId in openFolds) openFolds - messageId else openFolds + messageId
        publish()
    }

    /** The panel was opened: what an earlier change came to is not said again. */
    fun panelOpened() { if (panelError != null) { panelError = null; publish() } }

    // What botdot refused in the panel is said there, over which the chat can't be seen (Android's panel says it too).
    private fun failedInPanel(words: String) { panelError = words; publish() }

    fun setNoteKind(note: GroupNote, kind: String) { if (kind != note.kind) noteCall { api.changeGroupNote(groupId, note.id, kind = kind) } }

    /** A note's line as changed: emptied, it goes. */
    fun setNoteText(note: GroupNote, typed: String) {
        val t = GroupNotes.clean(typed)
        if (t.isEmpty()) removeNote(note) else if (t != note.text) noteCall { api.changeGroupNote(groupId, note.id, text = t) }
    }

    fun removeNote(note: GroupNote) = noteCall { api.removeGroupNote(groupId, note.id) }

    private fun noteCall(block: suspend () -> List<GroupNote>) {
        scope.launch {
            panelError = null
            runCatching { block() }.onSuccess { notes = it }.onFailure { if (it is CancellationException) throw it; panelError = it.message ?: tr("Couldn't save") }
            publish()
        }
    }

    private suspend fun readNotes() {
        runCatching { api.groupNotes(groupId) }.onSuccess { notes = it; publish() }
    }

    private fun change(block: suspend () -> Unit) {
        scope.launch {
            panelError = null
            runCatching { block() }.onFailure { if (it is CancellationException) throw it; panelError = it.message ?: tr("Couldn't save") }
            publish()
            store.groups.refresh()
        }
    }

    private fun group(): Group? = store.groups.value.value?.firstOrNull { it.id == groupId }

    // ---------- drafts ----------

    /**
     * From a server with drafts, the run stream of each member at work is followed for its draft; one that dropped
     * while the turn still works is followed again. A turn that ended keeps its draft until its reply is in the chat.
     */
    private fun follow() {
        // Left: a send or a turn that ends after it follows no run, so no stream outlives the screen.
        if (stopped) return
        val at = if (ReplyDraft.shows(store.version.value.value?.features)) working.associateBy { it.runId } else emptyMap()
        streams.keys.filter { it !in at }.forEach { streams.remove(it)?.cancel() }
        for ((id, w) in at) {
            if (streams[id]?.isActive == true) continue
            streams[id] = scope.launch {
                while (isActive) {
                    val failed = runCatching { api.runStream(id).collect { ev -> if (ev is RunEvent.Draft) { heldDrafts.say(w, ev.text); publish() } } }.exceptionOrNull()
                    if (failed == null || failed is CancellationException) break
                    delay(2_000)
                }
            }
        }
    }

    // ---------- what is drawn ----------

    private fun say(words: String) { notice = words; noticeCount++; publish() }

    private fun publish() { _state.value = snapshot() }

    private fun ownWords(): List<Queued> = held.rows().filterIsInstance<GroupItem.Message>().map { Queued(it.message.id, it.message.text, it.message.attachments) }

    private fun snapshot(): GroupChatState {
        val bots = store.bots.value.value.orEmpty()
        val groups = store.groups.value.value
        val g = groups?.firstOrNull { it.id == groupId }
        val features = store.version.value.value?.features
        val signedOut = store.claude.signedOut.value
        val lines = store.turnLines.value.value
        val members = g?.let { Groups.members(it, bots) }.orEmpty()
        val rows = held.rows()
        val messages = rows.filterIsInstance<GroupItem.Message>().map { it.message }
        val waits = messages.filter { waitsWhole(it, bots, signedOut) }
        val shown = rows.filterNot { it is GroupItem.Message && waitsWhole(it.message, bots, signedOut) }
        // A team's answer folds its members' replies under one row (Groups.shown), open while the owner keeps it open.
        val laid = Groups.shown(shown, openFolds)
        val drawn = laid.mapIndexed { i, x ->
            when (x) {
                is GroupItem.Message -> GroupRow(x.id, messageView(x.message, laid.getOrNull(i - 1) as? GroupItem, bots), null)
                is GroupItem.Reply -> GroupRow(x.id, null, replyView(x, bots, features))
                is Groups.Fold -> {
                    val who = x.runs.distinctBy { it.botId }
                    val words = "${namesList(who.map { r -> memberName(bots, r.botId).takeIf { bots.any { b -> b.id == r.botId } } ?: r.botName })} · ${x.runs.size}"
                    GroupRow(x.id, null, null, GroupFoldView(x.messageId, who.map { r -> GroupFoldHead(bots.firstOrNull { it.id == r.botId }, bots.firstOrNull { it.id == r.botId }?.color ?: r.botColor ?: GONE_COLOR) }, words, x.open))
                }
                else -> error("a row of the chat: $x")
            }
        }
        val next = Groups.heads(Groups.next(messages, working), bots)
        return GroupChatState(
            group = g,
            gone = groups != null && g == null,
            members = members,
            rows = drawn,
            plan = GroupWorking.planOf(working)?.let { (w, view) ->
                val p = view.plan
                GroupPlanView(memberName(bots, w.botId), memberColor(bots, w.botId),
                    tr("step {step} of {total}", "step" to p.step.toString(), "total" to p.total.toString()),
                    tr("{done} of {total}", "done" to p.done.toString(), "total" to p.total.toString()),
                    p.now?.let { it.doing.ifEmpty { it.text } }.orEmpty(), p.steps)
            },
            turns = working.map { w ->
                val line = lines[w.runId]
                GroupTurnView(w.runId, w.botId, bots.firstOrNull { it.id == w.botId }, memberName(bots, w.botId), memberColor(bots, w.botId),
                    workingWords(memberName(bots, w.botId), line, OpeningLine.ofRun(w.workingLine, w.openingLine, store.lines.features)), line?.held == true)
            },
            drafts = heldDrafts.shown(rows.filterIsInstance<GroupItem.Reply>().mapTo(HashSet()) { it.id }).map { (w, text) ->
                GroupDraftView(w.runId, bots.firstOrNull { it.id == w.botId }, memberName(bots, w.botId), memberColor(bots, w.botId), draftSource(text))
            },
            next = next,
            nextWords = if (next.isEmpty()) "" else tr("Next: {names}", "names" to namesList(next.map { it.name })),
            limit = limit?.text,
            waiting = waits.map { GroupWaitingView(it, waitsLine(it, bots).ifEmpty { tr("Waits until Claude is signed in") }) },
            sent = outbox.sent?.unlessIn(ownWords()),
            sending = outbox.sending,
            note = outbox.note,
            back = outbox.back,
            files = files,
            uploading = uploading,
            loaded = loaded,
            showsEmpty = loaded && rows.isEmpty() && outbox.sent == null,
            empty = if (members.isEmpty()) tr("Its bots are all gone. Add one, or delete the group.") else tr("{names}. What you write here, all of them read.", "names" to namesList(members.map { it.name })),
            notice = notice,
            noticeCount = noticeCount,
            panelError = panelError,
            notes = notes?.takeIf { GroupNotes.FEATURE in features.orEmpty() },
            addable = g?.let { Groups.addable(it, bots).sortedBy { b -> b.name.lowercase() } }.orEmpty(),
            room = g?.let { Groups.maxOf(it) - it.members.size }?.coerceAtLeast(0) ?: 0,
            changesMembers = g != null && Groups.changesMembers(g, features),
            canTakeOut = g != null && Groups.canTakeOut(g, features),
            renames = g != null && (g.team == null || features?.contains(Groups.TEAM_CHAT_RENAME) == true),
            deletes = g != null && Groups.deletes(g, features),
            picksLead = g != null && Groups.picksLead(g, features),
            pinned = (g?.pinned ?: 0) > 0,
        )
    }

    private fun messageView(m: GroupMessage, before: GroupItem?, bots: List<Bot>): GroupMessageView {
        val q = Groups.questionAbove(m, before)
        val lead = m.asBot?.let { id -> bots.firstOrNull { it.id == id } }
        return GroupMessageView(
            message = m,
            question = q,
            questionColor = memberColor(bots, q?.botId),
            questionBot = q?.let { x -> bots.firstOrNull { it.id == x.botId } },
            byName = if (m.byChief) lead?.name ?: store.chiefName.value else null,
            byColor = if (m.byChief) lead?.color ?: CHIEF_COLOR else null,
            byBot = if (m.byChief) lead else null,
            byOutfit = if (m.byChief) lead?.outfit ?: FigureDef.CHIEF else null,
            waits = waitsLine(m, bots),
        )
    }

    private fun replyView(x: GroupItem.Reply, bots: List<Bot>, features: Collection<String>?): GroupReplyView {
        val r = x.run
        val bot = bots.firstOrNull { it.id == r.botId }
        val ended = if (r.status == "success" || r.isRunning) null else endedWords(r, features)
        val asking = asks?.runId == r.id && r.status == "success"
        return GroupReplyView(
            id = x.id,
            run = r,
            bot = bot,
            name = bot?.name ?: r.botName.ifBlank { tr("A bot") },
            color = bot?.color ?: r.botColor ?: GONE_COLOR,
            figureState = if (r.status == "error") "failed" else "idle",
            reply = if (r.status == "success") r.result.orEmpty().ifBlank { if (r.files.isNullOrEmpty()) tr("Done.") else "" } else null,
            ended = ended?.text,
            problem = ended is Ended.Problem,
            files = r.files.orEmpty(),
            choices = if (asking) r.choices.orEmpty() else emptyList(),
            yes = if (asking) r.yes ?: -1 else -1,
            questions = if (asking) r.questions.orEmpty() else emptyList(),
            questionChoices = if (asking) r.questions.orEmpty().indices.map { r.questionChoices?.getOrNull(it).orEmpty() } else emptyList(),
        )
    }

    companion object {
        const val PAGE = 50
        /** The grey of a bot that is gone, and of a group whose bots are all gone. */
        const val GONE_COLOR = "#888780"
        private val SPACES = Regex("\\s+")

        /** "Coder", "Coder and Reviewer", "Coder, Reviewer and Issue Writer". */
        fun namesList(names: List<String>): String =
            if (names.size > 1) tr("{names} and {last}", "names" to names.dropLast(1).joinToString(", "), "last" to names.last()) else names.firstOrNull().orEmpty()

        /** A member's name now, or "A bot" for one that is gone. */
        fun memberName(bots: List<Bot>, botId: String?): String = bots.firstOrNull { it.id == botId }?.name ?: tr("A bot")

        /** A member's colour now, or grey for one that is gone. */
        fun memberColor(bots: List<Bot>, botId: String?): String = bots.firstOrNull { it.id == botId }?.color ?: GONE_COLOR

        /** Under a message of the owner's that waits for busy members: for whom; "" when it waits for nobody. */
        fun waitsLine(m: GroupMessage, bots: List<Bot>): String {
            val names = m.waitsFor.map { memberName(bots, it) }
            return if (names.isEmpty()) "" else if (names.size > 1) tr("Waits until {names} are free", "names" to namesList(names)) else tr("Waits until {names} is free", "names" to namesList(names))
        }

        /** A message none of whose turns has started, that waits for a busy member or for Claude's sign-in: drawn at the end. */
        fun waitsWhole(m: GroupMessage, bots: List<Bot>, signedOut: Boolean): Boolean = !m.byChief && m.canTakeBack && (waitsLine(m, bots).isNotEmpty() || signedOut)

        /** A member's working line: its name, and what it does in the server's words, or that it waits for the owner's OK. */
        fun workingWords(name: String, line: TurnLine?, opening: String?): String = "$name · " +
            if (line?.held == true) OpeningLine.WAITING_FOR_OK else "${OpeningLine.text(line?.text).ifEmpty { OpeningLine.text(opening) }.ifEmpty { tr("Working") }}…"
    }
}
