package dev.botdot.app.ui

import dev.botdot.app.data.without
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Checkup
import dev.botdot.app.data.ChiefGrant
import dev.botdot.app.data.ChiefJobs
import dev.botdot.app.data.ChiefName
import dev.botdot.app.data.DocumentView
import dev.botdot.app.data.UploadedFiles
import dev.botdot.app.data.WorkspaceFiles
import dev.botdot.app.data.ChiefSettingsDesk
import dev.botdot.app.data.ChiefSettingsState
import dev.botdot.app.data.ChiefSkills
import dev.botdot.app.data.PageRef
import dev.botdot.app.data.Pages
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/** The Chief's settings (its figure and name in its chat): its name, its model and reasoning, your rules for it, your skills for it, what you always approved, its pages, its files and workspace (#383) and its earlier chats. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChiefSettingsScreen(app: BotDotApp, onChat: (String) -> Unit, onFiles: () -> Unit = {}, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    val server by app.store.version.value.collectAsState()
    // What it shows, the save a moment after the last change, and what acts at once are the shared ChiefSettingsDesk's
    // (one copy with the iPhone's).
    // In the app's scope, so a save a moment after the last change outlives the screen; closed when the screen goes
    // (or another botdot makes a new desk), which saves at once what waited.
    val desk = remember(api) { api?.let { ChiefSettingsDesk(app.scope, it, app.store, app.feed.events) } }
    DisposableEffect(desk) { onDispose { desk?.close() } }
    LaunchedEffect(desk) { desk?.load() }
    val st = desk?.state?.collectAsState()?.value ?: ChiefSettingsState()
    LaunchedEffect(st.noticeCount) { st.notice?.takeIf { st.noticeCount > 0 }?.let { snack.showSnackbar(it) } }
    // Its pages are read again when the viewer closes (their keeping changed there).
    LaunchedEffect(DocViewer.open == null) { if (DocViewer.open == null) desk?.pagesAgain() }
    val savedAt = st.savedAt
    val chats = st.chats

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { BotSnackbarHost(snack) },
        topBar = { TopAppBar(navigationIcon = { if (LocalPanelClose.current == null) BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg), title = { Text(LocalChiefName.current, style = MaterialTheme.typography.titleMedium) }, actions = { SavedMark(savedAt); PanelClose() }) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            // The first read failed: nothing to edit (a save would go over its own settings), only Try again.
            if (st.failed) { SecondaryButton(onClick = { scope.launch { desk?.load() } }) { Text(tr("Try again"), color = p.text) }; return@Column }
            st.name?.let { name -> Section(tr("Name")) {
                Field(name, { desk?.setName(it) }, singleLine = true, modifier = Modifier.fillMaxWidth(), placeholder = { Text(ChiefName.role) })
            } }
            // Advanced (ADR 205): without it, the Chief's model is left as it is and not shown.
            val adv by dev.botdot.app.data.Advanced.on.collectAsState()
            if (adv) Section(null) {
                Choice(tr("Model"), st.model, st.models.map { it.id to it.label }) { desk?.setModel(it) }
                if (st.thinks) Choice(tr("Reasoning"), st.effort, st.efforts.map { it.id to it.label }) { desk?.setEffort(it) }
            }
            Section(tr("Your rules for it")) {
                Field(st.rules, { desk?.setRules(it) }, minLines = 3, modifier = Modifier.fillMaxWidth())
            }
            st.skills?.let { library ->
                val picked = st.picked
                FoldSection(ChiefSkills.TITLE, picked.sorted().joinToString(", ").ifBlank { tr("None") }) {
                    if (library.isEmpty()) Hint(ChiefSkills.EMPTY)
                    // The ones it has come first (as saved, so rows don't jump while you tick them).
                    library.forEach { k ->
                        val more = k.instructions.take(600) + if (k.instructions.length > 600) "…" else ""
                        key(k.name) { SkillRow(k.name, k.description, more, k.name in picked) { on -> desk?.setSkill(k.name, on) } }
                    }
                }
            }
            // Revoke takes one off at once; the Chief asks again next time.
            if (st.grants.isNotEmpty()) FoldSection(ChiefGrant.TITLE, st.grants.joinToString(", ") { it.label }) {
                st.grants.forEach { g ->
                    key(g.kind, g.id) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(g.label, color = p.text, style = MaterialTheme.typography.bodyLarge)
                                Text(g.kind.hint, color = p.muted, style = MaterialTheme.typography.bodySmall)
                            }
                            SecondaryButton(onClick = { scope.launch { desk?.revoke(g) } }) { Text(tr("Revoke"), color = p.text) }
                        }
                    }
                }
            }
            // Its own jobs: a switch pauses one, Remove takes it away; they are made by chat.
            st.jobs?.let { list ->
                FoldSection(ChiefJobs.TITLE, if (list.isEmpty()) ChiefJobs.EMPTY else "${list.size}") {
                    list.forEach { j ->
                        key(j.id) {
                            Row(Modifier.fillMaxWidth().padding(vertical = Space.s4), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f).padding(end = Space.s8)) {
                                    Text(j.name, color = p.text, style = MaterialTheme.typography.bodyLarge)
                                    Text(ChiefJobs.line(j), color = p.muted, style = MaterialTheme.typography.bodySmall)
                                    TextButton(onClick = { scope.launch { desk?.removeJob(j.id) } }, contentPadding = PaddingValues(0.dp)) { Text(tr("Remove"), color = p.err) }
                                }
                                Switch(checked = j.on, onCheckedChange = { on -> scope.launch { desk?.setJobOn(j.id, on) } }, colors = switchColors())
                            }
                        }
                    }
                }
            }
            // Its pages: what it made for you. Tap one to open it, and keep it up to date from there.
            st.pages?.let { list ->
                val name = LocalChiefName.current
                FoldSection(tr("Pages"), if (list.isEmpty()) tr("None yet") else "${list.size}") {
                    list.forEach { pg ->
                        key(pg.slug) {
                            Column(Modifier.fillMaxWidth().clickable { DocViewer.open = DocViewer.page(Pages.CHIEF, PageRef(pg.slug, pg.title), name) }.padding(vertical = Space.s8)) {
                                Text(pg.title, color = p.text, style = MaterialTheme.typography.bodyLarge)
                                Text(Pages.line(pg), color = if (pg.keep != null) p.okText else p.muted, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
            // Its files and workspace (#383), as a bot's: what you attached in its chats, and every file in its folder.
            // In Files (#603), full screen, from a server that has it.
            if (dev.botdot.app.data.FilesExplorer.opensFor(UploadedFiles.CHIEF, server?.features)) FilesLink(onFiles)
            else if (UploadedFiles.chiefShows(server?.features)) {
                val viewer = DocumentView.shows(server?.features)
                FilesSection(api, UploadedFiles.CHIEF, LocalChiefName.current, viewer,
                    empty = tr("None yet."), tell = ::tell)
                if (WorkspaceFiles.shows(server?.features)) WorkspaceSection(api, UploadedFiles.CHIEF, LocalChiefName.current, usesComputer = false, viewer = viewer, tell = ::tell, folders = WorkspaceFiles.folders(server?.features))
            }
            st.checkup?.let { c ->
                Section(null) {
                    SwitchRow(Checkup.LABEL, c.caption.ifEmpty { null }, c.on) { on -> scope.launch { desk?.setCheckup("on", on) } }
                    SwitchRow(Checkup.WEB_SEARCH, checked = c.webSearch, enabled = c.webSearchUsable) { on -> scope.launch { desk?.setCheckup("webSearch", on) } }
                }
            }
            Section(tr("Earlier chats")) {
                chats.take(15).forEach { c ->
                    Text(c.title, color = p.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().clickable { onChat(c.id) }.padding(vertical = Space.s12))
                }
                if (chats.isEmpty()) Text(tr("No earlier chats"), color = p.muted)
            }
        }
    }
}
