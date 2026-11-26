package dev.botdot.app.ui

import dev.botdot.app.data.without
import dev.botdot.app.data.exportDocument
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.BotFiles
import dev.botdot.app.data.DocumentView
import dev.botdot.app.data.FileView
import dev.botdot.app.data.KeepDraft
import dev.botdot.app.data.PageInfo
import dev.botdot.app.data.PageRef
import dev.botdot.app.data.InteractivePages
import dev.botdot.app.data.Pages
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.launch

/**
 * The document viewer (#251): a file a bot attached, one of a bot's files, the owner's own file sent to it, or a file
 * a path in its reply names, opened full screen with Back instead of handed to another app. Markdown is drawn by the
 * chat's own [MarkdownText], which shows HTML as the text it is; text and code with line numbers; a CSV as a table.
 * The ⋯ menu holds Copy text, Save to Downloads, Share and Open in another app. Only from a server with
 * `document-viewer` ([DocumentView]); an older one keeps the download.
 */
object DocViewer {
    /** A file to open: [src] its API path (DocumentView), [from] who it is from, [botId] whose computer starts for it.
     *  [text]: a long reply opened as a document (#348, OpenAsDocument), drawn as it is with no [src] to fetch. [page]: a bot's page (#346). */
    data class Request(val src: String, val name: String, val from: String = "", val botId: String? = null, val path: String? = null, val text: String? = null, val page: PageAt? = null)

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
        val of = { path: String, name: String -> DocumentView.ofPath(botId, path, from, name).let { DocViewer.Request(it.src, it.name, it.from, it.botId, it.path) } }
        PathActions(from, open = { path, name -> DocViewer.open = of(path, name) }, menu = { DocViewer.held = of(it, it.substringAfterLast('/')) })
    }
}

/** The viewer and the sheet of a held path, over whatever is on screen (MainActivity). */
@Composable
fun DocumentViewerHost() {
    DocViewer.held?.let { PathSheet(it) }
    val req = DocViewer.open ?: return
    Dialog(onDismissRequest = { DocViewer.open = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        // It slides in from the right as the settings panel does (#496); closed, the dialog goes at once.
        val shown = remember { MutableTransitionState(false).apply { targetState = true } }
        AnimatedVisibility(shown, enter = Motion.panelIn, exit = Motion.panelOut) { ViewerScreen(req, onBack = { DocViewer.open = null }) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PathSheet(req: DocViewer.Request) {
    val p = LocalPaper.current
    val context = LocalContext.current
    ModalBottomSheet(onDismissRequest = { DocViewer.held = null }) {
        Column(Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s16, bottom = Space.s24), verticalArrangement = Arrangement.spacedBy(Space.s16)) {
            Text(req.path.orEmpty(), color = p.text, fontFamily = GeistMono, fontSize = Type.s14)
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                Button(onClick = { DocViewer.held = null; DocViewer.open = req }, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Open")) }
                SecondaryButton(onClick = {
                    context.getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText("botdot", req.path.orEmpty()))
                    DocViewer.held = null
                }, modifier = Modifier.weight(1f)) { Text(tr("Copy path"), color = p.text) }
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
    var exporting by remember(req) { mutableStateOf(false) }
    // An interactive page (#399): the version shown (null: the one the page shows), full screen, its versions' sheet,
    // and the live values handed to its frame.
    var version by remember(req) { mutableStateOf<Int?>(null) }
    val src = version?.let { DocumentView.withQuery(req.src, "version=$it") } ?: req.src
    var siteFull by remember(req) { mutableStateOf(false) }
    var versions by remember(req) { mutableStateOf(false) }
    var values by remember(req) { mutableStateOf<kotlinx.serialization.json.JsonObject?>(null) }
    androidx.activity.compose.BackHandler(enabled = siteFull) { siteFull = false }
    val server by app.store.version.value.collectAsState()
    val tell = { t: String -> android.widget.Toast.makeText(context, t, android.widget.Toast.LENGTH_LONG).show() }
    LaunchedEffect(req, api, tries, version) {
        view = null; error = null
        // A reply opened as a document: its text is here already.
        if (req.text != null) { view = FileView(name = req.name, kind = "markdown", text = req.text); mode = "rendered"; return@LaunchedEffect }
        val a = api ?: return@LaunchedEffect
        runCatching { a.viewFile(src) }
            .onSuccess { v -> view = v; values = v.interactive?.values; mode = DocumentView.modeFor(v, req.name, server?.features) }
            .onFailure { error = it }
    }
    // A page (#346) is read again when its bot saves it (the feed's `page`) or its job changes, as it is shown now.
    val saves by app.store.pageSaves.value.collectAsState()
    var changed by remember(req) { mutableIntStateOf(0) }
    val saved = req.page?.let { saves["${it.botId}/${it.slug}"] }
    LaunchedEffect(saved, changed) {
        if (req.page == null || (saved == null && changed == 0) || view == null) return@LaunchedEffect
        // An interactive page with a new version shows the page as it is now.
        if (view?.interactive != null && version != null) { version = null; return@LaunchedEffect }
        api?.let { a -> runCatching { a.viewFile(src) }.onSuccess { view = it; values = it.interactive?.values } }
    }
    // A page's blocks (#395) are filled in anew when a tile they read has a new value (the feed's `dashboard`; no id:
    // the Board changed), and each minute while it is open, which reads its tiles that are due.
    val tick by app.store.tileTicks.value.collectAsState()
    suspend fun reblock() {
        val v = view ?: return
        if (v.interactive != null) {
            if (v.interactive!!.tiles.isNotEmpty()) api?.let { a -> runCatching { a.pageValues(src) }.onSuccess { r -> if (view === v) values = r.values } }
            return
        }
        if (v.parts == null || v.tiles.isEmpty()) return
        api?.let { a -> runCatching { a.pageBlocks(req.src) }.onSuccess { r -> if (view === v) view = v.copy(parts = r.parts, tiles = r.tiles, plain = r.plain ?: v.plain) } }
    }
    LaunchedEffect(tick) {
        val (id, n) = tick
        val reads = view?.interactive?.tiles ?: view?.tiles
        if (n == 0L || !dev.botdot.app.data.PageReblock.reads(reads, id)) return@LaunchedEffect
        kotlinx.coroutines.delay(dev.botdot.app.data.PageReblock.SETTLE_MS)
        reblock()
    }
    val readsTiles = (view?.interactive?.tiles ?: view?.tiles)?.isNotEmpty() == true
    LaunchedEffect(req, readsTiles) {
        while ((view?.interactive?.tiles ?: view?.tiles)?.isNotEmpty() == true) { kotlinx.coroutines.delay(dev.botdot.app.data.PageReblock.EVERY_MS); reblock() }
    }
    // Its download is a zip of the version shown, named as the server names it.
    val fileName = view?.interactive?.let { view?.name } ?: req.name
    var keeping by remember(req) { mutableStateOf(false) }
    // What was entered in "Keep up to date", opened again after a save that failed (#475).
    var keepDraft by remember(req) { mutableStateOf<KeepDraft?>(null) }
    // A page's bar (#346, #451, #475): Board, Keep up to date, Refresh now, Stop and the line under it are the
    // shared PageDesk's (one copy with the iPhone's).
    val pageDesk = remember(req, api) { val a = api; val pg = req.page; if (a != null && pg != null) dev.botdot.app.data.PageDesk(scope, a, pg.botId, pg.slug, req.from, server?.features) else null }
    val bar = pageDesk?.state?.collectAsState()?.value
    // The features may come after the desk was made (a cold start, a reconnect): Board follows them.
    LaunchedEffect(pageDesk, server?.features) { pageDesk?.setFeatures(server?.features) }
    LaunchedEffect(bar?.reopen) { val desk = pageDesk; val draft = bar?.reopen; if (desk != null && draft != null) { keepDraft = draft; keeping = true; desk.reopened() } }
    // A save or Stop changed what keeps the page: read it again (Refresh now changes nothing here).
    LaunchedEffect(bar?.pageChanged) { if ((bar?.pageChanged ?: 0) > 0) changed++ }
    // The ⋯ menu's actions, with the file fetched as it is (not only its start).
    fun withApi(what: String, act: suspend (dev.botdot.app.data.Api) -> Unit) {
        menu = false
        val a = api ?: return tell(tr("Not connected to botdot"))
        scope.launch { runCatching { act(a) }.onError { tell(it.message ?: tr("Couldn't {what}", "what" to what)) } }
    }
    Column(Modifier.fillMaxSize().background(p.bg).systemBarsPadding()) {
        if (!siteFull) Row(Modifier.fillMaxWidth().padding(start = Space.s4, end = Space.s4, top = Space.s8, bottom = Space.s8), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("Back"), tint = p.text) }
            Column(Modifier.weight(1f)) {
                Text(req.name, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s16, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val sub = if (req.text != null) listOfNotNull(req.from.ifBlank { null }, trn(dev.botdot.app.data.DocumentExport.words(req.text), "{n} word", "{n} words")).joinToString(" · ")
                    else if (req.page != null) Pages.subtitle(req.from, view?.page)
                    else DocumentView.subtitle(req.from, view, shortTime(view?.at))
                if (sub.isNotEmpty()) Text(sub, color = p.muted, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = tr("More"), tint = p.text) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    // A page with blocks copies what it shows, its blocks as text and tables; its Source, the Markdown.
                    (if (mode == "rendered") view?.plain ?: view?.text else view?.text)?.let { text ->
                        DropdownMenuItem(text = { Text(tr("Copy text"), color = p.text) }, onClick = {
                            menu = false
                            context.getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText(req.name, text))
                        })
                    }
                    if (view?.kind == "markdown" && dev.botdot.app.data.DocumentExport.shows(server?.features)) {
                        DropdownMenuItem(text = { Text(tr("Export…"), color = p.text) }, onClick = { menu = false; exporting = true })
                    }
                    if (req.text == null && view?.downloadable != false) {
                        DropdownMenuItem(text = { Text(tr("Save to Downloads"), color = p.text) }, onClick = { withApi(tr("save it")) { BotFiles.saveToDownloads(context, it, src, fileName); tell(tr("Saving {name} to Downloads", "name" to fileName)) } })
                        DropdownMenuItem(text = { Text(tr("Share…"), color = p.text) }, onClick = { withApi(tr("share it")) { BotFiles.share(context, it, src, fileName) } })
                        DropdownMenuItem(text = { Text(tr("Open in another app"), color = p.text) }, onClick = { withApi(tr("open it")) { BotFiles.openElsewhere(context, it, src, fileName) } })
                    }
                }
            }
        }
        val v = view
        val e = error
        val page = v?.page
        val site = v?.interactive
        val download = { withApi(tr("save it")) { BotFiles.saveToDownloads(context, it, src, fileName); tell(tr("Saving {name} to Downloads", "name" to fileName)) } }
        // On the Board or off it (#451): the button flips at once, and back if the server says no (#475).
        LaunchedEffect(pageDesk, page) { pageDesk?.show(page) }
        val onBoard = bar?.onBoard
        val board: (() -> Unit)? = if (pageDesk != null && bar?.board == true) { { pageDesk.toggleBoard() } } else null
        if (req.page != null && site != null) {
            if (board != null) Row(Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s4)) { BoardButton(onBoard == true, board) }
            InteractiveBar(site, siteFull, onFull = { siteFull = true }, onVersions = { versions = true }, onDownload = download,
                onRollBack = { withApi(tr("go back to it")) { it.setPageVersion(req.page.botId, req.page.slug, site.shown); tell(InteractivePages.shownAgain(site.shown)); version = null; tries++ } },
                onCurrent = { version = null })
            if (versions) VersionsSheet(req.name, site, onShow = { n -> versions = false; version = if (n == site.current) null else n },
                onCurrent = { n -> versions = false; withApi(tr("go back to it")) { it.setPageVersion(req.page.botId, req.page.slug, n); tell(InteractivePages.shownAgain(n)); version = null; tries++ } },
                onDismiss = { versions = false })
        }
        if (req.page != null && page != null && site == null) {
            PageBar(page, if (bar?.shown == true) bar.keep else page.keep, onBoard == true, board, busy = bar?.busy == true,
                onKeep = { if (pageDesk == null) tell(tr("Not connected to botdot")) else if (bar?.busy != true) { keepDraft = pageDesk.draft(); keeping = true } },
                onRefresh = { pageDesk?.refresh() ?: tell(tr("Not connected to botdot")) }, onStop = { pageDesk?.stop() ?: tell(tr("Not connected to botdot")) })
        }
        val desk = pageDesk
        val w = bar?.work
        if (req.page != null && desk != null && w != null) WorkLine(Work(w.kind, w.text, retry = { desk.retry() }), Modifier.padding(horizontal = Space.s16, vertical = Space.s4)) { desk.dismissWork() }
        // The sheet closes at once and the save runs on (#475); its error opens the sheet again with what was entered.
        if (keeping && req.page != null && page != null) KeepSheet(page, req.from, keepDraft, onDismiss = { keeping = false }) { draft ->
            keeping = false
            pageDesk?.keep(draft)
        }
        if (exporting && v?.text != null) ExportSheet(req.name, v.plain ?: v.text!!) { exporting = false }
        val noPreview: @Composable () -> Unit = { ViewerState(tr("No preview for this kind of file"), tr("The app shows Markdown, text, code, CSV and pictures. Open this one on your phone.")) {
            Button(onClick = { withApi(tr("save it")) { BotFiles.saveToDownloads(context, it, req.src, req.name); tell(tr("Saving {name} to Downloads", "name" to req.name)) } },
                colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Save to Downloads")) }
            SecondaryButton(onClick = { withApi(tr("open it")) { BotFiles.openElsewhere(context, it, req.src, req.name) } }) { Text(tr("Open in another app"), color = p.text) }
        } }
        // What the body shows is the shared layer's (DocumentView.pane), as on the iPhone.
        when (DocumentView.pane(v, e, req.page != null)) {
            DocumentView.Pane.NOT_FOUND -> ViewerState(tr("File not found"), tr("Nothing is at this path. It may not be made yet, or it was moved or deleted.")) { SecondaryButton(onClick = onBack) { Text(tr("Back to the chat"), color = p.text) } }
            DocumentView.Pane.COMPUTER_OFF -> ViewerState(tr("The computer is off"), tr("This file is on the account's computer, which is stopped. Start it to open the file.")) {
                req.botId?.let { botId ->
                    Button(onClick = { withApi(tr("start it")) { it.startComputer(botId); tries++ } }, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Start the computer")) }
                }
                SecondaryButton(onClick = onBack) { Text(tr("Not now"), color = p.text) }
            }
            DocumentView.Pane.FAILED -> ViewerState(tr("Couldn't open it"), e?.message.orEmpty()) { SecondaryButton(onClick = onBack) { Text(tr("Back to the chat"), color = p.text) } }
            DocumentView.Pane.LOADING -> Column(Modifier.padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
                listOf(0.6f, 0.92f, 0.84f, 0.7f, 0.88f).forEach { w -> Box(Modifier.fillMaxWidth(w).height(12.dp).clip(Radius.small).background(p.sunk)) }
            }
            DocumentView.Pane.TOO_LARGE -> ViewerState(tr("Too large to bring out of the computer"), tr("Files on the computer open here up to 1 MB. Ask the bot to put it in its folder or to make it smaller.")) {
                SecondaryButton(onClick = onBack) { Text(tr("Back to the chat"), color = p.text) }
            }
            DocumentView.Pane.INTERACTIVE -> InteractiveFrame(site!!, values, onDownload = download)
            DocumentView.Pane.PDF -> PdfPages(req.src, req.name, noPreview)
            DocumentView.Pane.NO_PREVIEW -> noPreview()
            DocumentView.Pane.IMAGE -> Box(Modifier.fillMaxSize().padding(Space.s12), contentAlignment = Alignment.Center) {
                api?.let { AsyncImage(it.url(req.src), contentDescription = req.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) }
            }
            DocumentView.Pane.TEXT -> Column(Modifier.fillMaxSize()) {
                v!!
                val modes = DocumentView.modes(v, req.name, server?.features)
                val htmlFrame = DocumentView.htmlFrame(v, req.name, server?.features)
                if (modes.isNotEmpty()) Row(Modifier.padding(horizontal = Space.s16, vertical = Space.s4), horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                    modes.forEach { (m, label) ->
                        ModeChip(label, mode == m) {
                            mode = m
                            // Rendered again after its address ran out: read anew, which signs another.
                            if (m == "rendered" && htmlFrame != null && DocumentView.frameStale(v, kotlin.time.Clock.System.now())) tries++
                        }
                    }
                    if (htmlFrame != null && mode == "rendered") Text(tr("Only what is in this file loads"), color = p.faint, fontSize = Type.s12, modifier = Modifier.align(Alignment.CenterVertically))
                }
                if (v.truncated) Text(tr("Too large to show whole. Showing its start (up to 1 MB or 1,000 lines).") + if (v.downloadable) " " + tr("Save it to see everything.") else "",
                    color = p.text, fontSize = Type.s14, modifier = Modifier.padding(horizontal = Space.s16, vertical = Space.s8).fillMaxWidth()
                        .border(1.dp, p.warnLine, Radius.card).background(p.warnSoft, Radius.card).padding(Space.s12))
                val text = v.text.orEmpty()
                when {
                    // An HTML file rendered: scripts on, in the sandbox's WebView and nothing more (ADR 281).
                    htmlFrame != null && mode == "rendered" -> HtmlFrame(htmlFrame)
                    v.kind == "markdown" && mode == "rendered" -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = Space.s16, vertical = Space.s12)) {
                        if (v.parts != null) PageParts(v.parts!!) else MarkdownText(text, onWeb = null, paths = null)
                        Spacer(Modifier.height(Space.s32))
                    }
                    v.kind == "csv" && mode == "table" -> CsvTable(text, DocumentView.sepOf(req.name))
                    else -> Lines(text)
                }
            }
        }
    }
}

/** The Export sheet of a Markdown document (#348): Word, PDF or Markdown made by the server and saved to Downloads,
 *  or the PDF to the phone's share sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ExportSheet(title: String, text: String, onDone: () -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val app = BotDotApp.of(context)
    val api by app.api.collectAsState()
    val tell = { t: String -> android.widget.Toast.makeText(context, t, android.widget.Toast.LENGTH_LONG).show() }
    val server by app.store.version.value.collectAsState()
    // Google Docs as the server says when the sheet opens, and the tap: the shared GoogleDocs (both phones).
    val docs = remember(api) { api?.let { dev.botdot.app.data.GoogleDocs(it) } }
    var docsLabel by remember { mutableStateOf("") }
    LaunchedEffect(docs) { if (docs != null && dev.botdot.app.data.DocumentExport.savesToGoogleDocs(server?.features)) { docs.read(); docsLabel = docs.label } }
    // The work outlives the sheet, which closes on the tap: in the app's scope, not the sheet's.
    fun make(what: String, act: suspend (java.io.File) -> Unit, format: String) {
        onDone()
        val a = api ?: return tell(tr("Not connected to botdot"))
        tell(tr("Making the file…"))
        app.scope.launch {
            runCatching { act(a.exportDocument(title, text, format, java.io.File(context.cacheDir, "botfiles/exports"))) }.onError { tell(it.message ?: tr("Couldn't {what}", "what" to what)) }
        }
    }
    ModalBottomSheet(onDismissRequest = onDone) {
        Column(Modifier.fillMaxWidth().padding(start = Space.s12, end = Space.s12, bottom = Space.s24)) {
            Text("DOWNLOAD", color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(horizontal = Space.s12, vertical = Space.s8))
            dev.botdot.app.data.DocumentExport.FORMATS.forEach { (format, label, ext) ->
                SheetRow(label, ext) { make(tr("save it"), { f -> BotFiles.saveToDownloads(context, f); tell(tr("Saved {name} to Downloads", "name" to f.name)) }, format) }
            }
            Box(Modifier.padding(vertical = Space.s8).fillMaxWidth().height(1.dp).background(p.line))
            if (dev.botdot.app.data.DocumentExport.savesToGoogleDocs(server?.features)) {
                Text(tr("SAVE TO"), color = p.faint, fontSize = Type.s12, modifier = Modifier.padding(horizontal = Space.s12, vertical = Space.s8))
                // Not connected: the tap connects Google Docs (the Connectors page's own path) with the sign-in in the
                // browser (#378); without connected apps on this server it says so.
                SheetRow("Google Docs", docsLabel) {
                    onDone()
                    val d = docs ?: return@SheetRow tell(tr("Not connected to botdot"))
                    app.scope.launch {
                        val done = d.tap(title, text) { tell(it) }
                        tell(done.say)
                        done.open?.let { url -> runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) } }
                    }
                }
                Box(Modifier.padding(vertical = Space.s8).fillMaxWidth().height(1.dp).background(p.line))
            }
            SheetRow(tr("Share…"), "PDF") { make(tr("share it"), { f -> BotFiles.shareFile(context, f) }, "pdf") }
        }
    }
}

@Composable
private fun SheetRow(label: String, end: String, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().clip(Radius.small).clickable(onClick = onClick).padding(horizontal = Space.s12, vertical = Space.s12), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = p.text, fontSize = Type.s16, modifier = Modifier.weight(1f))
        Text(end, color = p.faint, fontSize = Type.s12)
    }
}

@Composable
private fun ModeChip(label: String, on: Boolean, onClick: () -> Unit) {
    val p = LocalPaper.current
    Text(label, color = if (on) p.inkText else p.text, fontSize = Type.s14,
        modifier = Modifier.clip(Radius.pill).background(if (on) p.ink else p.raise2)
            .clickable(onClick = onClick).padding(horizontal = Space.s16, vertical = Space.s8))
}

@Composable
internal fun ViewerState(title: String, text: String, actions: @Composable () -> Unit) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth().padding(horizontal = Space.s24, vertical = Space.s48), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Text(title, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s16)
        if (text.isNotBlank()) Text(text, color = p.muted, fontSize = Type.s14, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s12)) { actions() }
    }
}

/** Text and code: monospace, each line with its number. */
@Composable
private fun Lines(text: String) {
    val p = LocalPaper.current
    val lines = remember(text) { text.removeSuffix("\n").split("\n") }
    val width = (lines.size.toString().length * 9 + 12).dp
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = Space.s12)) {
        items(lines.size) { i ->
            Row {
                Text("${i + 1}", color = p.faint, fontFamily = GeistMono, fontSize = Type.s12, modifier = Modifier.width(width).padding(top = 1.dp, end = Space.s8),
                    textAlign = androidx.compose.ui.text.style.TextAlign.End)
                Text(lines[i], color = p.text, fontFamily = GeistMono, fontSize = Type.s12, lineHeight = Type.line20)
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
        Row(Modifier.padding(horizontal = Space.s16, vertical = Space.s8), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
            BasicTextField(find, { find = it }, singleLine = true, textStyle = TextStyle(color = p.text, fontSize = Type.s14), cursorBrush = SolidColor(p.text),
                modifier = Modifier.weight(1f).background(p.raise2, Radius.pill).padding(horizontal = Space.s16, vertical = Space.s8),
                decorationBox = { inner -> if (find.isEmpty()) Text(tr("Find in table"), color = p.faint, fontSize = Type.s14); inner() })
            Text(trn(t.total, "{n} row", "{n} rows") + " · " + trn(t.cols, "{n} column", "{n} columns"), color = p.muted, fontSize = Type.s12)
        }
        val cell = Modifier.width(140.dp).padding(horizontal = Space.s8, vertical = Space.s8)
        Column(Modifier.fillMaxSize().horizontalScroll(rememberScrollState()).verticalScroll(rememberScrollState()).padding(horizontal = Space.s8)) {
            Row {
                Text("", modifier = Modifier.width(44.dp))
                for (c in 0 until t.cols) {
                    val arrow = when { sort?.first != c -> ""; sort?.second == true -> " ▲"; else -> " ▼" }
                    Text(t.head.getOrNull(c).orEmpty() + arrow, color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s14, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = cell.clickable { sort = when { sort?.first != c -> c to true; sort?.second == true -> c to false; else -> null } })
                }
            }
            Box(Modifier.height(1.dp).width((44 + 140 * t.cols).dp).background(p.line2))
            t.rows.forEach { (n, cells) ->
                Row {
                    Text("$n", color = p.faint, fontFamily = GeistMono, fontSize = Type.s12, textAlign = androidx.compose.ui.text.style.TextAlign.End, modifier = Modifier.width(44.dp).padding(end = Space.s8, top = Space.s8))
                    for (c in 0 until t.cols) Text(cells.getOrNull(c).orEmpty(), color = p.text, fontSize = Type.s14, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = cell)
                }
            }
            if (t.rows.isEmpty()) Text(tr("Nothing found."), color = p.muted, fontSize = Type.s14, modifier = Modifier.padding(Space.s12))
        }
    }
}

/** A page's bar (#346): what keeps it up to date, with Refresh now, Change and Stop, or the button that does. */
@Composable
private fun PageBar(page: PageInfo, keep: dev.botdot.app.data.PageKeep?, onBoard: Boolean, board: (() -> Unit)?, busy: Boolean, onKeep: () -> Unit, onRefresh: () -> Unit, onStop: () -> Unit) {
    val p = LocalPaper.current
    androidx.compose.foundation.layout.FlowRow(Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s8),
        horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        // While an action is on its way the others wait (PageBarState.busy): a second one would be dropped.
        if (keep == null) SecondaryButton(onClick = onKeep, enabled = !busy) { Text(tr("Keep up to date"), color = p.text) }
        else {
            Text("↻ " + tr("Keeps up to date") + " · ${keep.`when`}", color = p.okText, fontSize = Type.s12,
                modifier = Modifier.align(Alignment.CenterVertically).clip(Radius.pill).background(p.okSoft).padding(horizontal = Space.s12, vertical = Space.s8))
            SecondaryButton(onClick = onRefresh, enabled = !busy) { Text(tr("Refresh now"), color = p.text) }
            androidx.compose.material3.TextButton(onClick = onKeep, enabled = !busy) { Text(tr("Change"), color = p.muted) }
            androidx.compose.material3.TextButton(onClick = onStop, enabled = !busy) { Text(tr("Stop"), color = p.muted) }
        }
        if (board != null) BoardButton(onBoard, board)
    }
}

/** "Board" puts the page on the Board; "On Board", filled, takes it off (#451). */
@Composable
private fun BoardButton(on: Boolean, onClick: () -> Unit) {
    val p = LocalPaper.current
    val label = if (on) tr("On Board") else tr("Board")
    if (on) androidx.compose.material3.Button(onClick = onClick, colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = p.text, contentColor = p.bg)) {
        androidx.compose.material3.Icon(Icons.Outlined.GridView, contentDescription = null, modifier = Modifier.size(16.dp)); Spacer(Modifier.size(6.dp)); Text(label)
    } else SecondaryButton(onClick = onClick) {
        androidx.compose.material3.Icon(Icons.Outlined.GridView, contentDescription = null, tint = p.text, modifier = Modifier.size(16.dp)); Spacer(Modifier.size(6.dp)); Text(label, color = p.text)
    }
}

/** "Keep up to date" (#346): how often, at what time, whether to hear of every update, and what to check. The tap is the consent: no card follows. [draft]: what was entered before a save that failed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KeepSheet(page: PageInfo, from: String, draft: KeepDraft?, onDismiss: () -> Unit, onKeep: (KeepDraft) -> Unit) {
    val p = LocalPaper.current
    val start = draft ?: KeepDraft.of(page)
    var every by remember { mutableStateOf(start.every) }
    var time by remember { mutableStateOf(start.time) }
    var notify by remember { mutableStateOf(start.notify) }
    var check by remember { mutableStateOf(start.check) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = Space.s16, end = Space.s16, bottom = Space.s24), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            Text(tr("Keep “{title}” up to date", "title" to page.title), color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s16)
            Text(tr("{name} rewrites the page on this schedule, from the same sources.", "name" to from.ifBlank { tr("The bot") }), color = p.muted, fontSize = Type.s14)
            Text(tr("How often"), color = p.muted, fontSize = Type.s12)
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) { Pages.EVERY.forEach { (k, label) -> ModeChip(label, every == k) { every = k } } }
            if (every != "hour") {
                Text(tr("At"), color = p.muted, fontSize = Type.s12)
                BasicTextField(time, { time = it.take(5) }, singleLine = true, textStyle = TextStyle(color = p.text, fontSize = Type.s16), cursorBrush = SolidColor(p.text),
                    modifier = Modifier.width(110.dp).background(p.raise2, Radius.card).padding(horizontal = Space.s12, vertical = Space.s8))
            }
            Text(tr("Tell me"), color = p.muted, fontSize = Type.s12)
            listOf("report-only" to (tr("Only when something needs me") to tr("A quiet update otherwise. The page shows when it changed.")),
                "always" to (tr("Every time it's updated") to tr("A short message with what changed."))).forEach { (k, words) ->
                Row(Modifier.fillMaxWidth().clickable { notify = k }.padding(vertical = Space.s4), verticalAlignment = Alignment.Top) {
                    androidx.compose.material3.RadioButton(selected = notify == k, onClick = { notify = k })
                    Column(Modifier.padding(top = Space.s12)) {
                        Text(words.first, color = p.text, fontSize = Type.s14)
                        Text(words.second, color = p.faint, fontSize = Type.s12)
                    }
                }
            }
            Text(tr("What to check"), color = p.muted, fontSize = Type.s12)
            BasicTextField(check, { check = it.take(600) }, textStyle = TextStyle(color = p.text, fontSize = Type.s14), cursorBrush = SolidColor(p.text),
                modifier = Modifier.fillMaxWidth().height(90.dp).background(p.raise2, Radius.card).padding(Space.s12))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                SecondaryButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text(tr("Cancel"), color = p.text) }
                Button(onClick = { onKeep(KeepDraft(every, time, notify, check)) }, modifier = Modifier.weight(1.4f),
                    colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Keep it up to date")) }
            }
        }
    }
}
