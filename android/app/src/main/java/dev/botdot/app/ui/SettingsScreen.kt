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
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Settings: default model and reasoning, Claude's sign-in, backups, and where to go next. The Chief's model is on its own settings screen.
 * No update: the admin updates botdot for every account at once (ADR 028), and a newer app shows as a line on the home screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    app: BotDotApp,
    onSkills: () -> Unit, onConnectors: () -> Unit, onVault: () -> Unit,
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

    // All at once: over Tailscale, one after another would take a round trip each.
    suspend fun load() {
        val a = api ?: return
        coroutineScope {
            launch { runCatching { a.settings() }.onSuccess { info = it; edit = it.settings }.onError { tell(it.message ?: "Couldn't load") } }
            launch { runCatching { a.setup() }.onSuccess { setup = it } }
            launch { runCatching { a.version() }.onSuccess { server = it; app.store.version.set(it) } }
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
            Section("Default model and reasoning", "Every bot that doesn't choose its own uses this. More reasoning is better on hard tasks, but slower.") {
                Choice("Model", edit.defaultModel, models) { edit = edit.copy(defaultModel = it) }
                if (canThink(edit.defaultModel)) Choice("Reasoning", edit.defaultEffort, efforts) { edit = edit.copy(defaultEffort = it) }
            }
            Button(
                onClick = { scope.launch { runCatching { api!!.saveSettings(edit) }.onSuccess { info = it; edit = it.settings; tell("Saved. New runs use it.") }.onError { tell(it.message ?: "Couldn't save") } } },
                enabled = edit != info.settings, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText),
            ) { Text("Save") }

            // Claude's sign-in (the setup page's first step), for when it has to be done again.
            setup?.let { s ->
                Section("✳︎ Claude") {
                    if (s.claude.loggedIn && loginUrl == null) {
                        if (s.claude.fromEnv) Hint("Signed in with a token from the server's settings.")
                        else {
                            Hint(s.claude.email?.let { "Signed in with $it." } ?: "Signed in.")
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
                    } else if (loginUrl == null) {
                        Hint("Not signed in, so bots can't run.")
                        Button(onClick = { scope.launch { runCatching { api!!.claudeLogin() }.onSuccess { loginUrl = it.url }.onError { tell(it.message ?: "Couldn't start") } } },
                            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Sign in to Claude") }
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
                Section("Backups") {
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

            // Behind a front door (ADR 028): every session of the account ends, this phone's too, which then signs in again.
            if (server?.features?.contains("accounts") == true) {
                Section("Sign-ins", "Signs out this phone and every browser and app signed in to your account. Each signs in again with your passkey.") {
                    OutlinedButton(onClick = { confirmSignOut = true }) { Text("Sign out everywhere", color = p.text) }
                }
            }

            Section("More") {
                Link("✦ Skills", onSkills)
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

@Composable
private fun Link(text: String, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text("›", color = p.faint, style = MaterialTheme.typography.titleMedium)
    }
}
