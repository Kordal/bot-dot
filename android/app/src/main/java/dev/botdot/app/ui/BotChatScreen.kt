package dev.botdot.app.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
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
import androidx.compose.ui.unit.sp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.GROUP_MAX
import dev.botdot.app.data.RunEvent
import dev.botdot.app.data.InboxNote
import dev.botdot.app.data.NotesWake
import dev.botdot.app.data.Learned
import dev.botdot.app.data.MEMORY_CHIPS
import dev.botdot.app.data.announces
import dev.botdot.app.data.Plan
import dev.botdot.app.data.PlanView
import dev.botdot.app.data.Run
import dev.botdot.app.data.SentTo
import dev.botdot.app.data.Unread
import dev.botdot.app.data.str
import kotlinx.coroutines.launch

/**
 * A bot's chat: its runs as messages (your task, its reply), and one status line while it works. Right of its name
 * stands a very small plus, "Add a bot to this chat": it makes a group of this bot and those picked, and [onGroup]
 * opens it. Only against a botdot server that has groups, and with another bot to add.
 */
@Composable
fun BotChatScreen(app: BotDotApp, botId: String, shared: List<Uri>, sharedText: String, onJobs: () -> Unit, onSettings: () -> Unit, onScreen: () -> Unit, onNeeds: () -> Unit, onLearned: () -> Unit = onSettings, onSignIn: () -> Unit = {}, onGroup: (String) -> Unit = {}, onBack: () -> Unit) {
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
    val waiting = vm.waiting
    val loaded = vm.loaded
    val files = vm.files
    val listState = rememberLazyListState()
    var opened by remember { mutableStateOf(setOf<String>()) } // runs a search match opened (folded ones between bots)

    LaunchedEffect(vm) { vm.notes.collect { scope.launch { snack.showSnackbar(it) } } }
    // From a search match: go to that run (older pages until it's there), and open it if it's folded.
    LaunchedEffect(loaded) {
        val j = app.jump ?: return@LaunchedEffect
        if (!loaded || j.bot?.id != botId) return@LaunchedEffect
        app.jump = null
        val runId = j.runId ?: return@LaunchedEffect
        if (!vm.reach(runId)) return@LaunchedEffect
        val i = vm.runs.indexOfFirst { it.id == runId }
        if (i < 0) return@LaunchedEffect
        opened = opened + runId
        listState.scrollToItem(1 + (if (vm.waiting.isNotEmpty()) 1 else 0) + i) // below it: what waits for your OK, notes waiting
    }
    // The run its open question is from (docs/api.md, "A bot that asks"), however far back: older pages until it is
    // in the chat, so "Needs you" on its key points at something to answer.
    val askedIn = bot?.asks?.runId
    LaunchedEffect(loaded, askedIn) { if (loaded && askedIn != null) vm.reach(askedIn) }
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
            val i = vm.runs.indexOfFirst { it.id == vm.newFirst }
            val below = 1 + (if (vm.waiting.isNotEmpty()) 1 else 0) // what waits for your OK, notes waiting
            (below + i).takeIf { i >= 0 && listState.layoutInfo.totalItemsCount == below + vm.runs.size }
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
    val waits by app.store.lines.waits.collectAsState() // the chats with a run that waits for the owner's OK
    val server by app.store.version.value.collectAsState() // its features: whether a message waits, and a run says who ended it
    val features = server?.features
    val stays = sendStays(features) // Send stays while it works, and Stop is the word on the working line
    val signedOut by app.store.claude.signedOut.collectAsState()
    // Its plan above the message box (docs/api.md, "The plan"): the run at work's, or the newest run's that was stopped
    // before its plan was done, until dismissed. Folded to its one line unless the owner opened it in this chat.
    var planFolded by remember(botId) { mutableStateOf(app.plans.folded(chatKey)) }
    var planDismissed by remember(botId) { mutableStateOf(0) } // a dismissal draws the chat again
    val planView = remember(runs, planDismissed) { PlanView.ofBot(runs, app.plans::dismissed) }

    // From the message box: a message that did not go comes back into it, with the line that says why.
    fun sendText(text: String, attachments: List<dev.botdot.app.data.Attachment>) { vm.send(text, attachments) }
    // From a quick answer or a question card: whether it went. What was tapped stays until it did.
    suspend fun sendFrom(text: String, key: String): Boolean = vm.send(text, emptyList(), box = false, key = key).await()

    // What "@" mentions in this chat are matched against: the composer's suggestions, your bubbles. And where Quote
    // puts text selected in a message: this chat's message box (QuoteUi.kt).
    // Where this chat opens on the web page, for the link under a diagram (Markdown.kt).
    val api by app.api.collectAsState()
    // A path in its replies, and a file you sent it, open in the viewer (#251).
    CompositionLocalProvider(LocalMentions provides rememberMentions(app, botId), LocalQuote provides remember(botId) { QuoteBox() }, LocalChatOnWeb provides api?.let { chatOnWeb(it.baseUrl, "bot", botId) },
        LocalPathActions provides rememberPathActions(botId, bot?.name.orEmpty())) {
        Scaffold(
            containerColor = p.bg,
            snackbarHost = { SnackbarHost(snack) },
            topBar = {
                ChatBar(bot?.color, bot?.state ?: "idle", bot?.name ?: "", onName = onSettings, onBack = onBack, outfit = bot?.outfit,
                    // The owner at the test of Milestone 10: the plus stands right of the bot's name, with no words beside it.
                    beside = if (bot != null && canMakeGroup(features, others.size)) ({ SmallPlus(ADD_A_BOT) { makingGroup = true } }) else null,
                ) {
                    if (bot?.computer == "linux") RoundButton(Icons.Filled.DesktopWindows, "Its screen", onClick = onScreen)
                    val jobs = bot?.jobs.orEmpty()
                    if (jobs.isNotEmpty()) RoundButton(Icons.Filled.Schedule, "Scheduled jobs", dot = jobs.any { it.waits }, onClick = onJobs)
                }
            },
            bottomBar = { Column {
                PlanDock(planView, bot?.color, bot?.name ?: "It", planFolded,
                    onFold = { planFolded = it; app.plans.setFolded(chatKey, it) },
                    onDismiss = { planView?.let { app.plans.dismiss(it.id) }; planDismissed++ })
                Composer(
                    placeholder = "Give ${bot?.name ?: "it"} a task…",
                    files = files,
                    busy = boxStops(running != null, features),
                    outbox = vm.outbox,
                    onSend = { text, attachments -> sendText(text, attachments) },
                    onStop = { vm.stop() },
                    onError = { scope.launch { snack.showSnackbar(it) } },
                    initialText = sharedText,
                    onSignIn = onSignIn.takeIf { signedOut },
                )
            } },
        ) { pad ->
            LazyColumn(
                Modifier.fillMaxSize(),
                state = listState,
                reverseLayout = true, // newest at the bottom, and the list starts there
                // The top bar and the message box float over the messages, which scroll behind them.
                contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = pad.calculateTopPadding() + 4.dp, bottom = pad.calculateBottomPadding() + 4.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom), // few messages: at the bottom, by the message box
            ) {
                // Last in the chat: the one line of a working bot (the server's words for what it is doing, "Working…", or "Waiting for your OK" while its
                // run waits for it), then your messages that wait for it, then what it waits for your OK on (as on the web page).
                // Where Send stays, the line is there for every run Stop can end, with Stop at its end; against a botdot
                // from before, Stop is in the message box. A script job has no run while its script runs, and no line.
                item(key = "needs") {
                    Column {
                        val waiting = running != null && chatKey in waits
                        // The owner's message on its way: above the line of a bot that was free, which reads "Working…"
                        // until the server answers; under what waits already for a bot at work.
                        val sent = vm.sent
                        if (sent != null && running == null) SentBubble(sent, above = true, sentArrives)
                        if (stays) StatusLine(lineWith(dev.botdot.app.data.OpeningLine.botLine(lines[chatKey], running, waiting), sent), bot?.color, still = waiting, onStop = if (running != null) ({ vm.stop() }) else null, room = true)
                        else StatusLine(lineWith(dev.botdot.app.data.OpeningLine.status(lines[chatKey], running != null, waiting), sent), bot?.color, still = waiting)
                        WaitingMessages(vm.queued, bot?.name ?: "it", onSteer = if (canSteer(features)) ({ vm.steer(it) }) else null) { vm.takeBack(it) }
                        if (sent != null && running != null) SentBubble(sent, above = false, sentArrives)
                        ChatNeeds(app, botId, onNeeds)
                    }
                }
                if (waiting.isNotEmpty()) item(key = "waiting") { NotesFold(waiting, "Notes waiting:", foot = NotesWake.line(waiting), onRunNow = if (announces(features, NotesWake.FEATURE)) ({ vm.runNotes() }) else null) }
                if (loaded && runs.isEmpty() && waiting.isEmpty() && vm.sent == null) item {
                    // An empty chat: the bot's large head, with its hat and the face of its state, as on the web page and the Mac.
                    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        BotFigure(bot?.color, bot?.state ?: "idle", size = 56, outfit = bot?.outfit)
                        Text("No messages yet. Give ${bot?.name ?: "it"} a task, or attach a file.", color = p.muted, textAlign = TextAlign.Center)
                    }
                }
                items(runs, key = { it.id }) { r ->
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        // The "New" line: below your own message when that started the run, above what else did.
                        val new = r.id == vm.newFirst
                        val mine = Unread.mine(r)
                        if (new && !mine) NewLine(bot?.color)
                        YourSide(r, open = r.id in opened)
                        if (new && mine) NewLine(bot?.color)
                        val theirs = @Composable {
                            TheirSide(r, open = r.id in opened, features = features, draft = vm.drafts[r.id], plan = r.plan?.takeIf { r.id != planView?.id },
                                learned = r.learned.orEmpty().map { x -> x.line(features) to when (x.opens) { Learned.Opens.JOBS -> onJobs; Learned.Opens.SETTINGS -> onLearned; null -> null } })
                            // Under the newest run, and under the run its open question is from when newer runs another
                            // bot or the Chief started came after it: what asks the owner can be answered where it stands.
                            if ((r.id == runs.firstOrNull()?.id || r.id == askedIn) && r.status == "success") {
                                Choices(r.choices, r.yes, bot?.color ?: r.botColor) { text, key -> sendFrom(text, key) }
                                Questions(r.questions) { text, key -> sendFrom(text, key) }
                            }
                        }
                        // Its reply, once the run ended: it arrives when it is new in this open chat, and what
                        // started the run stands still above it. A run at work has no reply to arrive.
                        if (r.isRunning) theirs() else Column(Modifier.arrives(arrivals, r.id), verticalArrangement = Arrangement.spacedBy(8.dp)) { theirs() }
                    }
                }
            }
        }
    }

    // A new group of this bot and those picked, one to five, with the name given. The bot's own chat stays as it
    // is. A refusal of the botdot server is shown in the picker, in its words, and nothing is made.
    if (makingGroup && bot != null) BotPicker(
        title = "New group", name = "", action = "Create", max = GROUP_MAX - 1,
        bots = others.sortedWith(compareBy<Bot> { it.group != bot.group }.thenBy { it.name.lowercase() }), // its category's bots first
        hint = { n -> makeHint(n, bot.name) }, onDismiss = { makingGroup = false },
    ) { picked, named ->
        val made = (app.api.value ?: error("Not connected to botdot")).makeGroup(named, listOf(bot.id) + picked)
        app.store.groups.refresh()
        onGroup(made.id)
    }
}

@Composable
private fun YourSide(r: Run, open: Boolean = false) {
    val notes = r.inbox.orEmpty()
    if (notes.isNotEmpty()) NotesFold(notes, if (notes.size == 1) "Read a note from" else "Read notes from")
    when (Unread.asked(r)) {
        Unread.Asked.REPLIES -> {} // the answers it waited for: the notes above are what started it
        Unread.Asked.MESSAGE -> FromBotBubble(r, open)
        Unread.Asked.JOB -> Chip("${Unread.jobChip(r)} · ${shortTime(r.startedAt)}")
        Unread.Asked.SCHEDULE -> Chip("⏰ Scheduled run · ${shortTime(r.startedAt)}")
        Unread.Asked.HELLO -> {} // a new bot's first message: the owner asked nothing
        Unread.Asked.REMINDER -> {} // a reminder the bot set went off: botdot posted it, the owner asked nothing
        Unread.Asked.CARRIED_ON -> {} // it goes on after your OK: your request stands once, above the first reply
        Unread.Asked.USUAL -> Chip("▶ Ran its main assignment")
        Unread.Asked.MINE -> MyBubble(r.prompt, r.attachments)
    }
    // What the owner steered into it while it worked (ADR 040), after its request, in the order read.
    r.steered.forEach { SteeredMessage(it) }
}

@Composable
private fun TheirSide(r: Run, open: Boolean = false, features: Collection<String>? = null, draft: String? = null, plan: Plan? = null, learned: List<Pair<String, (() -> Unit)?>> = emptyList()) {
    val p = LocalPaper.current
    val footer = shortTime(r.endedAt ?: r.startedAt)
    // What it learned is the server's line where the server writes it (`memory-chips`): printed whole. Before, cut as it was.
    val whole = announces(features, MEMORY_CHIPS)
    val to = r.sentToAll?.takeIf { it.isNotEmpty() } ?: listOfNotNull(r.sentTo)
    val reply: @Composable () -> Unit = {
        TheirBubble(footer, copyText = r.result, chips = learned, wholeChips = whole) {
            Column { MarkdownText(r.result.orEmpty().ifBlank { if (r.files.isNullOrEmpty() && r.pages.isEmpty() && r.reconnect.isEmpty()) "Done." else "" }); OpenAsDocument(r.result, r.botName); BotFilesRow(r.files); PageChips(r.botId, r.pages); ReconnectCards(r.reconnect); PlanFold(plan) }
        }
    }
    // Between bots (a run another bot or the Chief started) the reply folds as the message above it does (#413),
    // unless it addresses the owner: a teammate's request whose reply only the owner reads (#465).
    if ((r.fromBot != null && r.trigger == "bot" || r.startedBy == "chief") && r.status == "success" && r.notificationAudience != "owner") {
        ExchangeFold(r, to, footer, open, reply)
        RunScreenshots(r)
        return
    }
    if (to.isNotEmpty()) {
        val one = to.size == 1
        val how = when {
            to.all { it.delivered == "queued" } -> if (one) " · it picks it up when free" else " · they pick it up when free"
            to.all { it.delivered?.startsWith("inbox") == true } -> NotesWake.messagedHow(one)
            else -> ""
        }
        val w = LocalMentions.current
        FigureText(buildAnnotatedString { append("Messaged "); bots(to.map { named(w?.bot(it.id), it.name, it.color) }); append(how) }, color = p.muted, fontSize = 13.5.sp, modifier = Modifier.padding(horizontal = 6.dp))
    }
    when (r.status) {
        // No bubble while it works: the status line says it; only what it attached so far. From a server with drafts,
        // the reply as it is written so far stands in the reply's place and grows there (ReplyDraft).
        "running" -> if (draft.isNullOrEmpty()) BotFilesRow(r.files) else TheirBubble { Column { MarkdownText(draftSource(draft), copy = false); BotFilesRow(r.files) } }
        "success" -> reply()
        else -> when (val ended = endedWords(r, features)) {
            // A stopped run the server says nothing of, and every stopped run of a botdot from before `ended-by`.
            is Ended.Stopped -> TheirBubble(footer, chips = learned, wholeChips = whole) { Column { Text(ended.text, color = p.muted); PlanFold(plan) } }
            is Ended.Problem -> TheirBubble(footer, error = true, copyText = r.error?.ifBlank { null } ?: ended.text, chips = learned, wholeChips = whole) {
                Column { Text(ended.text, color = p.text, style = MaterialTheme.typography.bodyLarge); ReconnectCards(r.reconnect); PlanFold(plan) }
            }
        }
    }
    RunScreenshots(r)
}

/** The feature of a botdot that keeps who ended a run and words the sentence from it (docs/api.md). */
internal const val ENDED_BY = "ended-by"

/** What the bubble of a run that did not finish says: the app's own muted "Stopped.", or a problem in the problem bubble. */
internal sealed interface Ended {
    val text: String
    data class Stopped(override val text: String = "Stopped.") : Ended
    data class Problem(override val text: String) : Ended
}

/**
 * How a run that ended without a reply is drawn. A botdot with [ENDED_BY] keeps who ended a run (the owner, the
 * Chief, a sign-out, the time limit) and says it in the run's `problem`: that sentence is drawn, as every problem
 * is, and the app's own "Stopped." stands only for a stopped run without one. Against a botdot from before, a
 * stopped run reads "Stopped." as it did. Any other end: the problem, the raw error, or its status.
 */
internal fun endedWords(r: Run, features: Collection<String>?): Ended {
    val problem = r.problem?.trim()?.ifEmpty { null }
    if (r.status == "stopped") return if (problem != null && features != null && ENDED_BY in features) Ended.Problem(problem) else Ended.Stopped()
    return Ended.Problem(problem ?: r.error?.ifBlank { null } ?: "It didn't finish (${r.status}).")
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
            to.isEmpty() -> if (r.startedBy == "chief") { append("Replied to "); bot(chief) } else append("Replied") // the Chief reads the reply itself
            to.all { it.id == r.fromBot?.id } -> { append("Replied to "); bot(named(w?.bot(r.fromBot?.id), r.fromBot?.name.orEmpty(), r.fromBot?.color)) }
            else -> { append("Messaged "); bots(to.map { named(w?.bot(it.id), it.name, it.color) }) }
        }
        append(if (open) " ⌄" else " ›") // before the first words, which the line's end may cut
        val peek = foldPeek(r.result)
        if (!open && peek.isNotEmpty()) withStyle(SpanStyle(color = p.faint)) { append("  $peek") }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FigureText(label, color = p.muted, fontSize = 13.5.sp, maxLines = 1,
            modifier = Modifier.padding(end = 32.dp).clip(RoundedCornerShape(8.dp)).clickable { open = !open }.padding(horizontal = 6.dp, vertical = 2.dp))
        Unfold(open) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                messages.forEach { t ->
                    FigureText(buildAnnotatedString { append("To "); bot(named(w?.bot(t.id), t.name, t.color)) }, color = p.muted, fontSize = 13.5.sp, modifier = Modifier.padding(horizontal = 6.dp))
                    TheirBubble(null, copyText = t.text) { MarkdownText(t.text.orEmpty()) }
                }
                reply()
            }
        }
        if (!open && footer.isNotBlank()) Text(footer, color = p.faint, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
    }
}

/** The first words of a folded message between bots: its text as one plain line. */
internal fun foldPeek(text: String?): String = dev.botdot.app.feed.plainText(text.orEmpty()).replace(Regex("\\s+"), " ").trim().take(160)

/** Notes other bots left: one folded line, "Read notes from Web Surfer, Coder" (each with its small head), that opens to what each said. */
@Composable
private fun NotesFold(notes: List<InboxNote>, heading: String, foot: String = "", onRunNow: (() -> Unit)? = null) {
    val p = LocalPaper.current
    var open by remember(notes) { mutableStateOf(false) }
    val w = LocalMentions.current
    val whoOf = { n: InboxNote -> named(w?.bot(n.fromId), n.from, n.color) } // as it looks now, not when the note was left
    val who = notes.distinctBy { it.from }.map(whoOf)
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FigureText(buildAnnotatedString { append("$heading "); bots(who); append(if (open) " ⌄" else " ›") }, color = p.muted, fontSize = 13.5.sp,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { open = !open }.padding(horizontal = 6.dp, vertical = 2.dp))
        Unfold(open) { Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) { notes.forEach { n ->
            FigureText(buildAnnotatedString { bot(whoOf(n)); n.at?.let { append(" · ${shortTime(it)}") } }, color = p.muted, fontSize = 13.5.sp, modifier = Modifier.padding(horizontal = 6.dp))
            Text(SearchMarks.mark(linkedChatText(androidx.compose.ui.text.AnnotatedString(n.text), p.text)), color = p.text, style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(start = 48.dp).clip(RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)).holdToCopy(n.text).background(p.sunk)
                    .border(1.dp, p.line2, RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)).padding(horizontal = 14.dp, vertical = 10.dp))
        } } }
        // Under the notes that wait (#225): how long the oldest has waited, and "Run now", which starts the bot with them.
        if (foot.isNotEmpty() || onRunNow != null) Row(Modifier.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (foot.isNotEmpty()) Text(foot, color = p.faint, fontSize = 12.sp)
            if (onRunNow != null) Text("Run now", color = p.muted, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClick = onRunNow).padding(horizontal = 4.dp, vertical = 2.dp))
        }
    }
}

/** A run started by another bot's message or a Chief task: one folded line, "Message from Fleet Doctor" (with its small head), that opens to what it said. */
@Composable
private fun FromBotBubble(r: Run, startOpen: Boolean = false) {
    val p = LocalPaper.current
    var open by remember(r.id, startOpen) { mutableStateOf(startOpen) }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val w = LocalMentions.current
        val chief = chiefNamed()
        val line = buildAnnotatedString {
            append("Message from ")
            when {
                r.fromBot != null -> bot(named(w?.bot(r.fromBot.id), r.fromBot.name, r.fromBot.color))
                r.startedBy == "chief" -> bot(chief)
                else -> append("a bot")
            }
            append(if (open) " ⌄" else " ›") // before the first words, which the line's end may cut
            val peek = foldPeek(r.prompt)
            if (!open && peek.isNotEmpty()) withStyle(SpanStyle(color = p.faint)) { append("  $peek") }
        }
        FigureText(line, color = p.muted, fontSize = 13.5.sp, maxLines = 1,
            modifier = Modifier.padding(start = 48.dp).clip(RoundedCornerShape(8.dp)).clickable { open = !open }.padding(horizontal = 6.dp, vertical = 2.dp))
        Unfold(open) { Column(Modifier.padding(start = 48.dp).clip(RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)).holdToCopy(r.prompt).background(p.sunk)
                .border(1.dp, p.line2, RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)).padding(horizontal = 14.dp, vertical = 10.dp)) {
            Text(SearchMarks.mark(linkedChatText(androidx.compose.ui.text.AnnotatedString(r.prompt), p.text)), color = p.text, style = MaterialTheme.typography.bodyLarge)
            if (!r.attachments.isNullOrEmpty()) FilesRow(r.attachments, onDark = false)
        } }
    }
}
