package dev.botdot.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import dev.botdot.app.BotDotApp
import sh.calvin.reorderable.ReorderableItem
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Dashboard
import dev.botdot.app.data.Tile
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * The Board (like the web page's): tiles the Chief put together, under their headings. A tap does the
 * tile's thing (switch, button, refresh), a list or note opens its bot's chat. Press, hold and drag to move a
 * tile (among others, under another heading, into or out of an open group); hold and let go to remove it. While it's on screen, the stale tiles are read again every little while.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun DashboardScreen(app: BotDotApp, onBot: (String) -> Unit, onNeeds: () -> Unit, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    // As the app keeps them (Store): shown at once; a tile's new value comes in by itself from the live feed.
    val store = app.store
    val dash by store.dashboard.value.collectAsState()
    val botsNow by store.bots.value.collectAsState()
    val bots = botsNow.orEmpty()
    var refreshing by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Tile?>(null) }
    val flash = remember { mutableStateMapOf<String, String>() } // "Asked Home Keeper" and the like, for a moment after a tap
    val open = remember { mutableStateMapOf<String, Boolean>() } // the groups you opened
    val popped = remember { mutableStateMapOf<String, Boolean>() } // a tap that just worked: the card pops once, no words
    var panel by remember { mutableStateOf<Pair<String, String?>?>(null) } // a tile's pop-up: its id, and the one block it shows (a colour swatch's wheel) or null for its whole panel
    val haptic = LocalHapticFeedback.current

    // quiet: just look. Otherwise (while it's on screen, every 15 s) botdot also reads its out-of-date tiles again.
    suspend fun load(quiet: Boolean = false) {
        if (quiet) return store.dashboard.refresh()
        val a = api ?: return
        runCatching { a.dashboard(quiet = false) }.onSuccess { store.dashboard.set(it) }.onError { tell(it.message ?: "Couldn't load") }
    }
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(api) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { while (true) { load(); delay(15_000) } } }
    fun replace(t: Tile) { store.dashboard.update { d -> d.copy(tiles = d.tiles.map { if (it.id == t.id) t else it }) } }
    fun blink(t: Tile, text: String) = scope.launch { flash[t.id] = text; delay(2500); if (flash[t.id] == text) flash.remove(t.id) } // a later word stays its own time
    fun pop(t: Tile) = scope.launch { popped[t.id] = true; delay(180); popped.remove(t.id) }
    // What a tap does comes with the tile (look.tap): its pop-up, switch it, run it, read it again, or its bot's chat.
    fun tap(t: Tile, waiting: Boolean) {
        val how = t.look?.tap ?: if (t.kind == "group") "group" else "none"
        if (how == "group") { if (open[t.id] == true) open.remove(t.id) else open[t.id] = true; return }
        if (waiting) return onNeeds()
        when (how) {
            "panel" -> { panel = t.id to null; return }
            "chat" -> { if (bots.any { it.id == t.bot }) onBot(t.bot!!); return }
            "none" -> return
        }
        val on = if (how == "toggle") t.look?.dot?.filled != true else null
        if (on != null) replace(t.copy(value = JsonPrimitive(on), look = t.look?.copy(dot = t.look.dot?.copy(filled = on)))) // at once; the read after it says whether it took
        val asked = bots.firstOrNull { it.id == t.bot }?.name
        if (t.asks) blink(t, tileAsked(asked, queued = false))
        scope.launch {
            runCatching { api!!.tapTile(t.id, on) }
                // Its bot was busy: the tile says so in place of "Asked …".
                .onSuccess { a -> a.tile?.let { replace(it) }; if (a.queued) blink(t, tileAsked(asked, queued = true)); if (how == "act" && !t.asks) pop(t) }
                .onError { tell(it.message ?: "That didn't work"); load(quiet = true) }
        }
    }
    // One of a tile's controls: a switch, button, slider, the colour wheel or a choice. While the wheel is still
    // being dragged (done: false) the page isn't updated, so the mark stays under your finger.
    fun controlsFor(t: Tile): TileControls {
        val b = bots.firstOrNull { it.id == t.bot }
        return TileControls(
            act = { key, value, done ->
                scope.launch {
                    runCatching { api!!.actTile(t.id, key, value) }
                        .onSuccess { a -> if (done) a.tile?.let { replace(it) }; if (a.queued) blink(t, tileAsked(b?.name, queued = true)) }
                        .onError { tell(it.message ?: "That didn't work"); load(quiet = true) }
                }
            },
            openColor = { key -> panel = t.id to key },
            openChat = b?.let { { panel = null; onBot(it.id) } },
            chatName = b?.name, chatColor = b?.color, chatOutfit = b?.outfit,
            imageUrl = { src -> api?.url(src) },
        )
    }

    // A tile's pop-up in the middle of the screen (the Board stays as it is): a note or list in full with a way
    // into its bot's chat, a light's on/off, brightness and colour wheel… It follows the tile's new values.
    panel?.let { (id, only) ->
        val t = dash?.tiles.orEmpty().firstOrNull { it.id == id } ?: return@let
        fun find(list: List<dev.botdot.app.data.Block>): dev.botdot.app.data.Block? { for (b in list) { if (b.key == only) return b; find(b.blocks)?.let { return it } }; return null }
        val list = if (only != null) listOfNotNull(find(t.look?.face.orEmpty())) else t.look?.panel.orEmpty()
        AlertDialog(
            onDismissRequest = { panel = null },
            title = { Text(t.title) },
            text = {
                Column {
                    Blocks(list, parseColor(tileColor(t, dash?.tiles.orEmpty(), bots), p.faint), "panel", controlsFor(t),
                        Modifier.heightIn(max = 520.dp).verticalScroll(androidx.compose.foundation.rememberScrollState()))
                    // How often it refreshes, and who changes it (#42); not under one block's own pop-up.
                    refreshLine(t)?.takeIf { only == null }?.let { Text(it, color = p.faint, fontSize = 12.5.sp, modifier = Modifier.padding(top = 14.dp)) }
                }
            },
            confirmButton = {},
        )
    }
    fun remove(t: Tile, withTiles: Boolean) = scope.launch { runCatching { api!!.removeTile(t.id, withTiles) }.onError { tell(it.message ?: "Couldn't remove") }; load(quiet = true) }
    // A group with tiles in it: only the group (its tiles stay, loose), or everything.
    val removingInside = removing?.let { t -> dash?.tiles.orEmpty().count { it.parent == t.id } } ?: 0
    if (removing != null && removingInside > 0) removing?.let { t ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("Remove “${t.title}”?") },
            text = {
                Column {
                    Text(if (removingInside == 1) "It holds one tile." else "It holds $removingInside tiles.")
                    TextButton(onClick = { removing = null; remove(t, false) }) { Text("Only the group", color = p.text) }
                    TextButton(onClick = { removing = null; remove(t, true) }) { Text("The group and its tiles", color = p.err) }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel", color = p.text) } },
        )
    } else removing?.let { t ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("Remove “${t.title}”?") },
            text = { Text("It goes off your Board.") },
            confirmButton = { TextButton(onClick = { removing = null; remove(t, false) }) { Text("Remove", color = p.err) } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel", color = p.text) } },
        )
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = { TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg), title = { Text(BoardWords.NAME, style = MaterialTheme.typography.titleMedium) }) },
    ) { pad ->
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, modifier = Modifier.padding(pad).fillMaxSize()) {
            val d = dash
            val waiting = d?.pending.orEmpty().map { it.id }.toSet()
            val tilesById = d?.tiles.orEmpty().associateBy { it.id }
            // The grid as a list of keys: "h:<heading>", tile ids, and around an open group's tiles "in:<group>" … "out:<group>".
            // While you drag, this is the order you see; letting go saves where the tile ended up.
            fun layoutOf(): List<String> {
                val all = d?.tiles.orEmpty()
                val loose = all.filter { it.parent == null }
                val out = mutableListOf<String>()
                for ((name, ts) in listOf("" to loose.filter { it.section.isEmpty() }) + d?.sections.orEmpty().map { s -> s to loose.filter { it.section == s } }) {
                    if (ts.isEmpty()) continue
                    if (name.isNotEmpty()) out += "h:$name"
                    for (t in ts) {
                        out += t.id
                        if (t.kind == "group" && open[t.id] == true) { out += "in:${t.id}"; out += all.filter { it.parent == t.id }.map { it.id }; out += "out:${t.id}" }
                    }
                }
                return out
            }
            val rows = remember { androidx.compose.runtime.mutableStateListOf<String>() }
            var dragged by remember { mutableStateOf<String?>(null) }
            var moved by remember { mutableStateOf(false) }
            var held by remember { mutableStateOf<String?>(null) } // a hold isn't a tap too: the release after it is ignored
            val fresh = layoutOf()
            if (dragged == null && rows.toList() != fresh) { rows.clear(); rows.addAll(fresh) }
            val gridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
            // Inside an open group: between its "in:" and "out:".
            fun groupAt(i: Int): String? {
                for (j in i - 1 downTo 0) { val k = rows[j]; if (k.startsWith("out:") || k.startsWith("h:")) return null; if (k.startsWith("in:")) return k.removePrefix("in:") }
                return null
            }
            val reorder = sh.calvin.reorderable.rememberReorderableLazyGridState(gridState) { from, to ->
                val a = rows.indexOf(from.key as? String ?: return@rememberReorderableLazyGridState)
                val b = rows.indexOf(to.key as? String ?: return@rememberReorderableLazyGridState)
                if (a < 0 || b < 0) return@rememberReorderableLazyGridState
                val item = rows[a]
                rows.add(b, rows.removeAt(a))
                if (tilesById[item]?.kind == "group" && groupAt(rows.indexOf(item)) != null) { rows.add(a, rows.removeAt(b)); return@rememberReorderableLazyGridState } // a group stays out of groups
                moved = true
                haptic.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
            }
            // Let go: its heading, group and place, from where it is in the list. Held without moving: remove it?
            fun dropped(t: Tile) {
                dragged = null
                scope.launch { delay(400); if (held == t.id) held = null } // no tap came after it
                if (!moved) { removing = t; return }
                moved = false
                val i = rows.indexOf(t.id)
                val parent = groupAt(i)
                val section = if (parent != null) null else (i - 1 downTo 0).map { rows[it] }.firstOrNull { it.startsWith("h:") }?.removePrefix("h:") ?: ""
                // The next tile in the same place (skipping an open group's tiles when it's loose).
                var before: String? = null
                var j = i + 1
                while (j < rows.size) {
                    val k = rows[j]
                    if (k.startsWith("h:") || (parent != null && k.startsWith("out:"))) break
                    if (parent == null && k.startsWith("in:")) { j = rows.indexOf("out:" + k.removePrefix("in:")) + 1; continue }
                    if (!k.contains(':')) { before = k; break }
                    j++
                }
                scope.launch {
                    runCatching { api!!.moveTile(t.id, section, parent, before) }.onError { tell(it.message ?: "Couldn't move it") }
                    load(quiet = true)
                }
            }
            LazyVerticalGrid(GridCells.Fixed(2), Modifier.fillMaxSize(), state = gridState, contentPadding = PaddingValues(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (d != null && d.tiles.isEmpty()) item(span = { GridItemSpan(2) }) { Empty() }
                val colorOf = { t: Tile -> tileColor(t, d?.tiles.orEmpty(), bots) }
                items(rows.toList(), key = { it }, span = { k -> GridItemSpan(if (k.contains(':') || tilesById[k]?.let { it.wide || it.size != "small" } == true) 2 else 1) }) { k ->
                    ReorderableItem(reorder, key = k) { lifted ->
                        when {
                            k.startsWith("h:") -> Text(k.removePrefix("h:"), color = p.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 2.dp, top = 10.dp))
                            k.startsWith("in:") -> {
                                // The top of an open group's tiles; "Nothing in it yet" while it's empty.
                                val empty = d?.tiles.orEmpty().none { it.parent == k.removePrefix("in:") }
                                if (empty) Text("Nothing in it yet.", color = p.faint, fontSize = 13.sp, modifier = Modifier.padding(start = 4.dp))
                                else Spacer(Modifier.size(1.dp))
                            }
                            k.startsWith("out:") -> Spacer(Modifier.fillMaxWidth().size(1.dp).background(p.line))
                            else -> tilesById[k]?.let { t ->
                                val inGroup = t.parent != null
                                val bump by animateFloatAsState(if (popped[t.id] == true) 1.05f else 1f, tween(180), label = "pop")
                                Box(Modifier.graphicsLayer { val s = if (lifted) 1.04f else bump; scaleX = s; scaleY = s }) {
                                    TileCard(t, colorOf(t), t.id in waiting, flash[t.id], controlsFor(t),
                                        Modifier.longPressDraggableHandle(
                                            onDragStarted = { dragged = t.id; held = t.id; moved = false; haptic.performHapticFeedback(HapticFeedbackType.LongPress) },
                                            onDragStopped = { dropped(t) },
                                        ).clickable { if (held == t.id) held = null else tap(t, t.id in waiting) },
                                        inside = d?.tiles.orEmpty().filter { it.parent == t.id }.map { it to colorOf(it) },
                                        open = inGroup || open[t.id] == true)
                                }
                            }
                        }
                    }
                }
                // What bots suggested: faded, who and why, Add or ✕.
                val suggested = d?.suggestions.orEmpty()
                if (suggested.isNotEmpty()) item(key = "s:suggested", span = { GridItemSpan(2) }) {
                    Text("Suggested", color = p.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 2.dp, top = 10.dp))
                }
                items(suggested, key = { "sug:${it.id}" }, span = { GridItemSpan(2) }) { x ->
                    val b = bots.firstOrNull { it.id == x.bot }
                    SuggestedCard(x, b) { add -> scope.launch { runCatching { api!!.answerSuggestion(x.id, add) }.onError { tell(it.message ?: "That didn't work") }; load(quiet = true) } }
                }
            }
        }
    }
}

/** What the Board is for and how to get something onto it, while nothing is on it. */
@Composable
private fun Empty() {
    val p = LocalPaper.current
    Column(Modifier.padding(horizontal = 4.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(BoardWords.WHAT_FOR, color = p.muted, style = MaterialTheme.typography.bodyLarge)
        Text(buildAnnotatedString {
            append(BoardWords.TELL)
            withStyle(SpanStyle(color = p.text)) { append(BoardWords.EXAMPLE) }
        }, color = p.muted, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun TileCard(t: Tile, color: String, waiting: Boolean, flash: String?, ctl: TileControls, click: Modifier, inside: List<Pair<Tile, String>> = emptyList(), open: Boolean = false) {
    val p = LocalPaper.current
    val c = parseColor(color, p.faint)
    val shape = RoundedCornerShape(18.dp)
    val look = t.look
    Column(
        Modifier.fillMaxWidth().heightIn(min = if (t.size == "big") 220.dp else 104.dp).alpha(if (waiting) 0.55f else 1f).clip(shape).background(if (open) p.sunk else p.panel).border(1.dp, if (open) p.line2 else p.line, shape)
            .then(click).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val dot = look?.dot
        when {
            // A group: one dot per tile inside (filled when on, in its own colour).
            t.kind == "group" -> {
                Title(t.title)
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (inside.isEmpty()) Text("·", color = p.faint)
                    inside.forEach { (x, hex) ->
                        val xd = x.look?.dot
                        val off = xd != null && xd.filled != true
                        val fill = if (off) Color.Transparent else tint(xd?.color, parseColor(hex, p.faint))
                        Box(Modifier.size(14.dp).clip(CircleShape).background(fill).then(if (off) Modifier.border(1.5.dp, p.faint, CircleShape) else Modifier))
                    }
                }
            }
            // A big dot (a switch, a light): the dot on top, the title under it with the whole width, two lines.
            dot?.big == true -> {
                TileDotView(dot.filled, tint(dot.color, c), true)
                Title(t.title, lines = 2)
            }
            else -> Row(verticalAlignment = Alignment.CenterVertically) {
                if (dot != null) { TileDotView(dot.filled, tint(dot.color, c), false); Spacer(Modifier.size(8.dp)) }
                Title(t.title)
            }
        }
        if (t.kind != "group" && look != null) Blocks(look.face, c, "face", ctl)
        val note = if (waiting) "Waiting for your OK" else flash ?: if (t.error != null) "Couldn't update" else null
        if (note != null) Text(note, color = p.muted, fontSize = 12.sp)
    }
}

/** A tile a bot suggested, as a faded card: its title, why, its script if it has one, and Add or ✕. */
@Composable
fun SuggestedCard(x: dev.botdot.app.data.TileSuggestion, bot: Bot?, onAnswer: (Boolean) -> Unit) {
    val p = LocalPaper.current
    val shape = RoundedCornerShape(18.dp)
    var script by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(shape).border(1.dp, p.line2, shape).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.alpha(0.75f)) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(parseColor(bot?.color ?: CHIEF_COLOR, p.faint)))
            Spacer(Modifier.size(8.dp))
            Title(x.tile.title)
        }
        Text(buildAnnotatedString {
            if (bot != null) { withStyle(SpanStyle(color = p.text, fontWeight = FontWeight.SemiBold)) { append(bot.name) }; append(" · ") }
            append(x.reason)
        }, color = p.muted, fontSize = 13.sp)
        if (x.tile.scripts.isNotEmpty()) {
            Text(if (script) "Hide its script" else "Its script", color = p.muted, fontSize = 12.5.sp, modifier = Modifier.clip(RoundedCornerShape(6.dp)).combinedClickable(onClick = { script = !script }).padding(vertical = 2.dp))
            if (script) x.tile.scripts.forEach { Text(it, color = p.text, fontSize = 12.sp, fontFamily = GeistMono, modifier = Modifier.fillMaxWidth().background(p.sunk, RoundedCornerShape(8.dp)).padding(8.dp)) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.weight(1f))
            androidx.compose.material3.OutlinedButton(onClick = { onAnswer(false) }) { Text("✕", color = p.text) }
            Spacer(Modifier.size(8.dp))
            androidx.compose.material3.Button(onClick = { onAnswer(true) }, colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Add") }
        }
    }
}

@Composable
private fun Title(text: String, lines: Int = 1) =
    Text(text, color = LocalPaper.current.text, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, maxLines = lines, overflow = TextOverflow.Ellipsis)

/** A tile's dot colour: its own, else its bot's. A group has no bot: it takes the one whose tiles are in it (the Chief's when they're mixed). */
internal fun tileColor(t: Tile, tiles: List<Tile>, bots: List<Bot>): String {
    val owner = t.bot ?: tiles.filter { it.parent == t.id }.mapNotNull { it.bot }.toSet().singleOrNull().takeIf { t.kind == "group" }
    return t.color ?: bots.firstOrNull { it.id == owner }?.color ?: CHIEF_COLOR
}
