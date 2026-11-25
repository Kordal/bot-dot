package dev.botdot.app.ui

import dev.botdot.app.data.ApiException
import dev.botdot.app.data.NOT_CONNECTED
import dev.botdot.app.data.hasChoicesDismiss
import dev.botdot.app.data.endedWords
import dev.botdot.app.data.replyText
import dev.botdot.app.data.Ended
import dev.botdot.app.data.ENDED_BY
import dev.botdot.app.data.without
import dev.botdot.app.data.sendStays
import dev.botdot.app.data.lineWith
import dev.botdot.app.data.canSteer
import dev.botdot.app.data.boxStops
import dev.botdot.app.data.SentMessage
import dev.botdot.app.markdown.draftSource
import dev.botdot.app.data.plainText
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.ChatOrder
import dev.botdot.app.data.EmptyChatJobs
import dev.botdot.app.data.Bot
import dev.botdot.app.data.RunEvent
import dev.botdot.app.data.InboxNote
import dev.botdot.app.data.NotesWake
import dev.botdot.app.data.Learned
import dev.botdot.app.data.MEMORY_CHIPS
import dev.botdot.app.data.announces
import dev.botdot.app.data.Plan
import dev.botdot.app.data.Run
import dev.botdot.app.data.RunSteps
import dev.botdot.app.data.SentTo
import dev.botdot.app.data.AnswerQuote
import dev.botdot.app.data.Unread
import dev.botdot.app.data.str
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A bot's chat: its runs as messages (your task, its reply), and one status line while it works. Right of its name
 * stands a very small plus, "Add a bot to this chat": it makes a group of this bot and those picked, and [onGroup]
 * opens it. Only against a botdot server that has groups, and with another bot to add.
 */
@Composable
fun BotChatScreen(app: BotDotApp, botId: String, shared: List<Uri>, sharedText: String, onJobs: () -> Unit, onSettings: () -> Unit, onScreen: () -> Unit, onNeeds: () -> Unit, onLearned: (skill: String?) -> Unit = { onSettings() }, onSignIn: () -> Unit = {}, onGroup: (String) -> Unit = {}, onFiles: () -> Unit = {}, onBack: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    val vm: BotChatModel = viewModel(key = "bot:$botId") { BotChatModel(app, botId) }
    // The bot itself (its name, figure, jobs) as the app keeps it: kept up to date from the live feed.
    val bots by app.store.bots.value.collectAsState()
    val bot = remember(bots, botId) { bots?.firstOrNull { it.id == botId } }
    val others = remember(bots, botId) { bots.orEmpty().filter { it.id != botId } }
    var makingGroup by remember { mutableStateOf(false) }
    val runs = vm.runs
    // Its newest reply, for the button to it (ToLatestButton): the run, and how far it got.
    val namedHere = remember(runs) { newestNames(runs.sortedBy { it.startedAt }.map { it.id to it.cards.takeIf { _ -> it.status == "success" } }) }
    val newestRun = remember(runs) { ChatOrder.rounds(runs).lastOrNull()?.lastOrNull()?.let { "${it.id}:${it.status}" } }
    val waiting = vm.waiting
    val loaded = vm.loaded
    val files = vm.files
    val listState = rememberLazyListState()
    var opened by remember { mutableStateOf(setOf<String>()) } // runs a search match opened (folded ones between bots)
    val stepsOpen = remember(botId) { androidx.compose.runtime.mutableStateMapOf<String, Boolean>() } // the runs whose steps are open, each with whether it was at work then (#636)

    LaunchedEffect(vm) { vm.notes.collect { scope.launch { snack.showSnackbar(it) } } }
    // From a search match: go to that run (older pages until it's there), and open it if it's folded.
    var marked by remember { mutableStateOf<String?>(null) } // the reply the owner's answer was tapped to: marked for a moment
    // Go to a reply of the chat, open what is folded of it and mark it: a search match, or the question an answer quotes.
    suspend fun showReply(runId: String): Boolean {
        val i = ChatOrder.rounds(vm.runs).asReversed().indexOfFirst { b -> b.any { it.id == runId } } // the chat's blocks, newest first
        if (i < 0) return false
        opened = opened + runId
        listState.scrollToItem(1 + (if (vm.waiting.isNotEmpty()) 1 else 0) + (if (vm.watches.isNotEmpty()) 1 else 0) + i) // below it: what waits for your OK, notes waiting, watches
        return true
    }
    LaunchedEffect(loaded) {
        val j = app.jump ?: return@LaunchedEffect
        if (!loaded || j.bot?.id != botId) return@LaunchedEffect
        app.jump = null
        val runId = j.runId ?: return@LaunchedEffect
        if (!vm.reach(runId)) return@LaunchedEffect
        showReply(runId)
    }
    // The runs its open questions are from (docs/api.md, "A bot that asks"), however far back: older pages until the
    // oldest is in the chat, so "Needs you" on its key points at something to answer. Two runs that went at once and
    // both asked keep both questions (#1380).
    val askedIn = bot?.asks?.runs.orEmpty()
    val oldestAsked = bot?.asks?.reachBack
    LaunchedEffect(loaded, oldestAsked) { if (loaded && oldestAsked != null) vm.reach(oldestAsked) }
    LaunchedEffect(botId) { vm.addShared(shared) }
    // Near the top (the list is upside down: near its end): the page before.
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.let { (it.visibleItemsInfo.lastOrNull()?.index ?: 0) >= it.totalItemsCount - 4 } }
            .collect { near -> if (near) vm.loadOlder() }
    }
    val chatKey = "bot:$botId"
    DisposableEffect(botId) {
        app.notifier.visibleChat = chatKey
        onDispose { if (app.notifier.visibleChat == chatKey) app.notifier.visibleChat = null }
    }
    // New replies: the "New" line where they begin, and the report that reads the chat everywhere.
    NewReplies(app, chatKey, bot?.unread ?: 0, arrive = { vm.arrive() }, leave = { vm.leave() }) {
        if (app.jump != null || !vm.reachNew()) return@NewReplies // a search match is where the chat opens
        listState.showFromTop {
            val blocks = ChatOrder.rounds(vm.runs)
            val i = blocks.asReversed().indexOfFirst { b -> b.any { it.id == vm.newFirst } }
            val below = 1 + (if (vm.waiting.isNotEmpty()) 1 else 0) + (if (vm.watches.isNotEmpty()) 1 else 0) // what waits for your OK, notes waiting, watches
            (below + i).takeIf { i >= 0 && listState.layoutInfo.totalItemsCount == below + blocks.size }
        }
    }

    // A reply arrives, visibly: which of them are new in this open chat, told on every draw. The owner's message
    // on its way is one too, on Send; the run that takes its place is not (Arrivals).
    val arrivals = remember { Arrivals() }
    val onItsWay = vm.sent
    arrivals.draw(chatKey, loaded, replyIds(runs), onItsWay?.key)
    val sentArrives = Modifier.arrives(arrivals, onItsWay?.let { Arrivals.sent(it.key) })

    val running = dev.botdot.app.data.OpeningLine.atWork(runs) // never a script job's: it has no run while its script runs
    val lines by app.store.lines.lines.collectAsState() // what its line reads while it works: the server's words
    val server by app.store.version.value.collectAsState() // its features: whether a message waits, and a run says who ended it
    val features = server?.features
    val stays = sendStays(features) // Send stays while it works, and Stop is the word on the working line
    val signedOut by app.store.claude.signedOut.collectAsState()
    val backAt by app.store.claude.backAt.collectAsState()
    val backAtName by app.store.claude.backAtName.collectAsState()
    val heldLines by app.store.claude.held.collectAsState()
    // Its plan above the message box (docs/api.md, "The plan"): the run at work's, or the newest run's that was stopped
    // before its plan was done, until dismissed. Folded to its one line unless the owner opened it in this chat.
    val planView = vm.plan
    // Each run at work says what it is doing in its own block (#625): its line, its count of steps so far, and Stop.
    val runLines by app.store.lines.runLines.collectAsState()
    val heldRuns by app.store.lines.heldRuns.collectAsState()
    val runSteps by app.store.lines.runSteps.collectAsState()

    // From the message box: a message that did not go comes back into it, with the line that says why.
    // The board tile the owner pointed at with its pencil (ADR 275) while this is the project's chat: the message carries it, and sending clears it.
    val pointed = app.cardTarget?.takeIf { it.isIn(dev.botdot.app.data.ProjectChats.Open(dev.botdot.app.data.ProjectChats.BOT, botId)) }
    fun sendText(text: String, attachments: List<dev.botdot.app.data.Attachment>) {
        val sent = vm.send(text, attachments, replyTo = vm.reply?.runId, card = pointed)
        if (pointed != null) scope.launch { if (sent.await() && app.cardTarget == pointed) app.cardTarget = null }
    }
    // An empty chat (#727): the box in the middle, under its head and name, and its jobs under it. Gone with the first message.
    val empty = loaded && runs.isEmpty() && waiting.isEmpty() && vm.sent == null && vm.queued.isEmpty() && vm.started.isEmpty()
    @Composable fun box() {
        pointed?.let { CardChip(it.label) { app.cardTarget = null } }
        Composer(
            placeholder = tr("Message"),
            files = files,
            busy = boxStops(running != null, features),
            outbox = vm.outbox,
            onSend = { text, attachments -> sendText(text, attachments) },
            focusOn = pointed,
            onStop = { vm.stop() },
            onError = { scope.launch { snack.showError(it) } },
            initialText = sharedText,
            onSignIn = onSignIn.takeIf { signedOut },
            backAt = backAt,
            backAtName = backAtName,
            held = heldLines,
            onSignInHeld = onSignIn,
        )
    }
    // A job's chip: "Run now", the jobs screen's own.
    fun runJob(jobId: String) = scope.launch {
        val r = runCatching { app.api.value!!.runJob(botId, jobId) }
        snack.showSnackbar(r.fold({ runNowSays(it) }, { it.message ?: tr("Couldn't start it") }))
    }
    // Reply on a block (#627), against a botdot that takes it: the chip above the box names the block's first request.
    val replies = "reply-to" in features.orEmpty()
    // From a quick answer or a question card: whether it went. What was tapped stays until it did.
    // answers: the reply whose question it answers, so that with two questions open it ends that one alone (#1380).
    suspend fun sendFrom(text: String, key: String, answers: String? = null): Boolean = vm.send(text, emptyList(), box = false, key = key, answers = answers).await()
    // The inputs and buttons of an answer view send through the same function, as the owner's own message (ADR 265): a busy bot shows it as waiting.
    val sendView by rememberUpdatedState<suspend (String, String) -> Boolean> { t, k -> sendFrom(t, k) }
    val viewLater = vm.started.map { it.text } + vm.queued.map { it.text } + listOfNotNull(vm.sent?.text)
    val viewChat = remember(runs, viewLater, botId) { ViewChat(botBubbles(runs, viewLater), bot = botId) { t, k -> sendView(t, k) } }

    // What "@" mentions in this chat are matched against: the composer's suggestions, your bubbles. And where Quote
    // puts text selected in a message: this chat's message box (QuoteUi.kt).
    // Where this chat opens on the web page, for the link under a diagram (Markdown.kt).
    val api by app.api.collectAsState()
    // A path in its replies, and a file you sent it, open in the viewer (#251).
    CompositionLocalProvider(LocalMentions provides rememberMentions(app, botId), LocalFileMentions provides rememberFileMentions(app, botId), LocalQuote provides remember(botId) { QuoteBox() }, LocalChatOnWeb provides api?.let { chatOnWeb(it.baseUrl, "bot", botId) },
        LocalPathActions provides rememberPathActions(botId, bot?.name.orEmpty()), LocalSiteIcons provides sitesShown(features),
        LocalProductCards provides productCardsShown(features), LocalAnswerViews provides rememberAnswerViews(features), LocalViewChat provides viewChat, LocalProductSaver provides botId, LocalBotLinks provides rememberBotLinks(app, botId)) {
        Scaffold(
            containerColor = p.bg,
            snackbarHost = { BotSnackbarHost(snack) },
            topBar = {
                ChatBar(bot?.color, bot?.state ?: "idle", bot?.name ?: "", onName = onSettings, onBack = onBack, outfit = bot?.outfit,
                    // The owner at the test of Milestone 10: the plus stands right of the bot's name, with no words beside it.
                    beside = if (bot != null && canMakeGroup(features, others.size)) ({ SmallPlus(ADD_A_BOT) { makingGroup = true } }) else null,
                ) {
                    // Its files (#603), as a file manager shows them.
                    if (bot != null && dev.botdot.app.data.FilesExplorer.shows(features)) RoundButton(Icons.Filled.Folder, tr("Files"), onClick = onFiles)
                    if (bot?.computer == "linux" || (bot?.computer == "boat" && "boat-desktop" in features.orEmpty())) RoundButton(Icons.Filled.DesktopWindows, tr("Its screen"), onClick = onScreen)
                    val jobs = bot?.jobs.orEmpty()
                    if (jobs.isNotEmpty()) RoundButton(Icons.Filled.Schedule, tr("Scheduled jobs"), dot = jobs.any { it.waits }, onClick = onJobs)
                }
            },
            bottomBar = { if (!empty) Column {
                PlanDock(planView, bot?.color, bot?.name ?: tr("It"), vm.planFolded,
                    onFold = { vm.foldPlan(it) },
                    onDismiss = { vm.dismissPlan() })
                vm.reply?.let { ReplyChip(it.text) { vm.clearReply() } }
                box()
            } },
        ) { pad ->
            if (empty) EmptyChat(pad, bot?.name.orEmpty(), EmptyChatJobs.botJobs(bot?.jobs.orEmpty()), onJob = { runJob(it) },
                figure = { BotFigure(bot?.color, bot?.state ?: "idle", size = 56, outfit = bot?.outfit) },
                top = { ChatNeeds(app, botId) }) { box() }
            else Box(Modifier.fillMaxSize()) {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    state = listState,
                    reverseLayout = true, // newest at the bottom, and the list starts there
                    // The top bar and the message box float over the messages, which scroll behind them.
                    contentPadding = PaddingValues(start = Space.s16, end = Space.s16, top = pad.calculateTopPadding() + Space.s4, bottom = pad.calculateBottomPadding() + Space.s4),
                    verticalArrangement = Arrangement.spacedBy(Space.s12, Alignment.Bottom), // few messages: at the bottom, by the message box
                ) {
                    // Last in the chat: the one line of a working bot (the server's words for what it is doing, "Working…", or "Waiting for your OK" while its
                    // run waits for it), then your messages that wait for it, then what it waits for your OK on (as on the web page).
                    // A run at work has its line and Stop in its own block (#625); this line is for a bot with none of yours.
                    // A script job has no run while its script runs, and no line.
                    item(key = "needs") {
                        Column {
                            // The owner's message on its way: above the line of a bot that was free, which reads "Working…"
                            // until the server answers; under what waits already for a bot at work.
                            val sent = vm.sent
                            if (sent != null && running == null) SentBubble(sent, above = true, sentArrives)
                            // A run at work says it in its block (#625): the line here is only for the owner's message on its
                            // way to a bot that was free ("Working…").
                            if (running == null) {
                                if (stays) StatusLine(lineWith(dev.botdot.app.data.OpeningLine.botLine(lines[chatKey], null), sent), bot?.color, room = true)
                                else StatusLine(lineWith(dev.botdot.app.data.OpeningLine.status(lines[chatKey], false), sent), bot?.color)
                            }
                            vm.started.forEach { q -> androidx.compose.runtime.key(q.id) { SentBubble(SentMessage(q.id, q.text, q.attachments), above = false) } } // its turn came: until its run is here
                            WaitingMessages(vm.queued, bot?.name ?: "it", onSteer = if (canSteer(features)) ({ vm.steer(it) }) else null) { vm.takeBack(it) }
                            if (sent != null && running != null) SentBubble(sent, above = false, sentArrives)
                            ChatNeeds(app, botId, except = namedHere.values.flatten().toSet()) // what stands under a reply, not again here
                        }
                    }
                    if (vm.watches.isNotEmpty()) item(key = "watches") { WatchChips(vm.watches) { vm.stopWatch(it) } }
                    if (waiting.isNotEmpty()) item(key = "waiting") { NotesFold(waiting, tr("Notes waiting:"), foot = NotesWake.line(waiting), onRunNow = if (announces(features, NotesWake.FEATURE)) ({ vm.runNotes() }) else null) }
                    // Each run is one block (#625), where its reply ended: below what came while its run worked (a "/btw",
                    // another run, #460), and a run at work at the bottom. A run that replies to another is a further round of
                    // its block (#627), which stands where its newest round's reply does.
                    val blocks = ChatOrder.rounds(runs)
                    val lastReply = blocks.lastOrNull()?.lastOrNull()?.id
                    val held = runs.associateBy { it.id } // the question an answer quotes is its reply's (AnswerQuote)
                    val newestFirst = blocks.asReversed()
                    itemsIndexed(newestFirst, key = { _, b -> b.first().id }) { at, rounds ->
                        val last = rounds.last()
                        val older = newestFirst.getOrNull(at + 1).orEmpty().map { it.id } // the block above this one
                        // Details on the long press opens the newest round's steps; Copy takes its reply.
                        val detailed = rounds.lastOrNull { RunSteps.shows(it) }
                        RunBlock(onReply = if (replies && vm.replies(last.id)) ({ vm.replyTo(last.id) }) else null, onDetails = detailed?.let { d -> { stepsOpen[d.id] = d.isRunning } }, copy = rounds.lastOrNull { it.status == "success" }?.result,
                            marked = marked != null && rounds.any { it.id == marked }) {
                            rounds.forEachIndexed { n, r ->
                                if (n > 0) RoundRule()
                                // The "New" line: above what started the run, or, below your own message, above the rest of the block.
                                val new = r.id == vm.newFirst
                                val mine = Unread.mine(r)
                                val asked = drawsAsked(r)
                                if (new && !mine && asked) NewLine(bot?.color)
                                if (asked) YourSide(r, open = r.id in opened, quote = AnswerQuote.of(r, held, older.toSet() + rounds.take(n).map { it.id })) {
                                    scope.launch { if (showReply(it)) { marked = it; delay(1400); marked = null } }
                                }
                                r.steered.forEach { s -> s.fromBot?.let { SteeredFromBot(s, it) } ?: SteeredMessage(s) }
                                if (new && (mine || !asked)) NewLine(bot?.color)
                                val steps = RunSteps.shows(r)
                                if (steps) StepLine(r, runLines[r.id], maxOf(runSteps[r.id] ?: 0, r.steps?.count ?: 0), r.waitsForOk || r.id in heldRuns, bot?.color,
                                    open = RunSteps.open(stepsOpen, r), onOpen = { if (it) stepsOpen[r.id] = r.isRunning else stepsOpen.remove(r.id) }, onStop = { vm.stop(r.id) })
                                val theirs = @Composable { ViewReplyScope(r.id) {
                                    val asksHere = (r.id in askedIn || (r.id == lastReply && !r.asks)) && r.status == "success"
                                    TheirSide(r, open = r.id in opened, asksOpen = asksHere, features = features, timed = steps, draft = vm.drafts[r.id], plan = r.plan?.takeIf { r.id != planView?.id },
                                        learned = dev.botdot.app.data.LearnedChips.of(r, features).map { x -> x.text to when (val to = dev.botdot.app.data.LearnedChips.open(x)) { dev.botdot.app.data.LearnedChips.Open.Jobs -> onJobs; is dev.botdot.app.data.LearnedChips.Open.Settings -> ({ onLearned(to.skill) }); null -> null } })
                                    if (r.status == "success") NamedCards(app, botId, namedHere[r.id]) // the cards it names, to answer here (ADR 252)
                                    // Under the reply that is last in the chat, and under the run its open question is from when newer
                                    // runs another bot or the Chief started came after it: what asks the owner can be answered where it stands.
                                    // A reply that asked keeps them only while it is the open question: answered in a group, they go (ADR 211).
                                    if (asksHere) {
                                        Choices(r.choices, r.yes, bot?.color ?: r.botColor, putaway = if (hasChoicesDismiss(features)) Putaway(r.id, r.choicesDismissed) { app.api.value?.dismissChoices(r.id, it) ?: throw ApiException(NOT_CONNECTED) } else null) { text, key -> sendFrom(text, key, r.id) }
                                        Questions(r.questions, r.questionChoices, of = r.id) { text, key -> sendFrom(text, key, r.id) }
                                    }
                                } }
                                // Its reply, once the run ended: it arrives when it is new in this open chat, and what
                                // started the run stands still above it. A run at work has no reply to arrive.
                                if (r.isRunning) theirs() else Column(Modifier.arrives(arrivals, r.id), verticalArrangement = Arrangement.spacedBy(Space.s8)) { theirs() }
                                if (!steps) BlockFoot(r) { vm.stop(r.id) }
                            }
                        }
                    }
                }
                ToLatestButton(listState, botId, newestRun, pad.calculateBottomPadding()) { BotFigure(bot?.color, "idle", 20, bot?.outfit) }
            }
        }
    }

    // A new group of this bot and those picked, one to five, with the name given. The bot's own chat stays as it
    // is. A refusal of the botdot server is shown in the picker, in its words, and nothing is made.
    if (makingGroup && bot != null) BotPicker(
        title = tr("New group"), name = "", action = tr("Create"), max = dev.botdot.app.data.GroupMaker.PICKS,
        bots = dev.botdot.app.data.GroupMaker.others(bots.orEmpty(), bot), // its category's bots first
        hint = { n -> makeHint(n, bot.name) }, onDismiss = { makingGroup = false },
    ) { picked, named ->
        // The shared making (GroupMaker): the groups read again, or botdot's words, which the picker shows.
        val made = dev.botdot.app.data.GroupMaker.make(app.api.value ?: error(tr("Not connected to botdot")), app.store, bot.id, picked, named)
        onGroup((made.group ?: error(made.failed ?: tr("Couldn't create the group"))).id)
    }
}

@Composable
private fun YourSide(r: Run, open: Boolean = false, quote: AnswerQuote.Quote? = null, onQuote: (String) -> Unit = {}) {
    val notes = r.inbox.orEmpty()
    if (notes.isNotEmpty()) NotesFold(notes, if (notes.size == 1) tr("Read a note from") else tr("Read notes from"))
    when (Unread.asked(r)) {
        Unread.Asked.REPLIES -> {} // the answers it waited for: the notes above are what started it
        Unread.Asked.MESSAGE -> FromBotBubble(r, open)
        Unread.Asked.JOB -> Chip("${Unread.jobChip(r)} · ${shortTime(r.startedAt)}")
        Unread.Asked.SCHEDULE -> Chip("⏰ " + tr("Scheduled run") + " · ${shortTime(r.startedAt)}")
        Unread.Asked.HELLO -> {} // a new bot's first message: the owner asked nothing
        Unread.Asked.REMINDER -> {} // a reminder the bot set went off: botdot posted it, the owner asked nothing
        Unread.Asked.WATCH -> Chip("${r.watchName.orEmpty()} · ${shortTime(r.startedAt)}")
        Unread.Asked.CARRIED_ON -> {} // it goes on after your OK: your request stands once, above the first reply
        Unread.Asked.USUAL -> Chip("▶ " + tr("Ran its main assignment"))
        Unread.Asked.MINE -> MyBubble(r.prompt, r.attachments, quote = quote?.text, onQuote = quote?.let { q -> { onQuote(q.runId) } }, about = r.card)
    }
}

/** Whether a run's chat draws anything for what started it ([YourSide]): notes it read, or what the owner sees as asked. */
private fun drawsAsked(r: Run): Boolean = !r.inbox.isNullOrEmpty() || when (Unread.asked(r)) {
    Unread.Asked.REPLIES, Unread.Asked.HELLO, Unread.Asked.REMINDER, Unread.Asked.CARRIED_ON -> false
    else -> true
}

@Composable
private fun TheirSide(r: Run, open: Boolean = false, asksOpen: Boolean, features: Collection<String>? = null, draft: String? = null, plan: Plan? = null, learned: List<Pair<String, (() -> Unit)?>> = emptyList(), timed: Boolean = false) {
    val p = LocalPaper.current
    // [timed]: its step line says how long it took (#636), and its reply has no footer.
    val footer = if (timed) "" else listOf(shortTime(r.endedAt ?: r.startedAt), RunSteps.took(r.startedAt, r.endedAt)).filter { it.isNotEmpty() }.joinToString(" · ")
    // What it learned is the server's line where the server writes it (`memory-chips`): printed whole. Before, cut as it was.
    val whole = announces(features, MEMORY_CHIPS)
    val to = r.sentToAll?.takeIf { it.isNotEmpty() } ?: listOfNotNull(r.sentTo)
    // A long reply folds to its first paragraph and "More" (#625); a paragraph with a link is never folded.
    // A closed card's questions stand at the end of the reply (replyText).
    val text = replyText(r, asksOpen)
    // A reply that asks never folds: its quick answers or card stand under it, or a closed card's questions at its end.
    val asks = !r.questions.isNullOrEmpty() || (asksOpen && !r.choices.isNullOrEmpty())
    // One that asked and was answered folds, but its question stays: the owner's answer quotes it (AnswerQuote).
    val asked = !asks && !r.choices.isNullOrEmpty()
    val folded = remember(text, asks, asked) { RunSteps.folded(text, asks, asked) }
    var more by remember(r.id, open) { mutableStateOf(open) } // opened from a search match or from the question an answer quotes
    val reply: @Composable () -> Unit = {
        TheirBubble(footer, copyText = text, chips = learned, wholeChips = whole, plain = true) {
            Column {
                MarkdownText(tables = true, text = (if (folded != null && !more) folded else text).ifBlank { if (r.files.isNullOrEmpty() && r.pages.isEmpty() && r.reconnect.isEmpty()) tr("Done.") else "" })
                if (folded != null && !more) Text(tr("More"), color = p.muted, fontSize = Type.s14, modifier = Modifier.clip(Radius.small).clickable { more = true }.padding(top = Space.s8, bottom = Space.s4))
                OpenAsDocument(text, r.botName); BotFilesRow(r.files); PageChips(r.botId, r.pages); ReconnectCards(r.reconnect, r.botId); PlanFold(plan)
            }
        }
    }
    // Between bots (a run another bot or the Chief started) the reply folds as the message above it does (#413),
    // unless it addresses the owner: a teammate's request whose reply only the owner reads (#465).
    if ((r.fromBot != null && r.trigger == "bot" || r.startedBy == "chief") && r.status == "success" && r.notificationAudience != "owner") {
        ExchangeFold(r, to, footer, open, reply)
        RunScreenshots(r)
        return
    }
    // Whom it messaged is in its block's step line (StepLine, #625).
    when (r.status) {
        // No bubble while it works: the status line says it; only what it attached so far. From a server with drafts,
        // the reply as it is written so far stands in the reply's place and grows there (ReplyDraft).
        "running" -> if (draft.isNullOrEmpty()) BotFilesRow(r.files) else TheirBubble(plain = true) { Column { MarkdownText(draftSource(draft), copy = false, draft = true); BotFilesRow(r.files) } }
        "success" -> reply()
        else -> when (val ended = endedWords(r, features)) {
            // A stopped run the server says nothing of, and every stopped run of a botdot from before `ended-by`.
            is Ended.Stopped -> TheirBubble(footer, chips = learned, wholeChips = whole, plain = true) { Column { Text(ended.text, color = p.muted); PlanFold(plan) } }
            is Ended.Problem -> TheirBubble(footer, error = true, copyText = r.error?.ifBlank { null } ?: ended.text, chips = learned, wholeChips = whole) {
                Column { Text(ended.text, color = p.text, style = MaterialTheme.typography.bodyLarge); ReconnectCards(r.reconnect, r.botId); PlanFold(plan) }
            }
        }
    }
    RunScreenshots(r)
}


/**
 * The reply of a run another bot or the Chief started: one folded line, "Replied to Fleet Doctor" (with its small
 * head) and the first words of the reply, that opens to what it sent its teammates and the [reply]. Folded, the
 * time stays under it.
 */
@Composable
private fun ExchangeFold(r: Run, to: List<SentTo>, footer: String, startOpen: Boolean = false, reply: @Composable () -> Unit) {
    val p = LocalPaper.current
    var open by remember(r.id, startOpen) { mutableStateOf(startOpen) }
    val w = LocalMentions.current
    val messages = to.filter { !it.text.isNullOrBlank() }
    val chief = chiefNamed()
    // Each bot named has its small head beside its name.
    val label = buildAnnotatedString {
        when {
            to.isEmpty() -> if (r.startedBy == "chief") { append(tr("Replied to") + " "); bot(chief) } else append(tr("Replied")) // the Chief reads the reply itself
            to.all { it.id == r.fromBot?.id } -> { append(tr("Replied to") + " "); bot(named(w?.bot(r.fromBot?.id), r.fromBot?.name.orEmpty(), r.fromBot?.color)) }
            else -> { append(tr("Messaged") + " "); bots(to.map { named(w?.bot(it.id), it.name, it.color) }) }
        }
        append(if (open) " ⌄" else " ›") // before the first words, which the line's end may cut
        val peek = foldPeek(r.result)
        if (!open && peek.isNotEmpty()) withStyle(SpanStyle(color = p.faint)) { append("  $peek") }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        FigureText(label, color = p.muted, fontSize = Type.s14, maxLines = 1,
            modifier = Modifier.padding(end = Space.s32).clip(Radius.small).clickable { open = !open }.padding(horizontal = Space.s8, vertical = Space.s4))
        Unfold(open) {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                messages.forEach { t ->
                    FigureText(buildAnnotatedString { append(tr("To") + " "); bot(named(w?.bot(t.id), t.name, t.color)) }, color = p.muted, fontSize = Type.s14, modifier = Modifier.padding(horizontal = Space.s8))
                    TheirBubble(null, copyText = t.text) { MarkdownText(t.text.orEmpty()) }
                }
                reply()
            }
        }
        if (!open && footer.isNotBlank()) Text(footer, color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(start = Space.s8))
    }
}

/** The first words of a folded message between bots: its text as one plain line. */
internal fun foldPeek(text: String?): String = plainText(text.orEmpty()).replace(Regex("\\s+"), " ").trim().take(160)

/** Notes other bots left: one folded line, "Read notes from Web Surfer, Coder" (each with its small head), that opens to what each said. */
@Composable
private fun NotesFold(notes: List<InboxNote>, heading: String, foot: String = "", onRunNow: (() -> Unit)? = null) {
    val p = LocalPaper.current
    var open by remember(notes) { mutableStateOf(false) }
    val w = LocalMentions.current
    val whoOf = { n: InboxNote -> named(w?.bot(n.fromId), n.from, n.color) } // as it looks now, not when the note was left
    // A job's call the wake gate held (ADR 083) is named by its job, without a head.
    val label: androidx.compose.ui.text.AnnotatedString.Builder.(InboxNote) -> Unit = { n -> if (n.call) append("⏰ ${n.from}") else bot(whoOf(n)) }
    val who = notes.distinctBy { it.from }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        FigureText(buildAnnotatedString { append("$heading "); who.forEachIndexed { i, n -> if (i > 0) append(", "); label(n) }; append(if (open) " ⌄" else " ›") }, color = p.muted, fontSize = Type.s14,
            modifier = Modifier.clip(Radius.small).clickable { open = !open }.padding(horizontal = Space.s8, vertical = Space.s4))
        Unfold(open) { Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Space.s8)) { notes.forEach { n ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                FigureText(buildAnnotatedString { label(n); n.at?.let { append(" · ${shortTime(it)}") } }, color = p.muted, fontSize = Type.s14, modifier = Modifier.padding(horizontal = Space.s8))
                if (n.later) LaterPill()
            }
            Text(SearchMarks.mark(linkedChatText(androidx.compose.ui.text.AnnotatedString(n.text), p.text)), color = p.text, style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(start = Space.s48).raised(Radius.mine).holdToCopy(n.text).padding(horizontal = Space.s16, vertical = Space.s12))
        } } }
        // Under the notes that wait (#225): how long the oldest has waited, and "Run now", which starts the bot with them.
        if (foot.isNotEmpty() || onRunNow != null) Row(Modifier.padding(horizontal = Space.s8), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            if (foot.isNotEmpty()) Text(foot, color = p.faint, fontSize = Type.s12)
            if (notes.any { it.later }) LaterPill()
            if (onRunNow != null) Text(tr("Run now"), color = p.muted, fontSize = Type.s12, fontWeight = FontWeight.Normal,
                modifier = Modifier.clip(Radius.small).clickable(onClick = onRunNow).padding(horizontal = Space.s4, vertical = Space.s4))
        }
    }
}

/** What the bot watches (ADR 248), at the end of its chat on its side: what, until when, and Stop. */
@Composable
private fun WatchChips(list: List<dev.botdot.app.data.Watch>, onStop: (String) -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.Start, verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        list.forEach { w ->
            Row(Modifier.clip(Radius.pill).background(p.sunk).padding(start = Space.s12, end = Space.s4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                androidx.compose.material3.Icon(Icons.Default.Visibility, contentDescription = null, tint = p.muted, modifier = Modifier.size(14.dp))
                Text(w.name, color = p.text, fontSize = Type.s12, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Text(tr("until {time}", "time" to shortTime(w.until)), color = p.muted, fontSize = Type.s12, maxLines = 1)
                androidx.compose.material3.IconButton(onClick = { onStop(w.id) }, modifier = Modifier.size(32.dp)) {
                    androidx.compose.material3.Icon(Icons.Default.Close, contentDescription = tr("Stop watching {name}", "name" to w.name), tint = p.muted, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

/** A note the wake gate held for the bot's next run (ADR 083): it woke nothing. */
@Composable
private fun LaterPill() {
    val p = LocalPaper.current
    Text(tr("Later"), color = p.muted, fontSize = Type.s12, modifier = Modifier.clip(Radius.pill).background(p.sunk).padding(horizontal = Space.s8, vertical = 1.dp))
}

/** A teammate's message a run read while it worked (#1278): folded as a message from that bot, with "Steered" and its time. */
@Composable
private fun SteeredFromBot(m: dev.botdot.app.data.Steered, from: dev.botdot.app.data.BotRef) {
    val p = LocalPaper.current
    var open by remember(m.id) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        val w = LocalMentions.current
        val line = buildAnnotatedString {
            append(tr("Message from") + " ")
            bot(named(w?.bot(from.id), from.name, from.color))
            append(if (open) " ⌄" else " ›")
            val peek = foldPeek(m.text)
            if (!open && peek.isNotEmpty()) withStyle(SpanStyle(color = p.faint)) { append("  $peek") }
        }
        FigureText(line, color = p.muted, fontSize = Type.s14, maxLines = 1,
            modifier = Modifier.padding(start = Space.s48).clip(Radius.small).clickable { open = !open }.padding(horizontal = Space.s8, vertical = Space.s4))
        Unfold(open) { Column(Modifier.padding(start = Space.s48).raised(Radius.mine).holdToCopy(m.text).padding(horizontal = Space.s16, vertical = Space.s12)) {
            Text(SearchMarks.mark(linkedChatText(androidx.compose.ui.text.AnnotatedString(m.text), p.text)), color = p.text, style = MaterialTheme.typography.bodyLarge)
            if (m.attachments.isNotEmpty()) FilesRow(m.attachments, onDark = false)
            Text(m.at?.let { tr("Steered") + " · ${shortTime(it)}" } ?: tr("Steered"), color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(top = Space.s4))
        } }
    }
}

/** A run started by another bot's message or a Chief task: one folded line, "Message from Fleet Doctor" (with its small head), that opens to what it said. */
@Composable
private fun FromBotBubble(r: Run, startOpen: Boolean = false) {
    val p = LocalPaper.current
    var open by remember(r.id, startOpen) { mutableStateOf(startOpen) }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        val w = LocalMentions.current
        val chief = chiefNamed()
        val line = buildAnnotatedString {
            append(tr("Message from") + " ")
            when {
                r.fromBot != null -> r.fromBot!!.let { f -> bot(named(w?.bot(f.id), f.name, f.color)) }
                r.startedBy == "chief" -> bot(chief)
                else -> append(tr("a bot"))
            }
            append(if (open) " ⌄" else " ›") // before the first words, which the line's end may cut
            val peek = foldPeek(r.prompt)
            if (!open && peek.isNotEmpty()) withStyle(SpanStyle(color = p.faint)) { append("  $peek") }
        }
        FigureText(line, color = p.muted, fontSize = Type.s14, maxLines = 1,
            modifier = Modifier.padding(start = Space.s48).clip(Radius.small).clickable { open = !open }.padding(horizontal = Space.s8, vertical = Space.s4))
        Unfold(open) { Column(Modifier.padding(start = Space.s48).raised(Radius.mine).holdToCopy(r.prompt).padding(horizontal = Space.s16, vertical = Space.s12)) {
            Text(SearchMarks.mark(linkedChatText(androidx.compose.ui.text.AnnotatedString(r.prompt), p.text)), color = p.text, style = MaterialTheme.typography.bodyLarge)
            if (!r.attachments.isNullOrEmpty()) FilesRow(r.attachments!!, onDark = false)
        } }
    }
}
