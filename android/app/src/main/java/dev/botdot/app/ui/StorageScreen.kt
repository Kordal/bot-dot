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
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
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
    // What it reads, the folder open, Check again, Delete and Clear are the shared StorageDesk's (one copy with the iPhone's).
    // The folder open is kept over a rotation or the process going, as it was before the desk: the desk starts there.
    var kept by rememberSaveable { mutableStateOf(listOf<String>()) }
    val desk = remember(api) { api?.let { dev.botdot.app.data.StorageDesk(scope, it, kept) } }
    val s = desk?.state?.collectAsState()?.value
    LaunchedEffect(s?.trail) { s?.trail?.let { if (s.answer != null) kept = it } }
    var menu by remember { mutableStateOf<String?>(null) }
    var ask by remember { mutableStateOf<String?>(null) } // the key of the row whose question shows
    LaunchedEffect(desk) { desk?.load() }
    LaunchedEffect(s?.noticeCount) { s?.notice?.takeIf { s.noticeCount > 0 }?.let { snack.showSnackbar(it) } }
    fun go(up: Boolean, into: String = "") { if (up) desk?.back() else desk?.open(into); menu = null; ask = null }
    BackHandler(enabled = s?.trail?.isNotEmpty() == true) { go(true) }

    // One folder or file: its icon, name, a bar against the largest beside it, its size and its menu. A folder that
    // holds more opens; one Files opens has the menu.
    @Composable
    fun Item(r: dev.botdot.app.data.StorageRow) {
        val key = r.key
        val w = r.where
        val hot = menu == key || ask == key
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (hot) p.fill else Color.Transparent)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable {
                if (r.opens) go(false, r.into) else if (w != null) { menu = if (menu == key) null else key; ask = null }
            }.padding(horizontal = Space.s4), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (r.dir) Icons.Outlined.Folder else Icons.Outlined.Description, contentDescription = null, tint = p.faint, modifier = Modifier.size(18.dp))
                Text(r.name, color = p.text, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = Space.s12).weight(1f))
                if (r.owner != null) Text(r.owner!!, color = p.faint, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = Space.s8).width(72.dp))
                Box(Modifier.padding(start = Space.s8).width(40.dp).height(6.dp).clip(RoundedCornerShape(8.dp)).background(p.sunk)) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(r.share).background(p.muted))
                }
                Text(Storage.size(r.bytes), color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, modifier = Modifier.padding(start = Space.s8).width(64.dp))
                if (w != null) Box {
                    IconButton(onClick = { menu = if (menu == key) null else key; ask = null }) { Icon(Icons.Filled.MoreHoriz, contentDescription = tr("More"), tint = p.muted) }
                    DropdownMenu(expanded = menu == key, onDismissRequest = { menu = null }) {
                        if (!w.place.gone) DropdownMenuItem(text = { Text(tr("Open in Files")) }, onClick = {
                            menu = null
                            onFiles(Storage.ownerOf(w.place), Storage.rootOf(w.place), desk!!.filesFolder(r))
                        })
                        DropdownMenuItem(text = { Text(tr("Ask the Chief")) }, onClick = {
                            menu = null
                            val whose = desk!!.whose(r) { id -> app.store.bots.value.value?.firstOrNull { it.id == id }?.name }
                            app.chiefWords = desk.askWords(r, whose)
                            onChief()
                        })
                        if (r.deletable) DropdownMenuItem(text = { Text(tr("Delete…"), color = p.err) }, onClick = { menu = null; ask = key })
                    }
                } else if (r.opens) Text("›", color = p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s12, end = Space.s12)) else Spacer(Modifier.width(48.dp))
            }
            if (ask == key && w != null && desk != null) Box(Modifier.padding(horizontal = Space.s12)) {
                val busy = s?.busy == true
                Ask(desk.deleteWords(r), if (busy) tr("Deleting…") else tr("Delete"), busy, onCancel = { ask = null }) {
                    scope.launch { if (desk.delete(r)) ask = null }
                }
            }
        }
        if (!hot) Rule()
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { BotSnackbarHost(snack) },
        topBar = {
            TopAppBar(
                navigationIcon = { BackButton { if (s?.trail.isNullOrEmpty()) onBack() else go(true) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(s?.title ?: tr("Storage"), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    if (s?.trail.isNullOrEmpty()) IconButton(enabled = s?.checking != true, onClick = { scope.launch { desk?.check() } }) {
                        Icon(Icons.Filled.Refresh, contentDescription = tr("Check again"), tint = if (s?.checking == true) p.faint else p.muted)
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = Space.s16, vertical = Space.s8)) {
            val d = s?.answer
            if (s == null || d == null) {
                Text(s?.error ?: tr("Loading…"), color = p.muted)
                return@Column
            }
            Text(s.total, color = p.text, fontSize = Type.s32, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(Space.s16))
            if (s.trail.isEmpty()) {
                Bar(d)
                Spacer(Modifier.height(Space.s24))
                s.groups.forEach { g ->
                    val key = "g:${g.id}"
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { go(false, g.id) }.padding(vertical = Space.s8), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(CircleShape).background(colorOf(g.id, p)))
                        Text(Storage.groupName(g.id), color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = Space.s12).weight(1f))
                        if (g.id == "caches") TextButton(enabled = !s.busy, onClick = { ask = key; menu = null }) { Text(tr("Clear"), color = p.text) }
                        Text(Storage.size(g.bytes), color = p.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = Space.s8))
                        Text("›", color = p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s12))
                    }
                    if (ask == key && desk != null) Ask(desk.clearWords(g), if (s.busy) tr("Clearing…") else tr("Clear"), s.busy, onCancel = { ask = null }) {
                        scope.launch { if (desk.clearCaches()) ask = null }
                    }
                    Rule()
                }
                if (s.largest.isNotEmpty()) {
                    Text(tr("Largest"), color = p.muted, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = Space.s32, bottom = Space.s8))
                    s.largest.forEach { Item(it) }
                }
            } else {
                if (s.rows.isEmpty()) Text(tr("Nothing here."), color = p.muted)
                s.rows.forEach { Item(it) }
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
