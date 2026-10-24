package dev.botdot.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.botdot.app.BotDotApp
import dev.botdot.app.BuildConfig
import dev.botdot.app.data.AppSettings
import dev.botdot.app.data.SettingsInfo
import dev.botdot.app.data.SetupInfo
import dev.botdot.app.data.claudeCouldNotTell
import dev.botdot.app.data.claudeSays
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Settings: default model and reasoning, Claude's sign-in, backups, and where to go next. The Chief's model is on its own settings screen.
 * The admin installs a new version of botdot for every account (ADR 028); behind a front door that says so, the owner chooses
 * when this account switches to it (Updates, ADR 053). A newer app shows as a line on the home screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    app: BotDotApp,
    onSkills: () -> Unit, onConnectors: () -> Unit, onVault: () -> Unit, onPages: () -> Unit,
    onChangeServer: () -> Unit, onBattery: () -> Unit, onBack: () -> Unit,
) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }

    var info by remember { mutableStateOf(SettingsInfo()) }
    var edit by remember { mutableStateOf(AppSettings()) }
    var setup by remember { mutableStateOf<SetupInfo?>(null) }
    var server by remember { mutableStateOf<dev.botdot.app.data.VersionInfo?>(null) }
    var backups by remember { mutableStateOf<dev.botdot.app.data.BackupInfo?>(null) }
    var backingUp by remember { mutableStateOf(false) }
    var update by remember { mutableStateOf<dev.botdot.app.data.OwnUpdate?>(null) }
    var updateNotes by remember { mutableStateOf<List<dev.botdot.app.data.WhatsNew.Entry>>(emptyList()) } // what a waiting version brings (#303)
    var confirmUpdateNow by remember { mutableStateOf(false) }
    var updatePolls by remember { mutableStateOf(0) } // a new look each time, also when the answer is the same
    // Notifications turned off for this app (or never allowed): say so, checked again whenever you come back.
    var notifyOn by remember { mutableStateOf(NotificationManagerCompat.from(context).areNotificationsEnabled()) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) notifyOn = NotificationManagerCompat.from(context).areNotificationsEnabled() }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    var loginUrl by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var confirmLogout by remember { mutableStateOf<Int?>(null) } // how many bots are working, while asking
    var confirmSignOut by remember { mutableStateOf(false) }
    var keyOpen by remember { mutableStateOf(false) } // the box for an Anthropic API key (#35)
    var apiKey by remember { mutableStateOf("") }
    var confirmRemoveKey by remember { mutableStateOf(false) }

    // All at once: over Tailscale, one after another would take a round trip each.
    suspend fun load() {
        val a = api ?: return
        coroutineScope {
            launch { runCatching { a.settings() }.onSuccess { info = it; edit = it.settings }.onError { tell(it.message ?: "Couldn't load") } }
            launch { runCatching { a.setup() }.onSuccess { setup = it } }
            launch {
                runCatching { a.version() }.onSuccess { server = it; app.store.version.set(it) }
                // Updates: only where the front door says this account chooses when it switches (ADR 053).
                val session = runCatching { a.frontDoorSession() }.getOrNull()
                update = if (dev.botdot.app.data.OwnUpdate.on(server?.features, session)) runCatching { a.ownUpdate() }.getOrNull() else null
                // An older front door has no such route: no notes.
                updateNotes = if (update?.ready == true) runCatching { a.updateNotes() }.getOrDefault(emptyList()) else emptyList()
            }
            launch { runCatching { a.backups() }.onSuccess { backups = it } }
        }
    }
    LaunchedEffect(api) { load() }

    val models = listOf("" to "Claude Code's default") + info.models.map { it.id to it.label.ifBlank { it.id } }
    val efforts = listOf("" to "Claude Code's default") + info.efforts.map { it.id to it.label }
    val canThink = { m: String -> info.models.firstOrNull { it.id == m }?.effort ?: true }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = { TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg), title = { Text("Settings", style = MaterialTheme.typography.titleMedium) }) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            // Every section folds, closed whenever Settings opens; the links under More stay open.
            FoldSection("Default model and reasoning") {
                Choice("Model", edit.defaultModel, models) { edit = edit.copy(defaultModel = it) }
                if (canThink(edit.defaultModel)) Choice("Reasoning", edit.defaultEffort, efforts) { edit = edit.copy(defaultEffort = it) }
                Button(
                    onClick = { scope.launch { runCatching { api!!.saveSettings(edit) }.onSuccess { info = it; edit = it.settings; tell("Saved. New runs use it.") }.onError { tell(it.message ?: "Couldn't save") } } },
                    enabled = edit != info.settings, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText),
                ) { Text("Save") }
            }

            // Usage (#301): only from a server that counts it.
            val usageApi = api
            if (usageApi != null && dev.botdot.app.data.Usage.shows(server?.features)) UsageSection(usageApi)

            // Claude's sign-in (the setup page's first step), for when it has to be done again.
            setup?.let { s ->
                // An Anthropic API key as well as the subscription (#35): only from a server that takes one.
                val keys = s.claude.knowsKeys && server?.features?.contains("claude-api-key") == true
                fun keyChange(said: String, call: suspend () -> dev.botdot.app.data.ClaudeStatus?) {
                    scope.launch {
                        runCatching { call() }.onSuccess { tell(claudeCouldNotTell(it) ?: said); keyOpen = false; apiKey = "" }.onError { tell(it.message ?: "Couldn't change it") }
                        load()
                    }
                }
                FoldSection("✳︎ Claude") {
                    if (keys && keyOpen && loginUrl == null) {
                        Hint("Paste an Anthropic API key. Make one in the Claude Console (console.anthropic.com → API keys). botdot checks it with Anthropic, keeps it encrypted and never shows it again.")
                        OutlinedTextField(apiKey, { apiKey = it.trim() }, label = { Text("API key") }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = { val key = apiKey; keyChange("Saved. Bots now run on your API key") { api!!.claudeSaveKey(key) } }, enabled = apiKey.isNotBlank(),
                                colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Save") }
                            TextButton(onClick = { keyOpen = false; apiKey = "" }) { Text("Cancel", color = p.text) }
                        }
                    } else if (s.claude.onApiKey && loginUrl == null) {
                        Hint(claudeSays(s.claude))
                        Row {
                            if (s.claude.subscription == true) TextButton(onClick = { keyChange("Bots now run on your Claude subscription") { api!!.claudeUse("subscription") } }) {
                                Text("Use the subscription instead", color = p.text)
                            }
                            TextButton(onClick = { confirmRemoveKey = true }) { Text("Remove the key", color = p.text) }
                        }
                    } else if (s.claude.loggedIn && loginUrl == null) {
                        if (s.claude.fromEnv) Hint(claudeSays(s.claude))
                        else {
                            Hint(claudeSays(s.claude))
                            Row {
                                TextButton(onClick = { scope.launch { runCatching { api!!.claudeLogin() }.onSuccess { loginUrl = it.url }.onError { tell(it.message ?: "Couldn't start") } } }) {
                                    Text("Use another account", color = p.text)
                                }
                                // Ask with a fresh count of what's running, since signing out stops it.
                                TextButton(onClick = { scope.launch { confirmLogout = runCatching { api!!.setup().running }.getOrDefault(0) } }) {
                                    Text("Sign out", color = p.text)
                                }
                            }
                        }
                        if (keys) KeyOffer(s.claude.apiKey != null, onUse = { keyChange("Bots now run on your API key") { api!!.claudeUse("api-key") } }, onNew = { keyOpen = true })
                    } else if (loginUrl == null) {
                        Hint(claudeSays(s.claude))
                        Button(onClick = { scope.launch { runCatching { api!!.claudeLogin() }.onSuccess { loginUrl = it.url }.onError { tell(it.message ?: "Couldn't start") } } },
                            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Sign in to Claude") }
                        if (keys) KeyOffer(s.claude.apiKey != null, onUse = { keyChange("Bots now run on your API key") { api!!.claudeUse("api-key") } }, onNew = { keyOpen = true })
                    } else {
                        Hint("1. Open the sign-in page, sign in, allow access, and copy the code it shows.")
                        OutlinedButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(loginUrl))) }) { Text("Open the sign-in page", color = p.text) }
                        Hint("2. Paste the code here.")
                        OutlinedTextField(code, { code = it.trim() }, label = { Text("Code") }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = {
                                scope.launch {
                                    runCatching { api!!.claudeCode(code) }.onSuccess { tell(claudeCouldNotTell(it) ?: "Signed in to Claude") }.onError { tell(it.message ?: "That code didn't work") }
                                    loginUrl = null; code = ""; load()
                                }
                            }, enabled = code.isNotBlank(), colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Sign in") }
                            TextButton(onClick = { loginUrl = null; code = "" }) { Text("Cancel", color = p.text) }
                        }
                    }
                    if (s.timezone.isNotBlank()) Hint("Schedules run on ${s.timezone} time.")
                }
            }

            backups?.let { b ->
                FoldSection("Backups") {
                    if (!b.configured) Hint("Turn them on with a passphrase on botdot's web page (Settings → Backups).")
                    else {
                        Hint(if (backingUp || b.running) "Backing up…" else (b.last?.let { "Last backup ${shortTime(it.at)} · ${b.count} kept" } ?: "No backup yet") + ". Every night at 03:00.")
                        if (!b.error.isNullOrBlank()) Text(b.error, color = p.err, style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(enabled = !backingUp && !b.running, onClick = {
                                backingUp = true
                                scope.launch { runCatching { api!!.backupNow() }.onSuccess { backups = it; tell("Backed up") }.onError { tell(it.message ?: "Couldn't back up") }; backingUp = false }
                            }) { Text("Back up now", color = p.text) }
                            b.last?.let { f ->
                                // To Downloads, with the app's session (BackupDownload): this account's backup alone.
                                OutlinedButton(onClick = {
                                    runCatching { dev.botdot.app.data.BackupDownload.start(context, api!!, f.name) }
                                        .onSuccess { tell("Downloading to Downloads") }.onFailure { tell(it.message ?: "Couldn't download") }
                                }) { Text("Download", color = p.text) }
                            }
                        }
                    }
                }
            }

            update?.let { u ->
                FoldSection("Updates") {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Update automatically", color = p.text, style = MaterialTheme.typography.bodyLarge)
                            Hint("On: Always use the latest botdot version.")
                            Hint("Off: Update when you're ready, before the admin's deadline.")
                        }
                        androidx.compose.material3.Switch(checked = u.autoUpdate, onCheckedChange = { on ->
                            scope.launch { runCatching { api!!.setAutoUpdate(on) }.onSuccess { update = it }.onError { tell(it.message ?: "Couldn't change it") } }
                        })
                    }
                    u.text().takeIf { it.isNotEmpty() }?.let { Hint(it) }
                    if (u.canUpdate) OutlinedButton(onClick = { confirmUpdateNow = true }) { Text("Update now", color = p.text) }
                    if (u.ready && updateNotes.isNotEmpty()) {
                        Text(dev.botdot.app.data.WhatsNew.TITLE, color = p.text, style = MaterialTheme.typography.titleSmall)
                        WhatsNewEntries(updateNotes, color = p.text)
                    }
                }
                // While it moves, the section follows it.
                if (u.moving) LaunchedEffect(u, updatePolls) { kotlinx.coroutines.delay(10_000); runCatching { api!!.ownUpdate() }.onSuccess { update = it }; updatePolls++ }
            }

            // Behind a front door (ADR 028): every session of the account ends, this phone's too, which then signs in again.
            if (server?.features?.contains("accounts") == true) {
                FoldSection("Sign-ins") {
                    Hint("Signs out this phone and every browser and app signed in to your account. Each signs in again with your passkey.")
                    OutlinedButton(onClick = { confirmSignOut = true }) { Text("Sign out everywhere", color = p.text) }
                }
            }

            Section("More") {
                Link("✦ Skills", onSkills)
                if (dev.botdot.app.data.Pages.showsAll(server?.features)) Link("📄 Pages", onPages) // every bot's pages (#361)
                Link("🔌 Connectors", onConnectors)
                Link("🔐 Vault", onVault)
                if (notifyOn) Link("🔔 Notifications in the background", onBattery)
                else Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("🔔 Notifications are off", color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = {
                        context.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName))
                    }) { Text("Turn on", color = p.text) }
                }
                Link("🔗 Change botdot's address", onChangeServer)
            }
        }
    }

    confirmLogout?.let { running ->
        AlertDialog(
            onDismissRequest = { confirmLogout = null },
            title = { Text("Sign out of Claude?") },
            text = {
                Text("Bots can't run until you sign in again." + when (running) {
                    0 -> ""
                    1 -> "\n\nA bot is working right now; it will be stopped."
                    else -> "\n\n$running bots are working right now; they will be stopped."
                })
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = null
                    scope.launch {
                        runCatching { api!!.claudeLogout() }.onSuccess { tell("Signed out of Claude") }.onError { tell(it.message ?: "Couldn't sign out") }
                        load()
                    }
                }) { Text("Sign out", color = p.text) }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = null }) { Text("Cancel", color = p.text) } },
        )
    }
    if (confirmRemoveKey) AlertDialog(
        onDismissRequest = { confirmRemoveKey = false },
        title = { Text("Remove the API key?") },
        text = { Text(if (setup?.claude?.subscription == true) "Bots will run on your Claude subscription." else "Bots can't run until you sign in to Claude or save a key again.") },
        confirmButton = {
            TextButton(onClick = {
                confirmRemoveKey = false
                scope.launch {
                    runCatching { api!!.claudeRemoveKey() }.onSuccess { tell(claudeCouldNotTell(it) ?: "API key removed") }.onError { tell(it.message ?: "Couldn't remove it") }
                    load()
                }
            }) { Text("Remove", color = p.text) }
        },
        dismissButton = { TextButton(onClick = { confirmRemoveKey = false }) { Text("Cancel", color = p.text) } },
    )
    if (confirmUpdateNow) AlertDialog(
        onDismissRequest = { confirmUpdateNow = false },
        title = { Text("Update now?") },
        text = { Text("Your account moves to the new version: your bots restart, and work still running stops.") },
        confirmButton = {
            TextButton(onClick = {
                confirmUpdateNow = false
                scope.launch { runCatching { api!!.updateNow() }.onSuccess { update = it }.onError { tell(it.message ?: "Couldn't update") } }
            }) { Text("Update now", color = p.text) }
        },
        dismissButton = { TextButton(onClick = { confirmUpdateNow = false }) { Text("Cancel", color = p.text) } },
    )
    if (confirmSignOut) AlertDialog(
        onDismissRequest = { confirmSignOut = false },
        title = { Text("Sign out everywhere?") },
        text = { Text("Every browser and app signed in to your account, this phone too, signs in again with your passkey.") },
        confirmButton = {
            TextButton(onClick = {
                confirmSignOut = false
                // Done, the front door asks this phone to sign in, and its screen opens by itself.
                scope.launch { runCatching { api!!.signOutEverywhere() }.onError { tell(it.message ?: "Couldn't sign out") } }
            }) { Text("Sign out everywhere", color = p.text) }
        },
        dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text("Cancel", color = p.text) } },
    )
}

/** On the subscription, the API key as the other way to run (#35): the saved one ([saved]), or a new one. */
@Composable
private fun KeyOffer(saved: Boolean, onUse: () -> Unit, onNew: () -> Unit) {
    val p = LocalPaper.current
    TextButton(onClick = if (saved) onUse else onNew) { Text(if (saved) "Use the API key instead" else "Use an API key instead", color = p.text) }
}

@Composable
private fun Link(text: String, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text("›", color = p.faint, style = MaterialTheme.typography.titleMedium)
    }
}
