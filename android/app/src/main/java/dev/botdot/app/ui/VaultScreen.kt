package dev.botdot.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.BitwardenStatus
import dev.botdot.app.data.SecretFilePlace
import dev.botdot.app.data.VaultItem
import dev.botdot.app.data.VaultTypes
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
    var addingKey by remember { mutableStateOf(false) }
    var addedKey by remember { mutableStateOf<VaultItem?>(null) }
    var addingFile by remember { mutableStateOf(false) }
    var master by remember { mutableStateOf("") }
    var removingFile by remember { mutableStateOf<SecretFilePlace?>(null) }
    // Saves, Sync and Lock run on after the tap, with a line that says how they go (#478).
    val work = rememberWork()

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
        bottomBar = { work.now?.let { w -> Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp), contentAlignment = Alignment.Center) { WorkLine(w) { work.now = null } } } },
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
                        fun sync() { work.run("Syncing…", { "Synced" }, retry = ::sync) { try { api!!.syncBitwarden() } finally { load() } } }
                        TextButton(onClick = ::sync, enabled = !work.busy) { Text("Sync", color = p.text) }
                        TextButton(onClick = { work.run("Locking…", { "Locked" }) { try { api!!.lockBitwarden() } finally { load() } } }, enabled = !work.busy) { Text("Lock", color = p.text) }
                    }
                }
            }
            if (!b.error.isNullOrBlank() && b.configured) item { Text(b.error, color = p.err, style = MaterialTheme.typography.bodySmall) }
            if (!locked) {
                items(items, key = { it.id }) { i -> VaultRow(i, bots.orEmpty(), features, onRemoveFile = { removingFile = it }) { editing = i } }
                if (items.isEmpty()) item {
                    Hint(if (b.configured) "Nothing in the bot-dot folder yet. Move the logins, cards and identities bots may use into that folder in Bitwarden, or add a login here."
                        else "No saved logins yet. Add one so a bot can sign in to a site for you.")
                }
                item {
                    OutlinedButton(onClick = { adding = true }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) { Text("＋ Add", color = p.text) }
                }
                if (b.configured && b.unlocked && VaultTypes.addsFiles(features)) item {
                    OutlinedButton(onClick = { addingFile = true }, modifier = Modifier.fillMaxWidth()) { Text("＋ File", color = p.text) }
                }
                if (b.configured && b.unlocked && VaultTypes.addsSshKeys(features)) item {
                    OutlinedButton(onClick = { addingKey = true }, modifier = Modifier.fillMaxWidth()) { Text("＋ SSH key", color = p.text) }
                }
            }
        }
    }

    val done: (String?) -> Unit = { msg -> editing = null; adding = false; msg?.let(::tell); scope.launch { load() } }
    val allBots = bots.orEmpty()
    when {
        adding -> LoginEditor(null, allBots, bw?.configured == true, features, api, work, done) { adding = false }
        editing?.kind == "login" -> LoginEditor(editing, allBots, bw?.configured == true, features, api, work, done) { editing = null }
        editing != null -> ItemBots(editing!!, allBots, api, work, done) { editing = null }
        addingKey -> SshKeyEditor(allBots, api, work, { key -> addingKey = false; addedKey = key; scope.launch { load() } }) { addingKey = false }
        addedKey != null -> SshPublicKey(addedKey!!) { addedKey = null }
        addingFile -> FileEditor(allBots, api, work, { addingFile = false; scope.launch { load() } }) { addingFile = false }
        removingFile != null -> {
            val f = removingFile!!
            AlertDialog(onDismissRequest = { removingFile = null }, title = { Text("Remove the file?") },
                text = { Text("botdot deletes ${f.where}. The bot can't write it again without asking you on a card.") },
                confirmButton = { TextButton(onClick = {
                    removingFile = null
                    scope.launch { runCatching { api!!.removeSecretFile(f.id) }.onSuccess { tell(it ?: "Removed") }.onError { tell(it.message ?: "Couldn't remove it") }; load() }
                }) { Text("Remove", color = p.err) } },
                dismissButton = { TextButton(onClick = { removingFile = null }) { Text("Cancel", color = p.text) } })
        }
    }
}

/**
 * Adds a file (#157, docs/api.md `POST /api/vault/files`): any file the owner picks (#231) with the system's file picker, at most
 * 64 KB, read here and sent once. Only its name and size are shown again.
 */
@Composable
private fun FileEditor(bots: List<Bot>, api: dev.botdot.app.data.Api?, work: WorkState, added: () -> Unit, close: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var name by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<Pair<String, ByteArray>?>(null) }
    var chosen by remember { mutableStateOf(emptySet<String>()) }
    var error by remember { mutableStateOf<String?>(null) }
    // Set aside while it saves (#478): gone at once, back with the server's sentence when refused.
    var aside by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val read = withContext(Dispatchers.IO) {
                runCatching {
                    val fileName = api?.describe(context.contentResolver, uri)?.first ?: "file"
                    fileName to context.contentResolver.openInputStream(uri)?.use { readBytesAtMost(it, VaultTypes.FILE_MAX_BYTES + 1) }
                }.getOrNull()
            }
            val bytes = read?.second
            when {
                read == null || bytes == null -> error = "Couldn't read that file."
                bytes.size > VaultTypes.FILE_MAX_BYTES -> { picked = null; error = "That file is bigger than 64 KB, the most a file in the Vault can be." }
                else -> { picked = read.first to bytes; error = null }
            }
        }
    }
    if (!aside) AlertDialog(onDismissRequest = { picked = null; close() }, title = { Text("📄 Add a file") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { pick.launch(arrayOf("*/*")) }) { Text(picked?.let { "${it.first} · ${VaultTypes.fileSize(it.second.size.toLong())}" } ?: "Pick the file", color = p.text) }
            Hint("Any file, at most 64 KB. Saved in your Bitwarden's bot-dot folder: bots never see what is in it, and you can't see it here again.")
            OutlinedTextField(name, { name = it.take(100) }, label = { Text("Name (optional)") }, placeholder = { Text("GitHub App key") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Text("Bots that may use it", color = p.text, style = MaterialTheme.typography.titleSmall)
            Hint(VaultTypes.FILE_SHARE_NOTE)
            bots.forEach { b -> CheckRow("${b.emoji} ${b.name}", null, b.id in chosen) { on -> chosen = if (on) chosen + b.id else chosen - b.id } }
            error?.let { Text(it, color = p.err, style = MaterialTheme.typography.bodyMedium) }
        }
    }, confirmButton = {
        TextButton(enabled = !work.busy && picked != null, onClick = {
            picked?.let { (fileName, bytes) ->
                aside = true
                // Refused: the server's sentence, in the form, which comes back as it was.
                work.run("Adding the file…", { "Saved" }, refused = { error = it; aside = false }) {
                    api!!.addFile(name.trim(), fileName, bytes, chosen.toList()); picked = null; added()
                }
            }
        }) { Text("Add file", color = p.text) }
    }, dismissButton = { TextButton(onClick = { picked = null; close() }) { Text("Cancel", color = p.text) } })
}

/** At most [limit] bytes of [input]: enough to tell a file that is too big. */
private fun readBytesAtMost(input: java.io.InputStream, limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val chunk = ByteArray(8192)
    while (out.size() < limit) {
        val n = input.read(chunk, 0, minOf(chunk.size, limit - out.size()))
        if (n < 0) break
        out.write(chunk, 0, n)
    }
    return out.toByteArray()
}

/**
 * Adds an SSH key (#160, docs/api.md `POST /api/vault/ssh-keys`): an OpenSSH private key pasted or read from the file
 * the owner picks, or none, and botdot makes a new one. The key goes to the server once and is never shown again.
 */
@Composable
private fun SshKeyEditor(bots: List<Bot>, api: dev.botdot.app.data.Api?, work: WorkState, added: (VaultItem) -> Unit, close: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var name by remember { mutableStateOf("") }
    var key by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf(emptySet<String>()) }
    var error by remember { mutableStateOf<String?>(null) }
    // Set aside while it saves (#478): gone at once, back with the server's sentence when refused.
    var aside by remember { mutableStateOf(false) }
    // The system's file picker; the file is read here, at most 64 KB (an SSH private key is a few).
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { readAtMost(it, 64 * 1024 + 1) } }.getOrNull()
            }
            when {
                text == null -> error = "Couldn't read that file."
                text.length > 64 * 1024 -> error = "That file is too big for an SSH private key."
                else -> { key = text; error = null; if (name.isBlank()) name = uri.lastPathSegment?.substringAfterLast('/')?.substringAfterLast(':').orEmpty() }
            }
        }
    }
    if (!aside) AlertDialog(onDismissRequest = { key = ""; close() }, title = { Text("🗝️ Add an SSH key") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(name, { name = it.take(100) }, label = { Text("Name") }, placeholder = { Text("Home servers") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(key, { key = it }, label = { Text("Private key") }, placeholder = { Text("-----BEGIN OPENSSH PRIVATE KEY-----") }, minLines = 3, maxLines = 6,
                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
            TextButton(onClick = { pick.launch(arrayOf("*/*")) }) { Text("Pick its file", color = p.text) }
            Hint("OpenSSH format, without a passphrase. Leave it empty to generate a new key. It is saved in your Bitwarden's bot-dot folder: bots use it for SSH from the account's computer and never see it.")
            Text("Bots that may use it", color = p.text, style = MaterialTheme.typography.titleSmall)
            bots.forEach { b -> CheckRow("${b.emoji} ${b.name}", null, b.id in chosen) { on -> chosen = if (on) chosen + b.id else chosen - b.id } }
            error?.let { Text(it, color = p.err, style = MaterialTheme.typography.bodyMedium) }
        }
    }, confirmButton = {
        TextButton(enabled = !work.busy && name.isNotBlank(), onClick = {
            aside = true
            val given = key.isNotBlank()
            // Refused: the server's sentence, in the form, which comes back with what was given.
            work.run(if (given) "Adding the key…" else "Generating a key…", { if (given) "Key added" else "Key made" }, refused = { error = it; aside = false }) {
                val made = api!!.addSshKey(name.trim(), key.trim().ifEmpty { null }, chosen.toList()); key = ""; added(made)
            }
        }) { Text(if (key.isBlank()) "Generate new key" else "Add key", color = p.text) }
    }, dismissButton = { TextButton(onClick = { key = ""; close() }) { Text("Cancel", color = p.text) } })
}

/** At most [limit] bytes of [input], as text: enough to tell a file that is too big. */
private fun readAtMost(input: java.io.InputStream, limit: Int): String = String(bytesAtMost(input, limit), Charsets.UTF_8)

private fun bytesAtMost(input: java.io.InputStream, limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val chunk = ByteArray(8192)
    while (out.size() < limit) {
        val n = input.read(chunk, 0, minOf(chunk.size, limit - out.size()))
        if (n < 0) break
        out.write(chunk, 0, n)
    }
    return out.toByteArray()
}

/**
 * A secret of several lines read from a file the owner picks (#155), in the Vault's editor and a login request's
 * card: the system's file picker, the file's text as it is, or a sentence when it can't be read or is over 64 KB.
 * Returns what opens the picker.
 */
@Composable
internal fun rememberSecretFilePick(onText: (String) -> Unit, onError: (String) -> Unit): () -> Unit {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val bytes = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { bytesAtMost(it, VaultTypes.SECRET_FILE_MAX + 1) } }.getOrNull()
            }
            when {
                bytes == null -> onError("Couldn't read that file.")
                bytes.size > VaultTypes.SECRET_FILE_MAX -> onError("That file is too big for the Vault (64 KB at most).")
                else -> onText(String(bytes, Charsets.UTF_8))
            }
        }
    }
    return { pick.launch(arrayOf("*/*")) }
}

/** The public key of the SSH key just added, to copy into a server's authorized_keys. */
@Composable
private fun SshPublicKey(key: VaultItem, close: () -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    AlertDialog(onDismissRequest = close, title = { Text("🗝️ ${key.name}") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Hint("Saved in Bitwarden. To let it in, add its public key to ~/.ssh/authorized_keys on the server.")
            Text(key.publicKey.orEmpty(), color = p.text, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
            Text(key.fingerprint.orEmpty(), color = p.faint, fontSize = 12.sp)
        }
    }, confirmButton = {
        TextButton(onClick = {
            context.getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText("botdot", key.publicKey.orEmpty()))
        }) { Text("Copy public key", color = p.text) }
    }, dismissButton = { TextButton(onClick = close) { Text("Done", color = p.text) } })
}

@Composable
private fun VaultRow(i: VaultItem, bots: List<Bot>, features: Collection<String>?, onRemoveFile: (SecretFilePlace) -> Unit, onClick: () -> Unit) {
    val p = LocalPaper.current
    val names = i.allowedBots.map { id -> bots.firstOrNull { it.id == id }?.name ?: id }
    Column(Modifier.fillMaxWidth().background(p.panel, RoundedCornerShape(14.dp)).border(1.dp, p.line, RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(12.dp)) {
        Text("${KIND_ICON[i.kind] ?: "🔑"} ${i.name}", color = p.text, style = MaterialTheme.typography.titleMedium)
        when (i.kind) {
            "card" -> listOf("${i.brand ?: "Card"} •••• ${i.last4.orEmpty()}${i.expiry?.let { " · expires $it" } ?: ""} · you approve each payment")
            "identity" -> listOf(listOfNotNull(i.holder, i.email).joinToString(" · "))
            VaultTypes.SSH_KEY -> VaultTypes.sshKeyRows(i)
            VaultTypes.FILE -> VaultTypes.fileRows(i)
            else -> VaultTypes.rows(i, features) // its type before its address, then the line of that type
        }.forEach { Text(it, color = p.muted, style = MaterialTheme.typography.bodyMedium) }
        if (i.reprompt) Text("Asks for the master password again in Bitwarden, so bots can't use it.", color = p.faint, fontSize = 12.sp)
        Text(if (names.isEmpty()) "No bot may use it yet" else "Can be used by ${names.joinToString(", ")}", color = p.faint, fontSize = 12.sp)
        // Where botdot keeps it in a file (#253), each with its own "Remove the file".
        i.placedIn.forEach { f ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("📍 ${if (f.written) "Placed in" else "Allowed, not written yet:"} ${f.where} (${bots.firstOrNull { it.id == f.botId }?.name ?: f.botId}${if (f.at.isNotEmpty()) ", ${shortTime(f.at)}" else ""})", color = p.muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = { onRemoveFile(f) }) { Text("Remove the file", color = p.err) }
            }
        }
    }
}

private val KIND_ICON = mapOf("login" to "🔑", "card" to "💳", "identity" to "🪪", VaultTypes.SSH_KEY to "🗝️", VaultTypes.FILE to "📄")

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
private fun LoginEditor(item: VaultItem?, bots: List<Bot>, bitwarden: Boolean, features: Collection<String>?, api: dev.botdot.app.data.Api?, work: WorkState, done: (String?) -> Unit, close: () -> Unit) {
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
    // Set aside while it saves (#478): gone at once, back with the server's sentence when refused.
    var aside by remember { mutableStateOf(false) }
    var askDelete by remember { mutableStateOf(false) }
    val pick = rememberSecretFilePick({ pw = it; error = null }) { error = it }

    if (!aside) AlertDialog(onDismissRequest = close, title = { Text(item?.let { "Edit ${it.name}" } ?: "Add to the Vault") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // A type with its own address (a GitHub App's api.github.com) fills an empty address field.
            if (VaultTypes.shows(features)) Choice(VaultTypes.CONTROL, type, VaultTypes.options(features, item?.type)) { type = it; VaultTypes.of(it).site?.let { s -> if (site.isBlank()) site = s } }
            OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(site, { site = it.trim() }, label = { Text("Website or server") }, placeholder = { Text("pve.example.ts.net") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
            fields.username?.let { label ->
                OutlinedTextField(user, { user = it }, label = { Text(label) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                if (type == VaultTypes.GITHUB_APP) Hint(VaultTypes.GITHUB_APP_HINT)
            }
            if (fields.multiline) {
                SecretBox(pw, { pw = it }, fields.secret)
                TextButton(onClick = pick) { Text("Pick its file", color = p.text) }
            } else PasswordField(pw, { pw = it }, fields.secret)
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
            if (item != null) TextButton(onClick = { askDelete = true }, enabled = !work.busy) { Text("Delete", color = p.err) }
        }
    }, confirmButton = {
        TextButton(enabled = !work.busy && name.isNotBlank() && site.isNotBlank() && (item != null || pw.isNotEmpty()), onClick = {
            aside = true
            // A refused save: the server's sentence, the form as it was typed, the secret cleared (docs/api.md).
            work.run("Saving…", { if (bitwarden) "Saved in Bitwarden" else "Saved" }, refused = { pw = ""; error = it; aside = false }) {
                val sent = VaultTypes.sent(type, user, features, saved = item?.type)
                api!!.saveVaultLogin(item?.id, name.trim(), site, sent.username, pw, insecure, chosen.toList(),
                    hosts.split(',').map(String::trim).filter(String::isNotEmpty), sent.type, if (showsInComputer) inComputer else null)
                pw = ""; done(null)
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
private fun ItemBots(item: VaultItem, bots: List<Bot>, api: dev.botdot.app.data.Api?, work: WorkState, done: (String?) -> Unit, close: () -> Unit) {
    val p = LocalPaper.current
    var chosen by remember { mutableStateOf(item.allowedBots.toSet()) }
    var error by remember { mutableStateOf<String?>(null) }
    // Set aside while it saves (#478): gone at once, back with the server's sentence when refused.
    var aside by remember { mutableStateOf(false) }
    if (!aside) AlertDialog(onDismissRequest = close, title = { Text("${KIND_ICON[item.kind] ?: ""} ${item.name}") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Hint(VaultTypes.itemBotsHint(item.kind) + " Change the details themselves in Bitwarden.")
            bots.forEach { b -> CheckRow("${b.emoji} ${b.name}", null, b.id in chosen) { on -> chosen = if (on) chosen + b.id else chosen - b.id } }
            error?.let { Text(it, color = p.err, style = MaterialTheme.typography.bodyMedium) }
        }
    }, confirmButton = {
        TextButton(enabled = !work.busy, onClick = {
            aside = true
            work.run("Saving…", { "Saved" }, refused = { error = it; aside = false }) { api!!.setVaultBots(item.id, chosen.toList()); done(null) }
        }) { Text("Save", color = p.text) }
    }, dismissButton = { TextButton(onClick = close) { Text("Cancel", color = p.text) } })
}
