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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
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
import dev.botdot.app.data.Bot
import dev.botdot.app.data.BotFiles
import dev.botdot.app.data.Project
import dev.botdot.app.data.Projects
import dev.botdot.app.data.PickedFolder
import dev.botdot.app.data.WorkspaceEntry
import dev.botdot.app.data.WorkspaceFiles
import dev.botdot.app.data.WorkspaceListing
import dev.botdot.app.data.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What a workspace dialog asks: a new folder's or project's name, a new name, a folder to move to, a project's bots, or a yes to a delete. */
private data class WorkspaceAsk(val kind: String, val entry: WorkspaceEntry? = null, val words: String = "")

/**
 * A bot's workspace in its settings (#296), next to its Files: every file in its folder on botdot, to open in the
 * viewer, save, upload into (a file, or with [folders] a whole folder, #576), rename, move and delete, and, for a bot
 * that uses the computer, its folder there, the same with [folders] (else only open, save and delete) while the
 * computer runs; a computer that is off is started only by the owner's tap. Only from a server with
 * `workspace-files` ([WorkspaceFiles]); [folders] from one with `workspace-folders`; [projects] from one with
 * `projects` (#578): each shared project the bot is in is a root of its own, with its bots.
 */
@Composable
fun WorkspaceSection(api: Api?, botId: String, botName: String, usesComputer: Boolean, viewer: Boolean, tell: (String) -> Unit, folders: Boolean = false, projects: Boolean = false) {
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
    var busy by remember { mutableStateOf<String?>(null) }
    val withProjects = projects && usesComputer
    var allProjects by remember { mutableStateOf<List<Project>>(emptyList()) }
    var allBots by remember { mutableStateOf<List<Bot>>(emptyList()) }
    var picked by remember { mutableStateOf<Set<String>>(emptySet()) }
    val project = WorkspaceFiles.projectOf(root)?.let { n -> allProjects.firstOrNull { it.name == n } }

    fun go(r: String, to: String) { root = r; path = to }
    fun act(what: String, block: suspend (Api) -> Unit) {
        val a = api ?: return tell(tr("Not connected to botdot"))
        scope.launch { runCatching { block(a) }.onError { tell(it.message ?: tr("Couldn't {what}", "what" to what)) }; tries++ }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        if (uris.size > WorkspaceFiles.MAX_FILES) tell(tr("Upload at most {n} files at a time.", "n" to WorkspaceFiles.MAX_FILES))
        val into = path
        val r = root
        act("upload") { a ->
            for (uri in uris.take(WorkspaceFiles.MAX_FILES)) {
                runCatching { a.uploadToWorkspace(context.contentResolver, uri, botId, into, r) }.onError { tell(it.message ?: tr("Couldn't upload")) }
            }
        }
    }
    // A whole folder (#576): its top made first under a free name, then its files one by one, their folders made as they come.
    val pickFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
        if (tree == null) return@rememberLauncherForActivityResult
        val into = path
        val r = root
        act(tr("upload the folder")) { a ->
            val picked = withContext(Dispatchers.IO) { PickedFolder.read(context.contentResolver, tree) }
            if (picked.tooMany) return@act tell(tr("{name} has more than {n} files: upload at most that many at a time.", "name" to picked.name, "n" to String.format(java.util.Locale.ROOT, "%,d", WorkspaceFiles.MAX_FOLDER_FILES)))
            val top = a.makeWorkspaceFolder(botId, into, picked.name, r, free = true)
            var failed = 0
            try {
                picked.files.forEachIndexed { i, f ->
                    busy = tr("Uploading {name}: {i} of {n}", "name" to picked.name, "i" to i + 1, "n" to picked.files.size)
                    if ((f.size ?: 0) > WorkspaceFiles.MAX_BYTES) failed++
                    else runCatching { a.uploadToWorkspace(context.contentResolver, f.uri, botId, WorkspaceFiles.folderDir(top, f.dir), r, made = true) }.onError { failed++ }
                }
            } finally { busy = null }
            tell(if (failed > 0) tr("{name}: {failed} of {n} files didn't upload.", "name" to picked.name, "failed" to failed, "n" to picked.files.size) else tr("Uploaded {name}", "name" to picked.name))
        }
    }
    fun open(e: WorkspaceEntry) {
        val src = WorkspaceFiles.file(botId, root, e.path)
        if (viewer) DocViewer.open = DocViewer.Request(src, e.name, botName, botId = if (root != WorkspaceFiles.SERVER) botId else null)
        else act(tr("open it")) { BotFiles.openElsewhere(context, it, src, e.name) }
    }

    FoldSection(tr("Workspace")) {
        LaunchedEffect(api, root, path, tries) {
            val a = api ?: return@LaunchedEffect
            listing = null; failed = null
            runCatching { a.workspace(botId, root, path) }.onSuccess { listing = it }.onError { failed = it }
        }
        if (withProjects) LaunchedEffect(api, tries) {
            val a = api ?: return@LaunchedEffect
            runCatching { a.projects() }.onSuccess { allProjects = it }
            runCatching { a.bots() }.onSuccess { allBots = it }
        }
        if (usesComputer) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            val roots = listOf(WorkspaceFiles.SERVER to tr("On botdot"), WorkspaceFiles.COMPUTER to tr("On the computer")) +
                (if (withProjects) Projects.of(botId, allProjects).map { WorkspaceFiles.projectRoot(it.name) to it.name } else emptyList())
            for ((r, label) in roots) {
                if (root == r) Button(onClick = {}, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(label) }
                else OutlinedButton(onClick = { go(r, "") }) { Text(label, color = p.text) }
            }
            if (withProjects) TextButton(onClick = { answer = ""; ask = WorkspaceAsk("project") }) { Text("+ " + tr("Project"), color = p.text) }
        }
        // A shared project's bots (#578), to change, and its delete.
        if (project != null) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
            Text(Projects.members(project, allBots), color = p.muted, style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = { picked = project.bots.toSet(); ask = WorkspaceAsk("members") }) { Text(tr("Bots"), color = p.text) }
            TextButton(onClick = {
                val r = root
                scope.launch {
                    runCatching { (api ?: error(tr("Not connected to botdot"))).workspaceCount(botId, r, "") }
                        .onSuccess { ask = WorkspaceAsk("delete-project", null, WorkspaceFiles.deleteWords(project.name, it, project = true)) }
                        .onError { tell(it.message ?: tr("Couldn't delete")) }
                }
            }) { Text(tr("Delete project"), color = p.err) }
        }
        // The breadcrumb: a tap on a folder on the way goes back to it.
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
            val crumbs = WorkspaceFiles.crumbs(path, when { root == WorkspaceFiles.COMPUTER -> "/workspace/$botId"; project != null -> project.folder; else -> tr("Its folder") })
            crumbs.forEachIndexed { i, (name, to) ->
                if (i == crumbs.lastIndex) Text(name, color = p.text, style = MaterialTheme.typography.bodyMedium)
                else {
                    Text(name, color = p.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.clickable { path = to }.padding(vertical = Space.s8))
                    Text(" / ", color = p.faint)
                }
            }
        }
        val e = failed
        val l = listing
        when {
            e != null && (e as? ApiException)?.status == 409 -> {
                Hint(tr("The computer is off. botdot doesn't start it just to show its files."))
                OutlinedButton(onClick = { act(tr("start it")) { it.startComputer(botId) } }) { Text(tr("Start the computer"), color = p.text) }
            }
            e != null && (e as? ApiException)?.status == 404 -> {
                Hint(tr("This folder is gone."))
                OutlinedButton(onClick = { path = "" }) { Text(tr("Back to the top"), color = p.text) }
            }
            e != null -> Hint(e.message ?: tr("Couldn't load it."))
            l == null -> Hint(tr("Loading…"))
            else -> {
                val writes = WorkspaceFiles.writes(root, l, folders)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Space.s4), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { byDate = !byDate }) { Text(if (byDate) tr("Sorted by date") else tr("Sorted by name"), color = p.muted) }
                    val hid = WorkspaceFiles.hiddenCount(l.entries)
                    if (hid > 0) TextButton(onClick = { hidden = !hidden }) { Text(if (hidden) tr("Hide hidden ({n})", "n" to hid) else tr("Show hidden ({n})", "n" to hid), color = p.muted) }
                    val b = busy
                    if (b != null) Text(b, color = p.muted, style = MaterialTheme.typography.bodySmall)
                    else if (writes) {
                        TextButton(onClick = { answer = ""; ask = WorkspaceAsk("folder") }) { Text(tr("New folder"), color = p.text) }
                        TextButton(onClick = { pick.launch("*/*") }) { Text(tr("Upload"), color = p.text) }
                        if (folders) TextButton(onClick = { pickFolder.launch(null) }) { Text(tr("Upload folder"), color = p.text) }
                    }
                }
                if (l.readOnly) Hint(tr("botdot keeps this folder as it is: it is part of how the bot works. Open or save what is in it."))
                val shown = WorkspaceFiles.sorted(l.entries, byDate, hidden)
                if (shown.isEmpty()) Hint(if (l.entries.isEmpty()) tr("Empty.") else tr("Only hidden files here."))
                shown.forEach { entry ->
                    key(entry.path) {
                        EntryRow(entry, WorkspaceFiles.detail(entry, shortTime(entry.at)),
                            onOpen = { when (entry.type) { "folder" -> { path = entry.path }; "file" -> open(entry) } },
                            onSave = if (entry.type == "file") ({ act(tr("save it")) { BotFiles.saveToDownloads(context, it, WorkspaceFiles.file(botId, root, entry.path), entry.name); tell(tr("Saving {name} to Downloads", "name" to entry.name)) } }) else null,
                            onRename = if (WorkspaceFiles.changes(root, l, entry, folders)) ({ answer = entry.name; ask = WorkspaceAsk("rename", entry) }) else null,
                            onMove = if (WorkspaceFiles.changes(root, l, entry, folders)) ({ answer = WorkspaceFiles.parentOf(entry.path); ask = WorkspaceAsk("move", entry) }) else null,
                            onDelete = if (WorkspaceFiles.deletes(root, l, entry)) ({
                                val r = root
                                scope.launch {
                                    runCatching { (api ?: error(tr("Not connected to botdot"))).workspaceCount(botId, r, entry.path) }
                                        .onSuccess { ask = WorkspaceAsk("delete", entry, WorkspaceFiles.deleteWords(entry.name, it)) }
                                        .onError { tell(it.message ?: tr("Couldn't delete")) }
                                }
                            }) else null,
                            kept = root == WorkspaceFiles.SERVER && entry.kept,
                        )
                    }
                }
                if (l.more > 0) Hint(tr("…and {n} more, not listed.", "n" to String.format(java.util.Locale.ROOT, "%,d", l.more)))
            }
        }
    }

    ask?.let { a ->
        val entry = a.entry
        val r = root
        AlertDialog(
            onDismissRequest = { ask = null },
            title = {
                Text(when (a.kind) { "folder" -> tr("New folder"); "project" -> tr("New project"); "members" -> tr("Bots in {name}", "name" to project?.name); "rename" -> tr("Rename {name}", "name" to entry?.name); "move" -> tr("Move {name}", "name" to entry?.name); else -> tr("Delete?") })
            },
            text = {
                if (a.kind == "delete" || a.kind == "delete-project") Text(a.words, color = p.text)
                else if (a.kind == "members") Column {
                    Projects.eligible(allBots).forEach { b ->
                        Row(Modifier.fillMaxWidth().clickable { picked = if (b.id in picked) picked - b.id else picked + b.id }, verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(b.id in picked, { picked = if (it) picked + b.id else picked - b.id }, colors = CheckboxDefaults.colors(checkedColor = p.ink, checkmarkColor = p.inkText))
                            Text(b.name, color = p.text)
                        }
                    }
                }
                else Column {
                    if (a.kind == "move") Text(tr("To which folder? A path in its folder, such as notes/old. Empty for the top."), color = p.muted, modifier = Modifier.padding(bottom = Space.s8))
                    OutlinedTextField(answer, { answer = it.take(255) }, singleLine = true, label = { Text(if (a.kind == "move") tr("Folder") else tr("Name")) }, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton(enabled = a.kind == "delete" || a.kind == "delete-project" || a.kind == "move" || (a.kind == "members" && picked.isNotEmpty()) || answer.isNotBlank(), onClick = {
                    ask = null
                    when (a.kind) {
                        "project" -> act(tr("make it")) { made -> made.createProject(answer.trim(), listOf(botId)).let { pr -> allProjects = made.projects(); go(WorkspaceFiles.projectRoot(pr.name), ""); picked = pr.bots.toSet(); ask = WorkspaceAsk("members") } }
                        "members" -> project?.let { pr -> val bots = picked.toList(); act(tr("change its bots")) { it.setProjectBots(pr.name, bots); allProjects = it.projects(); if (botId !in bots) go(WorkspaceFiles.COMPUTER, "") } }
                        "delete-project" -> project?.let { pr -> act(tr("delete it")) { it.deleteProject(pr.name); allProjects = it.projects(); go(WorkspaceFiles.COMPUTER, ""); tell(tr("Deleted {name}", "name" to pr.name)) } }
                        "folder" -> act(tr("make it")) { it.makeWorkspaceFolder(botId, path, answer.trim(), r) }
                        "rename" -> if (!WorkspaceFiles.nameOk(answer)) tell(tr("A name can't have / in it. To put it in another folder, use Move.")) else entry?.let { en -> WorkspaceFiles.renamed(en.path, answer).takeIf { it != en.path }?.let { to -> act(tr("rename it")) { it.moveInWorkspace(botId, en.path, to, r) } } }
                        "move" -> entry?.let { en -> WorkspaceFiles.movedTo(en.path, answer).takeIf { it != en.path }?.let { to -> act(tr("move it")) { it.moveInWorkspace(botId, en.path, to, r) } } }
                        else -> entry?.let { en -> act(tr("delete it")) { it.deleteFromWorkspace(botId, r, en.path); tell(tr("Deleted {name}", "name" to en.name)) } }
                    }
                }) { Text(when (a.kind) { "folder", "project" -> tr("Make"); "members" -> tr("Save"); "rename" -> tr("Rename"); "move" -> tr("Move"); else -> tr("Delete") }, color = if (a.kind == "delete" || a.kind == "delete-project") p.err else p.text) }
            },
            dismissButton = { TextButton(onClick = { ask = null }) { Text(tr("Cancel"), color = p.text) } },
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
        Column(Modifier.weight(1f).clickable(enabled = e.type != "link", onClick = onOpen).padding(vertical = Space.s8)) {
            Text("$icon ${e.name}", color = p.text, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val sub = listOfNotNull(detail.ifBlank { null }, if (kept) tr("Kept by botdot") else null).joinToString(" · ")
            if (sub.isNotEmpty()) Text(sub, color = p.muted, style = MaterialTheme.typography.bodySmall)
        }
        if (onSave != null || onRename != null || onMove != null || onDelete != null) Box {
            TextButton(onClick = { menu = true }) { Text("⋯", color = p.muted) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = p.panel) {
                onSave?.let { f -> DropdownMenuItem(text = { Text(tr("Save to Downloads"), color = p.text) }, onClick = { menu = false; f() }) }
                onRename?.let { f -> DropdownMenuItem(text = { Text(tr("Rename"), color = p.text) }, onClick = { menu = false; f() }) }
                onMove?.let { f -> DropdownMenuItem(text = { Text(tr("Move"), color = p.text) }, onClick = { menu = false; f() }) }
                onDelete?.let { f -> DropdownMenuItem(text = { Text(tr("Delete"), color = p.err) }, onClick = { menu = false; f() }) }
            }
        }
    }
}
