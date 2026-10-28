package dev.botdot.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
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
import dev.botdot.app.data.I18n
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
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
    var boatSizes by remember { mutableStateOf<dev.botdot.app.data.BoatSizes?>(null) } // only while boat.dev is set up (#539)
    var computerPlace by remember { mutableStateOf<dev.botdot.app.data.ComputerPlace?>(null) } // where the account's computer is (#579)
    var askPlace by remember { mutableStateOf<String?>(null) } // the place a switch asks about first
    val botsNow by app.store.bots.value.collectAsState()
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
            launch { runCatching { a.settings() }.onSuccess { info = it; edit = it.settings }.onError { tell(it.message ?: tr("Couldn't load")) } }
            launch { runCatching { a.setup() }.onSuccess { setup = it } }
            launch {
                runCatching { a.version() }.onSuccess { server = it; app.store.version.set(it) }
                if (server?.boat == true && server?.features?.contains("boat-size") == true) boatSizes = runCatching { a.boatSizes() }.getOrNull()
                if (dev.botdot.app.data.ComputerPlace.shows(server?.features, server?.boat)) computerPlace = runCatching { a.computerPlace() }.getOrNull()
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

    val models = listOf("" to tr("Claude Code's default")) + info.models.map { it.id to it.label.ifBlank { it.id } }
    val efforts = listOf("" to tr("Claude Code's default")) + info.efforts.map { it.id to it.label }
    val canThink = { m: String -> info.models.firstOrNull { it.id == m }?.effort ?: true }

    // Saved by itself (#636): the top says "Saved" for a moment, in place of a sentence.
    var savedAt by remember { mutableStateOf(0) }
    fun saved() { savedAt++ }
    // Model and reasoning save as they are picked; one that doesn't save goes back to what was.
    fun saveModel(next: AppSettings) {
        edit = next
        scope.launch { runCatching { api!!.saveSettings(next) }.onSuccess { info = it; edit = it.settings; saved() }.onError { edit = info.settings; tell(it.message ?: tr("Couldn't save")) } }
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = { TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg), title = { Text(tr("Settings"), style = MaterialTheme.typography.titleMedium) },
            actions = { SavedMark(savedAt) }) },
    ) { pad ->
        // One flat list (#636): a row per setting, its value and a chevron, and no helper text. Each row that holds
        // more opens under itself, closed whenever Settings opens.
        Column(Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 6.dp)) {
            Link(tr("Skills"), onClick = onSkills)
            if (dev.botdot.app.data.Pages.showsAll(server?.features)) Link(tr("Pages"), onClick = onPages) // every bot's pages (#361)
            Link(tr("Connectors"), onClick = onConnectors)
            Link(tr("Vault"), onClick = onVault)
            Spacer(Modifier.height(18.dp))

            Choice(tr("Model"), edit.defaultModel, models) { saveModel(edit.copy(defaultModel = it)) }
            if (canThink(edit.defaultModel)) Choice(tr("Reasoning"), edit.defaultEffort, efforts) { saveModel(edit.copy(defaultEffort = it)) }
            Rule()

            // The interface's language (#645): saved by itself, and every screen draws again in it at once.
            if (server?.features?.contains(I18n.FEATURE) == true) {
                Choice(tr("Language"), I18n.language, I18n.LANGUAGES) { to ->
                    if (to == I18n.language) return@Choice
                    scope.launch { runCatching { api!!.setLanguage(to); I18n.sync(api!!, server?.features) }.onSuccess { saved() }.onError { tell(it.message ?: tr("Couldn't save")) } }
                }
                Rule()
            }

            if (boatSizes != null || computerPlace != null) FoldSection(tr("Computer"), computerPlace?.let { c -> dev.botdot.app.data.ComputerPlace.options.firstOrNull { it.first == c.place }?.second }) {
                computerPlace?.let { c ->
                    Choice(tr("Where"), c.place, dev.botdot.app.data.ComputerPlace.options) { to ->
                        if (to == c.place) return@Choice
                        // Every bot with a computer moves along: whether their files go too is asked first (#556).
                        if (botsNow.orEmpty().any { it.computer == "linux" || it.computer == "boat" }) askPlace = to
                        else scope.launch { runCatching { api!!.setComputerPlace(to, false) }.onSuccess { computerPlace = it; saved() }.onError { tell(it.message ?: tr("Couldn't save")) } }
                    }
                }
                boatSizes?.takeIf { computerPlace == null || computerPlace?.place == "boat" }?.let { b ->
                    // A new size reaches each machine when it starts next.
                    Choice(tr("Size"), b.size, b.offered) { size ->
                        scope.launch { runCatching { api!!.setBoatSize(size) }.onSuccess { boatSizes = it; saved() }.onError { tell(it.message ?: tr("Couldn't save")) } }
                    }
                }
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
                        runCatching { call() }.onSuccess { tell(claudeCouldNotTell(it) ?: said); keyOpen = false; apiKey = "" }.onError { tell(it.message ?: tr("Couldn't change it")) }
                        load()
                    }
                }
                FoldSection("Claude", claudeValue(s.claude)) {
                    if (keys && keyOpen && loginUrl == null) {
                        OutlinedTextField(apiKey, { apiKey = it.trim() }, label = { Text(tr("Anthropic API key")) }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = { val key = apiKey; keyChange(tr("Saved. Bots now run on your API key")) { api!!.claudeSaveKey(key) } }, enabled = apiKey.isNotBlank(),
                                colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Save")) }
                            TextButton(onClick = { keyOpen = false; apiKey = "" }) { Text(tr("Cancel"), color = p.text) }
                        }
                    } else if (s.claude.onApiKey && loginUrl == null) {
                        Hint(claudeSays(s.claude))
                        Row {
                            if (s.claude.subscription == true) TextButton(onClick = { keyChange(tr("Bots now run on your Claude subscription")) { api!!.claudeUse("subscription") } }) {
                                Text(tr("Use the subscription instead"), color = p.text)
                            }
                            TextButton(onClick = { confirmRemoveKey = true }) { Text(tr("Remove the key"), color = p.text) }
                        }
                    } else if (s.claude.loggedIn && loginUrl == null) {
                        if (s.claude.fromEnv) Hint(claudeSays(s.claude))
                        else {
                            Hint(claudeSays(s.claude))
                            Row {
                                TextButton(onClick = { scope.launch { runCatching { api!!.claudeLogin() }.onSuccess { loginUrl = it.url }.onError { tell(it.message ?: tr("Couldn't start")) } } }) {
                                    Text(tr("Use another account"), color = p.text)
                                }
                                // Ask with a fresh count of what's running, since signing out stops it.
                                TextButton(onClick = { scope.launch { confirmLogout = runCatching { api!!.setup().running }.getOrDefault(0) } }) {
                                    Text(tr("Sign out"), color = p.text)
                                }
                            }
                        }
                        if (keys) KeyOffer(s.claude.apiKey != null, onUse = { keyChange(tr("Bots now run on your API key")) { api!!.claudeUse("api-key") } }, onNew = { keyOpen = true })
                    } else if (loginUrl == null) {
                        Hint(claudeSays(s.claude))
                        Button(onClick = { scope.launch { runCatching { api!!.claudeLogin() }.onSuccess { loginUrl = it.url }.onError { tell(it.message ?: tr("Couldn't start")) } } },
                            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Sign in to Claude")) }
                        if (keys) KeyOffer(s.claude.apiKey != null, onUse = { keyChange(tr("Bots now run on your API key")) { api!!.claudeUse("api-key") } }, onNew = { keyOpen = true })
                    } else {
                        // Open the page, sign in and allow access, then paste the code it shows.
                        OutlinedButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(loginUrl))) }) { Text(tr("Open the sign-in page"), color = p.text) }
                        OutlinedTextField(code, { code = it.trim() }, label = { Text(tr("Code")) }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = {
                                scope.launch {
                                    runCatching { api!!.claudeCode(code) }.onSuccess { tell(claudeCouldNotTell(it) ?: tr("Signed in to Claude")) }.onError { tell(it.message ?: tr("That code didn't work")) }
                                    loginUrl = null; code = ""; load()
                                }
                            }, enabled = code.isNotBlank(), colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Sign in")) }
                            TextButton(onClick = { loginUrl = null; code = "" }) { Text(tr("Cancel"), color = p.text) }
                        }
                    }
                }
            }

            backups?.let { b ->
                FoldSection(tr("Backups"), backupValue(b, backingUp)) {
                    // Turned on with a passphrase on the web page only.
                    if (!b.configured) Hint(tr("Turn them on in botdot's web page."))
                    else {
                        if (!b.error.isNullOrBlank()) Text(b.error, color = p.err, style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(enabled = !backingUp && !b.running, onClick = {
                                backingUp = true
                                scope.launch { runCatching { api!!.backupNow() }.onSuccess { backups = it; tell(tr("Backed up")) }.onError { tell(it.message ?: tr("Couldn't back up")) }; backingUp = false }
                            }) { Text(tr("Back up now"), color = p.text) }
                            b.last?.let { f ->
                                // To Downloads, with the app's session (BackupDownload): this account's backup alone.
                                OutlinedButton(onClick = {
                                    runCatching { dev.botdot.app.data.BackupDownload.start(context, api!!, f.name) }
                                        .onSuccess { tell(tr("Downloading to Downloads")) }.onFailure { tell(it.message ?: tr("Couldn't download")) }
                                }) { Text(tr("Download"), color = p.text) }
                            }
                        }
                    }
                }
            }

            update?.let { u ->
                // On: always the latest botdot version. Off: the owner updates when ready, before the admin's deadline.
                FoldSection(tr("Updates"), if (u.autoUpdate) tr("Automatic") else tr("By hand")) {
                    SwitchRow(tr("Update automatically"), checked = u.autoUpdate) { on ->
                        scope.launch { runCatching { api!!.setAutoUpdate(on) }.onSuccess { update = it; saved() }.onError { tell(it.message ?: tr("Couldn't change it")) } }
                    }
                    u.text().takeIf { it.isNotEmpty() }?.let { Hint(it) }
                    if (u.canUpdate) OutlinedButton(onClick = { confirmUpdateNow = true }) { Text(tr("Update now"), color = p.text) }
                    if (u.ready && updateNotes.isNotEmpty()) {
                        Text(dev.botdot.app.data.WhatsNew.TITLE, color = p.text, style = MaterialTheme.typography.titleSmall)
                        WhatsNewEntries(updateNotes, color = p.text)
                    }
                }
                // While it moves, the section follows it.
                if (u.moving) LaunchedEffect(u, updatePolls) { kotlinx.coroutines.delay(10_000); runCatching { api!!.ownUpdate() }.onSuccess { update = it }; updatePolls++ }
            }

            if (notifyOn) Link(tr("Notifications"), value = "On", onClick = onBattery)
            else Link(tr("Notifications"), value = "Off") {
                context.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName))
            }

            // Behind a front door (ADR 028): every session of the account ends, this phone's too, which then signs in
            // again with its passkey (the dialog says so).
            if (server?.features?.contains("accounts") == true) {
                FoldSection(tr("Sign-ins")) {
                    OutlinedButton(onClick = { confirmSignOut = true }) { Text(tr("Sign out everywhere"), color = p.text) }
                }
            }
            Link(tr("botdot's address"), value = api?.baseUrl?.removePrefix("https://")?.removePrefix("http://")?.trimEnd('/'), onClick = onChangeServer)
        }
    }

    confirmLogout?.let { running ->
        AlertDialog(
            onDismissRequest = { confirmLogout = null },
            title = { Text(tr("Sign out of Claude?")) },
            text = {
                Text(tr("Bots can't run until you sign in again.") + when (running) {
                    0 -> ""
                    else -> "\n\n" + trn(running, "A bot is working right now; it will be stopped.", "{n} bots are working right now; they will be stopped.")
                })
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = null
                    scope.launch {
                        runCatching { api!!.claudeLogout() }.onSuccess { tell(tr("Signed out of Claude")) }.onError { tell(it.message ?: tr("Couldn't sign out")) }
                        load()
                    }
                }) { Text(tr("Sign out"), color = p.text) }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = null }) { Text(tr("Cancel"), color = p.text) } },
        )
    }
    if (confirmRemoveKey) AlertDialog(
        onDismissRequest = { confirmRemoveKey = false },
        title = { Text(tr("Remove the API key?")) },
        text = { Text(if (setup?.claude?.subscription == true) tr("Bots will run on your Claude subscription.") else tr("Bots can't run until you sign in to Claude or save a key again.")) },
        confirmButton = {
            TextButton(onClick = {
                confirmRemoveKey = false
                scope.launch {
                    runCatching { api!!.claudeRemoveKey() }.onSuccess { tell(claudeCouldNotTell(it) ?: tr("API key removed")) }.onError { tell(it.message ?: tr("Couldn't remove it")) }
                    load()
                }
            }) { Text(tr("Remove"), color = p.text) }
        },
        dismissButton = { TextButton(onClick = { confirmRemoveKey = false }) { Text(tr("Cancel"), color = p.text) } },
    )
    askPlace?.let { to ->
        val move = { copy: Boolean ->
            askPlace = null
            scope.launch { runCatching { api!!.setComputerPlace(to, copy) }.onSuccess { computerPlace = it; app.store.bots.refresh() }.onError { tell(it.message ?: tr("Couldn't save")) } }
        }
        AlertDialog(
            onDismissRequest = { askPlace = null },
            title = { Text(if (to == "boat") tr("Copy the bots' files to the External Virtual PC?") else tr("Copy the bots' files to this machine?")) },
            confirmButton = { TextButton(onClick = { move(true) }) { Text(tr("Copy files"), color = p.text) } },
            dismissButton = { TextButton(onClick = { move(false) }) { Text(tr("Start empty"), color = p.text) } },
        )
    }

    if (confirmUpdateNow) AlertDialog(
        onDismissRequest = { confirmUpdateNow = false },
        title = { Text(tr("Update now?")) },
        text = { Text(tr("Your account moves to the new version: your bots restart, and work still running stops.")) },
        confirmButton = {
            TextButton(onClick = {
                confirmUpdateNow = false
                scope.launch { runCatching { api!!.updateNow() }.onSuccess { update = it }.onError { tell(it.message ?: tr("Couldn't update")) } }
            }) { Text(tr("Update now"), color = p.text) }
        },
        dismissButton = { TextButton(onClick = { confirmUpdateNow = false }) { Text(tr("Cancel"), color = p.text) } },
    )
    if (confirmSignOut) AlertDialog(
        onDismissRequest = { confirmSignOut = false },
        title = { Text(tr("Sign out everywhere?")) },
        text = { Text(tr("Every browser and app signed in to your account, this phone too, signs in again with your passkey.")) },
        confirmButton = {
            TextButton(onClick = {
                confirmSignOut = false
                // Done, the front door asks this phone to sign in, and its screen opens by itself.
                scope.launch { runCatching { api!!.signOutEverywhere() }.onError { tell(it.message ?: tr("Couldn't sign out")) } }
            }) { Text(tr("Sign out everywhere"), color = p.text) }
        },
        dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text(tr("Cancel"), color = p.text) } },
    )
}

/** On the subscription, the API key as the other way to run (#35): the saved one ([saved]), or a new one. */
@Composable
private fun KeyOffer(saved: Boolean, onUse: () -> Unit, onNew: () -> Unit) {
    val p = LocalPaper.current
    TextButton(onClick = if (saved) onUse else onNew) { Text(if (saved) tr("Use the API key instead") else tr("Use an API key instead"), color = p.text) }
}

/** A row that opens another screen (#636): its name, its [value] and a chevron, and a thin line under it. */
@Composable
private fun Link(text: String, value: String? = null, onClick: () -> Unit) {
    val p = LocalPaper.current
    Column {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(onClick = onClick).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(text, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            if (!value.isNullOrBlank()) Text(value, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 12.dp).widthIn(max = 220.dp))
            Text("›", color = p.faint, fontSize = 18.sp, modifier = Modifier.padding(start = 10.dp))
        }
        Rule()
    }
}

/** Claude's row in a word or two: what bots run on, or that they can't. */
internal fun claudeValue(c: dev.botdot.app.data.ClaudeStatus): String = when {
    c.onApiKey -> tr("API key")
    !c.loggedIn -> tr("Not signed in")
    else -> c.email ?: tr("Signed in")
}

/** The Backups row's value: what it does now, when it last did it, or that it is off. */
internal fun backupValue(b: dev.botdot.app.data.BackupInfo, backingUp: Boolean): String = when {
    !b.configured -> tr("Off")
    backingUp || b.running -> tr("Backing up…")
    else -> b.last?.let { shortTime(it.at) } ?: tr("None yet")
}
