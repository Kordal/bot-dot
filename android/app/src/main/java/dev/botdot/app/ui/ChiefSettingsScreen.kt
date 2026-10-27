package dev.botdot.app.ui

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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
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
import dev.botdot.app.data.AppSettings
import dev.botdot.app.data.Checkup
import dev.botdot.app.data.ChiefGrant
import dev.botdot.app.data.ChiefJob
import dev.botdot.app.data.ChiefJobs
import dev.botdot.app.data.ChiefName
import dev.botdot.app.data.DocumentView
import dev.botdot.app.data.UploadedFiles
import dev.botdot.app.data.WorkspaceFiles
import dev.botdot.app.data.ChiefSkills
import dev.botdot.app.data.PageInfo
import dev.botdot.app.data.PageRef
import dev.botdot.app.data.Pages
import dev.botdot.app.data.Skill
import dev.botdot.app.data.SettingsInfo
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
    var info by remember { mutableStateOf(SettingsInfo()) }
    var edit by remember { mutableStateOf(AppSettings()) }
    LaunchedEffect(api) { runCatching { api?.settings() }.onSuccess { if (it != null) { info = it; edit = it.settings } }.onError { tell(it.message ?: "Couldn't load") } }
    val overview by app.store.chief.value.collectAsState()
    val chats = overview?.chats.orEmpty()
    val canThink = { m: String -> info.models.firstOrNull { it.id == m }?.effort ?: true }
    // The checkup's two switches, only from a server that has it. Each saves at once; the feed says when another
    // app or the Chief changed them.
    val server by app.store.version.value.collectAsState()
    val hasCheckup = Checkup.shows(server?.features)
    var checkup by remember { mutableStateOf<Checkup?>(null) }
    LaunchedEffect(api, hasCheckup) { if (hasCheckup) runCatching { api?.checkup() }.onSuccess { checkup = it }.onError { tell(it.message ?: "Couldn't load") } else checkup = null }
    LaunchedEffect(Unit) { app.feed.events.collect { ev -> Checkup.event(ev)?.let { checkup = it } } }
    // Your library skills for it, ticked as a bot's are, only from a server that keeps them; saved with Save.
    val hasSkills = ChiefSkills.shows(server?.features)
    var library by remember { mutableStateOf<List<Skill>>(emptyList()) }
    LaunchedEffect(api, hasSkills) { if (hasSkills) runCatching { api?.skills() }.onSuccess { if (it != null) library = it.library }.onError { tell(it.message ?: "Couldn't load") } }
    // Its lasting grants, "Always allow" on its cards (#381), of the kinds this server has; asked each time the settings open.
    val grantKinds = ChiefGrant.kinds(server?.features)
    var grants by remember { mutableStateOf<List<ChiefGrant>>(emptyList()) }
    LaunchedEffect(api, grantKinds) { grants = grantKinds.flatMap { k -> runCatching { api?.chiefGrants(k) }.getOrNull().orEmpty() } }
    // Its pages (#384): read again when one of them is saved (the feed's `page`) or the viewer closes (its keeping changed there).
    // Its own jobs (#408): read when the settings open, and from the feed's `chief_jobs` when they change.
    val hasJobs = ChiefJobs.shows(server?.features)
    var jobs by remember { mutableStateOf<List<ChiefJob>?>(null) }
    LaunchedEffect(api, hasJobs) { jobs = if (hasJobs) runCatching { api?.chiefJobs() }.getOrNull() else null }
    LaunchedEffect(hasJobs) { if (hasJobs) app.feed.events.collect { ev -> ChiefJobs.event(ev)?.let { jobs = it } } }
    val hasPages = Pages.showsChief(server?.features)
    val pageSaves by app.store.pageSaves.value.collectAsState()
    var pages by remember { mutableStateOf<List<PageInfo>?>(null) }
    LaunchedEffect(api, hasPages, pageSaves, DocViewer.open == null) { if (hasPages) runCatching { api?.pages(Pages.CHIEF) }.onSuccess { pages = it } else pages = null }
    // Its name, as a bot's is in its settings (#379), only from a server that has names; renamed with Save.
    val hasName = ChiefName.FEATURE in server?.features.orEmpty()
    val chiefName by app.store.chiefName.collectAsState()
    var name by remember(chiefName) { mutableStateOf(ChiefName.field(chiefName)) }
    val renames = hasName && ChiefName.changed(name, chiefName)
    // A refused or failed change puts the switch back and says why.
    fun switch(before: Checkup, field: String, now: Checkup) {
        checkup = now
        scope.launch { runCatching { api!!.setCheckup(field, if (field == "on") now.on else now.webSearch) }.onSuccess { if (it != null) checkup = it }.onError { if (checkup == now) checkup = before; tell(it.message ?: "Couldn't save") } } // not over what the feed said meanwhile
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = { TopAppBar(navigationIcon = { if (LocalPanelClose.current == null) BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg), title = { Text(LocalChiefName.current, style = MaterialTheme.typography.titleMedium) }, actions = { PanelClose() }) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (hasName) Section("Name") {
                OutlinedTextField(name, { name = it.take(ChiefName.MAX) }, singleLine = true, modifier = Modifier.fillMaxWidth(), placeholder = { Text(ChiefName.ROLE) })
            }
            Section("Model and reasoning", "What the Chief uses to plan, create and manage your bots.") {
                Choice("Model", edit.chiefModel, listOf("" to "Same as the default") + info.models.map { it.id to it.label.ifBlank { it.id } }) { edit = edit.copy(chiefModel = it) }
                if (canThink(edit.chiefModel.ifBlank { edit.defaultModel })) Choice("Reasoning", edit.chiefEffort, listOf("" to "Same as the default") + info.efforts.map { it.id to it.label }) { edit = edit.copy(chiefEffort = it) }
            }
            Section("Your rules for it", "Added to its own instructions, for the Chief only.") {
                OutlinedTextField(edit.chiefRules, { edit = edit.copy(chiefRules = it.take(4000)) }, minLines = 3, modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("e.g. Always ask me before creating a bot. Talk to me like a colleague: short and direct.") })
            }
            if (hasSkills) {
                val picked = edit.chiefSkills.orEmpty()
                FoldSection(ChiefSkills.TITLE, picked.sorted().joinToString(", ").ifBlank { "None" }) {
                    Hint(ChiefSkills.HINT)
                    if (library.isEmpty()) Hint(ChiefSkills.EMPTY)
                    // The ones it has come first (as saved, so rows don't jump while you tick them).
                    library.sortedBy { it.name !in info.settings.chiefSkills.orEmpty() }.forEach { k ->
                        val more = k.instructions.take(600) + if (k.instructions.length > 600) "…" else ""
                        key(k.name) { SkillRow(k.name, k.description, more, k.name in picked) { on -> edit = edit.copy(chiefSkills = ChiefSkills.toggle(picked, k.name, on)) } }
                    }
                }
            }
            Button(
                onClick = {
                    scope.launch {
                        // A refused name (a bot's, say) is put back and the server's sentence shown; the rest still saves.
                        if (renames) runCatching { api!!.renameChief(name.trim()) }.onSuccess { name = ChiefName.field(it); tell("Renamed.") }.onError { name = ChiefName.field(chiefName); tell(it.message ?: "Couldn't rename") }
                        if (edit != info.settings) runCatching { api!!.saveSettings(edit) }.onSuccess { info = it; edit = it.settings; tell("Saved. The Chief uses it from its next reply.") }.onError { tell(it.message ?: "Couldn't save") }
                    }
                },
                enabled = edit != info.settings || renames, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText),
            ) { Text("Save") }
            // Revoke takes one off at once; the Chief asks again next time.
            if (grants.isNotEmpty()) FoldSection(ChiefGrant.TITLE, grants.joinToString(", ") { it.label }) {
                Hint(ChiefGrant.HINT)
                grants.forEach { g ->
                    key(g.kind, g.id) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(g.label, color = p.text, style = MaterialTheme.typography.bodyLarge)
                                Text(g.kind.hint, color = p.muted, style = MaterialTheme.typography.bodySmall)
                            }
                            OutlinedButton(onClick = {
                                scope.launch {
                                    runCatching { api!!.revokeChiefGrant(g) }
                                        .onSuccess { grants = grants - g; tell(ChiefGrant.REVOKED) }
                                        .onError { tell(it.message ?: "Couldn't save") }
                                }
                            }) { Text("Revoke", color = p.text) }
                        }
                    }
                }
            }
            // Its own jobs: a switch pauses one, Remove takes it away; they are made by chat.
            jobs?.let { list ->
                FoldSection(ChiefJobs.TITLE, if (list.isEmpty()) ChiefJobs.EMPTY else "${list.size}") {
                    Hint(ChiefJobs.HINT)
                    list.forEach { j ->
                        key(j.id) {
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f).padding(end = 8.dp)) {
                                    Text(j.name, color = p.text, style = MaterialTheme.typography.bodyLarge)
                                    Text(ChiefJobs.line(j), color = p.muted, style = MaterialTheme.typography.bodySmall)
                                    TextButton(onClick = {
                                        scope.launch { runCatching { api!!.removeChiefJob(j.id) }.onSuccess { jobs = jobs.orEmpty().filter { it.id != j.id }; tell("Removed.") }.onError { tell(it.message ?: "Couldn't remove") } }
                                    }, contentPadding = PaddingValues(0.dp)) { Text("Remove", color = p.err) }
                                }
                                Switch(checked = j.on, onCheckedChange = { on ->
                                    scope.launch { runCatching { api!!.setChiefJobOn(j.id, on) }.onSuccess { now -> jobs = jobs.orEmpty().map { if (it.id == now.id) now else it } }.onError { tell(it.message ?: "Couldn't save") } }
                                }, colors = switchColors())
                            }
                        }
                    }
                }
            }
            // Its pages: what it made for you. Tap one to open it, and keep it up to date from there.
            pages?.let { list ->
                val name = LocalChiefName.current
                FoldSection("Pages", if (list.isEmpty()) "None yet" else "${list.size}") {
                    Hint(if (list.isEmpty()) "None yet. Ask $name for a page, a report or an overview." else "Reports, memos and overviews it made for you. Open one to keep it up to date.")
                    list.forEach { pg ->
                        key(pg.slug) {
                            Column(Modifier.fillMaxWidth().clickable { DocViewer.open = DocViewer.page(Pages.CHIEF, PageRef(pg.slug, pg.title), name) }.padding(vertical = 6.dp)) {
                                Text(pg.title, color = p.text, style = MaterialTheme.typography.bodyLarge)
                                Text(Pages.line(pg), color = if (pg.keep != null) p.okText else p.muted, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
            // Its files and workspace (#383), as a bot's: what you attached in its chats, and every file in its folder.
            // In Files (#603), full screen, from a server that has it.
            if (UploadedFiles.chiefShows(server?.features) && dev.botdot.app.data.FilesExplorer.shows(server?.features)) FilesLink(onFiles)
            else if (UploadedFiles.chiefShows(server?.features)) {
                val viewer = DocumentView.shows(server?.features)
                FilesSection(api, UploadedFiles.CHIEF, LocalChiefName.current, viewer,
                    hint = "It sees this list in every reply. A file kept in mind comes with every reply.", empty = "None yet. Attach a file in its chat.", tell = ::tell)
                if (WorkspaceFiles.shows(server?.features)) WorkspaceSection(api, UploadedFiles.CHIEF, LocalChiefName.current, usesComputer = false, viewer = viewer, tell = ::tell, folders = WorkspaceFiles.folders(server?.features))
            }
            checkup?.takeIf { hasCheckup }?.let { c ->
                Section(null) {
                    SwitchRow(Checkup.LABEL, c.caption, c.on) { switch(c, "on", c.copy(on = it)) }
                    SwitchRow(Checkup.WEB_SEARCH, Checkup.WEB_SEARCH_HINT, c.webSearch, enabled = c.webSearchUsable) { switch(c, "webSearch", c.copy(webSearch = it)) }
                }
            }
            Section("Earlier chats") {
                chats.take(15).forEach { c ->
                    Text(c.title, color = p.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().clickable { onChat(c.id) }.padding(vertical = 10.dp))
                }
                if (chats.isEmpty()) Text("No earlier chats", color = p.muted)
            }
        }
    }
}
