package dev.botdot.app.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.DriveFileMove
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.automirrored.outlined.ViewList
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.DriveFileRenameOutline
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.FileUpload
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Api
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.Bot
import dev.botdot.app.data.BotFiles
import dev.botdot.app.data.DocumentView
import dev.botdot.app.data.FilesExplorer
import dev.botdot.app.data.PickedFolder
import dev.botdot.app.data.Project
import dev.botdot.app.data.Projects
import dev.botdot.app.data.UploadedFile
import dev.botdot.app.data.UploadedFiles
import dev.botdot.app.data.WorkspaceEntry
import dev.botdot.app.data.WorkspaceFiles
import dev.botdot.app.data.WorkspaceListing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A sheet from the bottom: the places, the sort, what a "+" adds, one entry's actions, or a project's. */
private sealed interface FxSheet {
    data object Places : FxSheet
    data object Sort : FxSheet
    data object Add : FxSheet
    data class Entry(val e: WorkspaceEntry) : FxSheet
    data class Project(val name: String) : FxSheet
}

/** One folder of the Move to… tree, flattened: its place, path, name and depth. */
private data class FxNode(val root: String, val path: String, val name: String, val depth: Int)

/** A dialog: a name (a new folder or project, a rename), a project's bots, or a yes to a delete. */
private data class FxAsk(val kind: String, val entries: List<WorkspaceEntry> = emptyList(), val words: String = "", val project: String = "")

/** Move to… or Copy to…: what goes, from which place, and the folder picked so far. */
private data class FxCarry(val move: Boolean, val from: String, val entries: List<WorkspaceEntry>, val to: String? = null, val folder: String = "")

/**
 * Files (#603): a bot's files, or the Chief's ([UploadedFiles.CHIEF]), full screen, as the phone mockups show them.
 * Its places in a sheet under the title; the folder's rows (or a grid with images as themselves), sorted by name,
 * date or size; a breadcrumb; a tap opens, a long press selects, with All and a bar of Move, Copy, Download and
 * Delete; each row's ⋯ opens its sheet; "+" uploads files or a folder or makes a folder. Move to… and Copy to… pick
 * a folder in a tree of every place. A computer that is off is started only by the owner's tap. Only from a server
 * with `files-explorer` ([FilesExplorer]).
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun FilesScreen(app: BotDotApp, ownerId: String, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val server by app.store.version.value.collectAsState()
    val bots by app.store.bots.value.collectAsState()
    val features = server?.features
    val chief = ownerId == UploadedFiles.CHIEF
    val bot = bots?.firstOrNull { it.id == ownerId }
    val chiefName = LocalChiefName.current
    val name = if (chief) chiefName else bot?.name.orEmpty()
    val computer = if (chief) "none" else bot?.computer ?: "none"
    val viewer = DocumentView.shows(features)
    val withProjects = !chief && computer == "linux" && Projects.shows(features)
    val searches = FilesExplorer.searches(features)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snack = remember { SnackbarHostState() }
    fun tell(s: String) { scope.launch { snack.showSnackbar(s) } }

    var place by rememberSaveable(ownerId) { mutableStateOf(WorkspaceFiles.SERVER) }
    var path by rememberSaveable(ownerId) { mutableStateOf("") }
    var sortName by rememberSaveable { mutableStateOf(FilesExplorer.Sort.NAME.name) }
    val sort = FilesExplorer.Sort.valueOf(sortName)
    var grid by rememberSaveable { mutableStateOf(false) }
    var listing by remember { mutableStateOf<WorkspaceListing?>(null) }
    var failed by remember { mutableStateOf<Throwable?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    var kept by remember { mutableStateOf<List<UploadedFile>>(emptyList()) }
    var projects by remember { mutableStateOf<List<Project>>(emptyList()) }
    var allBots by remember { mutableStateOf<List<Bot>>(emptyList()) }
    var selected by remember(place, path) { mutableStateOf<Set<String>>(emptySet()) }
    var query by rememberSaveable { mutableStateOf("") }
    var found by remember { mutableStateOf<List<dev.botdot.app.data.FoundFile>?>(null) }
    var sheet by remember { mutableStateOf<FxSheet?>(null) }
    var ask by remember { mutableStateOf<FxAsk?>(null) }
    var answer by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<Set<String>>(emptySet()) }
    var carry by remember { mutableStateOf<FxCarry?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }

    val root = FilesExplorer.rootOf(place)
    val pinned = kept.filter { it.pinned }.map { it.file }.toSet()
    fun go(to: String, at: String) { place = to; path = at; query = ""; found = null }
    fun act(what: String, block: suspend (Api) -> Unit) {
        val a = api ?: return tell("Not connected to botdot")
        scope.launch { runCatching { block(a) }.onError { tell(it.message ?: "Couldn't $what") }; tries++ }
    }

    // What is kept in mind: the pins of files on botdot, and a place of its own.
    LaunchedEffect(api, tries) { val a = api ?: return@LaunchedEffect; runCatching { a.botFiles(ownerId) }.onSuccess { kept = it.files } }
    LaunchedEffect(api, place, path, tries) {
        val a = api ?: return@LaunchedEffect
        if (place == FilesExplorer.KEPT) { listing = null; failed = null; return@LaunchedEffect }
        listing = null; failed = null
        runCatching { a.workspace(ownerId, place, path) }.onSuccess { listing = it }.onError { failed = it }
    }
    if (withProjects) LaunchedEffect(api, tries) {
        val a = api ?: return@LaunchedEffect
        runCatching { a.projects() }.onSuccess { projects = it }
        runCatching { a.bots() }.onSuccess { allBots = it }
    }
    // A search as it is typed, a moment after the last key.
    if (searches) LaunchedEffect(api, query) {
        val a = api ?: return@LaunchedEffect
        if (query.isBlank()) { found = null; return@LaunchedEffect }
        delay(250)
        runCatching { a.searchFiles(ownerId, query.trim()) }.onSuccess { found = it.results }.onError { found = emptyList() }
    }

    val places = FilesExplorer.places(ownerId, computer, projects)
    val hits = found
    val shown: List<WorkspaceEntry> = when {
        hits != null -> hits.map { WorkspaceEntry(it.name, it.path, it.type, it.size, at = it.at) }
        place == FilesExplorer.KEPT -> FilesExplorer.keptEntries(kept)
        else -> FilesExplorer.sorted(listing?.entries.orEmpty(), sort)
    }
    // Where each shown entry is: a search finds them in every place.
    val shownAt: List<String> = hits?.map { FilesExplorer.placeOf(it) } ?: shown.map { root }
    val writesHere = found == null && place != FilesExplorer.KEPT && listing?.readOnly == false
    val selecting = selected.isNotEmpty()
    val chosen = shown.filter { it.path in selected }
    fun can(e: WorkspaceEntry) = FilesExplorer.can(place, listing, e, pinned)

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        if (uris.size > WorkspaceFiles.MAX_FILES) tell("Upload at most ${WorkspaceFiles.MAX_FILES} files at a time.")
        val into = path
        val r = root
        act("upload") { a ->
            for (uri in uris.take(WorkspaceFiles.MAX_FILES)) {
                runCatching { a.uploadToWorkspace(context.contentResolver, uri, ownerId, into, r) }.onError { tell(it.message ?: "Couldn't upload") }
            }
        }
    }
    // A whole folder (#576): its top made first under a free name, then its files one by one, their folders made as they come.
    val pickFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
        if (tree == null) return@rememberLauncherForActivityResult
        val into = path
        val r = root
        act("upload the folder") { a ->
            val folder = withContext(Dispatchers.IO) { PickedFolder.read(context.contentResolver, tree) }
            if (folder.tooMany) return@act tell("${folder.name} has more than ${String.format(java.util.Locale.ROOT, "%,d", WorkspaceFiles.MAX_FOLDER_FILES)} files: upload at most that many at a time.")
            val top = a.makeWorkspaceFolder(ownerId, into, folder.name, r, free = true)
            var missed = 0
            try {
                folder.files.forEachIndexed { i, f ->
                    busy = "Uploading ${folder.name}: ${i + 1} of ${folder.files.size}"
                    if ((f.size ?: 0) > WorkspaceFiles.MAX_BYTES) missed++
                    else runCatching { a.uploadToWorkspace(context.contentResolver, f.uri, ownerId, WorkspaceFiles.folderDir(top, f.dir), r, made = true) }.onError { missed++ }
                }
            } finally { busy = null }
            tell(if (missed > 0) "${folder.name}: $missed of ${folder.files.size} files didn't upload." else "Uploaded ${folder.name}")
        }
    }

    fun open(e: WorkspaceEntry, at: String = root) {
        if (e.type == "folder") return go(at, e.path)
        if (e.type != "file") return
        val src = WorkspaceFiles.file(ownerId, at, e.path)
        if (viewer) DocViewer.open = DocViewer.Request(src, e.name, name, botId = if (at != WorkspaceFiles.SERVER) ownerId else null)
        else act("open it") { BotFiles.openElsewhere(context, it, src, e.name) }
    }
    fun download(list: List<WorkspaceEntry>) {
        val a = api ?: return tell("Not connected to botdot")
        val files = list.filter { it.type == "file" }
        files.forEach { BotFiles.saveToDownloads(context, a, WorkspaceFiles.file(ownerId, root, it.path), it.name) }
        if (files.isNotEmpty()) tell(if (files.size == 1) "Saving ${files[0].name} to Downloads" else "Saving ${files.size} files to Downloads")
    }
    fun delete(list: List<WorkspaceEntry>) {
        if (list.isEmpty()) return
        if (list.size > 1) { ask = FxAsk("delete", list, FilesExplorer.deleteManyWords(list.size)); return }
        val r = root
        scope.launch {
            runCatching { (api ?: error("Not connected to botdot")).workspaceCount(ownerId, r, list[0].path) }
                .onSuccess { ask = FxAsk("delete", list, WorkspaceFiles.deleteWords(list[0].name, it)) }
                .onError { tell(it.message ?: "Couldn't delete") }
        }
    }
    fun keep(e: WorkspaceEntry, on: Boolean) = act("keep it in mind") { a ->
        if (on) a.keepFromWorkspace(ownerId, e.path) else a.pinBotFile(ownerId, e.path, false)
        tell(if (on) "Keeping ${e.name} in mind" else "${e.name} is no longer kept in mind")
    }
    fun startCarry(move: Boolean, list: List<WorkspaceEntry>) { if (list.isNotEmpty()) carry = FxCarry(move, place, list) }
    fun tap(e: WorkspaceEntry, at: String) {
        if (selecting) selected = if (e.path in selected) selected - e.path else selected + e.path
        else open(e, at)
    }

    BackHandler(enabled = selecting || path.isNotEmpty() || found != null) {
        when {
            selecting -> selected = emptySet()
            found != null -> { query = ""; found = null }
            else -> path = WorkspaceFiles.parentOf(path)
        }
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            Column(Modifier.background(p.bg)) {
                Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (selecting) {
                        IconButton(onClick = { selected = emptySet() }) { Icon(Icons.Filled.Close, contentDescription = "Clear the selection") }
                        Text("${selected.size} selected", color = p.text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f).padding(start = 8.dp))
                        OutlinedButton(onClick = { selected = shown.map { it.path }.toSet() }, modifier = Modifier.padding(end = 8.dp)) { Text("All", color = p.text) }
                    } else {
                        BackButton(onBack)
                        Column(Modifier.weight(1f).padding(start = 4.dp)) {
                            Text(path.substringAfterLast('/').ifEmpty { name }, color = p.text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${FilesExplorer.placeName(place)} ▾", color = p.muted, style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable { sheet = FxSheet.Places }.padding(vertical = 2.dp).testTag("files-place"))
                        }
                        IconButton(onClick = { sheet = FxSheet.Sort }) { Icon(Icons.Outlined.SwapVert, contentDescription = "Sort", tint = p.text) }
                        IconButton(onClick = { grid = !grid }) { Icon(if (grid) Icons.AutoMirrored.Outlined.ViewList else Icons.Outlined.GridView, contentDescription = if (grid) "List" else "Grid", tint = p.text) }
                    }
                }
                if (searches && !selecting) OutlinedTextField(query, { query = it.take(100) }, singleLine = true, placeholder = { Text("Search", color = p.faint) },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = p.muted) },
                    shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp))
                if (found == null && place != FilesExplorer.KEPT && path.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val crumbs = FilesExplorer.crumbs(path, name)
                    crumbs.forEachIndexed { i, (n, to) ->
                        if (i == crumbs.lastIndex) Text(n, color = p.text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyLarge)
                        else {
                            Text(n, color = p.muted, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.clickable { path = to })
                            Text("  /  ", color = p.faint)
                        }
                    }
                }
            }
        },
        bottomBar = {
            if (selecting) Row(Modifier.fillMaxWidth().background(p.panel).navigationBarsPadding().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                val cans = chosen.map { can(it) }
                BarButton(Icons.AutoMirrored.Outlined.DriveFileMove, "Move", cans.isNotEmpty() && cans.all { it.move }) { startCarry(true, chosen) }
                BarButton(Icons.Outlined.ContentCopy, "Copy", cans.isNotEmpty() && cans.all { it.copy }) { startCarry(false, chosen) }
                BarButton(Icons.Outlined.FileDownload, "Download", cans.any { it.download }) { download(chosen); selected = emptySet() }
                BarButton(Icons.Outlined.Delete, "Delete", cans.isNotEmpty() && cans.all { it.delete }, danger = true) { delete(chosen) }
            }
        },
        floatingActionButton = {
            if (writesHere && !selecting && busy == null) FloatingActionButton(onClick = { sheet = FxSheet.Add }, containerColor = p.ink, contentColor = p.inkText, shape = RoundedCornerShape(20.dp)) {
                Icon(Icons.Filled.Add, contentDescription = "Add")
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            val e = failed
            when {
                found == null && place != FilesExplorer.KEPT && e != null && (e as? ApiException)?.status == 409 -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text("The computer is off.", color = p.muted)
                    Button(onClick = { act("start it") { it.startComputer(ownerId) } }, modifier = Modifier.padding(top = 12.dp), colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Start the computer") }
                }
                found == null && place != FilesExplorer.KEPT && e != null && (e as? ApiException)?.status == 404 -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text("This folder is gone.", color = p.muted)
                    OutlinedButton(onClick = { path = "" }, modifier = Modifier.padding(top = 12.dp)) { Text("Back to the top", color = p.text) }
                }
                found == null && place != FilesExplorer.KEPT && e != null -> Text(e.message ?: "Couldn't load it.", color = p.muted, modifier = Modifier.align(Alignment.Center).padding(24.dp))
                found == null && place != FilesExplorer.KEPT && listing == null -> Text("Loading…", color = p.faint, modifier = Modifier.align(Alignment.Center))
                shown.isEmpty() -> Text(if (found != null) "Nothing by that name." else "Empty.", color = p.faint, modifier = Modifier.align(Alignment.Center))
                grid -> LazyVerticalGrid(GridCells.Adaptive(108.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp, 8.dp, 12.dp, 96.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    itemsIndexed(shown, key = { i, x -> shownAt[i] + "\u0000" + x.path }) { i, entry ->
                        val thumb = if (FilesExplorer.thumbs(entry)) api?.url(WorkspaceFiles.thumb(ownerId, shownAt[i], entry.path)) else null
                        FileCard(entry, thumb, entry.path in selected, onTap = { tap(entry, shownAt[i]) }, onHold = { if (hits == null) selected = selected + entry.path })
                    }
                }
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                    busy?.let { b -> item { Text(b, color = p.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) } }
                    itemsIndexed(shown, key = { i, x -> shownAt[i] + "\u0000" + x.path }) { i, entry ->
                        val detail = if (hits != null) listOf(FilesExplorer.placeName(shownAt[i]), WorkspaceFiles.parentOf(entry.path)).filter { it.isNotEmpty() }.joinToString(" / ") else FilesExplorer.detail(entry)
                        val c = can(entry)
                        FileRow(entry, detail, selecting, entry.path in selected,
                            onTap = { tap(entry, shownAt[i]) }, onHold = { if (hits == null) selected = selected + entry.path },
                            onMore = if (hits == null && (c.open || c.download || c.delete || c.copy)) ({ sheet = FxSheet.Entry(entry) }) else null)
                    }
                }
            }
        }
    }

    // ---------- sheets ----------

    sheet?.let { s ->
        ModalBottomSheet(onDismissRequest = { sheet = null }, containerColor = p.panel) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
                when (s) {
                    FxSheet.Places -> {
                        (places + FilesExplorer.KEPT).forEach { pl ->
                            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable { sheet = null; go(pl, "") }.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(placeIcon(pl), contentDescription = null, tint = p.text, modifier = Modifier.size(24.dp))
                                Text(FilesExplorer.placeName(pl), color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 18.dp))
                                if (pl == FilesExplorer.KEPT && pinned.isNotEmpty()) Text("  ${pinned.size}", color = p.faint)
                                if (pl == place) Icon(Icons.Filled.Check, contentDescription = "Here", tint = p.text, modifier = Modifier.padding(start = 12.dp).size(20.dp))
                                Spacer(Modifier.weight(1f))
                                WorkspaceFiles.projectOf(pl)?.let { pr -> IconButton(onClick = { sheet = FxSheet.Project(pr) }) { Icon(Icons.Filled.MoreHoriz, contentDescription = "Project", tint = p.muted) } }
                            }
                        }
                        if (withProjects) SheetRow(Icons.Outlined.CreateNewFolder, "New project") { sheet = null; answer = ""; ask = FxAsk("project") }
                    }
                    FxSheet.Sort -> FilesExplorer.Sort.entries.forEach { o ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable { sheet = null; sortName = o.name }.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(o.label, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                            if (o == sort) Icon(Icons.Filled.Check, contentDescription = "Sorted so", tint = p.text)
                        }
                    }
                    FxSheet.Add -> {
                        SheetRow(Icons.Outlined.FileUpload, "Upload files") { sheet = null; pick.launch("*/*") }
                        SheetRow(Icons.Outlined.FolderOpen, "Upload folder") { sheet = null; pickFolder.launch(null) }
                        SheetRow(Icons.Outlined.CreateNewFolder, "New folder") { sheet = null; answer = ""; ask = FxAsk("folder") }
                    }
                    is FxSheet.Entry -> {
                        val en = s.e
                        val c = can(en)
                        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            KindIcon(en, 28.dp)
                            Column(Modifier.padding(start = 16.dp)) {
                                Text(en.name, color = p.text, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(FilesExplorer.detail(en), color = p.muted, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                        HorizontalDivider(color = p.line2, modifier = Modifier.padding(vertical = 6.dp))
                        if (c.open) SheetRow(Icons.AutoMirrored.Outlined.InsertDriveFile, "Open") { sheet = null; open(en) }
                        if (c.rename) SheetRow(Icons.Outlined.DriveFileRenameOutline, "Rename") { sheet = null; answer = en.name; ask = FxAsk("rename", listOf(en)) }
                        if (c.move) SheetRow(Icons.AutoMirrored.Outlined.DriveFileMove, "Move to…") { sheet = null; startCarry(true, listOf(en)) }
                        if (c.copy) SheetRow(Icons.Outlined.ContentCopy, "Copy to…") { sheet = null; startCarry(false, listOf(en)) }
                        if (c.download) SheetRow(Icons.Outlined.FileDownload, "Download") { sheet = null; download(listOf(en)) }
                        if (c.keep) SheetRow(Icons.Outlined.PushPin, "Keep in mind") { sheet = null; keep(en, true) }
                        if (c.unpin) SheetRow(Icons.Outlined.PushPin, "Unpin") { sheet = null; keep(en, false) }
                        if (c.delete) SheetRow(Icons.Outlined.Delete, "Delete", danger = true) { sheet = null; delete(listOf(en)) }
                    }
                    is FxSheet.Project -> {
                        val pr = projects.firstOrNull { it.name == s.name }
                        Text(s.name, color = p.text, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                        if (pr != null) Text(Projects.members(pr, allBots), color = p.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 20.dp))
                        HorizontalDivider(color = p.line2, modifier = Modifier.padding(vertical = 6.dp))
                        SheetRow(Icons.Outlined.Dns, "Bots…") { sheet = null; picked = pr?.bots.orEmpty().toSet(); ask = FxAsk("members", project = s.name) }
                        SheetRow(Icons.Outlined.Delete, "Delete project", danger = true) {
                            sheet = null
                            scope.launch {
                                runCatching { (api ?: error("Not connected to botdot")).workspaceCount(ownerId, WorkspaceFiles.projectRoot(s.name), "") }
                                    .onSuccess { ask = FxAsk("delete-project", words = WorkspaceFiles.deleteWords(s.name, it).replace("Delete the folder", "Delete the project"), project = s.name) }
                                    .onError { tell(it.message ?: "Couldn't delete") }
                            }
                        }
                    }
                }
            }
        }
    }

    // ---------- dialogs ----------

    ask?.let { a ->
        val r = root
        val en = a.entries.firstOrNull()
        val danger = a.kind == "delete" || a.kind == "delete-project"
        AlertDialog(
            onDismissRequest = { ask = null },
            containerColor = p.panel,
            title = { Text(when (a.kind) { "folder" -> "New folder"; "project" -> "New project"; "members" -> "Bots in ${a.project}"; "rename" -> "Rename"; else -> "Delete?" }) },
            text = {
                when {
                    danger -> Text(a.words, color = p.text)
                    a.kind == "members" -> Column {
                        Projects.eligible(allBots).forEach { b ->
                            Row(Modifier.fillMaxWidth().clickable { picked = if (b.id in picked) picked - b.id else picked + b.id }, verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(b.id in picked, { picked = if (it) picked + b.id else picked - b.id }, colors = CheckboxDefaults.colors(checkedColor = p.ink, checkmarkColor = p.inkText))
                                Text(b.name, color = p.text)
                            }
                        }
                    }
                    else -> OutlinedTextField(answer, { answer = it.take(255) }, singleLine = true, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton(enabled = danger || (a.kind == "members" && picked.isNotEmpty()) || (a.kind != "members" && answer.isNotBlank()), onClick = {
                    ask = null
                    when (a.kind) {
                        "folder" -> act("make it") { it.makeWorkspaceFolder(ownerId, path, answer.trim(), r) }
                        "project" -> act("make it") { made ->
                            val pr = made.createProject(answer.trim(), listOf(ownerId))
                            projects = made.projects(); go(WorkspaceFiles.projectRoot(pr.name), ""); picked = pr.bots.toSet(); ask = FxAsk("members", project = pr.name)
                        }
                        "members" -> { val members = picked.toList(); act("change its bots") { it.setProjectBots(a.project, members); projects = it.projects(); if (ownerId !in members && place == WorkspaceFiles.projectRoot(a.project)) go(WorkspaceFiles.COMPUTER, "") } }
                        "delete-project" -> act("delete it") { it.deleteProject(a.project); projects = it.projects(); if (place == WorkspaceFiles.projectRoot(a.project)) go(WorkspaceFiles.COMPUTER, ""); tell("Deleted ${a.project}") }
                        "rename" -> if (!WorkspaceFiles.nameOk(answer)) tell("A name can't have / in it. To put it in another folder, use Move to….")
                            else en?.let { x -> WorkspaceFiles.renamed(x.path, answer).takeIf { it != x.path }?.let { to -> act("rename it") { it.moveInWorkspace(ownerId, x.path, to, r) } } }
                        else -> {
                            val list = a.entries
                            selected = emptySet()
                            act("delete it") { api2 ->
                                var missed = 0
                                for (x in list) runCatching { api2.deleteFromWorkspace(ownerId, r, x.path) }.onError { missed++; tell("${x.name}: ${it.message}") }
                                if (missed == 0) tell(if (list.size == 1) "Deleted ${list[0].name}" else "Deleted ${list.size} items")
                            }
                        }
                    }
                }) { Text(when (a.kind) { "folder", "project" -> "Make"; "members" -> "Save"; "rename" -> "Rename"; else -> "Delete" }, color = if (danger) p.err else p.text) }
            },
            dismissButton = { TextButton(onClick = { ask = null }) { Text("Cancel", color = p.text) } },
        )
    }

    carry?.let { c -> CarryDialog(api, ownerId, c, places, onPick = { to, folder -> carry = c.copy(to = to, folder = folder) }, onDismiss = { carry = null }, tell = ::tell) { to, folder ->
        carry = null
        selected = emptySet()
        val from = FilesExplorer.rootOf(c.from)
        act(if (c.move) "move it" else "copy it") { a ->
            var missed = 0
            for (x in c.entries) runCatching { a.carryInWorkspace(ownerId, x.path, folder, from, to, c.move) }.onError { missed++; tell("${x.name}: ${it.message}") }
            if (missed == 0) tell(FilesExplorer.carriedWords(c.move, c.entries.map { it.name }, to, folder))
        }
    } }
}

/**
 * Move to… and Copy to…: every place of the bot as a tree, each folder opened as it is tapped. The folder the items
 * are in, and the items themselves with what they hold, are not offered. New folder makes one in the folder picked.
 */
@Composable
private fun CarryDialog(api: Api?, ownerId: String, c: FxCarry, places: List<String>, onPick: (String, String) -> Unit, onDismiss: () -> Unit, tell: (String) -> Unit, onGo: (String, String) -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    // A folder's folders, by "<root>\u0000<path>"; a key that is there is opened.
    val open = remember { mutableStateMapOf<String, List<WorkspaceEntry>?>() }
    var naming by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    val paths = c.entries.map { it.path }
    fun slot(root: String, path: String) = "$root\u0000$path"
    fun load(root: String, path: String) {
        val a = api ?: return
        open[slot(root, path)] = null
        scope.launch {
            runCatching { a.workspace(ownerId, root, path) }
                .onSuccess { l -> open[slot(root, path)] = FilesExplorer.sorted(l.entries.filter { it.type == "folder" && !it.kept }) }
                .onError { open.remove(slot(root, path)); tell(it.message ?: "Couldn't load it") }
        }
    }
    fun toggle(root: String, path: String) { if (slot(root, path) in open) open.remove(slot(root, path)) else load(root, path) }
    LaunchedEffect(Unit) { FilesExplorer.rootOf(c.from).let { load(it, "") } }

    val nodes = buildList<FxNode> {
        fun walk(root: String, path: String, depth: Int) {
            open[slot(root, path)]?.forEach { f -> add(FxNode(root, f.path, f.name, depth)); walk(root, f.path, depth + 1) }
        }
        places.forEach { r -> add(FxNode(r, "", FilesExplorer.placeName(r), 0)); walk(r, "", 1) }
    }
    val what = if (c.entries.size == 1) c.entries[0].name else "${c.entries.size} items"
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = p.panel,
        title = { Text("${if (c.move) "Move" else "Copy"} $what", maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = {
            Column {
                Column(Modifier.fillMaxWidth().heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                    nodes.forEach { n -> key(slot(n.root, n.path)) {
                        val ok = FilesExplorer.takes(c.from, paths, n.root, n.path)
                        val here = c.to == n.root && c.folder == n.path
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (here) p.sunk else Color.Transparent)
                            .clickable(enabled = ok) { onPick(n.root, n.path) }.heightIn(min = 44.dp).padding(start = (n.depth * 18).dp), verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = { toggle(n.root, n.path) }, modifier = Modifier.size(36.dp)) {
                                Icon(if (slot(n.root, n.path) in open) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight, contentDescription = "Open", tint = p.muted)
                            }
                            Icon(if (n.depth == 0) placeIcon(n.root) else Icons.Outlined.Folder, contentDescription = null, tint = if (ok) p.text else p.faint, modifier = Modifier.size(20.dp))
                            Text(n.name, color = if (ok) p.text else p.faint, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 10.dp))
                        }
                    } }
                }
                if (naming) OutlinedTextField(newName, { newName = it.take(255) }, singleLine = true, label = { Text("Name") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
            }
        },
        confirmButton = {
            Row {
                val to = c.to
                if (naming) TextButton(enabled = to != null && newName.isNotBlank(), onClick = {
                    val a = api ?: return@TextButton
                    val r = to ?: return@TextButton
                    scope.launch {
                        runCatching { a.makeWorkspaceFolder(ownerId, c.folder, newName.trim(), r) }
                            .onSuccess { made -> naming = false; newName = ""; load(r, c.folder); onPick(r, made) }
                            .onError { tell(it.message ?: "Couldn't make it") }
                    }
                }) { Text("Make", color = p.text) }
                else TextButton(enabled = to != null, onClick = { naming = true }) { Text("New folder", color = p.text) }
                TextButton(enabled = to != null && !naming, onClick = { to?.let { onGo(it, c.folder) } }) { Text(if (c.move) "Move here" else "Copy here", color = p.text) }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = p.text) } },
    )
}

private fun placeIcon(place: String): ImageVector = when (place) {
    WorkspaceFiles.SERVER -> Icons.Outlined.Dns
    WorkspaceFiles.COMPUTER -> Icons.Outlined.DesktopWindows
    FilesExplorer.KEPT -> Icons.Outlined.PushPin
    else -> Icons.Outlined.Folder
}

/** An entry's icon, coloured by its kind as the web page's: folders amber, sheets green, images blue. */
@Composable
private fun KindIcon(e: WorkspaceEntry, size: androidx.compose.ui.unit.Dp = 26.dp) {
    val p = LocalPaper.current
    val (icon, tint) = when (FilesExplorer.kindOf(e)) {
        FilesExplorer.Kind.FOLDER -> Icons.Outlined.Folder to p.warn
        FilesExplorer.Kind.LOCK -> Icons.Outlined.Lock to p.faint
        FilesExplorer.Kind.LINK -> Icons.Outlined.Link to p.muted
        FilesExplorer.Kind.SHEET -> Icons.Outlined.TableChart to p.ok
        FilesExplorer.Kind.IMAGE -> Icons.Outlined.Image to p.mention
        FilesExplorer.Kind.DOC -> Icons.Outlined.Description to p.text
        FilesExplorer.Kind.FILE -> Icons.AutoMirrored.Outlined.InsertDriveFile to p.text
    }
    Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size))
}

/** One row, at least 60 dp tall: a tap opens it (or, selecting, picks it), a long press selects; ⋯ opens its sheet. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileRow(e: WorkspaceEntry, detail: String, selecting: Boolean, on: Boolean, onTap: () -> Unit, onHold: () -> Unit, onMore: (() -> Unit)?) {
    val p = LocalPaper.current
    Column {
        Row(Modifier.fillMaxWidth().background(if (on) p.sunk else Color.Transparent).combinedClickable(onClick = onTap, onLongClick = onHold)
            .heightIn(min = 64.dp).padding(start = 14.dp, end = 4.dp, top = 8.dp, bottom = 8.dp).testTag("files-row"), verticalAlignment = Alignment.CenterVertically) {
            if (selecting) Checkbox(on, { onTap() }, colors = CheckboxDefaults.colors(checkedColor = p.mention, checkmarkColor = p.text), modifier = Modifier.padding(end = 6.dp))
            KindIcon(e)
            Column(Modifier.weight(1f).padding(start = 16.dp)) {
                Text(e.name, color = p.text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (detail.isNotEmpty()) Text(detail, color = p.muted, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (!selecting && onMore != null) IconButton(onClick = onMore) { Icon(Icons.Filled.MoreHoriz, contentDescription = "More", tint = p.faint) }
            else Spacer(Modifier.width(12.dp))
        }
        HorizontalDivider(color = p.line)
    }
}

/** One card of the grid: an image as itself, else its icon, with its name under it. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileCard(e: WorkspaceEntry, thumb: String?, on: Boolean, onTap: () -> Unit, onHold: () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.clip(RoundedCornerShape(12.dp)).background(if (on) p.sunk else p.panel).combinedClickable(onClick = onTap, onLongClick = onHold).padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.fillMaxWidth().aspectRatio(1.2f).clip(RoundedCornerShape(8.dp)).background(p.bg), contentAlignment = Alignment.Center) {
            KindIcon(e, 36.dp)
            if (thumb != null) AsyncImage(thumb, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Text(e.name, color = p.text, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun SheetRow(icon: ImageVector, label: String, danger: Boolean = false, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(onClick = onClick).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = if (danger) p.err else p.text, modifier = Modifier.size(24.dp))
        Text(label, color = if (danger) p.err else p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 18.dp))
    }
}

@Composable
private fun BarButton(icon: ImageVector, label: String, enabled: Boolean, danger: Boolean = false, onClick: () -> Unit) {
    val p = LocalPaper.current
    val tint = when { !enabled -> p.faint; danger -> p.err; else -> p.text }
    Column(Modifier.clip(RoundedCornerShape(10.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 14.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, contentDescription = null, tint = tint)
        Text(label, color = tint, style = MaterialTheme.typography.bodySmall)
    }
}

/** The settings' way into Files (#603), in place of the Files and Workspace sections. */
@Composable
fun FilesLink(onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.panel).clickable(onClick = onClick).heightIn(min = 56.dp).padding(horizontal = 16.dp).testTag("files-link"),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Folder, contentDescription = null, tint = p.text, modifier = Modifier.size(22.dp))
        Text("Files", color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f).padding(start = 14.dp))
        Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = p.faint)
    }
}
