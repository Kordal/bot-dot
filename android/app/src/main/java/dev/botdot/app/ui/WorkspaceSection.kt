package dev.botdot.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Api
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.BotFiles
import dev.botdot.app.data.WorkspaceEntry
import dev.botdot.app.data.WorkspaceFiles
import dev.botdot.app.data.WorkspaceListing
import kotlinx.coroutines.launch

/** What a workspace dialog asks: a new folder's name, a new name, a folder to move to, or a yes to a delete. */
private data class WorkspaceAsk(val kind: String, val entry: WorkspaceEntry? = null, val words: String = "")

/**
 * A bot's workspace in its settings (#296), next to its Files: every file in its folder on botdot, to open in the
 * viewer, save, upload into, rename, move and delete, and, for a bot that uses the computer, its folder there, to
 * open, save and delete in while the computer runs; a computer that is off is started only by the owner's tap.
 * Only from a server with `workspace-files` ([WorkspaceFiles]).
 */
@Composable
fun WorkspaceSection(api: Api?, botId: String, botName: String, usesComputer: Boolean, viewer: Boolean, tell: (String) -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var root by remember { mutableStateOf(WorkspaceFiles.SERVER) }
    var path by remember { mutableStateOf("") }
    var listing by remember { mutableStateOf<WorkspaceListing?>(null) }
    var failed by remember { mutableStateOf<Throwable?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    var byDate by remember { mutableStateOf(false) }
    var hidden by remember { mutableStateOf(false) }
    var ask by remember { mutableStateOf<WorkspaceAsk?>(null) }
    var answer by remember { mutableStateOf("") }

    fun go(r: String, to: String) { root = r; path = to }
    fun act(what: String, block: suspend (Api) -> Unit) {
        val a = api ?: return tell("Not connected to botdot")
        scope.launch { runCatching { block(a) }.onError { tell(it.message ?: "Couldn't $what") }; tries++ }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        if (uris.size > WorkspaceFiles.MAX_FILES) tell("Upload at most ${WorkspaceFiles.MAX_FILES} files at a time.")
        val into = path
        act("upload") { a ->
            for (uri in uris.take(WorkspaceFiles.MAX_FILES)) {
                runCatching { a.uploadToWorkspace(context.contentResolver, uri, botId, into) }.onError { tell(it.message ?: "Couldn't upload") }
            }
        }
    }
    fun open(e: WorkspaceEntry) {
        val src = WorkspaceFiles.file(botId, root, e.path)
        if (viewer) DocViewer.open = DocViewer.Request(src, e.name, botName, botId = if (root == WorkspaceFiles.COMPUTER) botId else null)
        else act("open it") { BotFiles.openElsewhere(context, it, src, e.name) }
    }

    FoldSection("Workspace", "Every file in its folder: what it keeps, makes and clones") {
        LaunchedEffect(api, root, path, tries) {
            val a = api ?: return@LaunchedEffect
            listing = null; failed = null
            runCatching { a.workspace(botId, root, path) }.onSuccess { listing = it }.onError { failed = it }
        }
        if (usesComputer) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((r, label) in listOf(WorkspaceFiles.SERVER to "On botdot", WorkspaceFiles.COMPUTER to "On the computer")) {
                if (root == r) Button(onClick = {}, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(label) }
                else OutlinedButton(onClick = { go(r, "") }) { Text(label, color = p.text) }
            }
        }
        // The breadcrumb: a tap on a folder on the way goes back to it.
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
            val crumbs = WorkspaceFiles.crumbs(path, if (root == WorkspaceFiles.COMPUTER) "/workspace/$botId" else "Its folder")
            crumbs.forEachIndexed { i, (name, to) ->
                if (i == crumbs.lastIndex) Text(name, color = p.text, style = MaterialTheme.typography.bodyMedium)
                else {
                    Text(name, color = p.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.clickable { path = to }.padding(vertical = 6.dp))
                    Text(" / ", color = p.faint)
                }
            }
        }
        val e = failed
        val l = listing
        when {
            e != null && (e as? ApiException)?.status == 409 -> {
                Hint("The computer is off. botdot doesn't start it just to show its files.")
                OutlinedButton(onClick = { act("start it") { it.startComputer(botId) } }) { Text("Start the computer", color = p.text) }
            }
            e != null && (e as? ApiException)?.status == 404 -> {
                Hint("This folder is gone.")
                OutlinedButton(onClick = { path = "" }) { Text("Back to the top", color = p.text) }
            }
            e != null -> Hint(e.message ?: "Couldn't load it.")
            l == null -> Hint("Loading…")
            else -> {
                val writes = root == WorkspaceFiles.SERVER && !l.readOnly
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { byDate = !byDate }) { Text(if (byDate) "Sorted by date" else "Sorted by name", color = p.muted) }
                    val hid = WorkspaceFiles.hiddenCount(l.entries)
                    if (hid > 0) TextButton(onClick = { hidden = !hidden }) { Text(if (hidden) "Hide hidden ($hid)" else "Show hidden ($hid)", color = p.muted) }
                    if (writes) {
                        TextButton(onClick = { answer = ""; ask = WorkspaceAsk("folder") }) { Text("New folder", color = p.text) }
                        TextButton(onClick = { pick.launch("*/*") }) { Text("Upload", color = p.text) }
                    }
                }
                if (l.readOnly) Hint("botdot keeps this folder as it is: it is part of how the bot works. Open or save what is in it.")
                val shown = WorkspaceFiles.sorted(l.entries, byDate, hidden)
                if (shown.isEmpty()) Hint(if (l.entries.isEmpty()) "Empty." else "Only hidden files here.")
                shown.forEach { entry ->
                    key(entry.path) {
                        EntryRow(entry, WorkspaceFiles.detail(entry, shortTime(entry.at)),
                            onOpen = { when (entry.type) { "folder" -> { path = entry.path }; "file" -> open(entry) } },
                            onSave = if (entry.type == "file") ({ act("save it") { BotFiles.saveToDownloads(context, it, WorkspaceFiles.file(botId, root, entry.path), entry.name); tell("Saving ${entry.name} to Downloads") } }) else null,
                            onRename = if (WorkspaceFiles.changes(root, l, entry)) ({ answer = entry.name; ask = WorkspaceAsk("rename", entry) }) else null,
                            onMove = if (WorkspaceFiles.changes(root, l, entry)) ({ answer = WorkspaceFiles.parentOf(entry.path); ask = WorkspaceAsk("move", entry) }) else null,
                            onDelete = if (WorkspaceFiles.deletes(root, l, entry)) ({
                                val r = root
                                scope.launch {
                                    runCatching { (api ?: error("Not connected to botdot")).workspaceCount(botId, r, entry.path) }
                                        .onSuccess { ask = WorkspaceAsk("delete", entry, WorkspaceFiles.deleteWords(entry.name, it)) }
                                        .onError { tell(it.message ?: "Couldn't delete") }
                                }
                            }) else null,
                            kept = root == WorkspaceFiles.SERVER && entry.kept,
                        )
                    }
                }
                if (l.more > 0) Hint("…and ${String.format(java.util.Locale.ROOT, "%,d", l.more)} more, not listed.")
            }
        }
    }

    ask?.let { a ->
        val entry = a.entry
        val r = root
        AlertDialog(
            onDismissRequest = { ask = null },
            title = {
                Text(when (a.kind) { "folder" -> "New folder"; "rename" -> "Rename ${entry?.name}"; "move" -> "Move ${entry?.name}"; else -> "Delete?" })
            },
            text = {
                if (a.kind == "delete") Text(a.words, color = p.text)
                else Column {
                    if (a.kind == "move") Text("To which folder? A path in its folder, such as notes/old. Empty for the top.", color = p.muted, modifier = Modifier.padding(bottom = 8.dp))
                    OutlinedTextField(answer, { answer = it.take(255) }, singleLine = true, label = { Text(if (a.kind == "move") "Folder" else "Name") }, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton(enabled = a.kind == "delete" || a.kind == "move" || answer.isNotBlank(), onClick = {
                    ask = null
                    when (a.kind) {
                        "folder" -> act("make it") { it.makeWorkspaceFolder(botId, path, answer.trim()) }
                        "rename" -> if (!WorkspaceFiles.nameOk(answer)) tell("A name can't have / in it. To put it in another folder, use Move.") else entry?.let { en -> WorkspaceFiles.renamed(en.path, answer).takeIf { it != en.path }?.let { to -> act("rename it") { it.moveInWorkspace(botId, en.path, to) } } }
                        "move" -> entry?.let { en -> WorkspaceFiles.movedTo(en.path, answer).takeIf { it != en.path }?.let { to -> act("move it") { it.moveInWorkspace(botId, en.path, to) } } }
                        else -> entry?.let { en -> act("delete it") { it.deleteFromWorkspace(botId, r, en.path); tell("Deleted ${en.name}") } }
                    }
                }) { Text(when (a.kind) { "folder" -> "Make"; "rename" -> "Rename"; "move" -> "Move"; else -> "Delete" }, color = if (a.kind == "delete") p.err else p.text) }
            },
            dismissButton = { TextButton(onClick = { ask = null }) { Text("Cancel", color = p.text) } },
        )
    }
}

/** One entry: its name (a tap opens it), its size and time, and its ⋯ menu. */
@Composable
private fun EntryRow(e: WorkspaceEntry, detail: String, onOpen: () -> Unit, onSave: (() -> Unit)?, onRename: (() -> Unit)?, onMove: (() -> Unit)?, onDelete: (() -> Unit)?, kept: Boolean) {
    val p = LocalPaper.current
    var menu by remember { mutableStateOf(false) }
    val icon = when (e.type) { "folder" -> "📁"; "link" -> "🔗"; else -> "📄" }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).clickable(enabled = e.type != "link", onClick = onOpen).padding(vertical = 6.dp)) {
            Text("$icon ${e.name}", color = p.text, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val sub = listOfNotNull(detail.ifBlank { null }, if (kept) "Kept by botdot" else null).joinToString(" · ")
            if (sub.isNotEmpty()) Text(sub, color = p.muted, style = MaterialTheme.typography.bodySmall)
        }
        if (onSave != null || onRename != null || onMove != null || onDelete != null) Box {
            TextButton(onClick = { menu = true }) { Text("⋯", color = p.muted) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = p.panel) {
                onSave?.let { f -> DropdownMenuItem(text = { Text("Save to Downloads", color = p.text) }, onClick = { menu = false; f() }) }
                onRename?.let { f -> DropdownMenuItem(text = { Text("Rename", color = p.text) }, onClick = { menu = false; f() }) }
                onMove?.let { f -> DropdownMenuItem(text = { Text("Move", color = p.text) }, onClick = { menu = false; f() }) }
                onDelete?.let { f -> DropdownMenuItem(text = { Text("Delete", color = p.err) }, onClick = { menu = false; f() }) }
            }
        }
    }
}
