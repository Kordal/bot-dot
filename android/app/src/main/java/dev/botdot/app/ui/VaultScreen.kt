package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.BitwardenStatus
import dev.botdot.app.data.VaultItem
import dev.botdot.app.data.VaultTypes
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** The vault: Bitwarden's bot-dot folder (or the built-in logins), and which bots may use each item. Like the web's Vault page. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultScreen(app: BotDotApp, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    val bots by app.store.bots.value.collectAsState()
    val server by app.store.version.value.collectAsState() // its features: whether it keeps item types
    val features = server?.features
    val unlocking by app.bwUnlocking.collectAsState()
    val unlockError by app.bwUnlockError.collectAsState()

    var items by remember { mutableStateOf<List<VaultItem>>(emptyList()) }
    var bw by remember { mutableStateOf<BitwardenStatus?>(null) }
    var editing by remember { mutableStateOf<VaultItem?>(null) }
    var adding by remember { mutableStateOf(false) }
    var master by remember { mutableStateOf("") }

    suspend fun load() {
        val a = api ?: return
        runCatching { coroutineScope { val i = async { a.vault() }; val b = async { a.bitwarden() }; i.await() to b.await() } }
            .onSuccess { (i, b) -> items = i; bw = b }.onError { tell(it.message ?: "Couldn't load") }
    }
    // Unlocking runs in the app (it takes a while); show the items once it's done.
    LaunchedEffect(api, unlocking) { if (!unlocking) load() }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = { TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg), title = { Text("🔐 Vault", style = MaterialTheme.typography.titleMedium) }) },
    ) { pad ->
        val b = bw ?: return@Scaffold
        val locked = b.configured && !b.unlocked
        LazyColumn(Modifier.padding(pad).fillMaxSize().imePadding(), contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Hint(if (b.configured) "Your Bitwarden's bot-dot folder: logins, cards and identities your bots can use without ever seeing them."
                    else "Saved logins your bots can use without ever seeing the password.")
            }
            when {
                !b.configured && !b.installed -> item { Hint("To use Bitwarden, install its command-line tool on botdot's computer first (brew install bitwarden-cli).") }
                !b.configured -> item { BitwardenSetup(onConnect = { server, url, id, secret ->
                    scope.launch {
                        runCatching { api!!.setUpBitwarden(server, url, id, secret) }.onSuccess { tell("Connected. Now unlock it.") }.onError { tell(it.message ?: "Couldn't connect") }
                        load()
                    }
                }) }
                locked -> item {
                    Section("🛡 Bitwarden is locked", "The master password is only kept in botdot's memory, never saved.") {
                        if (unlockError != null) Text(unlockError!!, color = p.err, style = MaterialTheme.typography.bodyMedium)
                        PasswordField(master, { master = it }, "Master password")
                        Button(onClick = { api?.let { app.unlockBitwarden(it, master) }; master = "" }, enabled = master.isNotEmpty() && !unlocking,
                            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(if (unlocking) "Unlocking…" else "Unlock") }
                    }
                }
                else -> item {
                    Row(Modifier.fillMaxWidth().background(p.panel, RoundedCornerShape(14.dp)).border(1.dp, p.line, RoundedCornerShape(14.dp)).padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("🛡 ${b.email ?: b.server ?: "Bitwarden"} · ${b.items ?: 0} item${if (b.items == 1) "" else "s"}${b.lastSync?.let { " · synced ${shortTime(it)}" } ?: ""}",
                            color = p.muted, fontSize = 12.5.sp, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { runCatching { api!!.syncBitwarden() }.onSuccess { tell("Synced") }.onError { tell(it.message ?: "Couldn't sync") }; load() } }) { Text("Sync", color = p.text) }
                        TextButton(onClick = { scope.launch { runCatching { api!!.lockBitwarden() }.onSuccess { tell("Locked") }.onError { tell(it.message ?: "Couldn't lock") }; load() } }) { Text("Lock", color = p.text) }
                    }
                }
            }
            if (!b.error.isNullOrBlank() && b.configured) item { Text(b.error, color = p.err, style = MaterialTheme.typography.bodySmall) }
            if (!locked) {
                items(items, key = { it.id }) { i -> VaultRow(i, bots.orEmpty(), features) { editing = i } }
                if (items.isEmpty()) item {
                    Hint(if (b.configured) "Nothing in the bot-dot folder yet. Move the logins, cards and identities bots may use into that folder in Bitwarden, or add a login here."
                        else "No saved logins yet. Add one so a bot can sign in to a site for you.")
                }
                item {
                    OutlinedButton(onClick = { adding = true }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) { Text("＋ Add", color = p.text) }
                }
            }
        }
    }

    val done: (String?) -> Unit = { msg -> editing = null; adding = false; msg?.let(::tell); scope.launch { load() } }
    val allBots = bots.orEmpty()
    when {
        adding -> LoginEditor(null, allBots, bw?.configured == true, features, api, done) { adding = false }
        editing?.kind == "login" -> LoginEditor(editing, allBots, bw?.configured == true, features, api, done) { editing = null }
        editing != null -> ItemBots(editing!!, allBots, api, done) { editing = null }
    }
}

@Composable
private fun VaultRow(i: VaultItem, bots: List<Bot>, features: Collection<String>?, onClick: () -> Unit) {
    val p = LocalPaper.current
    val names = i.allowedBots.map { id -> bots.firstOrNull { it.id == id }?.name ?: id }
    Column(Modifier.fillMaxWidth().background(p.panel, RoundedCornerShape(14.dp)).border(1.dp, p.line, RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(12.dp)) {
        Text("${KIND_ICON[i.kind] ?: "🔑"} ${i.name}", color = p.text, style = MaterialTheme.typography.titleMedium)
        when (i.kind) {
            "card" -> listOf("${i.brand ?: "Card"} •••• ${i.last4.orEmpty()}${i.expiry?.let { " · expires $it" } ?: ""} · you approve each payment")
            "identity" -> listOf(listOfNotNull(i.holder, i.email).joinToString(" · "))
            VaultTypes.SSH_KEY -> VaultTypes.sshKeyRows(i)
            else -> VaultTypes.rows(i, features) // its type before its address, then the line of that type
        }.forEach { Text(it, color = p.muted, style = MaterialTheme.typography.bodyMedium) }
        if (i.reprompt) Text("Asks for the master password again in Bitwarden, so bots can't use it.", color = p.faint, fontSize = 12.sp)
        Text(if (names.isEmpty()) "No bot may use it yet" else "Can be used by ${names.joinToString(", ")}", color = p.faint, fontSize = 12.sp)
    }
}

private val KIND_ICON = mapOf("login" to "🔑", "card" to "💳", "identity" to "🪪", VaultTypes.SSH_KEY to "🗝️")

@Composable
private fun BitwardenSetup(onConnect: (server: String, serverUrl: String, clientId: String, clientSecret: String) -> Unit) {
    val p = LocalPaper.current
    var server by remember { mutableStateOf("us") }
    var url by remember { mutableStateOf("") }
    var id by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    Section("Use your Bitwarden", "Bots will use the logins, payment cards and identities in a folder called bot-dot in your Bitwarden, and nothing else in it. " +
        "Your master password is only used to unlock and is never saved.\n\n1. In the Bitwarden web vault, open Settings → Security → Keys → View API key.\n2. Copy the client_id and client_secret here.") {
        Chips(listOf("us" to "bitwarden.com", "eu" to "bitwarden.eu", "custom" to "Self-hosted"), server) { server = it }
        if (server == "custom") OutlinedTextField(url, { url = it.trim() }, label = { Text("Address") }, placeholder = { Text("https://vault.example.com") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
        OutlinedTextField(id, { id = it.trim() }, label = { Text("client_id") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
        PasswordField(secret, { secret = it.trim() }, "client_secret")
        Button(onClick = { onConnect(server, url, id, secret); secret = "" }, enabled = id.isNotBlank() && secret.isNotBlank() && (server != "custom" || url.isNotBlank()),
            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Connect Bitwarden") }
    }
}

/**
 * Adds a login-kind item (item null) or changes one. Its Type comes first, and the two fields that hold the secret
 * follow it at once (VaultTypes). The secret is write-only: empty keeps the saved one.
 */
@Composable
private fun LoginEditor(item: VaultItem?, bots: List<Bot>, bitwarden: Boolean, features: Collection<String>?, api: dev.botdot.app.data.Api?, done: (String?) -> Unit, close: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(item?.name.orEmpty()) }
    var site by remember { mutableStateOf(item?.site.orEmpty()) }
    var type by remember { mutableStateOf(VaultTypes.of(item?.type).id) }
    // Kept while Other shows no field for it: a login changed to Other and back shows its username again.
    var user by remember { mutableStateOf(item?.username.orEmpty()) }
    var pw by remember { mutableStateOf("") }
    val fields = VaultTypes.editorFields(type, features, isNew = item == null)
    var hosts by remember { mutableStateOf(item?.allowedHosts.orEmpty().joinToString(", ")) }
    var insecure by remember { mutableStateOf(item?.insecureTls ?: false) }
    var inComputer by remember { mutableStateOf(item?.inComputer ?: false) }
    val showsInComputer = VaultTypes.showsInComputer(features)
    var chosen by remember { mutableStateOf(item?.allowedBots.orEmpty().toSet()) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var askDelete by remember { mutableStateOf(false) }

    AlertDialog(onDismissRequest = close, title = { Text(item?.let { "Edit ${it.name}" } ?: "Add to the Vault") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (VaultTypes.shows(features)) Choice(VaultTypes.CONTROL, type, VaultTypes.OPTIONS) { type = it }
            OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(site, { site = it.trim() }, label = { Text("Website or server") }, placeholder = { Text("pve.example.ts.net") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
            fields.username?.let { label ->
                OutlinedTextField(user, { user = it }, label = { Text(label) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
            }
            PasswordField(pw, { pw = it }, fields.secret)
            OutlinedTextField(hosts, { hosts = it }, label = { Text("Additional exact hosts") }, placeholder = { Text("api.example.com, auth.example.com") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
            Hint("Only these hosts may also receive it. Subdomains are not included automatically.")
            SwitchRow("Accept a self-signed certificate", "For your own servers, e.g. Proxmox or a NAS", insecure) { insecure = it }
            if (showsInComputer) SwitchRow(VaultTypes.IN_COMPUTER, VaultTypes.IN_COMPUTER_HINT, inComputer) { inComputer = it }
            Text("Bots that may use it", color = p.text, style = MaterialTheme.typography.titleSmall)
            bots.forEach { b ->
                CheckRow("${b.emoji} ${b.name}", if (b.computer == "linux") null else "No computer, so it can't sign in to websites", b.id in chosen) { on -> chosen = if (on) chosen + b.id else chosen - b.id }
            }
            error?.let { Text(it, color = p.err, style = MaterialTheme.typography.bodyMedium) }
            if (item != null) TextButton(onClick = { askDelete = true }, enabled = !busy) { Text("Delete", color = p.err) }
        }
    }, confirmButton = {
        TextButton(enabled = !busy && name.isNotBlank() && site.isNotBlank() && (item != null || pw.isNotEmpty()), onClick = {
            busy = true
            scope.launch {
                runCatching {
                    val sent = VaultTypes.sent(type, user, features, saved = item?.type)
                    api!!.saveVaultLogin(item?.id, name.trim(), site, sent.username, pw, insecure, chosen.toList(),
                        hosts.split(',').map(String::trim).filter(String::isNotEmpty), sent.type, if (showsInComputer) inComputer else null)
                }.onSuccess { pw = ""; done(if (bitwarden) "Saved in Bitwarden" else "Saved") }
                    // A refused save: the server's sentence, the form as it was typed, the secret cleared (docs/api.md).
                    .onError { pw = ""; error = it.message ?: "Couldn't save" }
                busy = false
            }
        }) { Text("Save", color = p.text) }
    }, dismissButton = { TextButton(onClick = close) { Text("Cancel", color = p.text) } })

    if (askDelete && item != null) AlertDialog(
        onDismissRequest = { askDelete = false },
        title = { Text("Delete ${item.name}?") },
        text = { Text(if (bitwarden) "It moves to Bitwarden's trash, where you can restore it for 30 days." else "Bots can't use it any more.") },
        confirmButton = {
            TextButton(onClick = {
                askDelete = false
                scope.launch { runCatching { api!!.deleteVaultItem(item.id) }.onSuccess { done("Deleted") }.onError { error = it.message ?: "Couldn't delete" } }
            }) { Text("Delete", color = p.err) }
        },
        dismissButton = { TextButton(onClick = { askDelete = false }) { Text("Keep", color = p.text) } },
    )
}

/** Which bots may use a card or an identity; the details themselves are changed in Bitwarden. */
@Composable
private fun ItemBots(item: VaultItem, bots: List<Bot>, api: dev.botdot.app.data.Api?, done: (String?) -> Unit, close: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var chosen by remember { mutableStateOf(item.allowedBots.toSet()) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = close, title = { Text("${KIND_ICON[item.kind] ?: ""} ${item.name}") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Hint(VaultTypes.itemBotsHint(item.kind) + " Change the details themselves in Bitwarden.")
            bots.forEach { b -> CheckRow("${b.emoji} ${b.name}", null, b.id in chosen) { on -> chosen = if (on) chosen + b.id else chosen - b.id } }
            error?.let { Text(it, color = p.err, style = MaterialTheme.typography.bodyMedium) }
        }
    }, confirmButton = {
        TextButton(onClick = {
            scope.launch { runCatching { api!!.setVaultBots(item.id, chosen.toList()) }.onSuccess { done("Saved") }.onError { error = it.message ?: "Couldn't save" } }
        }) { Text("Save", color = p.text) }
    }, dismissButton = { TextButton(onClick = close) { Text("Cancel", color = p.text) } })
}
