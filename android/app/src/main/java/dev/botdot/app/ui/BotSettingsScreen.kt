package dev.botdot.app.ui

import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import kotlinx.coroutines.delay
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Connection
import dev.botdot.app.data.Job
import dev.botdot.app.data.SettingsInfo
import dev.botdot.app.data.Skill
import dev.botdot.app.data.UploadedFiles
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A bot's settings: who it is and its main assignment, then its computer, jobs, skills, apps and teammates. Model and the finer points are under Advanced.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BotSettingsScreen(app: BotDotApp, botId: String, focusSkill: String? = null, onScreen: () -> Unit, onJobs: () -> Unit, onDeleted: () -> Unit, onCopied: (String) -> Unit = {}, onFiles: () -> Unit = {}, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    // Duplicate runs on after the tap, with a line that says how it goes (#478).
    val work = rememberWork()

    var bot by remember { mutableStateOf<Bot?>(null) }
    var choices by remember { mutableStateOf(SettingsInfo()) }
    var library by remember { mutableStateOf<List<Skill>>(emptyList()) }
    var apps by remember { mutableStateOf<List<Connection>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var askDelete by remember { mutableStateOf(false) }
    val server by app.store.version.value.collectAsState() // its features: whether it can duplicate a bot
    var copyPlan by remember { mutableStateOf<dev.botdot.app.data.CopyPlan?>(null) } // the Duplicate confirmation, while it is open
    var copyName by remember { mutableStateOf("") }
    var pages by remember { mutableStateOf<List<dev.botdot.app.data.PageInfo>?>(null) } // its pages (#346), once loaded
    val context = androidx.compose.ui.platform.LocalContext.current

    // What you're editing (starts as the bot's current settings).
    var color by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var group by remember { mutableStateOf("") }
    var pinned by remember { mutableStateOf(false) }
    var task by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var effort by remember { mutableStateOf("") }
    var computer by remember { mutableStateOf(false) }
    var computerOn by remember { mutableStateOf("linux") } // where its computer is: this machine, or boat.dev (ADR 088)
    var moveFiles by remember { mutableStateOf(false) } // "Copy files" for its new computer (#556)
    var askMove by remember { mutableStateOf<String?>(null) } // the computer a switch asks about first
    val botsNow by app.store.bots.value.collectAsState()
    var useSkills by remember { mutableStateOf(true) }
    var skills by remember { mutableStateOf(setOf<String>()) }
    var sysSkills by remember { mutableStateOf(listOf<Pair<dev.botdot.app.data.BuiltinSkill, String>>()) } // every bot has these unless switched off
    var disabled by remember { mutableStateOf(setOf<String>()) }
    var connectors by remember { mutableStateOf(setOf<String>()) }
    var mayMessage by remember { mutableStateOf(setOf<String>()) }
    var othersMayAsk by remember { mutableStateOf(true) }
    var rooms by remember { mutableStateOf(dev.botdot.app.data.BotRooms()) } // shared rooms (#316), when the server keeps them
    var hotkey by remember { mutableStateOf(0) }
    var others by remember { mutableStateOf<List<Bot>>(emptyList()) }

    fun fill(b: Bot) {
        bot = b; color = b.color.orEmpty(); name = b.name; description = b.description; group = b.group; pinned = b.pinned > 0; task = b.prompt
        model = b.model.orEmpty(); effort = b.effort.orEmpty(); computer = b.computer == "linux" || b.computer == "boat"; computerOn = if (b.computer == "boat") "boat" else "linux"
        useSkills = b.useSkills; skills = b.skills.toSet(); disabled = b.disabledSkills.toSet(); connectors = b.connectors.toSet(); mayMessage = if (b.mayMessageAll) others.map { it.id }.toSet() else b.mayMessage.toSet()
        othersMayAsk = b.othersMayAsk != false
        rooms = b.rooms ?: dev.botdot.app.data.BotRooms()
        hotkey = b.hotkey ?: 0
    }

    LaunchedEffect(api) {
        val a = api ?: return@LaunchedEffect
        // All at once: over Tailscale, one after another would take a round trip each.
        coroutineScope {
            launch { runCatching { app.store.bots.value.value ?: a.bots() }.onSuccess { all -> others = all.filter { it.id != botId }; all.firstOrNull { it.id == botId }?.let(::fill) }.onError { tell(it.message ?: tr("Couldn't load")) } }
            launch { runCatching { a.settings() }.onSuccess { choices = it } }
            launch { runCatching { a.skills() }.onSuccess { library = it.library; sysSkills = it.machine.map { k -> k to "machine" } + it.builtin.map { k -> k to "builtin" } } }
            launch { runCatching { a.connectors() }.onSuccess { apps = it.connections.distinctBy { c -> c.toolkit } } }
        }
    }

    val keepsFiles = UploadedFiles.shows(server?.features)
    // Its pages (#346): read again when one of them is saved (the feed's `page`) or the viewer closes (a job changed there).
    val hasPages = dev.botdot.app.data.Pages.shows(server?.features)
    val pageSaves by app.store.pageSaves.value.collectAsState()
    LaunchedEffect(api, hasPages, pageSaves, DocViewer.open == null) {
        val a = api ?: return@LaunchedEffect
        if (hasPages) runCatching { a.pages(botId) }.onSuccess { pages = it }
    }

    // What differs from the bot as botdot has it: what a save sends.
    fun changes(b: Bot) = buildJsonObject {
            if (color != b.color.orEmpty()) put("color", color)
            if (name != b.name) put("name", name)
            if (description != b.description) put("description", description)
            if (group != b.group) put("group", group)
            if (pinned != (b.pinned > 0)) put("pinned", pinned) // pinning puts it last; drag it on the home screen to move it
            if (task != b.prompt) put("prompt", task)
            if (model != b.model.orEmpty()) put("model", model)
            if (effort != b.effort.orEmpty()) put("effort", effort)
            val nextComputer = if (computer) computerOn else "none"
            if (nextComputer != b.computer) put("computer", nextComputer)
            if (nextComputer != b.computer && moveFiles) put("moveFiles", true)
            if (useSkills != b.useSkills) put("useSkills", useSkills)
            if (skills != b.skills.toSet()) put("skills", JsonArray(skills.map { JsonPrimitive(it) }))
            if (disabled != b.disabledSkills.toSet()) put("disabledSkills", JsonArray(disabled.map { JsonPrimitive(it) }))
            if (connectors != b.connectors.toSet()) put("connectors", JsonArray(connectors.map { JsonPrimitive(it) }))
            val everyone = others.all { it.id in mayMessage }
            if (everyone != b.mayMessageAll) put("mayMessageAll", everyone)
            if (!everyone && (b.mayMessageAll || mayMessage != b.mayMessage.toSet())) put("mayMessage", JsonArray(mayMessage.map { JsonPrimitive(it) }))
            if (b.othersMayAsk != null && othersMayAsk != b.othersMayAsk) put("othersMayAsk", othersMayAsk)
            b.rooms?.let { was -> dev.botdot.app.data.BotRooms.change(was, rooms)?.let { put("rooms", it) } }
            if (b.hotkey != null && hotkey != b.hotkey) put("hotkey", hotkey)
        }
    // Saved by itself (#636), a moment after the last change, and "Saved" says so at the top; its next run uses it.
    // Changed again while it saved: what is typed stays, and the next save sends it. Else botdot's answer is shown as
    // it keeps it (a name it trimmed), so a field it changed is not sent again and again.
    // A change botdot refused is said once and not sent again until it is changed.
    var savedAt by remember { mutableStateOf(0) }
    var refused by remember { mutableStateOf<kotlinx.serialization.json.JsonObject?>(null) }
    fun save() = scope.launch {
        val b = bot ?: return@launch
        val sent = changes(b)
        if (sent.isEmpty() || saving) return@launch
        saving = true
        runCatching { api!!.updateBot(botId, sent) }.onSuccess { if (changes(b) == sent) fill(it) else bot = it; moveFiles = false; savedAt++ }.onError { refused = sent; tell(it.message ?: tr("Couldn't save")) }
        saving = false
    }
    LaunchedEffect(color, name, description, group, pinned, task, model, effort, computer, computerOn, useSkills, skills, disabled, connectors, mayMessage, othersMayAsk, rooms, hotkey, saving) {
        val b = bot ?: return@LaunchedEffect
        val now = changes(b)
        if (name.isBlank() || now.isEmpty() || now == refused) return@LaunchedEffect
        delay(800)
        save()
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = { work.now?.let { w -> Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(Space.s12), contentAlignment = Alignment.Center) { WorkLine(w) { work.now = null } } } },
        topBar = {
            // Beside the chat the panel has its close button; covering the chat, Back.
            TopAppBar(navigationIcon = { if (LocalPanelClose.current == null) BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(bot?.name ?: "", style = MaterialTheme.typography.titleMedium) },
                actions = { SavedMark(savedAt); PanelClose() })
        },
    ) { pad ->
        val b = bot ?: return@Scaffold
        Column(Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            Section(tr("Who it is")) {
                Field(name, { name = it.take(60) }, label = { Text(tr("Name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                ColorPicker(color) { color = it }
                Field(description, { description = it }, label = { Text(tr("What it does")) }, modifier = Modifier.fillMaxWidth())
                Field(group, { group = it.take(40) }, label = { Text(tr("Category")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            Section(tr("Its main assignment")) {
                Field(task, { task = it }, minLines = 4, modifier = Modifier.fillMaxWidth())
                // The change a card made to it or its rules, undone in one tap while nothing changed them since (#596).
                b.undo?.let { change ->
                    TextButton(onClick = {
                        scope.launch {
                            runCatching { api!!.undoChange(botId, change); api!!.bot(botId) }
                                .onSuccess { fill(it); tell(tr("Undone")) }
                                .onError { tell(it.message ?: tr("Couldn't undo")) }
                        }
                    }) { Text(tr("Undo last change"), color = p.text) }
                }
            }
            // Its rows in three groups (#728), as on the web page: how it runs, what it uses, who and what it may.
            SettingsGroup {
                SwitchRow(tr("Pinned below the Chief"), checked = pinned) { pinned = it }
                // Its own key on the keypad (#366): only from a server that has it. A digit another bot holds moves here.
                if (b.hotkey != null) FoldSection(tr("Key on the keypad"), if (hotkey in 1..9) "$hotkey" else tr("By its place")) {
                    CheckRow(tr("By its place"), null, hotkey == 0) { hotkey = 0 }
                    for (d in 1..9) CheckRow("$d", others.firstOrNull { it.hotkey == d }?.let { tr("Now {name}'s", "name" to it.name) }, hotkey == d) { on -> hotkey = if (on) d else 0 }
                }
                Choice(tr("Model"), model, listOf("" to tr("Default")) + choices.models.map { it.id to it.label.ifBlank { it.id } }) { model = it }
                val canThink = choices.models.firstOrNull { it.id == model }?.effort ?: true
                if (canThink) Choice(tr("Reasoning"), effort, listOf("" to tr("Default")) + choices.efforts.map { it.id to it.label }) { effort = it }
            }
            SettingsGroup {
                // Where it is, this machine or the External Virtual PC, is the account's choice in Settings (#579): here
                // only whether. A server from before chose it per bot (ADR 088).
                val accountComputer = "account-computer" in server?.features.orEmpty()
                if (!accountComputer && "boat-computer" in server?.features.orEmpty() && (server?.boat == true || b.computer == "boat")) {
                    Choice(tr("Computer"), if (computer) computerOn else "none", listOf("none" to tr("None"), "linux" to tr("This machine"), "boat" to tr("External Virtual PC"))) {
                        // Between this machine and boat.dev, its files go along or not: asked first (#556).
                        if ("computer-move" in server?.features.orEmpty() && it != b.computer && it != "none" && b.computer != "none") { askMove = it; return@Choice }
                        computer = it != "none"
                        if (computer) computerOn = it
                        moveFiles = false
                    }
                } else SwitchRow(tr("Uses the computer"), checked = computer) { computer = it }
                val move = botsNow?.firstOrNull { it.id == botId }?.computerMove ?: b.computerMove
                if (move != null) androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.CenterVertically) {
                    if (move.state == "copying") Text(tr("Copying files") + (if (move.total > 0) " · ${move.done * 100 / move.total}%" else "…"), color = p.muted, style = MaterialTheme.typography.bodySmall)
                    else {
                        Text(tr("Files not copied: {why}", "why" to (move.error ?: tr("it failed"))), color = p.err, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { runCatching { api!!.retryComputerMove(botId) }.onError { tell(it.message ?: tr("Couldn't try again")) } } }) { Text(tr("Try again"), color = p.text) }
                    }
                }
                if (b.computer == "linux" || (b.computer == "boat" && "boat-desktop" in server?.features.orEmpty())) SecondaryButton(onClick = onScreen) { Text("🖥 " + tr("See its screen"), color = p.text) }
                val waiting = b.jobs.count { it.waits }
                androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClick = onJobs).padding(vertical = Space.s12), verticalAlignment = Alignment.CenterVertically) {
                    Text(tr("Scheduled jobs"), color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                    Text(
                        when {
                            b.jobs.isEmpty() -> tr("None")
                            waiting > 0 -> trn(waiting, "{n} waiting for your OK", "{n} waiting for your OK")
                            else -> "${b.jobs.size}${b.nextRunAt?.let { " · " + tr("next {time}", "time" to shortTime(it)) } ?: ""}"
                        },
                        color = if (waiting > 0) p.warnText else p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1,
                    )
                    Text("›", color = p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s12))
                }
                // Skills, Apps, May message: what's picked in one line; tap to see everything with a checkbox.
                // Opened from a skill's chip: the Skills open on that skill, its row open and in view; a skill that is gone, the Skills.
                val skillsView = remember { BringIntoViewRequester() }
                val focusRow = focusSkill?.takeIf { f -> f.isNotEmpty() && (library.any { it.name == f } || sysSkills.any { it.first.name == f }) }
                LaunchedEffect(focusSkill, focusRow) { if (focusSkill != null && focusRow == null) { delay(350); skillsView.bringIntoView() } }
                if (!useSkills) Section(tr("Skills"), modifier = Modifier.bringIntoViewRequester(skillsView)) {
                    Hint(tr("Skills are off for this bot."))
                    SecondaryButton(onClick = { useSkills = true }) { Text(tr("Turn them on"), color = p.text) }
                } else {
                    // One list, as on the web: your library's skills, then the ones every bot has unless switched off here.
                    val count = { from: String -> sysSkills.count { (k, f) -> f == from && k.name !in disabled } }
                    val summary = listOfNotNull(
                        skills.sorted().joinToString(", ").ifBlank { null },
                        count("machine").takeIf { it > 0 }?.let { tr("{n} from your Claude account", "n" to it) },
                        count("builtin").takeIf { it > 0 }?.let { tr("{n} built into Claude Code", "n" to it) },
                    ).joinToString(", ").ifBlank { tr("None") }
                    FoldSection(tr("Skills"), summary, startOpen = focusSkill != null, modifier = Modifier.bringIntoViewRequester(skillsView)) {
                        val botName = { id: String -> (others + b).firstOrNull { it.id == id }?.name ?: tr("a deleted bot") }
                        if (library.isNotEmpty()) GroupHead(tr("Your skills"))
                        // In each group the ones it has come first (as saved, so rows don't jump while you tick them).
                        library.sortedBy { it.name !in b.skills }.forEach { k ->
                            val from = when {
                                k.source == "github" -> tr("Installed by you from {source}", "source" to (k.sourceUrl ?: "GitHub"))
                                k.createdBy?.startsWith("bot:") == true -> tr("Written by {name}", "name" to botName(k.createdBy.removePrefix("bot:")))
                                k.createdBy == "chief" -> tr("Written by the Chief")
                                else -> tr("Written by you")
                            }
                            val more = listOfNotNull(from, if (k.fileCount > 1) trn(k.fileCount, "{n} file", "{n} files") else null,
                                if (k.usedBy.isNotEmpty()) tr("Used by {names}", "names" to k.usedBy.joinToString(", ") { botName(it) }) else tr("No bot uses it yet")).joinToString("\n") +
                                if (k.instructions.isNotBlank()) "\n\n" + k.instructions.take(600) + (if (k.instructions.length > 600) "…" else "") else ""
                            key(k.name) { SkillRow(k.name, k.description, more, k.name in skills, focus = k.name == focusRow) { on -> skills = if (on) skills + k.name else skills - k.name } } // its row keeps its open/closed state when the order changes
                        }
                        for (group in listOf("machine", "builtin")) {
                            val list = sysSkills.filter { it.second == group }.sortedBy { it.first.name in b.disabledSkills }
                            if (list.isEmpty()) continue
                            GroupHead((if (group == "builtin") tr("built into Claude Code") else tr("from your Claude account")).replaceFirstChar { it.uppercase() })
                            list.forEach { (k, _) ->
                                val more = (if (group == "builtin") tr("Comes with Claude Code.") else tr("Installed in your Claude account.")) + " " + tr("Every bot has it unless you switch it off here.")
                                key(k.name) { SkillRow(k.name, k.description, more, k.name !in disabled, focus = k.name == focusRow) { on -> disabled = if (on) disabled - k.name else disabled + k.name } }
                            }
                        }
                    }
                }
                if (apps.isNotEmpty() || connectors.isNotEmpty()) FoldSection(tr("Apps"), apps.filter { it.toolkit in connectors }.joinToString(", ") { it.app?.name ?: it.toolkit }.ifBlank { tr("None") }) {
                    apps.forEach { c ->
                        CheckRow(c.app?.name ?: c.toolkit, null, c.toolkit in connectors) { on -> connectors = if (on) connectors + c.toolkit else connectors - c.toolkit }
                    }
                }
                // Its pages (#346): what it made for you. Tap one to open it, and keep it up to date from there.
                pages?.let { list ->
                    FoldSection(tr("Pages"), if (list.isEmpty()) tr("None yet") else "${list.size}") {
                        list.forEach { pg ->
                            key(pg.slug) {
                                Column(Modifier.fillMaxWidth().clickable { DocViewer.open = DocViewer.page(botId, dev.botdot.app.data.PageRef(pg.slug, pg.title), b.name) }.padding(vertical = Space.s8)) {
                                    Text(pg.title, color = p.text, style = MaterialTheme.typography.bodyLarge)
                                    Text(dev.botdot.app.data.Pages.line(pg), color = if (pg.keep != null) p.okText else p.muted, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
            }
            // Its files (#603): every place of them in Files, full screen, in place of the Files and Workspace sections.
            val explorer = dev.botdot.app.data.FilesExplorer.shows(server?.features)
            if (explorer) FilesLink(onFiles)
            // Its files (#235): what you gave it. Tap one to open it; keep one in mind so it comes with every task.
            if (keepsFiles && !explorer) FilesSection(api, botId, name, viewer = dev.botdot.app.data.DocumentView.shows(server?.features),
                empty = tr("None yet."), tell = ::tell)
            // Its workspace (#296): every file in its folder, and in its folder on the account's computer.
            if (!explorer && dev.botdot.app.data.WorkspaceFiles.shows(server?.features)) {
                WorkspaceSection(api, botId, b.name, usesComputer = b.computer == "linux", viewer = dev.botdot.app.data.DocumentView.shows(server?.features), tell = ::tell, folders = dev.botdot.app.data.WorkspaceFiles.folders(server?.features), projects = dev.botdot.app.data.Projects.shows(server?.features))
            }
            val trusted = b.jobs.filter { it.alwaysApprove }
            val grants = b.alwaysAllowed
            val roomsShown = dev.botdot.app.data.BotRooms.shows(server?.features) && b.rooms != null
            if (others.isNotEmpty() || roomsShown || trusted.isNotEmpty() || grants.isNotEmpty() || b.overrides.isNotEmpty()) SettingsGroup {
                if (others.isNotEmpty()) FoldSection(tr("May message"), if (others.size > 1 && others.all { it.id in mayMessage }) tr("Everyone") else others.filter { it.id in mayMessage }.joinToString(", ") { it.name }.ifBlank { tr("Nobody") }) {
                    others.forEach { o ->
                        CheckRow(o.name, null, o.id in mayMessage) { on -> mayMessage = if (on) mayMessage + o.id else mayMessage - o.id }
                    }
                }
                // "Other bots may ask it" (#136): only from a server that has it.
                if (others.isNotEmpty() && b.othersMayAsk != null) SwitchRow(tr("Other bots may ask it"), checked = othersMayAsk) { othersMayAsk = it }
                // Shared rooms (ADR 060, #316): whether it may be in rooms with other accounts' bots, and who may mention it there.
                if (roomsShown) {
                    SwitchRow(tr("May be in shared rooms"), checked = rooms.allowRooms) { rooms = rooms.copy(allowRooms = it) }
                    if (rooms.allowRooms) Choice(tr("Who may mention it"), rooms.whoMayMention, dev.botdot.app.data.BotRooms.WHO) { rooms = rooms.copy(whoMayMention = it) }
                }
                // The jobs you said to always approve, whose later changes need no OK, and its lasting grants in connected apps
                // (#474). Revoke takes one off (saved right away).
                if (trusted.isNotEmpty() || grants.isNotEmpty()) FoldSection(tr("Always approved"), (trusted.map { it.name } + grants.map { it.label.ifBlank { it.action } }).joinToString(", ")) {
                    trusted.forEach { j ->
                        androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(j.name, color = p.text, style = MaterialTheme.typography.bodyLarge)
                                Text("${scheduleWords(j)} · " + if (j.kind == "script") tr("a script, no AI") else tr("uses AI"), color = p.muted, style = MaterialTheme.typography.bodySmall)
                            }
                            SecondaryButton(onClick = {
                                scope.launch {
                                    runCatching { api!!.setJobAlwaysApprove(botId, j.id, false) }
                                        .onSuccess { saved -> bot = b.copy(jobs = b.jobs.map { if (it.id == saved.id) it.copy(alwaysApprove = false) else it }); tell(tr("Revoked: its next change waits for your OK")) }
                                        .onError { tell(it.message ?: tr("Couldn't save")) }
                                }
                            }) { Text(tr("Revoke"), color = p.text) }
                        }
                    }
                    grants.forEach { g ->
                        androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(g.label.ifBlank { g.action }, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                            SecondaryButton(onClick = {
                                scope.launch {
                                    runCatching { api!!.revokeAlwaysAllowed(botId, g.action) }
                                        .onSuccess { bot = b.copy(alwaysAllowed = b.alwaysAllowed - g); tell(tr("Revoked: it asks you again")) }
                                        .onError { tell(it.message ?: tr("Couldn't save")) }
                                }
                            }) { Text(tr("Revoke"), color = p.text) }
                        }
                    }
                }
                // The rules you lifted for it with "Allow always for this bot" (#253). Revoke takes one back (saved right away).
                if (b.overrides.isNotEmpty()) FoldSection(tr("Rules you lifted"), b.overrides.joinToString(", ") { it.action }) {
                    b.overrides.forEach { o ->
                        androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(o.action, color = p.text, style = MaterialTheme.typography.bodyLarge)
                                Text(tr("Its rule: {rule}", "rule" to o.rule), color = p.muted, style = MaterialTheme.typography.bodySmall)
                            }
                            SecondaryButton(onClick = {
                                scope.launch {
                                    runCatching { api!!.revokeOverride(botId, o.id) }
                                        .onSuccess { saved -> bot = b.copy(overrides = saved.overrides); tell(tr("Revoked: it asks you again")) }
                                        .onError { tell(it.message ?: tr("Couldn't save")) }
                                }
                            }) { Text(tr("Revoke"), color = p.text) }
                        }
                    }
                }
            }
            if (dev.botdot.app.data.Duplicate.shows(server?.features)) SecondaryButton(onClick = {
                scope.launch { runCatching { (api ?: error(tr("Not connected to botdot"))).copyPlan(botId) }.onSuccess { copyPlan = it; copyName = it.name }.onError { tell(it.message ?: tr("Couldn't load")) } }
            }, modifier = Modifier.fillMaxWidth()) { Text(tr("Duplicate {name}", "name" to b.name), color = p.text) }
            SecondaryButton(onClick = { askDelete = true }, modifier = Modifier.fillMaxWidth()) { Text(tr("Delete {name}", "name" to b.name), color = p.err) }
        }
    }

    // "Duplicate" (#227): the server's list of what the copy gets, a name to change, then the copy's chat. It goes away
    // at once while the copy is made (#478), and comes back with the server's sentence when refused.
    copyPlan?.let { plan ->
        var aside by remember { mutableStateOf(false) }
        if (!aside) AlertDialog(
            onDismissRequest = { copyPlan = null },
            title = { Text(tr("Duplicate {name}?", "name" to bot?.name)) },
            text = {
                Column {
                    Field(copyName, { copyName = it.take(60) }, label = { Text(tr("Name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Text(dev.botdot.app.data.Duplicate.text(plan), color = p.text, modifier = Modifier.padding(top = Space.s12))
                }
            },
            confirmButton = {
                TextButton(enabled = !work.busy && !plan.vaultLocked, onClick = {
                    aside = true
                    var made = ""
                    work.run(tr("Duplicating {name}…", "name" to bot?.name), { tr("{name} made", "name" to made) }, refused = { aside = false; tell(it) }) {
                        val copy = (api ?: error(tr("Not connected to botdot"))).duplicateBot(botId, copyName)
                        made = copy.name; copyPlan = null; onCopied(copy.id)
                    }
                }) { Text(tr("Duplicate"), color = p.text) }
            },
            dismissButton = { TextButton(onClick = { copyPlan = null }) { Text(tr("Cancel"), color = p.text) } },
        )
    }

    askMove?.let { to ->
        val choose = { copy: Boolean -> computer = true; computerOn = to; moveFiles = copy; askMove = null }
        AlertDialog(
            onDismissRequest = { askMove = null },
            title = { Text(if (to == "boat") tr("Copy its files to the External Virtual PC?") else tr("Copy its files to this machine?")) },
            confirmButton = { TextButton(onClick = { choose(true) }) { Text(tr("Copy files"), color = p.text) } },
            dismissButton = { TextButton(onClick = { choose(false) }) { Text(tr("Start empty"), color = p.text) } },
        )
    }

    if (askDelete) AlertDialog(
        onDismissRequest = { askDelete = false },
        title = { Text(tr("Delete {name}?", "name" to bot?.name)) },
        // Its screen on the account's computer ends; the computer, which the other bots use, and its folder there stay (#109).
        text = {
            Text(
                if (bot?.computer == "linux") tr("Its settings and jobs go, and so do the skills it wrote itself, and its screen and its browser's logins on the account's computer. Its folder {folder} there stays, and so does the computer, which the other bots use. Its past runs stay.", "folder" to "/workspace/$botId")
                else tr("Its settings and jobs go, and so do the skills it wrote itself. Its past runs stay.")
            )
        },
        confirmButton = {
            TextButton(onClick = {
                askDelete = false
                scope.launch { runCatching { api!!.deleteBot(botId) }.onSuccess { onDeleted() }.onError { tell(it.message ?: tr("Couldn't delete")) } }
            }) { Text(tr("Delete"), color = p.err) }
        },
        dismissButton = { TextButton(onClick = { askDelete = false }) { Text(tr("Keep"), color = p.text) } },
    )
}

@Composable
internal fun CheckRow(label: String, sub: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    val p = LocalPaper.current
    // The whole row ticks it, not only the small box.
    androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { onChange(!checked) }) {
        Checkbox(checked, onChange, colors = CheckboxDefaults.colors(checkedColor = p.ink, checkmarkColor = p.inkText))
        Column(Modifier.weight(1f)) {
            Text(label, color = p.text, style = MaterialTheme.typography.bodyLarge)
            if (!sub.isNullOrBlank()) Text(sub, color = p.muted, style = MaterialTheme.typography.bodySmall, maxLines = 2)
        }
    }
}

/** The colour of a bot's figure: one of [BotColors], the picked one ringed. */
@Composable
private fun ColorPicker(selected: String, onPick: (String) -> Unit) {
    val p = LocalPaper.current
    androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        for ((hex, label) in BotColors) {
            val on = hex.equals(selected, ignoreCase = true)
            androidx.compose.foundation.layout.Box(
                Modifier.size(34.dp)
                    .border(2.dp, if (on) p.text else Color.Transparent, CircleShape)
                    .padding(Space.s4).clip(CircleShape).background(parseColor(hex, p.faint))
                    .clickable(onClickLabel = label) { onPick(hex) }
                    .semantics { contentDescription = label; this.selected = on },
            )
        }
    }
}

/** Why "Always approve" on a script needs a second thought. */
fun scriptWarningText(name: String) = tr("It's a script: it runs as commands on botdot's computer with your permissions, without AI and without the bot's tool limits. If a web page or email ever tricks {name} into changing it, the new version would run on its schedule without you seeing it first.\n\nYou can take this back in {name}'s settings.", "name" to name)

@Composable
internal fun GroupHead(text: String) = Text(text, color = LocalPaper.current.muted, fontSize = Type.s12, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
    modifier = Modifier.padding(top = Space.s8, bottom = Space.s4))

/** A skill: the box switches it, a tap on its name shows more about it. */
@Composable
internal fun SkillRow(name: String, desc: String, more: String, checked: Boolean, focus: Boolean = false, onChange: (Boolean) -> Unit) {
    val p = LocalPaper.current
    var open by remember(focus) { mutableStateOf(focus) } // [focus]: a skill's chip opened the settings on it
    val view = remember { BringIntoViewRequester() }
    LaunchedEffect(focus) { if (focus) { delay(350); view.bringIntoView() } } // once the Skills have unfolded
    androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth().bringIntoViewRequester(view)) {
        Checkbox(checked, onChange, colors = CheckboxDefaults.colors(checkedColor = p.ink, checkmarkColor = p.inkText))
        Column(Modifier.weight(1f).clickable(onClickLabel = if (open) tr("Show less") else tr("Show more")) { open = !open }.padding(top = Space.s12, bottom = Space.s8)) {
            Text(name, color = p.text, style = MaterialTheme.typography.bodyLarge)
            if (desc.isNotBlank()) Text(desc, color = p.muted, style = MaterialTheme.typography.bodySmall, maxLines = if (open) Int.MAX_VALUE else 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            if (open) Text(more, color = p.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = Space.s8))
        }
    }
}
