package dev.botdot.app.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.ThumbDown as ThumbDownOutline
import androidx.compose.material.icons.outlined.ThumbUp as ThumbUpOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Attachment
import dev.botdot.app.data.ChiefChat
import dev.botdot.app.data.ChiefChatSummary
import dev.botdot.app.data.ChiefMessage
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.Mentions
import dev.botdot.app.data.Ratings
import dev.botdot.app.data.Unread
import dev.botdot.app.data.str
import kotlinx.coroutines.launch

private val SUGGESTIONS = listOf(
    "What bots do I have, and what is each one good at?",
    "Create a bot that checks the news on a topic every morning and sends me the highlights.",
    "Make a bot that uses the computer to work on websites for me.",
    "Make a research bot that finds fresh game design ideas on the web.",
)

/** The Chief of Staff: a chat that manages your bots. chatId "latest" opens the newest chat. */
@Composable
fun ChiefScreen(app: BotDotApp, startChatId: String, shared: List<Uri>, sharedText: String, onSettings: () -> Unit, onNeeds: () -> Unit, onBot: (String) -> Unit, onScreen: (String) -> Unit, onSkills: () -> Unit, onSignIn: () -> Unit = {}, onBack: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    val vm: ChiefChatModel = viewModel(key = "chief:$startChatId") { ChiefChatModel(app, startChatId) }
    val chatId = vm.chatId
    val chat = vm.chat
    // The chat list (for its new replies) and the bots (for the chips), as the app keeps them.
    val overview by app.store.chief.value.collectAsState()
    val chats = overview?.chats.orEmpty()
    val botsNow by app.store.bots.value.collectAsState()
    val bots = botsNow.orEmpty()
    val server by app.store.version.value.collectAsState() // its features: whether it rates unasked messages
    val features = server?.features
    val stays = sendStays(features) // Send stays while it replies, and Stop is the word on the working line
    val signedOut by app.store.claude.signedOut.collectAsState()
    val activity = vm.activity
    val files = vm.files

    LaunchedEffect(vm) { vm.notes.collect { scope.launch { snack.showSnackbar(it) } } }
    // From a search match: go to that message (older ones first, if it's not loaded yet).
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(chat?.id) {
        val j = app.jump ?: return@LaunchedEffect
        val c = chat ?: return@LaunchedEffect
        if (j.chatId != c.id) return@LaunchedEffect
        app.jump = null
        val k = j.index ?: return@LaunchedEffect
        vm.reachIndex(k)
        val now = vm.chat ?: return@LaunchedEffect
        val last = now.offset + now.messages.size - 1
        if (k in now.offset..last) listState.scrollToItem(1 + (last - k)) // newest first, below what waits for your OK
    }
    LaunchedEffect(Unit) { vm.addShared(shared) }
    // Near the top (the list is upside down: near its end): the messages before.
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.let { (it.visibleItemsInfo.lastOrNull()?.index ?: 0) >= it.totalItemsCount - 4 } }
            .collect { near -> if (near) vm.loadOlder() }
    }
    DisposableEffect(chatId) {
        val key = "chief:$chatId"
        app.notifier.visibleChat = key
        onDispose { if (app.notifier.visibleChat == key) app.notifier.visibleChat = null }
    }
    // New replies, as in a bot's chat. A chat that was just started here is reported as soon as it exists.
    NewReplies(app, chatId?.let { "chief:$it" }, chats.firstOrNull { it.id == chatId }?.unread ?: 0, arrive = { vm.arrive() }, leave = { vm.leave() }) {
        if (app.jump != null || !vm.reachNew()) return@NewReplies // a search match is where the chat opens
        listState.showFromTop {
            val now = vm.chat ?: return@showFromTop null
            val row = Unread.rowFrom(List(now.messages.size) { now.offset + it }, vm.newFirst)
            // Newest first, below what waits for your OK.
            (now.messages.size - row).takeIf { row >= 0 && listState.layoutInfo.totalItemsCount == 1 + now.messages.size }
        }
    }

    // A reply arrives, visibly: which of them are new in this open chat, told on every draw (Arrivals). A message
    // is told by its place in the whole chat; the owner's own arrives on Send, and not again as the server's.
    val arrivals = remember { Arrivals() }
    val onItsWay = vm.sent
    arrivals.draw(chatId, chat?.id == chatId, replyIds(chat), onItsWay?.key)
    val sentArrives = Modifier.arrives(arrivals, onItsWay?.let { Arrivals.sent(it.key) })

    // While the Chief replies: what it's doing, in the server's words ("Reading nytimes.com…").
    val busy = vm.busy
    val lines by app.store.lines.lines.collectAsState() // what it said it is about to do

    // From the message box: a message that did not go comes back into it, with the line that says why.
    fun send(text: String, attachments: List<dev.botdot.app.data.Attachment>) { vm.send(text, attachments) }
    // From a quick answer, a question card, a plan's Approve: whether it went. What was tapped stays until it did.
    suspend fun sendFrom(text: String, key: String): Boolean = vm.send(text, emptyList(), box = false, key = key).await()

    // What "@" mentions in this chat are matched against: the composer's suggestions, your bubbles. And where Quote
    // puts text selected in a message: this chat's message box (QuoteUi.kt).
    CompositionLocalProvider(LocalMentions provides rememberMentions(app, Mentions.CHIEF), LocalQuote provides remember { QuoteBox() }) {
        Scaffold(
            containerColor = p.bg,
            snackbarHost = { SnackbarHost(snack) },
            topBar = {
                ChatBar(CHIEF_COLOR, if (busy) "working" else "idle", LocalChiefName.current, onName = onSettings, onBack = onBack, outfit = FigureDef.CHIEF) {
                    RoundButton(Icons.Filled.Add, "New chat") { vm.open(null) }
                }
            },
            bottomBar = {
                Composer(
                    placeholder = "Message the Chief…",
                    files = files,
                    busy = boxStops(busy, features),
                    outbox = vm.outbox,
                    onSend = { t, a -> send(t, a) },
                    onStop = { vm.stop() },
                    onError = { scope.launch { snack.showSnackbar(it) } },
                    initialText = sharedText,
                    onSignIn = onSignIn.takeIf { signedOut },
                )
            },
        ) { pad ->
            val messages = chat?.messages.orEmpty()
            val first = chat?.offset ?: 0 // where the loaded messages start in the whole chat
            val newestFirst = remember(messages) { messages.asReversed() }
            val botById = remember(bots) { bots.associateBy { it.id } }
            // The "New" line: above the message the server named, or the next one that is loaded.
            val newFirst = vm.newFirst
            val newAt = remember(messages, first, newFirst) { Unread.rowFrom(List(messages.size) { first + it }, newFirst) }
            LazyColumn(
                Modifier.fillMaxSize(),
                state = listState,
                reverseLayout = true,
                // The top bar and the message box float over the messages, which scroll behind them.
                contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = pad.calculateTopPadding() + 4.dp, bottom = pad.calculateBottomPadding() + 4.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom), // few messages: at the bottom, by the message box
            ) {
                // Last in the chat: the Chief's working line while it replies, then your messages that wait for the
                // reply to end, then what it set up or asked for. Where Send stays, the line is all there is of its
                // working state (what it is doing in the server's words, its opening line first, else "Thinking…"), with Stop at its end;
                // against a botdot from before, the line is its opening line and the reply's bubble says the rest.
                val sent = vm.sent // the owner's message on its way, as in a bot's chat: also the first of a new chat
                if (messages.isNotEmpty() || sent != null) item(key = "needs") {
                    Column {
                        if (sent != null && !busy) SentBubble(sent, above = true, sentArrives)
                        if (stays) StatusLine(lineWith(dev.botdot.app.data.OpeningLine.chiefLine(lines["chief:$chatId"], activity.lastOrNull(), busy), sent), CHIEF_COLOR, onStop = if (busy) ({ vm.stop() }) else null, room = true)
                        else StatusLine(lineWith(dev.botdot.app.data.OpeningLine.status(lines["chief:$chatId"].takeIf { busy }, working = false), sent), CHIEF_COLOR)
                        WaitingMessages(vm.queued, "the Chief", onSteer = if (canSteerChief(features)) ({ vm.steer(it) }) else null) { vm.takeBack(it) }
                        if (sent != null && busy) SentBubble(sent, above = false, sentArrives)
                        ChatNeeds(app, "chief", onNeeds, chiefChat = chatId)
                    }
                }
                // A new chat starts like the web page's: the Chief's figure, a heading and the suggestions, in the middle.
                if (messages.isEmpty() && sent == null) item {
                    Column(
                        Modifier.fillParentMaxSize().padding(horizontal = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        BotFigure(CHIEF_COLOR, if (busy) "working" else "idle", 56, FigureDef.CHIEF)
                        Spacer(Modifier.size(14.dp))
                        Text("What should the team work on?", style = MaterialTheme.typography.titleLarge, color = p.text, textAlign = TextAlign.Center)
                        Spacer(Modifier.size(6.dp))
                        Text("Ask for anything. I'll hand it to the right bot, or build a new one.", color = p.muted, textAlign = TextAlign.Center)
                        Spacer(Modifier.size(22.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            val shape = RoundedCornerShape(16.dp)
                            SUGGESTIONS.forEach { s ->
                                Text(s, color = p.muted, fontSize = 13.5.sp, lineHeight = 19.sp,
                                    modifier = Modifier.fillMaxWidth().clip(shape).background(p.panel).border(1.dp, p.line, shape)
                                        .clickable { send(s, files.take()) }.padding(horizontal = 14.dp, vertical = 12.dp))
                            }
                        }
                    }
                }
                itemsIndexed(newestFirst, key = { i, m -> "${first + messages.size - 1 - i}:${m.at}" }) { i, m ->
                    // A reply that is new in this open chat arrives; the owner's own message and a reply still
                    // being written are no replies, and stand still.
                    Column(Modifier.arrives(arrivals, "${first + messages.size - 1 - i}".takeUnless { m.role == "user" || m.pending }), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (newAt >= 0 && messages.size - 1 - i == newAt) NewLine(CHIEF_COLOR)
                        val chips = m.actions.orEmpty().map { a ->
                            val bot = botById[a.botId]
                            val screen = a.kind == "run" && bot?.computer == "linux"
                            chipText(chipWords(a, screen), p.warnText) to when {
                                a.kind == "skill" -> onSkills
                                a.botId != null || a.runId != null -> ({
                                    scope.launch {
                                        runCatching {
                                            val id = a.botId ?: app.api.value?.run(a.runId!!)?.botId
                                            val target = botById[id]
                                            if (target == null) snack.showSnackbar("This bot is no longer available")
                                            else if (a.kind == "run" && target.computer == "linux") onScreen(target.id)
                                            else onBot(target.id)
                                        }.onError { snack.showSnackbar(it.message ?: "Couldn't open bot") }
                                    }
                                    Unit
                                })
                                else -> null
                            }
                        }
                        val index = first + messages.size - 1 - i // its place in the whole chat
                        val approval = remember { messageKey() } // one key for the plan's Approve while it is shown
                        // What the owner steered into this reply while the Chief worked (ADR 040), before it, in the order read.
                        if (m.role == "chief") m.steered.forEach { SteeredMessage(it) }
                        Message(m, if (i == 0 && busy) activity else emptyList(), chips, lineSaysIt = stays, draft = if (i == 0) vm.draft else "",
                            onBuild = { scope.launch { sendFrom(PLAN_APPROVAL, approval) } },
                            onDismiss = { vm.dismiss() },
                            thumbs = if (Ratings.shows(m, features, index)) ({ Thumbs(Ratings.value(m.rating)) { vm.rate(index, it) } }) else null)
                        if (i == 0 && m.role == "chief" && !m.pending && !busy) {
                            Choices(m.choices) { text, key -> sendFrom(text, key) }
                            Questions(m.questions) { text, key -> sendFrom(text, key) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Message(m: ChiefMessage, activity: List<String>, chips: List<Pair<CharSequence, (() -> Unit)?>>, lineSaysIt: Boolean, draft: String = "", onBuild: () -> Unit, onDismiss: () -> Unit, thumbs: (@Composable () -> Unit)? = null) {
    val p = LocalPaper.current
    when {
        m.role == "user" -> MyBubble(m.text, m.attachments)
        m.role == "suggestion" -> Suggestion(m, onBuild, onDismiss)
        m.role == "report" -> Report(m)
        // A reply still being written: the working line under the chat says it ([lineSaysIt]), and only what it
        // did so far stands here, with its draft from a server that sends one (ReplyDraft), growing in the reply's
        // place. Against a botdot from before `message-waits`, its bubble as it was.
        m.pending && draft.isNotEmpty() -> TheirBubble(chips = chips) { MarkdownText(draftSource(draft)) }
        m.pending -> if (lineSaysIt) { if (chips.isNotEmpty()) ActionChips(chips) } else Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Working(activity.lastOrNull()?.let { "$it…" } ?: "Thinking…", activity)
            if (chips.isNotEmpty()) ActionChips(chips)
        }
        else -> {
            val drawn = chiefReply(m)
            val error = drawn.error
            val files = drawn.files
            when {
                // Nothing to show: no bubble, and no words of the app's own. What it did still shows.
                drawn.text == null && error == null && files.isEmpty() -> if (chips.isNotEmpty()) ActionChips(chips)
                // Files alone: a bubble that holds them, as a bot's message without text. No time under it, as on the web page.
                drawn.text == null && error == null -> TheirBubble(chips = chips) { BotFilesRow(files, top = 0.dp) }
                drawn.text == null -> TheirBubble(shortTime(m.endedAt ?: m.at), error = true, copyText = error, chips = chips) {
                    Column {
                        Text(error.orEmpty(), color = p.text)
                        BotFilesRow(files)
                    }
                }
                else -> TheirBubble(shortTime(m.endedAt ?: m.at), copyText = drawn.text, chips = chips, footerEnd = thumbs) {
                    Column {
                        MarkdownText(drawn.text)
                        BotFilesRow(files)
                        // A reply that failed after writing: its problem, in a block of its own under the text.
                        if (error != null) MarkdownText(error, color = p.warnText,
                            modifier = Modifier.padding(top = 8.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.warnSoft).padding(horizontal = 12.dp, vertical = 8.dp))
                    }
                }
            }
        }
    }
}

/**
 * What a Chief reply's bubble shows: its text, the problem of a reply that failed or was stopped (each null when
 * there is none), and the files of the bot's result it is about (none for any other reply).
 */
internal class ChiefReply(val text: String?, val error: String?, val files: List<Attachment> = emptyList())

/**
 * How a Chief reply is drawn (docs/api.md: `error` also comes beside `text`). Both: the text, and the problem in its
 * own block under it. The problem alone: the problem bubble. Neither: nothing, and the app writes no "Done.".
 * Its `files` (docs/api.md, A late result) are drawn in the bubble as under a bot's own message: under the text and
 * above the problem, and alone in a bubble when the reply has no words. A reply still being written shows none.
 */
internal fun chiefReply(m: ChiefMessage) = ChiefReply(m.text.takeIf { it.isNotBlank() }, m.error?.takeIf { it.isNotBlank() }, if (m.pending) emptyList() else m.files.orEmpty())

/** 👍 and 👎 after the time of an unasked message: outlines, the one the owner tapped filled in the Chief's colour. */
@Composable
private fun Thumbs(rating: String?, onTap: (String) -> Unit) {
    val p = LocalPaper.current
    val chief = parseColor(CHIEF_COLOR, p.muted)
    Row {
        for ((value, label) in listOf(Ratings.UP to "More like this", Ratings.DOWN to "Less like this")) {
            val on = rating == value
            val icon = when (value) {
                Ratings.UP -> if (on) Icons.Filled.ThumbUp else Icons.Outlined.ThumbUpOutline
                else -> if (on) Icons.Filled.ThumbDown else Icons.Outlined.ThumbDownOutline
            }
            // An icon button: a touch target of 48 dp around a small icon, read out with its label and whether it is on.
            IconButton(onClick = { onTap(value) }, modifier = Modifier.semantics { selected = on }) {
                Icon(icon, contentDescription = label, tint = if (on) chief else p.faint, modifier = Modifier.size(16.dp))
            }
        }
    }
}

/** What Approve sends to answer a bot's plan for the Chief (the server knows it). */
const val PLAN_APPROVAL = "Approved. Go ahead."

/** "Message from Fleet Doctor": the words, then the bot with its small mark. */
@Composable
private fun FromLine(words: String, from: dev.botdot.app.data.BotRef?) {
    val w = LocalMentions.current
    val line = androidx.compose.ui.text.buildAnnotatedString {
        append("$words ")
        if (from != null) bot(named(w?.bot(from.id), from.name, from.color)) else append("a bot")
    }
    FigureText(line, color = LocalPaper.current.muted, fontSize = 13.5.sp, modifier = Modifier.padding(horizontal = 6.dp))
}

/** A bot's suggestion for the Chief: nothing happens until you tap Approve (or answer in your own words). */
@Composable
private fun Suggestion(m: ChiefMessage, onBuild: () -> Unit, onDismiss: () -> Unit) {
    val p = LocalPaper.current
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FromLine("Suggestion from", m.from)
        Column(Modifier.padding(start = 32.dp).clip(shape).holdToCopy(m.text).background(p.sunk).border(1.dp, p.line2, shape).padding(horizontal = 14.dp, vertical = 10.dp)) {
            MarkdownText(m.text)
        }
        when (m.status) {
            "pending" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onDismiss) { Text("Decline", color = p.text) }
                Button(onClick = onBuild, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Approve") }
            }
            "dismissed" -> Text("You declined it", color = p.muted, fontSize = 13.5.sp, modifier = Modifier.padding(horizontal = 6.dp))
        }
    }
}

/** A bot the Chief handed a task, with its final reply once the teammates it asked had answered. */
@Composable
private fun Report(m: ChiefMessage) {
    val p = LocalPaper.current
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        FromLine("Message from", m.from)
        // A task it didn't finish (`error: true`) is drawn like a failed reply; its text says why.
        Column(Modifier.padding(start = 32.dp).clip(shape).holdToCopy(m.text).background(if (m.failed) p.errSoft else p.sunk).border(1.dp, if (m.failed) p.err.copy(alpha = 0.3f) else p.line2, shape).padding(horizontal = 14.dp, vertical = 10.dp)) {
            if (m.text.isNotBlank()) MarkdownText(m.text) // a file it sent while working has no text
            BotFilesRow(m.files, top = if (m.text.isNotBlank()) 8.dp else 0.dp)
        }
    }
}
