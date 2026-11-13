package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.Attachment
import dev.botdot.app.data.Bot
import dev.botdot.app.data.DocumentView
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.GroupAsks
import dev.botdot.app.data.GroupChatItems
import dev.botdot.app.data.GroupItem
import dev.botdot.app.data.GroupLimit
import dev.botdot.app.data.GroupMessage
import dev.botdot.app.data.GroupQuestion
import dev.botdot.app.data.GroupSent
import dev.botdot.app.data.GroupWorking
import dev.botdot.app.data.Groups
import dev.botdot.app.data.MEMORY_CHIPS
import dev.botdot.app.data.Mentions
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.Plan
import dev.botdot.app.data.ReplyDraft
import dev.botdot.app.data.Run
import dev.botdot.app.data.RunEvent
import dev.botdot.app.data.Unread
import dev.botdot.app.data.AskedBot
import dev.botdot.app.data.announces
import dev.botdot.app.data.groupKey
import dev.botdot.app.data.hasGroupAll
import dev.botdot.app.data.isTrue
import dev.botdot.app.data.str
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * A group's chat, kept while it is open (and while the phone turns): the owner's messages and the replies as the
 * botdot server hands them out, the members at work, the open question and the stopped line. The one message the
 * app draws itself is the owner's own, from Send until the server's answer or the feed has it ([sent]).
 */
@OptIn(FlowPreview::class)
class GroupChatModel(private val app: BotDotApp, val groupId: String) : ViewModel() {
    private val _notes = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** Something to say at the bottom of the screen ("Couldn't load"). */
    val notes: SharedFlow<String> = _notes

    /** A file is uploaded to the group, where no bot reads it: each member with a turn on the message is handed a copy. */
    val files = PendingFiles(viewModelScope, app, { app.api.value }, { groupKey(groupId) }) { _notes.tryEmit(it) }

    private val held = GroupChatItems()
    /** The chat's rows, oldest first. */
    var rows by mutableStateOf<List<GroupItem>>(emptyList())
        private set
    /** The members at work in the group, in the order they started. */
    var working by mutableStateOf<List<GroupWorking>>(emptyList())
        private set
    /** The group's open question: the answer buttons stand under the reply that asked. */
    var asks by mutableStateOf<GroupAsks?>(null)
        private set
    /** The line that stopped at the limit of replies, or null. */
    var limit by mutableStateOf<GroupLimit?>(null)
        private set
    var loaded by mutableStateOf(false)
        private set
    private var want = PAGE
    private var asked = 0
    private var taken = 0
    private var loadingOlder = false

    private fun publish() { rows = held.rows(); publishDrafts() }

    /** The replies of the turns at work as they are written, each with its turn (ReplyDraft): under the replies. */
    var drafts by mutableStateOf<List<Pair<GroupWorking, String>>>(emptyList())
        private set
    private val heldDrafts = ReplyDraft.Group()
    private fun publishDrafts() { drafts = heldDrafts.shown(rows.filterIsInstance<GroupItem.Reply>().mapTo(HashSet()) { it.id }) }

    /**
     * While the chat is on screen (the screen calls it, and leaving it ends it): from a server with drafts, the run
     * stream of each turn at work is followed for its draft. The feed sends no draft. A turn that ended keeps its
     * draft until its reply is among the rows; a pass takes it away (group_run_finished), and so does leaving.
     */
    suspend fun followDrafts() = coroutineScope {
        val streams = HashMap<String, Job>()
        try {
            snapshotFlow { working.toList() }.collect { now ->
                val at = if (ReplyDraft.shows(app.store.version.value.value?.features)) now.associateBy { it.runId } else emptyMap()
                streams.keys.filter { it !in at }.forEach { streams.remove(it)?.cancel() }
                for ((id, w) in at) if (id !in streams) streams[id] = launch {
                    // A stream that dropped while the turn still works (a dead socket fails after a quiet spell, #1078)
                    // is followed again; one that ended is done, and the turn's end takes it away.
                    while (isActive) {
                        val failed = runCatching { app.api.value?.runStream(id)?.collect { ev -> if (ev is RunEvent.Draft) { heldDrafts.say(w, ev.text); publishDrafts() } } }.exceptionOrNull()
                        if (failed == null || failed is kotlinx.coroutines.CancellationException) break
                        delay(2_000)
                    }
                }
            }
        } finally {
            heldDrafts.clear()
            publishDrafts()
        }
    }

    /** The reply the "New" line is drawn above: the server's first new reply when the chat came on screen. Kept until the chat is left. */
    var newFirst by mutableStateOf<String?>(null)
        private set

    /** As [BotChatModel.arrive]: where the server says the group's new replies begin now, asked before the chat is reported as read. */
    suspend fun arrive(): Boolean {
        val asked = runCatching { withTimeoutOrNull(ASK_MS) { app.api.value?.group(groupId) } }.getOrNull()
        currentCoroutineContext().ensureActive() // the chat was left meanwhile: nothing is placed, nothing reported
        val now = asked ?: app.store.groups.value.value?.firstOrNull { it.id == groupId } ?: return false
        val first = Unread.line(newFirst, now.unread, now.firstUnread)
        if (first == newFirst) return false
        newFirst = first
        return true
    }

    /** The chat was left: its line goes. */
    fun leave() { newFirst = null }

    /** Waits for the chat, and brings in the reply the line is at: one from while the app was away, or one further back. */
    suspend fun reachNew(): Boolean {
        val id = newFirst ?: return false
        snapshotFlow { loaded }.first { it }
        load()
        if (!held.has(id) && held.more) load(REACH)
        return held.has(id)
    }

    private val kicks = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    init {
        viewModelScope.launch { app.api.filterNotNull().first(); load() }
        // What the feed says of this group changes what the chat holds at once; the chat is read again after it.
        viewModelScope.launch {
            app.feed.events.collect { ev ->
                val d = ev.data
                when {
                    ev.type == "reset" -> load()
                    !ev.type.startsWith("group_") || d.str("groupId") != groupId -> Unit
                    // A page asked a moment before either answers as the chat was then: the chat is read again after it.
                    ev.type == "group_message" -> { GroupMessage.of(d["message"])?.let { if (held.hold(it)) publish() }; kicks.tryEmit(Unit) }
                    ev.type == "group_message_gone" -> { if (held.remove(d.str("id"))) publish(); kicks.tryEmit(Unit) }
                    ev.type == "group_run_started" -> {
                        val run = d.str("id")
                        if (run.isNotEmpty() && d.str("botId").isNotEmpty() && working.none { it.runId == run }) working = working + GroupWorking(d.str("botId"), run, d.str("groupMessageId").ifEmpty { null }, d.str("startedAt").ifEmpty { null })
                        kicks.tryEmit(Unit)
                    }
                    ev.type == "group_run_finished" -> {
                        working = working.filterNot { it.runId == d.str("id") }
                        if (isTrue(d["passed"])) { heldDrafts.passed(d.str("id")); publishDrafts() } // a pass leaves nothing, not even its draft
                        kicks.tryEmit(Unit)
                    }
                    // A member's plan changed: on its turn as the chat holds it, drawn above the message box.
                    ev.type == "group_run_plan" -> d.str("runId").let { run -> working = working.map { if (it.runId == run) it.copy(plan = Plan.of(d["plan"])) else it } }
                    ev.type == "group_asks" -> asks = GroupAsks.of(d["asks"])
                    ev.type == "group_limit" -> { limit = GroupLimit.of(d["limit"]); kicks.tryEmit(Unit) }
                }
            }
        }
        viewModelScope.launch { kicks.debounce(250).collect { load() } }
    }

    /** The chat's newest items (again). [reach]: read this many of them, when more than the usual page. */
    suspend fun load(reach: Int = 0) {
        val a = app.api.value ?: return
        want = minOf(maxOf(want, reach), REACH)
        val mine = ++asked
        val page = try { a.groupChat(groupId, want) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) {
            if (!loaded) _notes.tryEmit(e.message ?: tr("Couldn't load"))
            return
        }
        if (mine < taken) return // a later answer is drawn already
        taken = mine
        held.take(page)
        working = page.working
        asks = page.asks
        limit = page.limit
        app.store.turnLines.read(groupId, page.working) // each member's line, as the chat has it now
        loaded = true
        publish()
    }

    /** The page before the oldest item held (the chat was scrolled up). */
    fun loadOlder() {
        if (!held.more || loadingOlder || !loaded) return
        val oldest = held.oldest?.id ?: return
        loadingOlder = true
        viewModelScope.launch {
            runCatching { app.api.value?.groupChat(groupId, PAGE, before = oldest) }.onSuccess { page -> if (page != null) { held.take(page, older = true); publish() } }
            loadingOlder = false
        }
    }

    /** What its message box is told about a send: under way, failed and why, the message to take back. */
    val outbox = Outbox.of(groupKey(groupId))

    private fun took(sent: GroupSent) {
        sent.held.forEach { held.hold(it) }
        if (sent.wentOn) limit = null // "Go on", typed: no message of its own, and the line is no longer stopped
        publish()
    }

    /**
     * The owner writes in the group: one message, and the server gives the turns. True once it went. [box]: it came
     * from the message box, and goes back there when it failed. As [BotChatModel.send], the request outlives the screen.
     */
    fun send(text: String, attachments: List<Attachment>, box: Boolean = true, key: String? = null): Deferred<Boolean> {
        val known = ownWords(rows).mapTo(HashSet()) { it.id }
        // "Go on", typed while the group is stopped at the limit, is no message: nothing is drawn for it.
        val draw = !(limit != null && isGoOn(text))
        // Begun in the tap itself: the message is in the chat before anything else is drawn.
        return app.scope.async(start = CoroutineStart.UNDISPATCHED) {
            outbox.send(text, attachments, box, key, once = takesOnce(app.store.version.value.value?.features), known = known, draw = draw) { k ->
                took((app.api.value ?: throw ApiException(NOT_CONNECTED)).sendToGroup(groupId, text, attachments, k))
            }
        }.also { sent -> viewModelScope.launch { sent.await(); load() } }
    }

    /** As [BotChatModel.sent]: the owner's message on its way, until the answer or the feed has put the server's in the chat. */
    val sent: SentMessage? by derivedStateOf { outbox.sent?.unlessIn(ownWords(rows)) }

    private val taking = HashSet<String>()

    /** "Take back" on a message none of whose turns has started, as [BotChatModel.takeBack]. */
    fun takeBack(m: GroupMessage) {
        if (!taking.add(m.id)) return
        val back = app.scope.async { outbox.takeBack { (app.api.value ?: throw ApiException(NOT_CONNECTED)).takeBackFromGroup(groupId, m.id) } }
        viewModelScope.launch {
            if (back.await() && held.remove(m.id)) publish()
            taking.remove(m.id)
            load()
        }
    }

    /** "Stop all": every run of the group at work ends, and the turns that would have followed never start. */
    fun stopAll() {
        viewModelScope.launch {
            runCatching { app.api.value?.stopGroup(groupId) }.onError { _notes.tryEmit(it.message ?: tr("Couldn't stop")) }
            load()
        }
    }

    /** "Go on": the group stopped at the limit gets its next replies. A group that is no longer stopped says so in the server's words. */
    fun goOn() {
        viewModelScope.launch {
            runCatching { (app.api.value ?: throw ApiException(NOT_CONNECTED)).goOn(groupId) }.onSuccess { if (it.wentOn) took(it) }.onError { _notes.tryEmit(it.message ?: tr("That didn't work")) }
            load()
        }
    }

    companion object {
        const val PAGE = 50
        const val REACH = 200 // the most one request reads: for a "New" line further back
        private const val ASK_MS = 3_000L
        private val NOT_CONNECTED: String get() = tr("Not connected to botdot")
    }
}

/** The owner's messages among a group's rows: what [SentMessage.unlessIn] looks through. */
internal fun ownWords(rows: List<GroupItem>): List<dev.botdot.app.data.Queued> =
    rows.filterIsInstance<GroupItem.Message>().map { dev.botdot.app.data.Queued(it.message.id, it.message.text, it.message.attachments) }

/**
 * A group's chat: the owner's messages and every reply under its bot's name, in the bot's colour, with its head
 * beside it. Under the chat stands one line per working member and one "Stop all", under them the small heads of
 * the members whose turn has not come, the line that the group stopped at the limit with "Go on", the messages that
 * wait for a busy member with "Take back", and the cards asked in the group. The title opens the group's settings.
 */
@Composable
fun GroupChatScreen(app: BotDotApp, groupId: String, onSettings: () -> Unit, onNeeds: () -> Unit, onSignIn: () -> Unit = {}, onBack: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    val vm: GroupChatModel = viewModel(key = groupKey(groupId)) { GroupChatModel(app, groupId) }
    val botsNow by app.store.bots.value.collectAsState()
    val bots = botsNow.orEmpty()
    val groupsNow by app.store.groups.value.collectAsState()
    val group = remember(groupsNow, groupId) { groupsNow?.firstOrNull { it.id == groupId } }
    val members = remember(group, botsNow) { group?.let { Groups.members(it, bots) }.orEmpty() }
    val turnLines by app.store.turnLines.value.collectAsState()
    val server by app.store.version.value.collectAsState()
    val features = server?.features
    val signedOut by app.store.claude.signedOut.collectAsState()
    val backAt by app.store.claude.backAt.collectAsState()
    val listState = rememberLazyListState()
    val chatKey = groupKey(groupId)
    // The plan of a member at work, above the message box (docs/api.md, "The plan"), folded as the owner left it here.
    var planFolded by remember(groupId) { mutableStateOf(app.plans.folded(chatKey)) }
    val groupPlan = GroupWorking.planOf(vm.working)

    LaunchedEffect(vm) { vm.notes.collect { scope.launch { snack.showSnackbar(it) } } }
    // Deleted, here or in another app: there is no chat to show. The list is read once more first: a group made a
    // moment ago, opened from its notification, may not be in the list the app holds.
    LaunchedEffect(groupsNow != null, group == null) {
        if (groupsNow == null || group != null) return@LaunchedEffect
        app.store.groups.refresh()
        // A read that failed says nothing of the group: the chat stays.
        if (app.store.groups.error.value == null && app.store.groups.value.value?.none { it.id == groupId } == true) onBack()
    }
    // Near the top (the list is upside down: near its end): the page before.
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.let { (it.visibleItemsInfo.lastOrNull()?.index ?: 0) >= it.totalItemsCount - 4 } }
            .collect { near -> if (near) vm.loadOlder() }
    }
    LaunchedEffect(vm, ReplyDraft.shows(features)) { vm.followDrafts() } // its turns' drafts, while the chat is on screen; again once the features are known
    DisposableEffect(groupId) {
        app.notifier.visibleChat = chatKey
        onDispose { if (app.notifier.visibleChat == chatKey) app.notifier.visibleChat = null }
    }
    // The messages that wait whole stand at the end of the chat; the rest in their place, newest first for the list.
    val waiting by remember(botsNow, signedOut) { derivedStateOf { vm.rows.filterIsInstance<GroupItem.Message>().map { it.message }.filter { waitsWhole(it, bots, signedOut) } } }
    // The members' replies a team's answer folds (ADR 201) stand under one row, open while the owner keeps it open.
    val openFolds = remember(groupId) { mutableStateMapOf<String, Boolean>() }
    val shown by remember(botsNow, signedOut) { derivedStateOf { Groups.shown(vm.rows.filterNot { it is GroupItem.Message && waitsWhole(it.message, bots, signedOut) }, openFolds.keys.toSet()).asReversed() } }
    // The head on the button to the newest message (ToLatestButton): the member whose reply is newest.
    @Composable fun newestHead() {
        val r = shown.firstNotNullOfOrNull { (it as? GroupItem.Reply)?.run } ?: return
        BotFigure(memberColor(bots, r.botId, r.botColor), "idle", 20, bots.firstOrNull { it.id == r.botId }?.outfit)
    }
    // Who is next, of the one message the rule picks (Groups.next): its heads stand under the working lines.
    val next by remember { derivedStateOf { Groups.next(vm.rows.filterIsInstance<GroupItem.Message>().map { it.message }, vm.working) } }
    // New replies: the "New" line above the first of them, and the report that reads the group in every app.
    NewReplies(app, chatKey, group?.unread ?: 0, arrive = { vm.arrive() }, leave = { vm.leave() }) {
        if (!vm.reachNew()) return@NewReplies
        listState.showFromTop {
            val i = shown.indexOfFirst { (it as? GroupItem)?.id == vm.newFirst }
            (1 + i).takeIf { i >= 0 && listState.layoutInfo.totalItemsCount == 1 + shown.size }
        }
    }

    // A reply arrives, visibly: which of them are new in this open chat, told on every draw (Arrivals). A reply is
    // told by its turn's id; the owner's message arrives on Send, and not again as the server's.
    val arrivals = remember { Arrivals() }
    val onItsWay = vm.sent
    arrivals.draw(chatKey, vm.loaded, groupReplyIds(vm.rows), onItsWay?.key)
    val sentArrives = Modifier.arrives(arrivals, onItsWay?.let { Arrivals.sent(it.key) })

    suspend fun sendFrom(text: String, key: String): Boolean = vm.send(text, emptyList(), box = false, key = key).await()

    // Typing "@" in a group suggests its members, and "@all" first at the start of a message (#124); a member named in
    // the owner's message is drawn as a mention.
    val all = hasGroupAll(features)
    val (mentionPages, mentionTiles) = rememberMentionables(app) // a page or a tile, named for every turn (#473)
    val mentionProjects = rememberProjectMentions(app) // a project, named for every turn (#700)
    val mentions = remember(members, chatKey, all, mentionPages, mentionTiles, mentionProjects) { Mentions.World(chatKey, members, emptyList(), all, pages = mentionPages, tiles = mentionTiles, projects = mentionProjects) }
    // Text selected in a message is quoted into this chat's message box (QuoteUi.kt).
    // Where this chat opens on the web page, for the link under a diagram (Markdown.kt).
    val api by app.api.collectAsState()
    // A file you sent in this group opens in the viewer (#268).
    val ownFiles = remember(groupId, server?.features) { { f: Attachment -> DocumentView.groupUpload(groupId, f.file) }.takeIf { DocumentView.opensChatFiles(server?.features) } }
    CompositionLocalProvider(LocalMentions provides mentions, LocalQuote provides remember(chatKey) { QuoteBox() }, LocalChatOnWeb provides api?.let { chatOnWeb(it.baseUrl, "group", groupId) }, LocalOwnFiles provides ownFiles, LocalSiteIcons provides sitesShown(features), LocalProductCards provides productCardsShown(features)) {
        Scaffold(
            containerColor = p.bg,
            snackbarHost = { BotSnackbarHost(snack) },
            topBar = {
                // A team's chat (#697, #705) follows its team in Projects: its faces in a row, the lead first, how many
                // work, its colour on top. Its name opens its panel, as a group's does: its members and its notes.
                if (group?.team != null) Column {
                    Box(Modifier.fillMaxWidth().height(3.dp).background(parseColor(group.color, p.muted)))
                    val (n, at) = Groups.teamCount(group, bots)
                    ChatBar(null, "idle", group.name, onName = onSettings, onBack = onBack, nameLabel = group.name, picture = { TeamPicture(Groups.teamFaces(group, bots), group.lead, 26) })
                    // Under its name: how many bots, and how many work now.
                    Text(teamLine(n, at), color = p.muted, fontSize = Type.s12, maxLines = 1, modifier = Modifier.padding(start = 72.dp).offset(y = (-Space.s8)))
                }
                else ChatBar(null, "idle", group?.name.orEmpty(), onName = onSettings, onBack = onBack, nameLabel = tr("Its name and its members"), picture = { GroupPicture(members, 32) })
            },
            bottomBar = { Column {
                groupPlan?.let { (w, view) ->
                    val bot = bots.firstOrNull { it.id == w.botId }
                    PlanDock(view, bot?.color, bot?.name ?: tr("It"), planFolded, onFold = { planFolded = it; app.plans.setFolded(chatKey, it) }, onDismiss = {})
                }
                Composer(
                    placeholder = group?.name?.let { tr("Message {name}…", "name" to it) } ?: tr("Message the group…"),
                    files = vm.files,
                    busy = false, // a message to a group whose members work waits its turn: Send stays
                    outbox = vm.outbox,
                    onSend = { text, attachments -> vm.send(text, attachments) },
                    onStop = {},
                    onError = { scope.launch { snack.showError(it) } },
                    onSignIn = onSignIn.takeIf { signedOut },
                    backAt = backAt,
                )
            } },
        ) { pad ->
            Box(Modifier.fillMaxSize()) {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    state = listState,
                    reverseLayout = true, // newest at the bottom, and the list starts there
                    contentPadding = PaddingValues(start = Space.s16, end = Space.s16, top = pad.calculateTopPadding() + Space.s4, bottom = pad.calculateBottomPadding() + Space.s4),
                    verticalArrangement = Arrangement.spacedBy(Space.s12, Alignment.Bottom),
                ) {
                    // Last in the chat: the stopped line with "Go on", one line per member at work with one "Stop all", the
                    // messages that wait, and what the group waits for the owner's OK on.
                    item(key = "tail") {
                        Column {
                            // The replies being written, under the member's name, each in the bubble its reply will have.
                            vm.drafts.forEach { (w, text) -> androidx.compose.runtime.key(w.runId) { GroupDraft(text, bots.firstOrNull { it.id == w.botId }, memberName(bots, w.botId), memberColor(bots, w.botId)) } }
                            vm.limit?.let { StoppedLine(it.text) { vm.goOn() } }
                            // The owner's message on its way: above one line "Working…" while no member works, which the
                            // members' own lines replace; under what waits already while some do.
                            val sent = vm.sent
                            if (sent != null && vm.working.isEmpty()) { SentBubble(sent, above = true, sentArrives); StatusLine(lineWith("", sent), null, room = true) }
                            vm.working.forEachIndexed { i, w ->
                                val line = turnLines[w.runId]
                                StatusLine(workingWords(memberName(bots, w.botId), line, OpeningLine.ofRun(w.workingLine, w.openingLine, app.store.lines.features)), memberColor(bots, w.botId), still = line?.held == true,
                                    onStop = if (i == vm.working.lastIndex) ({ vm.stopAll() }) else null, stopWord = tr("Stop all"))
                            }
                            // Who is next: the members whose turn has not come, also between two turns, when no line stands.
                            NextHeads(Groups.heads(next, bots))
                            if (waiting.isNotEmpty()) Column(Modifier.fillMaxWidth().padding(top = Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                                waiting.forEach { m -> androidx.compose.runtime.key(m.id) { WaitingMessage(m.text, m.attachments, waitsWords(m, bots)) { vm.takeBack(m) } } }
                            }
                            if (sent != null && vm.working.isNotEmpty()) SentBubble(sent, above = false, sentArrives)
                            ChatNeeds(app, chatKey)
                        }
                    }
                    if (vm.loaded && vm.rows.isEmpty() && vm.sent == null) item {
                        Column(Modifier.fillMaxWidth().padding(Space.s24), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s12)) {
                            GroupPicture(members, 72)
                            Text(group?.name.orEmpty(), color = p.text, style = MaterialTheme.typography.titleMedium)
                            Text(emptyGroupWords(members.map { it.name }), color = p.muted, textAlign = TextAlign.Center)
                        }
                    }
                    itemsIndexed(shown, key = { _, it -> (it as? GroupItem)?.id ?: (it as Groups.Fold).id }) { i, x ->
                        when (x) {
                            is Groups.Fold -> FoldRow(x, bots) { if (x.open) openFolds.remove(x.messageId) else openFolds[x.messageId] = true }
                            is GroupItem.Message -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                                // The question it answers, unless right under it (shown is newest first): a tap goes to it.
                                Groups.questionAbove(x.message, shown.getOrNull(i + 1))?.let { q ->
                                    QuestionRow(q, bots) {
                                        Groups.folded(vm.rows)[q.runId]?.let { openFolds[it] = true }
                                        scope.launch {
                                            val at = withTimeoutOrNull(1_000) { snapshotFlow { shown.indexOfFirst { (it as? GroupItem)?.id == q.runId } }.first { it >= 0 } }
                                            if (at != null) listState.animateScrollToItem(1 + at)
                                        }
                                    }
                                }
                                if (x.message.byChief) ManagerMessage(x.message, bots.firstOrNull { it.id == x.message.asBot }) else MyBubble(x.message.text, x.message.attachments)
                                // Its first turns went, and it still waits for a busy member: for whom.
                                waitsLine(x.message, bots).let { if (it.isNotEmpty()) Text(it, color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(top = Space.s4, end = Space.s8)) }
                            }
                            is GroupItem.Reply -> Column(Modifier.arrives(arrivals, x.id), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                                val bot = bots.firstOrNull { it.id == x.run.botId }
                                if (x.id == vm.newFirst) NewLine(memberColor(bots, x.run.botId, x.run.botColor))
                                // The answer buttons of the group's open question stand under the reply that asked: an
                                // answer is a message to the group, and the member that asked has the first turn.
                                GroupReply(x.run, bot, features, asks = vm.asks?.runId == x.run.id) { text, key -> sendFrom(text, key) }
                            }
                        }
                    }
                }
                ToLatestButton(listState, groupId, shown.firstOrNull()?.let { (it as? GroupItem)?.id ?: (it as Groups.Fold).id }, pad.calculateBottomPadding()) { newestHead() }
            }
        }
    }
}

/**
 * The row a team's answer folds its members' replies under (ADR 201): their small heads and names, and how many; a
 * tap opens or closes them.
 */
/** The question an owner's message answers ([Groups.questionAbove]), above it: the asker's head and the question. */
@Composable
private fun QuestionRow(q: GroupQuestion, bots: List<Bot>, onClick: () -> Unit) {
    val p = LocalPaper.current
    val b = bots.firstOrNull { it.id == q.botId }
    Row(Modifier.padding(bottom = Space.s4).clip(RoundedCornerShape(14.dp)).background(p.raise2).clickable(onClick = onClick)
        .padding(start = Space.s4, end = Space.s12, top = Space.s4, bottom = Space.s4),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        SmallFigure(b?.color ?: memberColor(bots, q.botId), b?.outfit, 20.dp)
        Text(q.text, color = p.muted, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun FoldRow(f: Groups.Fold, bots: List<Bot>, onToggle: () -> Unit) {
    val p = LocalPaper.current
    val who = f.runs.distinctBy { it.botId }
    Row(Modifier.padding(start = 34.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onToggle).padding(horizontal = Space.s8, vertical = Space.s4),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
        Text(if (f.open) "\u25BE" else "\u25B8", color = p.muted, fontSize = Type.s12)
        who.forEach { r -> val b = bots.firstOrNull { it.id == r.botId }; SmallFigure(b?.color ?: r.botColor, b?.outfit, 14.dp) }
        Text("${namesList(who.map { r -> memberName(bots, r.botId).ifBlank { r.botName } })} · ${f.runs.size}", color = p.muted, fontSize = Type.s12)
    }
}

/**
 * The Project Manager's message in a team's chat (ADR 217): the Chief's head and name, on the bots' side, or the
 * project's lead's ([lead], ADR 227) when it wrote as that bot (web: groupMessageHTML).
 */
@Composable
private fun ManagerMessage(m: GroupMessage, lead: Bot?) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = Space.s16)) { if (lead != null) BotFigure(lead.color, "idle", 28, lead.outfit) else BotFigure(CHIEF_COLOR, "idle", 28, FigureDef.CHIEF) }
        Spacer(Modifier.size(6.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Text(lead?.name ?: LocalChiefName.current, color = parseColor(lead?.color ?: CHIEF_COLOR, LocalPaper.current.muted), fontSize = Type.s12, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = Space.s8))
            TheirBubble(shortTime(m.at), copyText = m.text) { MarkdownText(m.text) }
        }
    }
}

/** A member's reply as it is written (ReplyDraft): its head and name, as [GroupReply] has them, and its draft in a bubble. */
@Composable
private fun GroupDraft(text: String, bot: Bot?, name: String, color: String?) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().padding(bottom = Space.s12), verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = Space.s16)) { BotFigure(color, "working", 28, bot?.outfit) }
        Spacer(Modifier.size(6.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Text(name, color = parseColor(color, p.muted), fontSize = Type.s12, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = Space.s8))
            TheirBubble { MarkdownText(draftSource(text), copy = false) }
        }
    }
}

/** The line that the group stopped at the limit of replies, in the server's sentence, with "Go on". */
@Composable
private fun StoppedLine(text: String, onGoOn: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().padding(vertical = Space.s8), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
        Text(text, color = p.muted, fontSize = Type.s14, lineHeight = Type.line20, modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite })
        SecondaryButton(onClick = onGoOn) { Text(tr("Go on"), color = p.text) }
    }
}

/**
 * Who is next in a group: the small heads of the members whose turn has not come, in their colours and hats, in the
 * order they will answer. They never move, and carry no words and no count: a screen reader is told their names.
 * Nothing when nobody is to come.
 */
@Composable
private fun NextHeads(heads: List<Bot>) {
    if (heads.isEmpty()) return
    val words = nextWords(heads.map { it.name })
    Row(Modifier.padding(start = Space.s4, top = Space.s8, bottom = Space.s8).semantics(mergeDescendants = true) { contentDescription = words },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        heads.forEach { SmallFigure(it.color, it.outfit, 16.dp) }
    }
}

/**
 * One reply in a group: its bot's head beside it and its bot's name above it, in the bot's colour. A reply that
 * failed, was stopped or was cut says so under the same name. [bot]: its member as it is now, null when it is gone:
 * the name and the colour are then the run's. [asks]: it is the group's open question, and has its answer buttons.
 */
@Composable
private fun GroupReply(r: Run, bot: Bot?, features: Collection<String>?, asks: Boolean, onAnswer: suspend (String, String) -> Boolean) {
    val p = LocalPaper.current
    val color = bot?.color ?: r.botColor ?: GONE_COLOR
    val footer = shortTime(r.endedAt ?: r.startedAt)
    val whole = announces(features, MEMORY_CHIPS)
    val learned: List<Pair<CharSequence, (() -> Unit)?>> = r.learned.orEmpty().map { it.line(features) to null }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = Space.s16)) { BotFigure(color, if (r.status == "error") "failed" else "idle", 28, bot?.outfit) }
        Spacer(Modifier.size(6.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            Text(bot?.name ?: r.botName.ifBlank { tr("A bot") }, color = parseColor(color, p.muted), fontSize = Type.s12, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = Space.s8))
            r.asked.orEmpty().filter { it.text.isNotBlank() }.forEach { AskedFold(it) }
            when (r.status) {
                "success" -> TheirBubble(footer, copyText = r.result, chips = learned, wholeChips = whole) {
                    // A path in its reply opens in the viewer (#251), from its own folder or the computer.
                    CompositionLocalProvider(LocalPathActions provides rememberPathActions(r.botId, bot?.name ?: r.botName), LocalProductSaver provides r.botId) {
                        Column { MarkdownText(r.result.orEmpty().ifBlank { if (r.files.isNullOrEmpty()) tr("Done.") else "" }); OpenAsDocument(r.result, bot?.name ?: r.botName); BotFilesRow(r.files); PlanFold(r.plan) }
                    }
                }
                else -> when (val ended = endedWords(r, features)) {
                    is Ended.Stopped -> TheirBubble(footer, chips = learned, wholeChips = whole) { Text(ended.text, color = p.muted) }
                    is Ended.Problem -> TheirBubble(footer, error = true, copyText = r.error?.ifBlank { null } ?: ended.text, chips = learned, wholeChips = whole) {
                        Text(ended.text, color = p.text, style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
            RunScreenshots(r)
            if (asks && r.status == "success") {
                Choices(r.choices, r.yes, color, onAnswer)
                Questions(r.questions, r.questionChoices, onAnswer)
            }
        }
    }
}

/**
 * A bot outside the group this turn asked (ADR 219): one folded line, "Asked Mail Steward" with its small head and the
 * first words of its answer, that opens to the question and the answer. An ask with no answer yet opens to its question.
 */
@Composable
private fun AskedFold(a: AskedBot) {
    val p = LocalPaper.current
    var open by remember(a.id, a.at) { mutableStateOf(false) }
    val who = named(LocalMentions.current?.bot(a.id), a.name, a.color)
    val line = androidx.compose.ui.text.buildAnnotatedString {
        append(tr("Asked") + " ")
        bot(who)
        append(if (open) " ⌄" else " ›")
        val peek = foldPeek(a.reply ?: a.text)
        if (!open && peek.isNotEmpty()) pushStyle(androidx.compose.ui.text.SpanStyle(color = p.faint)).also { append("  $peek"); pop() }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        FigureText(line, color = p.muted, fontSize = Type.s14, maxLines = 1,
            modifier = Modifier.clip(Radius.small).clickable { open = !open }.padding(horizontal = Space.s8, vertical = Space.s4))
        Unfold(open) { Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            Column(Modifier.raised(Radius.mine).padding(horizontal = Space.s16, vertical = Space.s12)) { MarkdownText(a.text) }
            a.reply?.takeIf { it.isNotBlank() }?.let { reply ->
                Column(Modifier.raised(Radius.mine).padding(horizontal = Space.s16, vertical = Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                    FigureText(androidx.compose.ui.text.buildAnnotatedString { bot(who) }, color = p.muted, fontSize = Type.s12, maxLines = 1)
                    MarkdownText(reply)
                }
            }
        } }
    }
}

/** Under a team chat's name (#697): how many bots, and how many of them work now. */
internal fun teamLine(n: Int, working: Int): String {
    val bots = trn(n, "{n} bot", "{n} bots")
    return if (working > 0) bots + " · " + trn(working, "{n} working", "{n} working") else bots
}
