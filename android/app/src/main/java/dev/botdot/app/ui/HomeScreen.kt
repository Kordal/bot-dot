package dev.botdot.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Feedback as FeedbackIcon
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import android.content.res.Configuration
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import dev.botdot.app.feed.plainText
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.ChatHit
import dev.botdot.app.data.Feedback
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.Group
import dev.botdot.app.data.Groups
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.Run
import dev.botdot.app.data.WhatsNew
import dev.botdot.app.data.jobWaits
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.delay
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import dev.botdot.app.feed.Feed
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import sh.calvin.reorderable.ReorderableCollectionItemScope
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

private const val PINS = ListLayout.PINS // the big figures on top (the Chief, the bots and groups you pinned): drag a row above them to pin it
private const val CHIEF = "chief"

/**
 * The contact list: the Chief and the bots and groups you pinned as big figures on top (in your order), then the
 * rest, by category: a category's bots, then its groups.
 * [active]: whose chat is open beside the list ("chief", a bot's id or a group's row, "group:<id>"), on a screen wide enough for both.
 * [keypad]: from 840 dp the same bots and groups as keys, a page per category ([KeypadView]), under the same buttons,
 * Needs you and Board; the search shows what it finds in their place. [keys]: the hardware keyboard's presses for it.
 * [sections]: on a phone, the same pages one under the other as sections of keys ([KeypadSections]) under Needs you
 * and the Board, over the Chief's message box; the search shows what it finds in their place.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun HomeScreen(app: BotDotApp, modifier: Modifier = Modifier, active: String? = null, onBot: (String) -> Unit, onGroup: (String) -> Unit, onChief: () -> Unit, onNew: () -> Unit, onDashboard: () -> Unit, onHit: (ChatHit) -> Unit, onNeedsYou: () -> Unit, onOpen: (String) -> Unit, shows: ListWidth.Shows = ListWidth.Shows.ALL, keypad: Boolean = false, keys: KeyRelay? = null, sections: Boolean = false) {
    val p = LocalPaper.current
    // A list too narrow for names (beside the chat, dragged there): figures only, a mark for the Board, and no search.
    val figures = shows == ListWidth.Shows.FIGURES
    val api by app.api.collectAsState()
    val feedState by app.feed.state.collectAsState()
    val scope = rememberCoroutineScope()
    // What the app keeps (Store): shown at once, and kept up to date from the live feed.
    val store = app.store
    val bots by store.bots.value.collectAsState()
    val error by store.bots.error.collectAsState()
    // The groups: none from a botdot server without them, and then nothing below draws or offers one.
    val groupsNow by store.groups.value.collectAsState()
    val groups = groupsNow.orEmpty()
    val turnLines by store.turnLines.value.collectAsState() // what each member at work in a group said it is doing
    var refreshing by remember { mutableStateOf(false) }

    val server by store.version.value.collectAsState() // for the app update banner
    // Feedback beside Settings (#216): shown when the front door says it goes to an admin page, asked once per server.
    var feedbackOn by remember(api) { mutableStateOf(false) }
    var feedbackOpen by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(api, server?.features) {
        feedbackOn = false
        val a = api ?: return@LaunchedEffect
        if (server?.features?.contains("accounts") != true) return@LaunchedEffect
        feedbackOn = Feedback.on(server?.features, runCatching { a.frontDoorSession() }.getOrNull())
    }
    // What's new after an update (#219): the notes this person has not seen, asked when the server announces it.
    // Not saved: after a rotation it is asked again, and what was not closed yet shows again.
    var whatsNew by remember(api) { mutableStateOf<List<WhatsNew.Entry>>(emptyList()) }
    val asksWhatsNew = WhatsNew.asks(server?.features)
    LaunchedEffect(api, asksWhatsNew) {
        whatsNew = emptyList()
        val a = api ?: return@LaunchedEffect
        if (asksWhatsNew) whatsNew = runCatching { a.whatsNew() }.getOrDefault(emptyList())
    }
    if (whatsNew.isNotEmpty() && !feedbackOpen) WhatsNewDialog(whatsNew, onClose = {
        val shown = whatsNew
        whatsNew = emptyList()
        scope.launch { runCatching { api?.whatsNewSeen(shown) } }
    })
    if (feedbackOpen) FeedbackDialog(send = { kind, text -> (api ?: throw ApiException("Can't reach botdot.")).sendFeedback(kind, text) }, onClose = { feedbackOpen = false })
    val context = androidx.compose.ui.platform.LocalContext.current
    // One small head per thing that waits, in the colour of the bot it's about (the Chief's for the rest).
    val waiting by store.waiting.collectAsState(initial = emptyList())
    val chiefWho = chiefNamed()
    val chiefName = chiefWho.name
    val needsWho = remember(waiting, chiefWho) { waiting.map { if (it.color == null) chiefWho else Named("", it.color, it.outfit) } }
    val needs = needsWho.size
    val chief by store.chief.value.collectAsState()
    val chiefBusy = chief?.busy == true // the logo's dot pulses while it works
    val dash by store.dashboard.value.collectAsState()
    // The search box: bots by name, and messages in every chat (fetched a moment after you stop typing).
    var query by rememberSaveable { mutableStateOf("") }
    var searching by rememberSaveable { mutableStateOf(false) } // the search box shows only once you ask for it
    val q = if (figures) "" else query.trim().lowercase() // a list of figures has no search box
    var hits by remember { mutableStateOf<List<ChatHit>>(emptyList()) }
    LaunchedEffect(q, api) {
        SearchMarks.terms = SearchMarks.of(q) // marked in the chats you open from here
        hits = emptyList()
        if (q.length < 2) return@LaunchedEffect
        delay(250)
        hits = runCatching { api?.search(q) }.getOrNull().orEmpty()
    }
    // The list, as keys: the big figures (PINS), then each category's heading ("g:<name>"), its bots' ids and its
    // groups' rows ("group:<id>"), in your order. While you drag, this is the order you see; letting go saves where
    // the row ended up.
    val layout = remember { mutableStateListOf<String>() }
    val pins = remember { mutableStateListOf<String>() } // the pinned bots' ids, then the pinned groups' rows, in your order
    var dragging by remember { mutableStateOf<String?>(null) }
    val haptic = LocalHapticFeedback.current
    // Categories you folded: only their heading shows (remembered on this phone).
    val folded by app.settings.foldedGroups.collectAsState(initial = emptySet())
    fun syncLayout() {
        if (dragging != null) return
        val rows = ListLayout.rows(bots.orEmpty(), groups, folded)
        pins.clear()
        pins.addAll(rows.pins)
        layout.clear()
        layout.addAll(rows.layout)
    }

    // Pull to refresh, or after a change here: everything the list shows, at once.
    suspend fun load() = coroutineScope {
        listOf(store.bots, store.groups, store.chief, store.recent, store.needs, store.dashboard).forEach { launch { it.refresh() } }
    }
    LaunchedEffect(bots, groupsNow, folded) { syncLayout() }
    // Worked out once per list of bots, not again for every row that's drawn.
    val byId = remember(bots) { bots.orEmpty().associateBy { it.id } }
    val groupById = remember(groupsNow) { groups.associateBy { ListLayout.groupRow(it.id) } }
    val categoryBots = remember(bots) { bots.orEmpty().filter { it.pinned == 0 }.groupBy { it.group } }
    // Each bot's last run that said something: its row shows that, and when.
    val recent by store.recent.value.collectAsState()
    val lastRun = remember(recent) { recent.orEmpty().filterNot { it.quiet }.groupBy { it.botId }.mapValues { it.value.first() } }

    val listState = rememberLazyListState()
    // The dragged row passes a row: they swap. Above the big figures it's pinned; past a heading it's in that category.
    val reorder = rememberReorderableLazyListState(listState) { from, to ->
        val a = layout.indexOf(from.key as? String ?: return@rememberReorderableLazyListState)
        val b = layout.indexOf(to.key as? String ?: return@rememberReorderableLazyListState)
        if (a < 0 || b < 0) return@rememberReorderableLazyListState
        layout.add(b, layout.removeAt(a))
        haptic.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
    }
    // Saves the row [id]'s new place ([ListLayout.change]): where the list's drag let it go, or the keypad's (#499).
    // The list is read again after it, saved or not.
    fun save(id: String, change: JsonObject) {
        val group = groupById[id]
        scope.launch {
            runCatching { if (group != null) api?.updateGroup(group.id, change) else api?.updateBot(id, change) }
                .onFailure { android.widget.Toast.makeText(context, it.message ?: "Couldn't save", android.widget.Toast.LENGTH_LONG).show() }
            load()
            syncLayout() // didn't save: back where it was (the same list again changes nothing by itself)
        }
    }
    // Let go: save where the row ended up: its place among the pinned ones, or its category and place there. A bot's
    // place is counted among the bots and a group's among the groups (ListLayout.dropped).
    fun dropped() {
        val id = dragging ?: return
        dragging = null
        haptic.performHapticFeedback(HapticFeedbackType.GestureEnd)
        val place = ListLayout.dropped(layout, pins, id) ?: return
        val group = groupById[id]
        val bot = bots.orEmpty().firstOrNull { it.id == id }
        if (group == null && bot == null) return
        val pinned = group?.pinned ?: bot?.pinned ?: 0
        val category = group?.category ?: bot?.group.orEmpty()
        val order = group?.order ?: bot?.order ?: 0
        val stays = when (place) {
            is ListLayout.Place.Pinned -> place.at == pinned
            is ListLayout.Place.In -> pinned == 0 && place.category == category && place.at == order
        }
        if (stays) return syncLayout()
        save(id, ListLayout.change(place, group = group != null, pinned = pinned > 0))
    }
    // The big figures: press and hold one, then drag it to its place among them.
    val pinState = rememberLazyListState()
    val pinReorder = rememberReorderableLazyListState(pinState) { from, to ->
        val a = pins.indexOf(from.key as? String ?: return@rememberReorderableLazyListState)
        val b = pins.indexOf(to.key as? String ?: return@rememberReorderableLazyListState)
        if (a < 0 || b < 0) return@rememberReorderableLazyListState // the Chief stays first
        pins.add(b, pins.removeAt(a))
        haptic.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
    }
    // What a bot's row says under its name: what it's doing, or the last thing it said.
    val lines by store.lines.lines.collectAsState() // what each working bot's line reads
    fun sub(b: Bot): String = botSub(b, lastRun[b.id], lines["bot:${b.id}"])
    fun asks(b: Bot): Boolean = botAsks(b, lastRun[b.id]) != null // its row reads "Asks: …", with the mark
    // A bot row you can press and hold, then drag.
    @Composable
    fun ReorderableCollectionItemScope.BotRow(b: Bot, lifted: Boolean) {
        Contact(b.color, b.state, b.name, sub(b), listTime(lastRun[b.id]?.startedAt), active = b.id == active, lifted = lifted, outfit = b.outfit, unread = b.unread, asks = asks(b), modifier = Modifier.longPressDraggableHandle(
            onDragStarted = { dragging = b.id; haptic.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate) },
            onDragStopped = { dropped() },
        )) { onBot(b.id) }
    }
    // A group's row: its members' heads with the faces of their states, its name, and its newest reply with the
    // bot's name before it; while a member works, who it is and its opening line; "… asks" with the mark when one asks.
    @Composable
    fun GroupContact(g: Group, modifier: Modifier = Modifier, lifted: Boolean = false) {
        val line = groupLine(g, bots.orEmpty(), turnLines)
        val members = Groups.members(g, bots.orEmpty())
        Contact(line.color, if (line.working) "working" else "idle", g.name, line.text, listTime(g.last?.at), active = ListLayout.groupRow(g.id) == active, lifted = lifted,
            unread = g.unread, asks = line.asks, who = line.who, picture = { GroupPicture(members, 40) }, modifier = modifier) { onGroup(g.id) }
    }
    // Press and hold a group's row or its big figure, then drag it, as a bot's.
    fun ReorderableCollectionItemScope.dragHandle(key: String): Modifier = Modifier.longPressDraggableHandle(
        onDragStarted = { dragging = key; haptic.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate) },
        onDragStopped = { dropped() },
    )
    // "Needs you" above the rows or the keys: what waits, with one small head per thing.
    @Composable
    fun NeedsRow() {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).clip(RoundedCornerShape(14.dp)).background(p.warnSoft)
                .clickable(onClick = onNeedsYou).padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Needs you", color = p.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text("Waiting for your OK", color = p.warnText, style = MaterialTheme.typography.bodySmall) // the figures say how many
            }
            Spacer(Modifier.size(10.dp))
            NeedsFigures(needsWho)
        }
    }
    // Above the keys, on the keypad and on a phone: what went wrong, a newer app, Needs you and the Board.
    @Composable
    fun AboveKeys() {
        error?.let { Text(it, color = p.err, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(16.dp)) }
        if (dev.botdot.app.data.AppUpdate.newer(server) != null) Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
            AppUpdateBanner(api, server) { android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_LONG).show() }
        }
        if (needs > 0) NeedsRow()
        DashboardStrip(dash, bots.orEmpty(), onClick = onDashboard)
    }
    // The keypad, and a phone's sections: the list's own order cut into pages, each bot and group a key that says what its row says.
    val pages = remember(bots, groupsNow, keypad, sections) { if (keypad || sections) Keypad.pages(bots.orEmpty(), groups) else emptyList() }
    fun look(k: Keypad.Key): KeyLook = when (k) {
        is Keypad.Key.OfBot -> k.bot.let { b -> KeyLook(b.name, sub(b), b.color, b.state, outfit = b.outfit, unread = b.unread, asks = asks(b)) }
        is Keypad.Key.OfGroup -> {
            val line = groupLine(k.group, bots.orEmpty(), turnLines)
            KeyLook(k.group.name, line.text, line.color, if (line.working) "working" else "idle", who = line.who, unread = k.group.unread, asks = line.asks, members = Groups.members(k.group, bots.orEmpty()))
        }
    }
    val openKey = { k: Keypad.Key -> when (k) { is Keypad.Key.OfBot -> onBot(k.bot.id); is Keypad.Key.OfGroup -> onGroup(k.group.id) } }
    var askSearch by remember { mutableIntStateOf(0) } // Ctrl+K: into the search box, shown or not
    val focusManager = LocalFocusManager.current
    if (keypad) KeypadKeys(keys, pages, keysShown = q.isEmpty(), onKey = openKey,
        // Esc: the Chief's chat again, and out of the message box it was typed in.
        onChief = { focusManager.clearFocus(); onChief() },
        onSearch = { searching = true; askSearch++ }, folded = folded)
    // A category's page folds with the list's category of the same name (#171): one setting, on this phone.
    val foldPage = { page: Keypad.Page -> Keypad.foldName(page)?.let { name -> scope.launch { app.settings.toggleFolded(name) } }; Unit }
    val config = LocalConfiguration.current
    val keyboard = config.keyboard == Configuration.KEYBOARD_QWERTY && config.hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_NO

    CompositionLocalProvider(LocalListShows provides shows) {
    Column(modifier.background(p.bg)) {
        // The logo and the list's buttons: in a row, or one under the other in a list of figures, which has no search.
        if (figures) Column(Modifier.fillMaxWidth().statusBarsPadding().padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Logo(busy = chiefBusy || bots.orEmpty().any { it.running })
            if (feedState == Feed.State.Retrying) Box(Modifier.size(8.dp).clip(CircleShape).background(p.warn).semantics { contentDescription = "Can't reach botdot" })
            RoundButton(Icons.Filled.Add, "New chat", onClick = onNew)
            RoundButton(Icons.Filled.Settings, "Settings") { onOpen("settings") }
            if (feedbackOn) RoundButton(Icons.Filled.FeedbackIcon, "Feedback") { feedbackOpen = true }
        }
        // A list of names: the logo, and the buttons under it, a little smaller, so that all three fit in 140.
        else if (shows == ListWidth.Shows.NAMES) Column(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Logo(busy = chiefBusy || bots.orEmpty().any { it.running })
                if (feedState == Feed.State.Retrying) Box(Modifier.size(8.dp).clip(CircleShape).background(p.warn).semantics { contentDescription = "Can't reach botdot" })
            }
            // Four buttons don't fit in one row of 140: Feedback wraps under them there.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RoundButton(Icons.Filled.Search, "Search", size = 34.dp) { searching = !searching; if (!searching) query = "" }
                RoundButton(Icons.Filled.Add, "New chat", size = 34.dp, onClick = onNew)
                RoundButton(Icons.Filled.Settings, "Settings", size = 34.dp) { onOpen("settings") }
                if (feedbackOn) RoundButton(Icons.Filled.FeedbackIcon, "Feedback", size = 34.dp) { feedbackOpen = true }
            }
        }
        else Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 16.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Logo(busy = chiefBusy || bots.orEmpty().any { it.running })
            Spacer(Modifier.weight(1f))
            ConnectionDot(feedState)
            RoundButton(Icons.Filled.Search, "Search") { searching = !searching; if (!searching) query = "" }
            RoundButton(Icons.Filled.Add, "New chat", onClick = onNew)
            // Settings; Memory, Skills, Connectors and the rest open from there.
            RoundButton(Icons.Filled.Settings, "Settings") { onOpen("settings") }
            if (feedbackOn) RoundButton(Icons.Filled.FeedbackIcon, "Feedback") { feedbackOpen = true }
        }
        if ((searching || query.isNotEmpty()) && !figures) SearchField(query, askSearch) { query = it }
        // The keypad, while the search finds nothing to show in its place.
        if (keypad && q.isEmpty()) Column(Modifier.fillMaxSize().navigationBarsPadding()) {
            AboveKeys()
            KeypadView(pages, active, ::look, onKey = openKey, onAsk = onNew, modifier = Modifier.weight(1f), hint = KEYPAD_HINT.takeIf { keyboard },
                // A key dragged to another place or page: saved as the list's drag saves a row.
                onMove = { k, place -> save(k.id, ListLayout.change(place, group = k is Keypad.Key.OfGroup, pinned = k.pinned)) },
                folded = folded, onFold = foldPage)
        }
        // A phone's sections, while the search finds nothing to show in their place; pulled down, everything again.
        else if (sections && q.isEmpty()) PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            KeypadSections(pages, ::look, onKey = openKey, onChief = onChief, modifier = Modifier.fillMaxSize().navigationBarsPadding(), chiefUnread = chief?.unread ?: 0, folded = folded, onFold = foldPage) {
                AboveKeys()
                if (bots != null && pages.isEmpty()) Text("No bots yet. Ask the Chief of Staff to make one.", color = p.muted, modifier = Modifier.padding(20.dp))
            }
        }
        else PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } },
            modifier = Modifier.fillMaxSize().imePadding(), // what the search found stays above the keyboard
        ) {
            LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = WindowInsets.navigationBars.asPaddingValues()) {
                if (error != null) item {
                    Text(error!!, color = p.err, style = if (figures) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(if (figures) 6.dp else 16.dp))
                }
                if (dev.botdot.app.data.AppUpdate.newer(server) != null && !figures) item {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                        AppUpdateBanner(api, server) { android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_LONG).show() }
                    }
                }
                // "Needs you" in a list of figures: the first of the figures that wait, on the same ground.
                if (needs > 0 && figures) item {
                    Box(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp).clip(RoundedCornerShape(14.dp)).background(p.warnSoft)
                        .clickable(onClickLabel = "Needs you", onClick = onNeedsYou).padding(vertical = 9.dp), contentAlignment = Alignment.Center) {
                        NeedsFigures(needsWho, max = 1)
                    }
                }
                else if (needs > 0) item { NeedsRow() }
                val list = bots.orEmpty()
                if (q.isNotEmpty()) {
                    // Searching: the bots that match, then the messages, instead of the usual list.
                    if ("chief of staff".contains(q) || chiefName.lowercase().contains(q)) item(key = "chief") { Contact(CHIEF_COLOR, if (chiefBusy) "working" else "idle", chiefName, "Your team of bots. Ask for anything.", outfit = FigureDef.CHIEF, unread = chief?.unread ?: 0, onClick = onChief) }
                    items(list.filter { "${it.name} ${it.description} ${it.group}".lowercase().contains(q) }, key = { it.id }) { b ->
                        Contact(b.color, b.state, b.name, sub(b), listTime(lastRun[b.id]?.startedAt), outfit = b.outfit, unread = b.unread, asks = asks(b)) { onBot(b.id) }
                    }
                    items(groups.filter { groupSearchText(it, list).contains(q) }, key = { ListLayout.groupRow(it.id) }) { g -> GroupContact(g) }
                    if (hits.isNotEmpty()) item(key = "hits") {
                        Text("Messages", color = p.muted, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 2.dp))
                    }
                    items(hits.withIndex().toList(), key = { "hit:${it.index}" }) { (_, h) -> Hit(h, list) { onHit(h) } }
                    return@LazyColumn
                }
                item(key = "dashboard") { DashboardStrip(dash, list, onClick = onDashboard) }
                // One block for all of them, so a row you drag above the big figures or across a heading keeps being dragged.
                items(layout, key = { it }) { row ->
                    val bot = byId[row]
                    val group = groupById[row]
                    when {
                        row == PINS -> ReorderableItem(reorder, key = PINS) {
                            // While you drag a row, the big figures stand out: above them is where bots get pinned.
                            val dragRow = dragging.let { it != null && it !in pins }
                            val ground by animateColorAsState(if (dragRow) p.sunk else p.bg, tween(200), label = "pins")
                            // A list of figures has no room for a row of them: one under the other, in the order they have.
                            if (figures) Column(Modifier.fillMaxWidth().padding(vertical = 2.dp).background(ground), horizontalAlignment = Alignment.CenterHorizontally) {
                                Pin(CHIEF_COLOR, if (chiefBusy) "working" else "idle", chiefName, active = active == CHIEF, outfit = FigureDef.CHIEF, unread = chief?.unread ?: 0, onClick = onChief)
                                for (id in pins) {
                                    val g = groupById[id]
                                    val b = byId[id]
                                    if (g != null) {
                                        val line = groupLine(g, list, turnLines)
                                        Pin(line.color, "idle", g.name, active = id == active, unread = g.unread, asks = line.asks, picture = { GroupPicture(Groups.members(g, list), 52) }) { onGroup(g.id) }
                                    } else if (b != null) Pin(b.color, b.state, b.name, active = id == active, outfit = b.outfit, unread = b.unread, asks = asks(b)) { onBot(id) }
                                }
                            }
                            else LazyRow(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp).clip(RoundedCornerShape(16.dp)).background(ground), state = pinState) {
                                item(key = CHIEF) { Pin(CHIEF_COLOR, if (chiefBusy) "working" else "idle", chiefName, active = active == CHIEF, outfit = FigureDef.CHIEF, unread = chief?.unread ?: 0, onClick = onChief) }
                                items(pins, key = { it }) { id ->
                                    // A pinned group: its picture as a big figure, after the pinned bots.
                                    groupById[id]?.let { g ->
                                        ReorderableItem(pinReorder, key = id) { lifted ->
                                            val line = groupLine(g, list, turnLines)
                                            val members = Groups.members(g, list)
                                            Pin(line.color, "idle", g.name, active = id == active, lifted = lifted, unread = g.unread, asks = line.asks, picture = { GroupPicture(members, 52) }, modifier = dragHandle(id)) { onGroup(g.id) }
                                        }
                                        return@items
                                    }
                                    val b = byId[id] ?: return@items
                                    ReorderableItem(pinReorder, key = id) { lifted ->
                                        Pin(b.color, b.state, b.name, active = id == active, lifted = lifted, outfit = b.outfit, unread = b.unread, asks = asks(b), modifier = Modifier.longPressDraggableHandle(
                                            onDragStarted = { dragging = id; haptic.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate) },
                                            onDragStopped = { dropped() },
                                        )) { onBot(id) }
                                    }
                                }
                            }
                        }
                        bot != null -> ReorderableItem(reorder, key = row) { lifted -> BotRow(bot, lifted) }
                        group != null -> ReorderableItem(reorder, key = row) { lifted -> GroupContact(group, dragHandle(row), lifted) }
                        ListLayout.isHeading(row) -> ReorderableItem(reorder, key = row) {
                            // Tap to fold or open the category; folded, a green dot says one of its bots is working.
                            val category = ListLayout.categoryOf(row)
                            val members = categoryBots[category].orEmpty()
                            val isFolded = category in folded
                            val turn by animateFloatAsState(if (isFolded) -90f else 0f, tween(200), label = "fold")
                            // A list of figures has no room for a category's name: a line stands where it begins.
                            if (figures) Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp).height(1.dp).background(p.line))
                            else Row(Modifier.fillMaxWidth().clickable(onClickLabel = if (isFolded) "Show this category" else "Hide this category") { scope.launch { app.settings.toggleFolded(category) } }
                                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(category.ifEmpty { "Other" }, color = p.muted, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                Spacer(Modifier.size(6.dp))
                                Text("▾", color = p.faint, fontSize = 12.sp, modifier = Modifier.graphicsLayer { rotationZ = turn })
                                if (isFolded && members.any { it.running }) {
                                    Spacer(Modifier.size(8.dp))
                                    Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(p.ok))
                                }
                            }
                        }
                    }
                }
                if (bots != null && list.isEmpty() && groups.isEmpty() && !figures) item {
                    Text("No bots yet. Ask the Chief of Staff to make one.", color = p.muted, modifier = Modifier.padding(20.dp))
                }
            }
        }
    }
    }
}

/** The search box above the list (the Search button shows it): bots by name, and messages in every chat. */
@Composable
private fun SearchField(value: String, ask: Int, onChange: (String) -> Unit) {
    val p = LocalPaper.current
    val focus = remember { FocusRequester() }
    // Just asked for: ready to type. Asked for again from the keyboard (Ctrl+K, [ask]): ready again, with what it holds.
    LaunchedEffect(ask) { if (value.isEmpty() || ask > 0) focus.requestFocus() }
    androidx.compose.foundation.text.BasicTextField(
        value, onChange, singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = p.text),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(p.text),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp).focusRequester(focus),
        decorationBox = { field ->
            Row(Modifier.clip(CircleShape).background(p.sunk).padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { if (value.isEmpty()) Text("Search", color = p.faint, style = MaterialTheme.typography.bodyLarge); field() }
                if (value.isNotEmpty()) Text("✕", color = p.muted, modifier = Modifier.clickable { onChange("") }.padding(start = 8.dp))
            }
        },
    )
}

/** A message the search found: whose chat, when, and the words around it (the matched ones bold). */
@Composable
private fun Hit(h: ChatHit, bots: List<Bot>, onClick: () -> Unit) {
    val p = LocalPaper.current
    // Whose chat: each bot named has its small mark before its name.
    val mark = { b: dev.botdot.app.data.BotRef? -> named(bots.firstOrNull { it.id == b?.id }, b?.name.orEmpty(), b?.color) }
    val chief = chiefNamed()
    val who = androidx.compose.ui.text.buildAnnotatedString {
        when {
            h.chatId != null -> { bot(chief); append(" · ${h.title.orEmpty()}") }
            h.fromBot != null -> { bot(mark(h.fromBot)); append(" → "); bot(mark(h.bot)) }
            else -> bot(mark(h.bot))
        }
    }
    val text = androidx.compose.ui.text.buildAnnotatedString {
        h.snippet.split('«').forEachIndexed { i, part ->
            if (i == 0) { append(part); return@forEachIndexed }
            val (hit, rest) = part.split('»', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
            withStyle(androidx.compose.ui.text.SpanStyle(color = p.text, fontWeight = FontWeight.SemiBold)) { append(hit) }
            append(rest)
        }
    }
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FigureText(who, color = p.text, style = MaterialTheme.typography.titleSmall, maxLines = 1, modifier = Modifier.weight(1f))
            Text(shortTime(h.at), color = p.faint, fontSize = 12.sp)
        }
        Text(text, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ConnectionDot(state: Feed.State) {
    // Nothing while all is well; only a word when botdot can't be reached.
    if (state != Feed.State.Retrying) return
    Text("Can't reach botdot", color = LocalPaper.current.warnText, fontSize = 12.sp, modifier = Modifier.padding(end = 4.dp))
}

/**
 * What a bot's row says of its open question (`asks` on the bot, docs/api.md): "Asks: <question>", in one line. null
 * when it asks nothing, the server says nothing of it, or it is working: the row then says what it does. [r]: its latest run.
 */
internal fun botAsks(b: Bot, r: Run?): String? =
    b.asks?.takeIf { !(b.running || r?.isRunning == true) }?.let { "Asks: ${plainText(it.text).replace('\n', ' ').take(120)}" }

/**
 * What a bot's row says under its name: what it's doing (its [line] as the server says it, "Working…" without
 * one: the words under its chat and the web page's), what it asks the owner ([botAsks]), or the last thing it said.
 * [r]: its latest run.
 */
internal fun botSub(b: Bot, r: Run?, line: String?): String = when {
    b.running || r?.isRunning == true -> OpeningLine.status(line, working = true)
    b.asks != null -> botAsks(b, r).orEmpty()
    b.jobs.any { it.waits } -> jobWaits(b.jobs.first { it.waits })
    r == null -> b.description
    r.status == "success" -> plainText(r.result.orEmpty()).replace('\n', ' ').take(120).ifBlank { b.description }
    r.status == "stopped" -> "Stopped"
    else -> "Couldn't finish"
}
