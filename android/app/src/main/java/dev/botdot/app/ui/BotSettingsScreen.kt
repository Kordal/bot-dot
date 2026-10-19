package dev.botdot.app.ui

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
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
fun BotSettingsScreen(app: BotDotApp, botId: String, onScreen: () -> Unit, onJobs: () -> Unit, onDeleted: () -> Unit, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }

    var bot by remember { mutableStateOf<Bot?>(null) }
    var choices by remember { mutableStateOf(SettingsInfo()) }
    var library by remember { mutableStateOf<List<Skill>>(emptyList()) }
    var apps by remember { mutableStateOf<List<Connection>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var askDelete by remember { mutableStateOf(false) }

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
    var useSkills by remember { mutableStateOf(true) }
    var skills by remember { mutableStateOf(setOf<String>()) }
    var sysSkills by remember { mutableStateOf(listOf<Pair<dev.botdot.app.data.BuiltinSkill, String>>()) } // every bot has these unless switched off
    var disabled by remember { mutableStateOf(setOf<String>()) }
    var connectors by remember { mutableStateOf(setOf<String>()) }
    var mayMessage by remember { mutableStateOf(setOf<String>()) }
    var others by remember { mutableStateOf<List<Bot>>(emptyList()) }

    fun fill(b: Bot) {
        bot = b; color = b.color.orEmpty(); name = b.name; description = b.description; group = b.group; pinned = b.pinned > 0; task = b.prompt
        model = b.model.orEmpty(); effort = b.effort.orEmpty(); computer = b.computer == "linux"
        useSkills = b.useSkills; skills = b.skills.toSet(); disabled = b.disabledSkills.toSet(); connectors = b.connectors.toSet(); mayMessage = if (b.mayMessageAll) others.map { it.id }.toSet() else b.mayMessage.toSet()
    }

    LaunchedEffect(api) {
        val a = api ?: return@LaunchedEffect
        // All at once: over Tailscale, one after another would take a round trip each.
        coroutineScope {
            launch { runCatching { app.store.bots.value.value ?: a.bots() }.onSuccess { all -> others = all.filter { it.id != botId }; all.firstOrNull { it.id == botId }?.let(::fill) }.onError { tell(it.message ?: "Couldn't load") } }
            launch { runCatching { a.settings() }.onSuccess { choices = it } }
            launch { runCatching { a.skills() }.onSuccess { library = it.library; sysSkills = it.machine.map { k -> k to "from your Claude account" } + it.builtin.map { k -> k to "built into Claude Code" } } }
            launch { runCatching { a.connectors() }.onSuccess { apps = it.connections.distinctBy { c -> c.toolkit } } }
        }
    }

    fun save() = scope.launch {
        val b = bot ?: return@launch
        val changes = buildJsonObject {
            if (color != b.color.orEmpty()) put("color", color)
            if (name != b.name) put("name", name)
            if (description != b.description) put("description", description)
            if (group != b.group) put("group", group)
            if (pinned != (b.pinned > 0)) put("pinned", pinned) // pinning puts it last; drag it on the home screen to move it
            if (task != b.prompt) put("prompt", task)
            if (model != b.model.orEmpty()) put("model", model)
            if (effort != b.effort.orEmpty()) put("effort", effort)
            if (computer != (b.computer == "linux")) put("computer", if (computer) "linux" else "none")
            if (useSkills != b.useSkills) put("useSkills", useSkills)
            if (skills != b.skills.toSet()) put("skills", JsonArray(skills.map { JsonPrimitive(it) }))
            if (disabled != b.disabledSkills.toSet()) put("disabledSkills", JsonArray(disabled.map { JsonPrimitive(it) }))
            if (connectors != b.connectors.toSet()) put("connectors", JsonArray(connectors.map { JsonPrimitive(it) }))
            val everyone = others.all { it.id in mayMessage }
            if (everyone != b.mayMessageAll) put("mayMessageAll", everyone)
            if (!everyone && (b.mayMessageAll || mayMessage != b.mayMessage.toSet())) put("mayMessage", JsonArray(mayMessage.map { JsonPrimitive(it) }))
        }
        if (changes.isEmpty()) return@launch tell("Nothing changed.")
        saving = true
        runCatching { api!!.updateBot(botId, changes) }.onSuccess { fill(it); tell("Saved. Its next run uses this.") }.onError { tell(it.message ?: "Couldn't save") }
        saving = false
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            // Beside the chat the panel has its close button; covering the chat, Back.
            TopAppBar(navigationIcon = { if (LocalPanelClose.current == null) BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(bot?.name ?: "", style = MaterialTheme.typography.titleMedium) },
                actions = { TextButton(onClick = { save() }, enabled = !saving && bot != null) { Text(if (saving) "Saving…" else "Save", color = p.text) }; PanelClose() })
        },
    ) { pad ->
        val b = bot ?: return@Scaffold
        Column(Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Section("Who it is") {
                OutlinedTextField(name, { name = it.take(60) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                ColorPicker(color) { color = it }
                OutlinedTextField(description, { description = it }, label = { Text("What it does") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(group, { group = it.take(40) }, label = { Text("Category (e.g. Home, Work)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                SwitchRow("Pinned below the Chief", checked = pinned) { pinned = it }
            }
            Section("Its main assignment", "What it does when a job runs it without a task of its own, and its guide for your messages.") {
                OutlinedTextField(task, { task = it }, minLines = 4, modifier = Modifier.fillMaxWidth())
            }
            Section("What it can do") {
                SwitchRow("Own computer", "A desktop with a browser, for sites that need real clicking.", computer) { computer = it }
                if (b.computer == "linux") OutlinedButton(onClick = onScreen) { Text("🖥 See its screen", color = p.text) }
                val waiting = b.jobs.count { it.waits }
                androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth().clickable(onClick = onJobs).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Scheduled jobs", color = p.text, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            when {
                                b.jobs.isEmpty() -> "None. Ask it, or the Chief, for one."
                                waiting > 0 -> "$waiting waiting for your OK"
                                else -> "${b.jobs.size} job${if (b.jobs.size == 1) "" else "s"}${b.nextRunAt?.let { " · next ${shortTime(it)}" } ?: ""}"
                            },
                            color = p.muted, style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Text("›", color = p.faint)
                }
            }
            // Skills, Apps, May message: what's picked in one line; tap to see everything with a checkbox.
            if (!useSkills) Section("Skills") {
                Hint("Skills are off for this bot.")
                OutlinedButton(onClick = { useSkills = true }) { Text("Turn them on", color = p.text) }
            } else {
                // One list, as on the web: your library's skills, then the ones every bot has unless switched off here.
                val count = { from: String -> sysSkills.count { (k, f) -> f == from && k.name !in disabled } }
                val summary = listOfNotNull(
                    skills.sorted().joinToString(", ").ifBlank { null },
                    count("from your Claude account").takeIf { it > 0 }?.let { "$it from your Claude account" },
                    count("built into Claude Code").takeIf { it > 0 }?.let { "$it built into Claude Code" },
                ).joinToString(", ").ifBlank { "None" }
                FoldSection("Skills", summary) {
                    if (library.isEmpty() && sysSkills.isEmpty()) Hint("No skills yet. Ask the Chief to write one.")
                    val botName = { id: String -> (others + b).firstOrNull { it.id == id }?.name ?: "a deleted bot" }
                    if (library.isNotEmpty()) GroupHead("Your skills")
                    // In each group the ones it has come first (as saved, so rows don't jump while you tick them).
                    library.sortedBy { it.name !in b.skills }.forEach { k ->
                        val from = when {
                            k.source == "github" -> "Installed by you from ${k.sourceUrl ?: "GitHub"}"
                            k.createdBy?.startsWith("bot:") == true -> "Written by ${botName(k.createdBy.removePrefix("bot:"))}"
                            k.createdBy == "chief" -> "Written by the Chief"
                            else -> "Written by you"
                        }
                        val more = listOfNotNull(from, if (k.fileCount > 1) "${k.fileCount} files" else null,
                            if (k.usedBy.isNotEmpty()) "Used by ${k.usedBy.joinToString(", ") { botName(it) }}" else "No bot uses it yet").joinToString("\n") +
                            if (k.instructions.isNotBlank()) "\n\n" + k.instructions.take(600) + (if (k.instructions.length > 600) "…" else "") else ""
                        key(k.name) { SkillRow(k.name, k.description, more, k.name in skills) { on -> skills = if (on) skills + k.name else skills - k.name } } // its row keeps its open/closed state when the order changes
                    }
                    for (group in listOf("from your Claude account", "built into Claude Code")) {
                        val list = sysSkills.filter { it.second == group }.sortedBy { it.first.name in b.disabledSkills }
                        if (list.isEmpty()) continue
                        GroupHead(group.replaceFirstChar { it.uppercase() })
                        list.forEach { (k, _) ->
                            val more = (if (group == "built into Claude Code") "Comes with Claude Code." else "Installed in your Claude account.") + " Every bot has it unless you switch it off here."
                            key(k.name) { SkillRow(k.name, k.description, more, k.name !in disabled) { on -> disabled = if (on) disabled - k.name else disabled + k.name } }
                        }
                    }
                }
            }
            if (apps.isNotEmpty() || connectors.isNotEmpty()) FoldSection("Apps", apps.filter { it.toolkit in connectors }.joinToString(", ") { it.app?.name ?: it.toolkit }.ifBlank { "None" }) {
                apps.forEach { c ->
                    CheckRow(c.app?.name ?: c.toolkit, null, c.toolkit in connectors) { on -> connectors = if (on) connectors + c.toolkit else connectors - c.toolkit }
                }
            }
            if (others.isNotEmpty()) FoldSection("May message", if (others.size > 1 && others.all { it.id in mayMessage }) "Everyone" else others.filter { it.id in mayMessage }.joinToString(", ") { it.name }.ifBlank { "Nobody" }) {
                others.forEach { o ->
                    CheckRow(o.name, null, o.id in mayMessage) { on -> mayMessage = if (on) mayMessage + o.id else mayMessage - o.id }
                }
            }
            // The jobs you said to always approve: their later changes need no OK. Revoke takes one off (saved right away).
            val trusted = b.jobs.filter { it.alwaysApprove }
            if (trusted.isNotEmpty()) FoldSection("Always approved", trusted.joinToString(", ") { it.name }) {
                trusted.forEach { j ->
                    androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(j.name, color = p.text, style = MaterialTheme.typography.bodyLarge)
                            Text("${scheduleWords(j)} · ${if (j.kind == "script") "a script, no AI" else "uses AI"}", color = p.muted, style = MaterialTheme.typography.bodySmall)
                        }
                        OutlinedButton(onClick = {
                            scope.launch {
                                runCatching { api!!.setJobAlwaysApprove(botId, j.id, false) }
                                    .onSuccess { saved -> bot = b.copy(jobs = b.jobs.map { if (it.id == saved.id) it.copy(alwaysApprove = false) else it }); tell("Revoked: its next change waits for your OK") }
                                    .onError { tell(it.message ?: "Couldn't save") }
                            }
                        }) { Text("Revoke", color = p.text) }
                    }
                }
            }
            FoldSection("Advanced", "Model and more") {
                Choice("Model", model, listOf("" to "Default (from Settings)") + choices.models.map { it.id to it.label.ifBlank { it.id } }) { model = it }
                val canThink = choices.models.firstOrNull { it.id == model }?.effort ?: true
                if (canThink) Choice("Reasoning", effort, listOf("" to "Default (from Settings)") + choices.efforts.map { it.id to it.label }) { effort = it }
            }
            Button(onClick = { save() }, enabled = !saving, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) {
                Text(if (saving) "Saving…" else "Save")
            }
            OutlinedButton(onClick = { askDelete = true }, modifier = Modifier.fillMaxWidth()) { Text("Delete ${b.name}", color = p.err) }
        }
    }

    if (askDelete) AlertDialog(
        onDismissRequest = { askDelete = false },
        title = { Text("Delete ${bot?.name}?") },
        // Its screen on the account's computer ends; the computer, which the other bots use, and its folder there stay (#109).
        text = {
            Text(
                "Its settings and jobs go, and so do the skills it wrote itself" +
                    (if (bot?.computer == "linux") ", and its screen and its browser's logins on the account's computer. Its folder /workspace/$botId there stays, and so does the computer, which the other bots use" else "") +
                    ". Its past runs stay."
            )
        },
        confirmButton = {
            TextButton(onClick = {
                askDelete = false
                scope.launch { runCatching { api!!.deleteBot(botId) }.onSuccess { onDeleted() }.onError { tell(it.message ?: "Couldn't delete") } }
            }) { Text("Delete", color = p.err) }
        },
        dismissButton = { TextButton(onClick = { askDelete = false }) { Text("Keep", color = p.text) } },
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
                    .padding(4.dp).clip(CircleShape).background(parseColor(hex, p.faint))
                    .clickable(onClickLabel = label) { onPick(hex) }
                    .semantics { contentDescription = label; this.selected = on },
            )
        }
    }
}

/** Why "Always approve" on a script needs a second thought. */
fun scriptWarningText(name: String) = "It's a script: it runs as commands on botdot's computer with your permissions, without AI and without the bot's tool limits. If a web page or email ever tricks $name into changing it, the new version would run on its schedule without you seeing it first.\n\nYou can take this back in $name's settings."

@Composable
internal fun GroupHead(text: String) = Text(text, color = LocalPaper.current.muted, fontSize = 12.5.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
    modifier = Modifier.padding(top = 8.dp, bottom = 2.dp))

/** A skill: the box switches it, a tap on its name shows more about it. */
@Composable
internal fun SkillRow(name: String, desc: String, more: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val p = LocalPaper.current
    var open by remember { mutableStateOf(false) }
    androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
        Checkbox(checked, onChange, colors = CheckboxDefaults.colors(checkedColor = p.ink, checkmarkColor = p.inkText))
        Column(Modifier.weight(1f).clickable(onClickLabel = if (open) "Show less" else "Show more") { open = !open }.padding(top = 12.dp, bottom = 6.dp)) {
            Text(name, color = p.text, style = MaterialTheme.typography.bodyLarge)
            if (desc.isNotBlank()) Text(desc, color = p.muted, style = MaterialTheme.typography.bodySmall, maxLines = if (open) Int.MAX_VALUE else 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            if (open) Text(more, color = p.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
        }
    }
}
