package dev.botdot.app.ui

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.Queued
import dev.botdot.app.data.Room
import dev.botdot.app.data.RoomLink
import dev.botdot.app.data.RoomLinkPreview
import dev.botdot.app.data.RoomMessage
import dev.botdot.app.data.Rooms
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

private val NOT_CONNECTED: String get() = tr("Not connected to botdot")

/** "Shared rooms" in the list, under Needs you and the Board, with the invitations that wait. */
@Composable
internal fun RoomsRow(app: BotDotApp, onClick: () -> Unit) {
    val p = LocalPaper.current
    val on by app.rooms.on.collectAsState()
    val list by app.rooms.list.collectAsState()
    if (!on) return
    val invites = list?.invites?.size ?: 0
    Row(Modifier.fillMaxWidth().padding(horizontal = Space.s12, vertical = Space.s4).clickable(onClickLabel = ROOMS, onClick = onClick).padding(horizontal = Space.s8, vertical = Space.s12),
        verticalAlignment = Alignment.CenterVertically) {
        // One line however narrow the list (#493): the name and what waits in one text that ends in "…".
        val line = RoomWords.rowLine(invites)
        Text(buildAnnotatedString {
            withStyle(SpanStyle(color = p.text, fontWeight = FontWeight.Medium)) { append(ROOMS) }
            if (line != null) withStyle(SpanStyle(color = p.warnText)) { append(" · $line") }
        }, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Spacer(Modifier.size(8.dp))
        Text("›", color = p.faint)
    }
}

/** What the list's row and the Rooms screen say, in one place for their tests. */
internal object RoomWords {
    /** What the row says after its name: only the invitations that wait (#493), nothing otherwise. */
    fun rowLine(invites: Int): String? = if (invites > 0) trn(invites, "{n} invitation", "{n} invitations") else null

    val NOT_A_LINK: String get() = tr("That isn't a room's invite link.")

    /** What a failed action says: the front door's own sentence, or that it was not reached. */
    fun failed(e: Throwable): String = if (e is ApiException && e.said) e.message.orEmpty() else e.message ?: tr("That didn't work")
}

internal val ROOMS: String get() = tr("Shared rooms")

/**
 * Shared rooms (ADR 060): the invitations that wait for this account, each with Accept and Decline, then the rooms it
 * is in, and "New room": a room is made with its invite link (ADR 076) and opens on its settings, to share it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomsScreen(app: BotDotApp, onRoom: (String) -> Unit, onMade: (String) -> Unit, onBack: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    val list by app.rooms.list.collectAsState()
    val on by app.rooms.on.collectAsState()
    val links by app.rooms.links.collectAsState()
    var making by rememberSaveable { mutableStateOf(false) }
    var joining by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { app.rooms.refresh() }
    fun act(block: suspend () -> Unit) = scope.launch { runCatching { block() }.onError { snack.showSnackbar(RoomWords.failed(it)) } }

    if (making) NameDialog(tr("New room"), tr("Name"), "", tr("Make"), onDone = { name ->
        val api = app.api.value ?: throw ApiException(NOT_CONNECTED)
        val room = api.makeRoom(name)
        app.rooms.took(room)
        if (links) runCatching { api.makeRoomLink(room.id) } // without one, the settings offer "Make an invite link"
        making = false
        onMade(room.id)
    }, onClose = { making = false })

    if (joining) JoinDialog(app, onJoined = { id -> joining = false; onRoom(id) }, onClose = { joining = false })

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(ROOMS, style = MaterialTheme.typography.titleMedium) },
                actions = {
                    if (on && links) TextButton(onClick = { joining = true }) { Text(tr("Join"), color = p.text) }
                    if (on) TextButton(onClick = { making = true }) { Text(tr("New room"), color = p.text) }
                })
        },
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            if (!on) item { Hint(tr("Shared rooms are off on this machine. The admin turns them on.")) }
            val invites = list?.invites.orEmpty()
            items(invites, key = { "invite:" + it.room.id }) { i ->
                Section(i.room.name, tr("{name} invites you", "name" to i.by)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                        SecondaryButton(onClick = { act { app.rooms.took(app.api.value!!.acceptRoom(i.room.id)); onRoom(i.room.id) } }) { Text(tr("Accept"), color = p.text) }
                        TextButton(onClick = { act { app.api.value!!.declineRoom(i.room.id); app.rooms.gone(i.room.id) } }) { Text(tr("Decline"), color = p.text) }
                    }
                }
            }
            val rooms = list?.rooms.orEmpty()
            if (on && list != null && rooms.isEmpty() && invites.isEmpty()) item { Hint(tr("No rooms yet")) }
            items(rooms, key = { it.id }) { r -> RoomRow(r) { onRoom(r.id) } }
        }
    }
}

@Composable
private fun RoomRow(r: Room, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = Space.s8), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(r.name, color = p.text, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            Text(Rooms.workingLine(r).ifEmpty { Rooms.summary(r) }, color = p.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1)
        }
        Text(listTime(r.last?.at), color = p.faint, fontSize = Type.s12)
    }
}

/** A dialog with one line to fill: its [title], [label], what it starts with, and the button that [onDone]s it. */
@Composable
private fun NameDialog(title: String, label: String, start: String, button: String, onDone: suspend (String) -> Unit, onClose: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var text by rememberSaveable { mutableStateOf(start) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                Field(text, { text = it.take(60); error = null }, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = p.err) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && text.isNotBlank(), onClick = {
                busy = true
                scope.launch { runCatching { onDone(text.trim()) }.onError { error = RoomWords.failed(it) }; busy = false }
            }) { Text(button, color = p.text) }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text(tr("Cancel"), color = p.text) } },
    )
}

/**
 * Joining with an invite link (ADR 068): the owner pastes the link someone shared, sees the room's name and who made
 * it, and joins. A room this account is in already just opens.
 */
@Composable
private fun JoinDialog(app: BotDotApp, onJoined: (String) -> Unit, onClose: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var text by rememberSaveable { mutableStateOf("") }
    var seen by remember { mutableStateOf<RoomLinkPreview?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val api = { app.api.value ?: throw ApiException(NOT_CONNECTED) }
    fun go(block: suspend () -> Unit) {
        busy = true
        scope.launch { runCatching { block() }.onError { error = RoomWords.failed(it) }; busy = false }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text(seen?.let { tr("Join {name}?", "name" to it.room.name) } ?: tr("Join a room")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                val room = seen
                if (room == null) {
                    Field(text, { text = it.take(400); error = null }, label = { Text(tr("Invite link")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                } else {
                    Text(tr("{name} made this room and shared its invite link.", "name" to room.room.by.ifBlank { tr("Someone") }), color = p.text)
                }
                error?.let { Text(it, color = p.err) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && text.isNotBlank(), onClick = {
                val token = Rooms.linkToken(text)
                val room = seen
                if (token == null) error = RoomWords.NOT_A_LINK
                else if (room == null) go {
                    val got = api().roomByLink(token)
                    if (got.member) onJoined(got.room.id) else seen = got
                } else go { val joined = api().joinRoomByLink(token); app.rooms.took(joined); onJoined(joined.id) }
            }) { Text(if (seen == null) tr("Next") else tr("Join"), color = p.text) }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text(tr("Cancel"), color = p.text) } },
    )
}

/**
 * A room's chat, kept while it is open: its messages as the front door hands them out, oldest first, the newer ones
 * from its live events. The one message the app draws itself is this account's own, from Send until the answer.
 */
class RoomChatModel(private val app: BotDotApp, val roomId: String) : ViewModel() {
    var messages by mutableStateOf<List<RoomMessage>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    private var more = false
    private var loadingOlder = false

    /** What its message box is told about a send. */
    val outbox = Outbox.of("room:$roomId")

    init {
        viewModelScope.launch { app.api.filterNotNull().first(); load() }
        viewModelScope.launch {
            app.rooms.events.collect { ev ->
                if (ev.type == "reset") load()
                else Rooms.messageOf(ev, roomId)?.let { messages = Rooms.merge(messages, listOf(it)) }
            }
        }
    }

    suspend fun load() {
        val a = app.api.value ?: return
        runCatching { a.roomMessages(roomId) }
            .onSuccess { page -> messages = Rooms.merge(messages, page.messages); if (!loaded) more = page.more; loaded = true; error = null }
            .onError { if (!loaded) error = RoomWords.failed(it) }
    }

    /** The page before the oldest message held (the chat was scrolled up). */
    fun loadOlder() {
        val oldest = messages.firstOrNull()?.id ?: return
        if (!more || loadingOlder) return
        loadingOlder = true
        viewModelScope.launch {
            runCatching { app.api.value?.roomMessages(roomId, before = oldest) }.onSuccess { page -> if (page != null) { messages = Rooms.merge(page.messages, messages); more = page.more } }
            loadingOlder = false
        }
    }

    /** This account writes in the room. True once it went; a message that did not go comes back to the box. */
    fun send(text: String, mine: String?): Deferred<Boolean> {
        val known = own(mine).mapTo(HashSet()) { it.id }
        return app.scope.async(start = CoroutineStart.UNDISPATCHED) {
            outbox.send(text, emptyList(), box = true, once = true, known = known) { k ->
                val m = (app.api.value ?: throw ApiException(NOT_CONNECTED)).sendToRoom(roomId, text, k)
                messages = Rooms.merge(messages, listOf(m))
            }
        }
    }

    /** This account's own messages, for [SentMessage.unlessIn]. */
    fun own(mine: String?): List<Queued> = messages.filter { it.bot == null && !it.notice && it.account == mine }.map { Queued(it.id, it.text) }

    /** Drops the turns of this room that wait. */
    fun stop() { viewModelScope.launch { runCatching { app.api.value?.stopRoom(roomId) } } }
}

/**
 * A shared room's chat: every message under who wrote it, a person by their account, a bot as "name · account" in its
 * colour, and under a message the bots it mentioned; the front door's notices as quiet lines. This account's own
 * messages stand right. Typing "@" offers the room's bots. The title opens the room's settings.
 */
@Composable
fun RoomChatScreen(app: BotDotApp, roomId: String, onSettings: () -> Unit, onBack: () -> Unit) {
    val p = LocalPaper.current
    val vm: RoomChatModel = viewModel(key = "room:$roomId") { RoomChatModel(app, roomId) }
    val list by app.rooms.list.collectAsState()
    val mine by app.rooms.account.collectAsState()
    val room = list?.rooms?.firstOrNull { it.id == roomId }
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    // Left, or deleted, here or elsewhere: there is no chat to show, once the list was read again.
    LaunchedEffect(list != null, room == null) {
        if (list == null || room != null) return@LaunchedEffect
        app.rooms.refresh()
        if (app.rooms.list.value?.rooms?.none { it.id == roomId } == true) onBack()
    }
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.let { (it.visibleItemsInfo.lastOrNull()?.index ?: 0) >= it.totalItemsCount - 4 } }.collect { near -> if (near) vm.loadOlder() }
    }
    val mentions = remember(room) { Rooms.world(room) }
    val shown by remember { derivedStateOf { vm.messages.asReversed() } }
    val sent = vm.outbox.sent?.unlessIn(vm.own(mine))
    val server by app.store.version.value.collectAsState()
    CompositionLocalProvider(LocalMentions provides mentions, LocalSiteIcons provides sitesShown(server?.features), LocalProductCards provides productCardsShown(server?.features)) {
        Scaffold(
            containerColor = p.bg,
            snackbarHost = { SnackbarHost(snack) },
            topBar = { ChatBar(null, "idle", room?.name.orEmpty(), onName = onSettings, onBack = onBack, nameLabel = tr("Its people and bots"), picture = { RoomMark() }) },
            bottomBar = {
                Composer(
                    placeholder = room?.name?.let { tr("Message {name}…", "name" to it) } ?: tr("Message the room…"),
                    files = null,
                    busy = false,
                    outbox = vm.outbox,
                    onSend = { text, _ -> vm.send(text, mine) },
                    onStop = {},
                    onError = { scope.launch { snack.showSnackbar(it) } },
                )
            },
        ) { pad ->
            LazyColumn(
                Modifier.fillMaxSize(),
                state = listState,
                reverseLayout = true,
                contentPadding = PaddingValues(start = Space.s16, end = Space.s16, top = pad.calculateTopPadding() + Space.s4, bottom = pad.calculateBottomPadding() + Space.s4),
                verticalArrangement = Arrangement.spacedBy(Space.s12, Alignment.Bottom),
            ) {
                item(key = "tail") {
                    Column {
                        if (sent != null) SentBubble(sent, above = false)
                        val working = room?.let { Rooms.workingLine(it) }.orEmpty()
                        if (working.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(top = Space.s8), verticalAlignment = Alignment.CenterVertically) {
                            Text(working, color = p.muted, fontSize = Type.s14, modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite })
                            TextButton(onClick = { vm.stop() }) { Text(tr("Stop"), color = p.text) }
                        }
                    }
                }
                if (vm.loaded && vm.messages.isEmpty() && sent == null) item {
                    Text(RoomChat.EMPTY, color = p.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(Space.s24))
                }
                vm.error?.let { e -> item { Text(e, color = p.err, modifier = Modifier.padding(Space.s16)) } }
                items(shown, key = { it.id }) { m -> RoomMessageRow(m, room, mine) }
            }
        }
    }
}

/** What a room's chat says, for its tests. */
internal object RoomChat {
    val EMPTY: String get() = tr("Nothing here yet. Mention a bot with @ and it answers; it only talks, it uses no tools.")

    /** Whether [m] stands right, as this account's own: a person's message by [mine]. */
    fun isMine(m: RoomMessage, mine: String?): Boolean = mine != null && m.bot == null && !m.notice && m.account == mine
}

@Composable
private fun RoomMark() {
    val p = LocalPaper.current
    Box(Modifier.size(32.dp), contentAlignment = Alignment.Center) { Text("#", color = p.muted, fontSize = Type.s16, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun RoomMessageRow(m: RoomMessage, room: Room?, mine: String?) {
    val p = LocalPaper.current
    val mentioned = Rooms.mentionLine(m)
    when {
        m.notice -> Text(m.text, color = p.faint, fontSize = Type.s12, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = Space.s4))
        RoomChat.isMine(m, mine) -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
            MyBubble(m.text)
            if (mentioned.isNotEmpty()) Text(mentioned, color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(top = Space.s4, end = Space.s8))
        }
        else -> {
            // A bot in its colour (as the room has it now, else neutral); a person in plain words.
            val color = m.bot?.let { b -> room?.bots?.firstOrNull { it.account == m.account && it.id == b.id }?.color }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                if (m.bot != null) { Box(Modifier.padding(top = Space.s16)) { BotFigure(color ?: GONE_COLOR, "idle", 28, null) }; Spacer(Modifier.size(6.dp)) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                    Text(Rooms.author(m), color = if (m.bot != null) parseColor(color, p.muted) else p.muted, fontSize = Type.s12, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = Space.s8))
                    TheirBubble(shortTime(m.at), copyText = m.text) { MarkdownText(m.text) }
                    if (mentioned.isNotEmpty()) Text(mentioned, color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(start = Space.s8))
                }
            }
        }
    }
}

/**
 * A room's settings: its name, its people and who is still invited by name, the maker's invite link (the only way in,
 * ADR 076), its bots with "Remove" on this account's own, adding one of this account's bots, and Leave (Delete for the
 * account that made it).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomSettingsScreen(app: BotDotApp, roomId: String, onGone: () -> Unit, onBack: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    val list by app.rooms.list.collectAsState()
    val mine by app.rooms.account.collectAsState()
    val bots by app.store.bots.value.collectAsState()
    val links by app.rooms.links.collectAsState()
    val room = list?.rooms?.firstOrNull { it.id == roomId }
    val maker = links && room != null && Rooms.mayDelete(room, mine)
    var link by remember { mutableStateOf<RoomLink?>(null) }
    var linkRead by remember { mutableStateOf(false) }
    val context = LocalContext.current
    LaunchedEffect(maker) { if (maker) runCatching { app.api.value?.roomLink(roomId) }.onSuccess { link = it; linkRead = true } }
    var name by rememberSaveable(room?.name) { mutableStateOf(room?.name.orEmpty()) }
    var asking by remember { mutableStateOf<String?>(null) } // "leave" or "delete", while its confirmation is open
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { app.api.value?.room(roomId) }.onSuccess { it?.let(app.rooms::took) } }
    fun act(done: String? = null, block: suspend () -> Unit) = scope.launch {
        busy = true
        runCatching { block() }.onSuccess { done?.let { snack.showSnackbar(it) } }.onError { snack.showSnackbar(RoomWords.failed(it)) }
        busy = false
    }
    val api = { app.api.value ?: throw ApiException(NOT_CONNECTED) }

    asking?.let { what ->
        AlertDialog(
            onDismissRequest = { asking = null },
            title = { Text(if (what == "delete") tr("Delete {name}?", "name" to room?.name) else tr("Leave {name}?", "name" to room?.name)) },
            text = { Text(if (what == "delete") tr("The room and its messages go, for everyone in it.") else tr("Your bots leave with you. The room stays with the others.")) },
            confirmButton = {
                TextButton(onClick = {
                    asking = null
                    act { if (what == "delete") api().deleteRoom(roomId) else api().leaveRoom(roomId); app.rooms.gone(roomId); onGone() }
                }) { Text(if (what == "delete") tr("Delete") else tr("Leave"), color = p.err) }
            },
            dismissButton = { TextButton(onClick = { asking = null }) { Text(tr("Cancel"), color = p.text) } },
        )
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(navigationIcon = { if (LocalPanelClose.current == null) BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(room?.name.orEmpty(), style = MaterialTheme.typography.titleMedium) }, actions = { PanelClose() })
        },
    ) { pad ->
        val r = room ?: return@Scaffold
        Column(Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            Section(tr("Name")) {
                Field(name, { name = it.take(60) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (name.isNotBlank() && name.trim() != r.name) SecondaryButton(enabled = !busy, onClick = { act(tr("Saved")) { app.rooms.took(api().renameRoom(roomId, name.trim())) } }) { Text(tr("Save"), color = p.text) }
            }
            Section(tr("People")) {
                r.members.forEach { m -> Text(m.account + if (m.account == mine) " " + tr("(you)") else "", color = p.text, style = MaterialTheme.typography.bodyLarge) }
                r.invites.forEach { i -> Text("${i.account} · " + tr("invited by {name}", "name" to i.by), color = p.muted, style = MaterialTheme.typography.bodyMedium) }
            }
            if (maker && linkRead) Section(tr("Invite link")) {
                val l = link
                if (l == null) {
                    SecondaryButton(enabled = !busy, onClick = { act { link = api().makeRoomLink(roomId) } }) { Text(tr("Make an invite link"), color = p.text) }
                } else {
                    SelectionContainer { Text(l.url, color = p.text, style = MaterialTheme.typography.bodyMedium) }
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                        SecondaryButton(enabled = !busy, onClick = {
                            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, l.url)
                            context.startActivity(Intent.createChooser(send, r.name))
                        }) { Text(tr("Share"), color = p.text) }
                        TextButton(enabled = !busy, onClick = { act(tr("A new link: the one before no longer works")) { link = api().makeRoomLink(roomId) } }) { Text(tr("New link"), color = p.text) }
                        TextButton(enabled = !busy, onClick = { act(tr("Taken back")) { api().dropRoomLink(roomId); link = null } }) { Text(tr("Take back"), color = p.err) }
                    }
                }
            }
            Section(tr("Bots")) {
                if (r.bots.isEmpty()) Hint(tr("No bots yet."))
                r.bots.forEach { b ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        BotFigure(b.color ?: GONE_COLOR, "idle", 24, null)
                        Spacer(Modifier.size(8.dp))
                        Text(Rooms.label(b.name, b.account), color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        if (b.account == mine) TextButton(enabled = !busy, onClick = { act { app.rooms.took(api().removeRoomBot(roomId, b.id)) } }) { Text(tr("Remove"), color = p.text) }
                    }
                }
                val addable = Rooms.addable(r, bots.orEmpty(), mine)
                if (addable.isNotEmpty()) {
                    Text(tr("Add one of yours"), color = p.muted, style = MaterialTheme.typography.bodyMedium)
                    addable.forEach { b ->
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            BotFigure(b.color, "idle", 24, b.outfit)
                            Spacer(Modifier.size(8.dp))
                            Text(b.name, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                            TextButton(enabled = !busy, onClick = { act { app.rooms.took(api().addRoomBot(roomId, b.id)) } }) { Text(tr("Add"), color = p.text) }
                        }
                    }
                } else if (bots.orEmpty().none { it.rooms?.allowRooms == true }) Hint(tr("None of your bots may be in shared rooms yet: switch it on in a bot's settings."))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                SecondaryButton(enabled = !busy, onClick = { asking = "leave" }) { Text(tr("Leave"), color = p.err) }
                if (Rooms.mayDelete(r, mine)) SecondaryButton(enabled = !busy, onClick = { asking = "delete" }) { Text(tr("Delete"), color = p.err) }
            }
        }
    }
}
