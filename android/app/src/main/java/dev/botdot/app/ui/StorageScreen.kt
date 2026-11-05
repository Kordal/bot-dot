package dev.botdot.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Storage
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Settings → Storage (docs/api.md, Storage; web: public/storage.js): the total, a bar of the groups and a row each, then
 * the largest files. A group or a folder opens to what it holds, largest first, and Back goes up. A row Files opens has a
 * menu: Open in Files, Ask the Chief and Delete, which asks on its own row first. The caches clear from their row after
 * the same question.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StorageScreen(app: BotDotApp, onFiles: (owner: String, root: String, path: String) -> Unit, onChief: () -> Unit, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    var data by remember { mutableStateOf<Storage.Answer?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var trail by rememberSaveable { mutableStateOf(listOf<String>()) }
    var menu by remember { mutableStateOf<String?>(null) }
    var ask by remember { mutableStateOf<String?>(null) } // the key of the row whose question shows
    var busy by remember { mutableStateOf(false) }
    var polls by remember { mutableStateOf(0) }

    suspend fun load() {
        val a = api ?: return
        runCatching { a.storage() }.onSuccess { data = it; error = null }.onFailure { error = it.message }
    }
    LaunchedEffect(api, polls) {
        load()
        // While a check runs, look again every few seconds.
        while (data?.checking == true) { delay(3000); load() }
    }
    fun go(next: List<String>) { trail = next; menu = null; ask = null }
    BackHandler(enabled = trail.isNotEmpty()) { go(trail.dropLast(1)) }

    val d = data
    val opened = d?.let { Storage.open(it, trail) }
    if (d != null && trail.isNotEmpty() && opened == null) trail = emptyList()

    // One folder or file: its icon, name, a bar against the largest beside it, its size and its menu. A folder that
    // holds more opens; one Files opens has the menu.
    @Composable
    fun Item(key: String, name: String, owner: String?, bytes: Long, dir: Boolean, files: Long, opens: Boolean, w: Storage.Where?, top: Long, into: String = name) {
        val hot = menu == key || ask == key
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (hot) p.fill else Color.Transparent)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable {
                if (opens) go(trail + into) else if (w != null) { menu = if (menu == key) null else key; ask = null }
            }.padding(horizontal = Space.s4), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (dir) Icons.Outlined.Folder else Icons.Outlined.Description, contentDescription = null, tint = p.faint, modifier = Modifier.size(18.dp))
                Text(name, color = p.text, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = Space.s12).weight(1f))
                if (owner != null) Text(owner, color = p.faint, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = Space.s8).width(72.dp))
                Box(Modifier.padding(start = Space.s8).width(40.dp).height(6.dp).clip(RoundedCornerShape(8.dp)).background(p.sunk)) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth((bytes.toFloat() / top).coerceIn(0.05f, 1f)).background(p.muted))
                }
                Text(Storage.size(bytes), color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, modifier = Modifier.padding(start = Space.s8).width(64.dp))
                if (w != null) Box {
                    IconButton(onClick = { menu = if (menu == key) null else key; ask = null }) { Icon(Icons.Filled.MoreHoriz, contentDescription = tr("More"), tint = p.muted) }
                    DropdownMenu(expanded = menu == key, onDismissRequest = { menu = null }) {
                        if (!w.place.gone) DropdownMenuItem(text = { Text(tr("Open in Files")) }, onClick = {
                            menu = null
                            val folder = if (dir) w.path else w.path.substringBeforeLast('/', "")
                            onFiles(Storage.ownerOf(w.place), Storage.rootOf(w.place), folder)
                        })
                        DropdownMenuItem(text = { Text(tr("Ask the Chief")) }, onClick = {
                            menu = null
                            val whose = w.place.project ?: if (w.place.bot == dev.botdot.app.data.UploadedFiles.CHIEF) tr("Chief of Staff") else app.store.bots.value.value?.firstOrNull { it.id == w.place.bot }?.name.orEmpty()
                            app.chiefWords = tr("What is {name} ({size}) in {whose}’s files, and can it go?", "name" to w.path, "size" to Storage.size(bytes), "whose" to whose)
                            onChief()
                        })
                        if (Storage.deletable(w)) DropdownMenuItem(text = { Text(tr("Delete…"), color = p.err) }, onClick = { menu = null; ask = key })
                    }
                } else if (opens) Text("›", color = p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s12, end = Space.s12)) else Spacer(Modifier.width(48.dp))
            }
            if (ask == key && w != null) Box(Modifier.padding(horizontal = Space.s12)) {
                val words = if (dir) tr("Delete {name}? {size}, {count}.", "name" to name, "size" to Storage.size(bytes), "count" to trn(files.toInt(), "{n} file", "{n} files"))
                    else tr("Delete {name}? {size}.", "name" to name, "size" to Storage.size(bytes))
                Ask(words, if (busy) tr("Deleting…") else tr("Delete"), busy, onCancel = { ask = null }) {
                    busy = true
                    scope.launch {
                        runCatching { if (w.place.gone) api!!.deleteGone(w) else api!!.deleteFromWorkspace(Storage.ownerOf(w.place), Storage.rootOf(w.place), w.path) }
                            .onSuccess { ask = null; tell(tr("Deleted")); load() }.onFailure { tell(it.message ?: tr("Couldn't delete")) }
                        busy = false
                    }
                }
            }
        }
        if (!hot) Rule()
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(
                navigationIcon = { BackButton { if (trail.isEmpty()) onBack() else go(trail.dropLast(1)) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(opened?.crumbs?.lastOrNull() ?: tr("Storage"), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    if (trail.isEmpty()) IconButton(enabled = d?.checking != true, onClick = {
                        scope.launch { runCatching { api!!.checkStorage() }.onSuccess { data = it }.onFailure { tell(it.message ?: tr("Couldn't check")) }; polls++ }
                    }) { Icon(Icons.Filled.Refresh, contentDescription = tr("Check again"), tint = if (d?.checking == true) p.faint else p.muted) }
                },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = Space.s16, vertical = Space.s8)) {
            if (d == null) {
                Text(error ?: tr("Loading…"), color = p.muted)
                return@Column
            }
            Text(if (d.checkedAt == null) "—" else Storage.size(opened?.node?.bytes ?: d.total), color = p.text, fontSize = Type.s32, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(Space.s16))
            if (opened == null) {
                Bar(d)
                Spacer(Modifier.height(Space.s24))
                d.groups.filter { it.bytes > 0 }.forEach { g ->
                    val key = "g:${g.id}"
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { go(listOf(g.id)) }.padding(vertical = Space.s8), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(CircleShape).background(colorOf(g.id, p)))
                        Text(Storage.groupName(g.id), color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = Space.s12).weight(1f))
                        if (g.id == "caches") TextButton(enabled = !busy, onClick = { ask = key; menu = null }) { Text(tr("Clear"), color = p.text) }
                        Text(Storage.size(g.bytes), color = p.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = Space.s8))
                        Text("›", color = p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s12))
                    }
                    if (ask == key) Ask(tr("Clear the caches? {size}.", "size" to Storage.size(g.bytes)), if (busy) tr("Clearing…") else tr("Clear"), busy, onCancel = { ask = null }) {
                        busy = true
                        scope.launch {
                            runCatching { api!!.clearCaches() }.onSuccess { data = it; ask = null; tell(tr("Cleared {size}", "size" to Storage.size(it.freed))) }.onFailure { tell(it.message ?: tr("Couldn't clear")) }
                            busy = false
                        }
                    }
                    Rule()
                }
                if (d.largest.isNotEmpty()) {
                    Text(tr("Largest"), color = p.muted, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = Space.s32, bottom = Space.s8))
                    val top = d.largest.first().bytes.coerceAtLeast(1)
                    d.largest.take(10).forEachIndexed { i, f ->
                        val w = f.place?.let { Storage.Where(it, f.path) }
                        Item("l:$i", f.name, f.owner, f.bytes, false, 0, false, w, top)
                    }
                }
            } else {
                val kids = opened.node.kids.filter { it.bytes > 0 }
                if (kids.isEmpty()) Text(tr("Nothing here."), color = p.muted)
                val top = kids.firstOrNull()?.bytes?.coerceAtLeast(1) ?: 1
                kids.forEachIndexed { i, k -> Item("k:$i", Storage.nameOf(k), null, k.bytes, k.dir, k.files, k.kids.isNotEmpty(), Storage.where(k, opened), top, into = k.name) }
            }
        }
    }
}

/** The groups' bar: each group's share of the total, in its colour. */
@Composable
private fun Bar(d: Storage.Answer) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().height(24.dp).clip(RoundedCornerShape(8.dp)).background(p.sunk), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
        Storage.bar(d).forEach { (id, share) -> Box(Modifier.weight(share.coerceAtLeast(0.004f)).fillMaxHeight().background(colorOf(id, p))) }
    }
}

internal fun colorOf(id: String, p: Paper): Color = when (id) {
    "computer" -> p.mention; "bots" -> p.ok; "projects" -> p.warn; "uploads" -> p.dot
    "chats" -> Color(0xFF9B7BE0); "caches" -> Color(0xFF8A8A8A); else -> Color(0xFF4A4A4A)
}

/** The question on a row, before a delete or a clear. */
@Composable
private fun Ask(words: String, yes: String, busy: Boolean, onCancel: () -> Unit, onYes: () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().padding(vertical = Space.s12)) {
        Text(words, color = p.text, style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.fillMaxWidth().padding(top = Space.s8), horizontalArrangement = Arrangement.End) {
            TextButton(enabled = !busy, onClick = onCancel) { Text(tr("Cancel"), color = p.text) }
            Spacer(Modifier.width(Space.s8))
            Button(enabled = !busy, onClick = onYes, colors = ButtonDefaults.buttonColors(containerColor = p.err, contentColor = p.inkText)) { Text(yes) }
        }
    }
}
