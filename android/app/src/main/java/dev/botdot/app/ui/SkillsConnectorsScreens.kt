package dev.botdot.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.BuiltinSkill
import dev.botdot.app.data.CatalogApp
import dev.botdot.app.data.ChiefSkills
import dev.botdot.app.data.ConnectorsInfo
import dev.botdot.app.data.Skill
import kotlinx.coroutines.launch

// ---------- skills ----------

/** Skills: your library (which bots use each), and the ones built into Claude Code. Pick them per bot in its settings. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SkillsScreen(app: BotDotApp, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    var library by remember { mutableStateOf<List<Skill>>(emptyList()) }
    var builtin by remember { mutableStateOf<List<BuiltinSkill>>(emptyList()) }
    val botsNow by app.store.bots.value.collectAsState()
    val botNames = remember(botsNow) { botsNow.orEmpty().associate { it.id to it.name } }
    var open by remember { mutableStateOf<Skill?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(api) {
        val a = api ?: return@LaunchedEffect
        runCatching { a.skills() }.onSuccess { library = it.library; builtin = it.builtin }.onError { error = it.message }
    }

    Scaffold(
        containerColor = p.bg,
        topBar = { TopAppBar(navigationIcon = { BackButton { if (open != null) open = null else onBack() } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
            title = { Text(open?.name ?: "✦ Skills", style = MaterialTheme.typography.titleMedium) }) },
    ) { pad ->
        val o = open
        if (o != null) {
            Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Hint(o.description)
                val users = ChiefSkills.usedBy(o.usedBy, botNames)
                Hint(if (users.isEmpty()) "No bot uses it yet. Turn it on in a bot's settings." else "Used by ${users.joinToString(", ")}")
                o.createdBy?.let { Hint("Made by ${if (it.startsWith("bot:")) botNames[it.removePrefix("bot:")] ?: "a bot" else if (it == "chief") "the Chief" else "you"}") }
                Section("What it tells the bot") { MarkdownText(o.instructions.ifBlank { "(empty)" }) }
            }
            return@Scaffold
        }
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (error != null) item { Text(error!!, color = p.err) }
            item { Hint("Instructions a bot loads when a task needs them. Choose which bots get which in each bot's settings, and the Chief's in its settings.") }
            if (library.isEmpty()) item { Hint("Your library is empty. Ask the Chief to make or import one.") }
            items(library, key = { it.name }) { k ->
                Column(Modifier.fillMaxWidth().background(p.panel, RoundedCornerShape(14.dp)).border(1.dp, p.line, RoundedCornerShape(14.dp)).clickable { open = k }.padding(12.dp)) {
                    Text(k.name, color = p.text, style = MaterialTheme.typography.titleMedium)
                    Text(k.description, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 3)
                    val chief = ChiefSkills.CHIEF_ID in k.usedBy
                    val n = k.usedBy.size - if (chief) 1 else 0
                    val bots = if (n == 0) "" else "$n bot${if (n == 1) "" else "s"}"
                    Text(if (n == 0 && !chief) "Not used yet" else "Used by ${listOf(if (chief) "the Chief" else "", bots).filter { it.isNotEmpty() }.joinToString(" and ")}", color = p.faint, fontSize = 12.sp)
                }
            }
            if (builtin.isNotEmpty()) {
                item { Text("Built into Claude Code", color = p.text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp)) }
                item { Hint(builtin.joinToString(" · ") { it.name }) }
            }
        }
    }
}

// ---------- connectors ----------

/** The Composio key field: Save checks it with Composio; Get a key opens composio.dev. */
@Composable
private fun ComposioKeyField(save: suspend (String) -> Boolean, onCancel: (() -> Unit)? = null, getKey: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var key by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    OutlinedTextField(key, { key = it }, placeholder = { Text("Composio API key") }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
    Row(verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = getKey) { Text("Get a key at composio.dev", color = p.muted) }
        Spacer(Modifier.weight(1f))
        if (onCancel != null) TextButton(onClick = onCancel) { Text("Cancel", color = p.text) }
        TextButton(enabled = key.isNotBlank() && !saving, onClick = {
            saving = true
            scope.launch { if (save(key.trim())) key = ""; saving = false }
        }) { Text("Save", color = p.okText) }
    }
}

/** Where the owner makes a Composio API key: botdot makes no Composio account of its own. */
private const val COMPOSIO_KEYS = "https://platform.composio.dev"

/** Connectors: your apps through Composio. Connecting opens the app's sign-in in the phone's browser. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectorsScreen(app: BotDotApp, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    var info by remember { mutableStateOf<ConnectorsInfo?>(null) }
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<CatalogApp>>(emptyList()) }
    var askRemove by remember { mutableStateOf<String?>(null) }
    var askRemoveKey by remember { mutableStateOf(false) }
    var replacing by remember { mutableStateOf(false) }
    suspend fun saveKey(key: String): Boolean = runCatching { api!!.setComposioKey(key) }
        .onSuccess { replacing = false; found = emptyList(); tell("Saved"); load() }.onError { tell(it.message ?: "Couldn't save") }.isSuccess

    suspend fun load() { runCatching { api?.connectors() }.onSuccess { info = it }.onError { tell(it.message ?: "Couldn't load") } }
    LaunchedEffect(api) { load() }
    // Back from signing in to an app in the browser: show the new connection.
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) scope.launch { load() } }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    fun search() = scope.launch { runCatching { api!!.catalog(query) }.onSuccess { found = it.items.take(30) }.onError { tell(it.message ?: "Couldn't search") } }
    fun connect(slug: String) = scope.launch {
        runCatching { api!!.connectApp(slug) }.onSuccess { link ->
            if (link.noAuth) { tell("Connected"); load() }
            else link.redirectUrl?.let { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) }
        }.onError { tell(it.message ?: "Couldn't connect") }
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = { TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg), title = { Text("🔌 Connectors", style = MaterialTheme.typography.titleMedium) }) },
    ) { pad ->
        val i = info ?: return@Scaffold
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!i.configured || i.keyRejected) {
                // No key yet, or Composio refuses it (#409): botdot makes no Composio account, so the owner pastes one.
                val title = when {
                    !i.configured -> "Add your Composio key"
                    i.account == "own" -> "Composio no longer accepts your key ${i.keyHint.orEmpty()}".trim()
                    else -> "Composio no longer accepts botdot's Composio account"
                }
                item { Section(title) { ComposioKeyField({ saveKey(it) }) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(COMPOSIO_KEYS))) } } }
                return@LazyColumn
            }
            // The key, always at the top: replaced or removed here (#440).
            item {
                if (replacing) Section(null) { ComposioKeyField({ saveKey(it) }, onCancel = { replacing = false }) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(COMPOSIO_KEYS))) } }
                else Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Composio key ${i.keyHint.orEmpty()}".trim(), color = p.text, modifier = Modifier.weight(1f))
                    TextButton(onClick = { replacing = true }) { Text("Replace", color = p.text) }
                    TextButton(onClick = { askRemoveKey = true }) { Text("Remove", color = p.err) }
                }
            }
            if (!i.error.isNullOrBlank()) item { Text(i.error, color = p.err) }
            item { Text("Connected", color = p.text, style = MaterialTheme.typography.titleMedium) }
            if (i.connections.isEmpty() && i.reconnect.isEmpty()) item { Hint("No apps yet. Search for one below.") }
            items(i.reconnect, key = { "r:${it.slug}" }) { a ->
                Row(Modifier.fillMaxWidth().background(p.panel, RoundedCornerShape(14.dp)).border(1.dp, p.line, RoundedCornerShape(14.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(a.name.ifBlank { a.slug }, color = p.text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = { connect(a.slug) }) { Text("Connect again", color = p.okText) }
                    TextButton(onClick = { scope.launch { runCatching { api!!.forgetReconnect(a.slug) }.onError { tell(it.message ?: "Couldn't remove") }; load() } }) { Text("Remove", color = p.muted) }
                }
            }
            items(i.connections, key = { it.id }) { c ->
                Row(Modifier.fillMaxWidth().background(p.panel, RoundedCornerShape(14.dp)).border(1.dp, p.line, RoundedCornerShape(14.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(c.app?.name ?: c.toolkit, color = p.text, style = MaterialTheme.typography.titleMedium)
                        val n = c.usedBy.size
                        Text("${c.status.lowercase().replaceFirstChar { it.uppercase() }} · ${if (n == 0) "no bot uses it yet" else "used by $n bot${if (n == 1) "" else "s"}"}",
                            color = if (c.status == "ACTIVE") p.muted else p.warnText, fontSize = 12.5.sp)
                    }
                    TextButton(onClick = { askRemove = c.id }) { Text("Remove", color = p.err) }
                }
            }
            item {
                OutlinedTextField(query, { query = it }, placeholder = { Text("Find an app: Gmail, Notion, Slack…") }, singleLine = true,
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { search() }),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            }
            items(found, key = { "f:${it.slug}" }) { a ->
                Row(Modifier.fillMaxWidth().clickable { connect(a.slug) }.padding(vertical = 10.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(a.name.ifBlank { a.slug }, color = p.text, style = MaterialTheme.typography.bodyLarge)
                        if (!a.description.isNullOrBlank()) Text(a.description, color = p.muted, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                    }
                    Text("Connect", color = p.okText, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }

    if (askRemoveKey) AlertDialog(
        onDismissRequest = { askRemoveKey = false },
        title = { Text("Remove your Composio key?") },
        text = { Text("Connectors stop working until you add another.") },
        confirmButton = { TextButton(onClick = { askRemoveKey = false; scope.launch { runCatching { api!!.removeComposioKey() }.onSuccess { found = emptyList(); tell("Removed") }.onError { tell(it.message ?: "Couldn't remove") }; load() } }) { Text("Remove", color = p.err) } },
        dismissButton = { TextButton(onClick = { askRemoveKey = false }) { Text("Keep", color = p.text) } },
    )
    askRemove?.let { id ->
        AlertDialog(
            onDismissRequest = { askRemove = null },
            title = { Text("Remove this app?") },
            text = { Text("Bots lose access to it, unless you connect it again.") },
            confirmButton = { TextButton(onClick = { askRemove = null; scope.launch { runCatching { api!!.disconnect(id) }.onSuccess { tell("Removed") }.onError { tell(it.message ?: "Couldn't remove") }; load() } }) { Text("Remove", color = p.err) } },
            dismissButton = { TextButton(onClick = { askRemove = null }) { Text("Keep", color = p.text) } },
        )
    }
}
