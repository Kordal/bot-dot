package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.BotFiles
import dev.botdot.app.data.DocumentView
import dev.botdot.app.data.FileView
import dev.botdot.app.data.PageInfo
import dev.botdot.app.data.PageRef
import dev.botdot.app.data.Pages
import kotlinx.coroutines.launch

/**
 * The document viewer (#251): a file a bot attached, one of a bot's files, the owner's own file sent to it, or a file
 * a path in its reply names, opened full screen with Back instead of handed to another app. Markdown is drawn by the
 * chat's own [MarkdownText], which shows HTML as the text it is; text and code with line numbers; a CSV as a table.
 * The ⋯ menu holds Copy text, Save to Downloads, Share and Open in another app. Only from a server with
 * `document-viewer` ([DocumentView]); an older one keeps the download.
 */
object DocViewer {
    /** A file to open: [src] its API path (DocumentView), [from] who it is from, [botId] whose computer starts for it. [page]: a bot's page (#346). */
    data class Request(val src: String, val name: String, val from: String = "", val botId: String? = null, val path: String? = null, val page: PageAt? = null)

    /** Which bot's page, by its slug. */
    data class PageAt(val botId: String, val slug: String)

    /** A bot's page (#346), opened from a chip under a reply or from its settings. */
    fun page(botId: String, page: PageRef, from: String): Request = Request(Pages.src(botId, page.slug), page.title, from, page = PageAt(botId, page.slug))

    var open by mutableStateOf<Request?>(null)
    /** A path held down in a reply: its sheet with Open and Copy path. */
    var held by mutableStateOf<Request?>(null)
}

/** What a path in [botId]'s reply does (a tap opens it, a long press its sheet); null on a server without the viewer. */
@Composable
fun rememberPathActions(botId: String, from: String): PathActions? {
    val app = BotDotApp.of(LocalContext.current)
    val server by app.store.version.value.collectAsState()
    if (!DocumentView.shows(server?.features)) return null
    return remember(botId, from) {
        val of = { path: String, name: String -> DocViewer.Request(DocumentView.pathFile(botId, path), name, from, botId, path) }
        PathActions(from, open = { path, name -> DocViewer.open = of(path, name) }, menu = { DocViewer.held = of(it, it.substringAfterLast('/')) })
    }
}

/** The viewer and the sheet of a held path, over whatever is on screen (MainActivity). */
@Composable
fun DocumentViewerHost() {
    DocViewer.held?.let { PathSheet(it) }
    val req = DocViewer.open ?: return
    Dialog(onDismissRequest = { DocViewer.open = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        ViewerScreen(req, onBack = { DocViewer.open = null })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PathSheet(req: DocViewer.Request) {
    val p = LocalPaper.current
    val context = LocalContext.current
    ModalBottomSheet(onDismissRequest = { DocViewer.held = null }, containerColor = p.panel) {
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(req.path.orEmpty(), color = p.text, fontFamily = GeistMono, fontSize = 13.5.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = { DocViewer.held = null; DocViewer.open = req }, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Open") }
                OutlinedButton(onClick = {
                    context.getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText("botdot", req.path.orEmpty()))
                    DocViewer.held = null
                }, modifier = Modifier.weight(1f)) { Text("Copy path", color = p.text) }
            }
        }
    }
}

@Composable
private fun ViewerScreen(req: DocViewer.Request, onBack: () -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val app = BotDotApp.of(context)
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    var view by remember(req) { mutableStateOf<FileView?>(null) }
    var error by remember(req) { mutableStateOf<Throwable?>(null) }
    var tries by remember(req) { mutableIntStateOf(0) }
    var mode by remember(req) { mutableStateOf("source") }
    var menu by remember { mutableStateOf(false) }
    val tell = { t: String -> android.widget.Toast.makeText(context, t, android.widget.Toast.LENGTH_LONG).show() }
    LaunchedEffect(req, api, tries) {
        val a = api ?: return@LaunchedEffect
        view = null; error = null
        runCatching { a.viewFile(req.src) }
            .onSuccess { v -> view = v; mode = when (v.kind) { "markdown" -> "rendered"; "csv" -> "table"; else -> "source" } }
            .onFailure { error = it }
    }
    // A page (#346) is read again when its bot saves it (the feed's `page`) or its job changes, as it is shown now.
    val saves by app.store.pageSaves.value.collectAsState()
    var changed by remember(req) { mutableIntStateOf(0) }
    val saved = req.page?.let { saves["${it.botId}/${it.slug}"] }
    LaunchedEffect(saved, changed) {
        if (req.page == null || (saved == null && changed == 0) || view == null) return@LaunchedEffect
        api?.let { a -> runCatching { a.viewFile(req.src) }.onSuccess { view = it } }
    }
    var keeping by remember(req) { mutableStateOf(false) }
    // The ⋯ menu's actions, with the file fetched as it is (not only its start).
    fun withApi(what: String, act: suspend (dev.botdot.app.data.Api) -> Unit) {
        menu = false
        val a = api ?: return tell("Not connected to botdot")
        scope.launch { runCatching { act(a) }.onError { tell(it.message ?: "Couldn't $what") } }
    }
    Column(Modifier.fillMaxSize().background(p.bg).systemBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = p.text) }
            Column(Modifier.weight(1f)) {
                Text(req.name, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val sub = if (req.page != null) Pages.subtitle(req.from, view?.page) else DocumentView.subtitle(req.from, view, shortTime(view?.at))
                if (sub.isNotEmpty()) Text(sub, color = p.muted, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More", tint = p.text) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = p.panel) {
                    view?.text?.let { text ->
                        DropdownMenuItem(text = { Text("Copy text", color = p.text) }, onClick = {
                            menu = false
                            context.getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText(req.name, text))
                        })
                    }
                    if (view?.downloadable != false) {
                        DropdownMenuItem(text = { Text("Save to Downloads", color = p.text) }, onClick = { withApi("save it") { BotFiles.saveToDownloads(context, it, req.src, req.name); tell("Saving ${req.name} to Downloads") } })
                        DropdownMenuItem(text = { Text("Share…", color = p.text) }, onClick = { withApi("share it") { BotFiles.share(context, it, req.src, req.name) } })
                        DropdownMenuItem(text = { Text("Open in another app", color = p.text) }, onClick = { withApi("open it") { BotFiles.openElsewhere(context, it, req.src, req.name) } })
                    }
                }
            }
        }
        val v = view
        val e = error
        val page = v?.page
        if (req.page != null && page != null) PageBar(page, onKeep = { keeping = true }, onRefresh = {
            page.keep?.let { k -> withApi("refresh it") { it.runJob(req.page.botId, k.jobId); tell("${req.from.ifBlank { "The bot" }} is refreshing it") } }
        }, onStop = { withApi("stop it") { it.stopKeepingPage(req.page.botId, page.slug); tell("It no longer keeps up to date"); changed++ } })
        if (keeping && req.page != null && page != null) KeepSheet(page, req.from, onDismiss = { keeping = false }) { every, time, notify, check ->
            withApi("keep it up to date") { it.keepPage(req.page.botId, page.slug, every, time, notify, check); keeping = false; tell("It keeps up to date now"); changed++ }
        }
        when {
            e != null -> {
                val status = (e as? ApiException)?.status
                when (status) {
                    404 -> ViewerState("This file is gone", "Nothing is at this path any more. It may have been moved or deleted.") { OutlinedButton(onClick = onBack) { Text("Back to the chat", color = p.text) } }
                    409 -> ViewerState("The computer is off", "This file is on the account's computer, which is stopped. Start it to open the file.") {
                        req.botId?.let { botId ->
                            Button(onClick = { withApi("start it") { it.startComputer(botId); tries++ } }, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Start the computer") }
                        }
                        OutlinedButton(onClick = onBack) { Text("Not now", color = p.text) }
                    }
                    else -> ViewerState("Couldn't open it", e.message.orEmpty()) { OutlinedButton(onClick = onBack) { Text("Back to the chat", color = p.text) } }
                }
            }
            v == null -> Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                listOf(0.6f, 0.92f, 0.84f, 0.7f, 0.88f).forEach { w -> Box(Modifier.fillMaxWidth(w).height(12.dp).clip(RoundedCornerShape(6.dp)).background(p.sunk)) }
            }
            !v.downloadable && v.kind == "none" -> ViewerState("Too large to bring out of the computer", "Files on the computer open here up to 1 MB. Ask the bot to put it in its folder or to make it smaller.") {
                OutlinedButton(onClick = onBack) { Text("Back to the chat", color = p.text) }
            }
            v.kind == "none" -> ViewerState("No preview for this kind of file", "The app shows Markdown, text, code, CSV and pictures. Open this one on your phone.") {
                Button(onClick = { withApi("save it") { BotFiles.saveToDownloads(context, it, req.src, req.name); tell("Saving ${req.name} to Downloads") } },
                    colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Save to Downloads") }
                OutlinedButton(onClick = { withApi("open it") { BotFiles.openElsewhere(context, it, req.src, req.name) } }) { Text("Open in another app", color = p.text) }
            }
            v.kind == "image" -> Box(Modifier.fillMaxSize().padding(12.dp), contentAlignment = Alignment.Center) {
                api?.let { AsyncImage(it.url(req.src), contentDescription = req.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) }
            }
            else -> Column(Modifier.fillMaxSize()) {
                if (v.kind == "markdown" || v.kind == "csv") Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val modes = if (v.kind == "markdown") listOf("rendered" to "Rendered", "source" to "Source") else listOf("table" to "Table", "source" to "Source")
                    modes.forEach { (m, label) -> ModeChip(label, mode == m) { mode = m } }
                }
                if (v.truncated) Text("Too large to show whole. Showing its start (up to 1 MB or 1,000 lines)." + if (v.downloadable) " Save it to see everything." else "",
                    color = p.text, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth()
                        .border(1.dp, p.warnLine, RoundedCornerShape(12.dp)).background(p.warnSoft, RoundedCornerShape(12.dp)).padding(10.dp))
                val text = v.text.orEmpty()
                when {
                    v.kind == "markdown" && mode == "rendered" -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp)) {
                        MarkdownText(text, onWeb = null, paths = null)
                        Spacer(Modifier.height(40.dp))
                    }
                    v.kind == "csv" && mode == "table" -> CsvTable(text, DocumentView.sepOf(req.name))
                    else -> Lines(text)
                }
            }
        }
    }
}

@Composable
private fun ModeChip(label: String, on: Boolean, onClick: () -> Unit) {
    val p = LocalPaper.current
    Text(label, color = if (on) p.inkText else p.text, fontSize = 13.sp,
        modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(if (on) p.ink else p.bg).border(1.dp, if (on) p.ink else p.line2, RoundedCornerShape(99.dp))
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 6.dp))
}

@Composable
private fun ViewerState(title: String, text: String, actions: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
        if (text.isNotBlank()) Text(text, color = p.muted, fontSize = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { actions() }
    }
}

/** Text and code: monospace, each line with its number. */
@Composable
private fun Lines(text: String) {
    val p = LocalPaper.current
    val lines = remember(text) { text.removeSuffix("\n").split("\n") }
    val width = (lines.size.toString().length * 9 + 12).dp
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        items(lines.size) { i ->
            Row {
                Text("${i + 1}", color = p.faint, fontFamily = GeistMono, fontSize = 11.5.sp, modifier = Modifier.width(width).padding(top = 1.dp, end = 8.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.End)
                Text(lines[i], color = p.text, fontFamily = GeistMono, fontSize = 12.5.sp, lineHeight = 19.sp)
            }
        }
    }
}

/** A CSV as a table: "Find in table", "N rows · M columns", and a column sorted by a tap on its name (again: the other way). */
@Composable
private fun CsvTable(text: String, sep: Char) {
    val p = LocalPaper.current
    var find by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf<Pair<Int, Boolean>?>(null) }
    val t = remember(text, find, sort) { DocumentView.table(text, sep, sort?.first, sort?.second ?: true, find) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            BasicTextField(find, { find = it }, singleLine = true, textStyle = TextStyle(color = p.text, fontSize = 14.sp), cursorBrush = SolidColor(p.text),
                modifier = Modifier.weight(1f).border(1.dp, p.line2, RoundedCornerShape(99.dp)).padding(horizontal = 14.dp, vertical = 8.dp),
                decorationBox = { inner -> if (find.isEmpty()) Text("Find in table", color = p.faint, fontSize = 14.sp); inner() })
            Text("${t.total} rows · ${t.cols} columns", color = p.muted, fontSize = 12.5.sp)
        }
        val cell = Modifier.width(140.dp).padding(horizontal = 8.dp, vertical = 6.dp)
        Column(Modifier.fillMaxSize().horizontalScroll(rememberScrollState()).verticalScroll(rememberScrollState()).padding(horizontal = 8.dp)) {
            Row {
                Text("", modifier = Modifier.width(44.dp))
                for (c in 0 until t.cols) {
                    val arrow = when { sort?.first != c -> ""; sort?.second == true -> " ▲"; else -> " ▼" }
                    Text(t.head.getOrNull(c).orEmpty() + arrow, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = cell.clickable { sort = when { sort?.first != c -> c to true; sort?.second == true -> c to false; else -> null } })
                }
            }
            Box(Modifier.height(1.dp).width((44 + 140 * t.cols).dp).background(p.line2))
            t.rows.forEach { (n, cells) ->
                Row {
                    Text("$n", color = p.faint, fontFamily = GeistMono, fontSize = 11.5.sp, textAlign = androidx.compose.ui.text.style.TextAlign.End, modifier = Modifier.width(44.dp).padding(end = 8.dp, top = 7.dp))
                    for (c in 0 until t.cols) Text(cells.getOrNull(c).orEmpty(), color = p.text, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = cell)
                }
            }
            if (t.rows.isEmpty()) Text("Nothing found.", color = p.muted, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
        }
    }
}

/** A page's bar (#346): what keeps it up to date, with Refresh now, Change and Stop, or the button that does. */
@Composable
private fun PageBar(page: PageInfo, onKeep: () -> Unit, onRefresh: () -> Unit, onStop: () -> Unit) {
    val p = LocalPaper.current
    androidx.compose.foundation.layout.FlowRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val keep = page.keep
        if (keep == null) OutlinedButton(onClick = onKeep) { Text("Keep up to date", color = p.text) }
        else {
            Text("↻ Keeps up to date · ${keep.`when`}", color = p.okText, fontSize = 12.5.sp,
                modifier = Modifier.align(Alignment.CenterVertically).clip(RoundedCornerShape(99.dp)).background(p.okSoft).padding(horizontal = 12.dp, vertical = 6.dp))
            OutlinedButton(onClick = onRefresh) { Text("Refresh now", color = p.text) }
            androidx.compose.material3.TextButton(onClick = onKeep) { Text("Change", color = p.muted) }
            androidx.compose.material3.TextButton(onClick = onStop) { Text("Stop", color = p.muted) }
        }
    }
}

/** "Keep up to date" (#346): how often, at what time, whether to hear of every update, and what to check. The tap is the consent: no card follows. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KeepSheet(page: PageInfo, from: String, onDismiss: () -> Unit, onKeep: (String, String, String, String) -> Unit) {
    val p = LocalPaper.current
    var every by remember { mutableStateOf(page.keep?.every ?: "day") }
    var time by remember { mutableStateOf(page.keep?.time ?: "07:00") }
    var notify by remember { mutableStateOf(page.keep?.notify ?: "report-only") }
    var check by remember { mutableStateOf(page.keep?.check ?: page.sources) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = p.panel) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Keep \u201c${page.title}\u201d up to date", color = p.text, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
            Text("${from.ifBlank { "The bot" }} rewrites the page on this schedule, from the same sources.", color = p.muted, fontSize = 13.5.sp)
            Text("How often", color = p.muted, fontSize = 12.5.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Pages.EVERY.forEach { (k, label) -> ModeChip(label, every == k) { every = k } } }
            if (every != "hour") {
                Text("At", color = p.muted, fontSize = 12.5.sp)
                BasicTextField(time, { time = it.take(5) }, singleLine = true, textStyle = TextStyle(color = p.text, fontSize = 15.sp), cursorBrush = SolidColor(p.text),
                    modifier = Modifier.width(110.dp).border(1.dp, p.line2, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 9.dp))
            }
            Text("Tell me", color = p.muted, fontSize = 12.5.sp)
            listOf("report-only" to ("Only when something needs me" to "A quiet update otherwise. The page shows when it changed."),
                "always" to ("Every time it's updated" to "A short message with what changed.")).forEach { (k, words) ->
                Row(Modifier.fillMaxWidth().clickable { notify = k }.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
                    androidx.compose.material3.RadioButton(selected = notify == k, onClick = { notify = k })
                    Column(Modifier.padding(top = 10.dp)) {
                        Text(words.first, color = p.text, fontSize = 14.sp)
                        Text(words.second, color = p.faint, fontSize = 12.sp)
                    }
                }
            }
            Text("What to check", color = p.muted, fontSize = 12.5.sp)
            BasicTextField(check, { check = it.take(600) }, textStyle = TextStyle(color = p.text, fontSize = 14.sp), cursorBrush = SolidColor(p.text),
                modifier = Modifier.fillMaxWidth().height(90.dp).border(1.dp, p.line2, RoundedCornerShape(12.dp)).padding(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("Cancel", color = p.text) }
                Button(onClick = { onKeep(every, time, notify, check) }, modifier = Modifier.weight(1.4f),
                    colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Keep it up to date") }
            }
        }
    }
}
