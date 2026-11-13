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
import androidx.compose.material3.Scaffold
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
    onSkills: () -> Unit, onConnectors: () -> Unit, onVault: () -> Unit, onPages: () -> Unit, onStorage: () -> Unit = {},
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
    var preparing by remember { mutableStateOf(false) }
    var pass1 by remember { mutableStateOf("") }
    var pass2 by remember { mutableStateOf("") }
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
    var session by remember { mutableStateOf<kotlinx.serialization.json.JsonObject?>(null) } // what the front door says of it
    var confirmDelete by remember { mutableStateOf(false) } // "Delete account" (#1307)
    var deleteTyped by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf(false) }
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
                session = runCatching { a.frontDoorSession() }.getOrNull()
                update = if (dev.botdot.app.data.OwnUpdate.on(server?.features, session)) runCatching { a.ownUpdate() }.getOrNull() else null
                // An older front door has no such route: no notes.
                updateNotes = if (update?.ready == true) runCatching { a.updateNotes() }.getOrDefault(emptyList()) else emptyList()
            }
            launch { runCatching { a.backups() }.onSuccess { backups = it } }
        }
    }
    LaunchedEffect(api) { load() }

    // Advanced (ADR 205): without it, the models and the proxy are left out.
    val adv = dev.botdot.app.data.Advanced.shows(server?.features, info.settings)
    LaunchedEffect(server, info) { if (server != null) dev.botdot.app.data.Advanced.take(server?.features, info.settings) }
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
        snackbarHost = { BotSnackbarHost(snack) },
        topBar = { TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg), title = { Text(tr("Settings"), style = MaterialTheme.typography.titleMedium) },
            actions = { SavedMark(savedAt) }) },
    ) { pad ->
        // One flat list (#636): a row per setting, its value and a chevron, and no helper text. Each row that holds
        // more opens under itself, closed whenever Settings opens.
        Column(Modifier.padding(pad).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = Space.s16, vertical = Space.s8)) {
            Link(tr("Skills"), onClick = onSkills)
            if (dev.botdot.app.data.Pages.showsAll(server?.features)) Link(tr("Pages"), onClick = onPages) // every bot's pages (#361)
            Link(tr("Connectors"), onClick = onConnectors)
            Link(tr("Passwords"), onClick = onVault)
            if (dev.botdot.app.data.Storage.shows(server?.features)) Link(tr("Storage"), onClick = onStorage) // what the account's files take on the disk
            Spacer(Modifier.height(Space.s16))

            if (adv) {
                Choice(tr("Model"), edit.defaultModel, models) { saveModel(edit.copy(defaultModel = it)) }
                if (canThink(edit.defaultModel)) Choice(tr("Reasoning"), edit.defaultEffort, efforts) { saveModel(edit.copy(defaultEffort = it)) }
                Rule()
            }

            // The account's proxies (ADR 171): the one the bots use, each with its test.
            val proxyApi = api
            if (adv && proxyApi != null && dev.botdot.app.data.Proxies.shows(server?.features)) ProxySection(proxyApi, ::tell, ::saved)

            // The interface's language (#645): saved by itself, and every screen draws again in it at once.
            if (server?.features?.contains(I18n.FEATURE) == true) {
                Choice(tr("Language"), I18n.language, I18n.LANGUAGES) { to ->
                    if (to == I18n.language) return@Choice
                    scope.launch { runCatching { api!!.setLanguage(to); I18n.sync(api!!, server?.features) }.onSuccess { saved() }.onError { tell(it.message ?: tr("Couldn't save")) } }
                }
                Rule()
            }

            val sizeShown = boatSizes != null && (computerPlace == null || computerPlace?.place == "boat")
            // The admin chooses the External Virtual PC's size too, on the admin page (ADR 163): a row with where it is and its size.
            if (dev.botdot.app.data.BoatSizes.byAdmin(server?.features)) {
                if (sizeShown) Fact(tr("Computer"), listOfNotNull(tr("External Virtual PC"), boatSizes?.sizeName).joinToString(" · "))
            } else if (sizeShown || (computerPlace != null && !dev.botdot.app.data.ComputerPlace.byAdmin(server?.features))) FoldSection(tr("Computer"), computerPlace?.let { c -> dev.botdot.app.data.ComputerPlace.options.firstOrNull { it.first == c.place }?.second }) {
                // Only the admin moves it, on the admin page, on a server that says so (ADR 146): then it is the section's value alone.
                computerPlace?.takeUnless { dev.botdot.app.data.ComputerPlace.byAdmin(server?.features) }?.let { c ->
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

            // Usage (#301): only from a server that counts it; without Advanced (ADR 205) without tokens.
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
                        Field(apiKey, { apiKey = it.trim() }, label = { Text(tr("Anthropic API key")) }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
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
                        SecondaryButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(loginUrl))) }) { Text(tr("Open the sign-in page"), color = p.text) }
                        Field(code, { code = it.trim() }, label = { Text(tr("Code")) }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
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
                FoldSection(tr("Backups"), backupValue(b, preparing)) {
                    val o = b.offsite
                    val lastGood = o?.lastSuccess
                    if (o?.state == "failed" && lastGood != null) Hint(tr("Last backup {ago}", "ago" to shortTime(lastGood)))
                    // A download of this account made now (ADR 158), with a passphrase chosen for it, to Downloads.
                    if (server?.features?.contains("backup-download") == true) {
                        Field(pass1, { pass1 = it }, placeholder = { Text(tr("Passphrase")) }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                        Field(pass2, { pass2 = it }, placeholder = { Text(tr("Again")) }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                        SecondaryButton(enabled = !preparing && !b.preparing && pass1.length >= b.minPassphrase, onClick = {
                            if (pass1 != pass2) { tell(tr("The two don't match")); return@SecondaryButton }
                            preparing = true
                            val phrase = pass1
                            scope.launch {
                                runCatching { api!!.backupDownload(phrase) }
                                    .onSuccess { asked ->
                                        pass1 = ""; pass2 = ""
                                        runCatching { dev.botdot.app.data.BackupDownload.start(context, api!!, asked) }
                                            .onSuccess { tell(tr("Downloading to Downloads")) }.onFailure { tell(it.message ?: tr("Couldn't download")) }
                                    }.onError { tell(it.message ?: tr("Couldn't download")) }
                                preparing = false
                            }
                        }) { Text(if (preparing || b.preparing) tr("Preparing…") else tr("Download"), color = p.text) }
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
                    if (u.canUpdate) SecondaryButton(onClick = { confirmUpdateNow = true }) { Text(tr("Update now"), color = p.text) }
                    if (u.ready && updateNotes.isNotEmpty()) {
                        Text(dev.botdot.app.data.WhatsNew.TITLE, color = p.text, style = MaterialTheme.typography.titleSmall)
                        WhatsNewEntries(updateNotes, color = p.text)
                    }
                }
                // While it moves, the section follows it.
                if (u.moving) LaunchedEffect(u, updatePolls) { kotlinx.coroutines.delay(10_000); runCatching { api!!.ownUpdate() }.onSuccess { update = it }; updatePolls++ }
            }

            if (notifyOn) Link(tr("Notifications"), value = tr("On"), onClick = onBattery)
            else Link(tr("Notifications"), value = tr("Off")) {
                context.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName))
            }

            // "Subscription" (ADR 234): a managed machine's billing page, which the fleet console names, in the browser.
            dev.botdot.app.data.Subscription.page(server?.features, session)?.let { page ->
                Link(tr("Subscription")) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(page))) } }
            }
            // Behind a front door (ADR 028): every session of the account ends, this phone's too, which then signs in
            // again with its passkey (the dialog says so).
            if (server?.features?.contains("accounts") == true) {
                FoldSection(tr("Sign-ins")) {
                    SecondaryButton(onClick = { confirmSignOut = true }) { Text(tr("Sign out everywhere"), color = p.text) }
                }
            }
            // "Delete account" (#1307): where the front door says this account may; the admin's own account is told why not.
            if (dev.botdot.app.data.AccountDeletion.on(server?.features, session)) {
                FoldSection(tr("Delete account")) {
                    SecondaryButton(onClick = { deleteTyped = ""; confirmDelete = true }) { Text(tr("Delete account…"), color = p.err) }
                }
            } else if (dev.botdot.app.data.AccountDeletion.page(server?.features, session) != null) {
                // A managed machine (#1312): the account is the machine, so the page of botdot.app says how.
                val deletePage = dev.botdot.app.data.AccountDeletion.page(server?.features, session)!!
                FoldSection(tr("Delete account")) {
                    Text(tr("Your account is deleted on botdot.app: the page says how."), color = p.muted)
                    SecondaryButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(deletePage))) } }) { Text(tr("Delete account…"), color = p.err) }
                }
            } else if (dev.botdot.app.data.AccountDeletion.adminNote(server?.features, session)) {
                FoldSection(tr("Delete account")) {
                    Text(tr("This is the admin's account of this machine, so it can't be deleted here. The machine is removed by its admin instead."), color = p.muted)
                }
            }
            // Advanced (ADR 205): saved by itself; every screen follows at once.
            if (server?.features?.contains(dev.botdot.app.data.Advanced.FEATURE) == true) {
                SwitchRow(tr("Advanced"), checked = adv) { on ->
                    scope.launch { runCatching { api!!.saveSettings(AppSettings(advanced = on)) }.onSuccess { info = it; edit = it.settings; saved() }.onError { tell(it.message ?: tr("Couldn't save")) } }
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
    if (confirmDelete) {
        val account = dev.botdot.app.data.AccountDeletion.account(session)
        AlertDialog(
            onDismissRequest = { if (!deleting) confirmDelete = false },
            title = { Text(tr("Delete your account?")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (dev.botdot.app.data.AccountDeletion.request(session)) tr("Your account is paused and you are signed out at once. Your subscription is cancelled, and the account, its bots, chats, files, notes and Board are erased within 7 days.")
                        else tr("This deletes at once, for good: the account, its bots, chats, files, notes, Board, containers, passkeys, sessions and feedback."))
                    Text(tr("Off-site backups of the account are kept for 14 days, then removed."))
                    Field(deleteTyped, { deleteTyped = it }, label = { Text(tr("Type your account name, {name}, to confirm", "name" to account)) }, singleLine = true,
                        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii))
                }
            },
            confirmButton = {
                TextButton(enabled = !deleting && dev.botdot.app.data.AccountDeletion.matches(deleteTyped, account), onClick = {
                    deleting = true
                    // Done, the front door clears this phone's session, and the sign-in screen opens by itself, which
                    // leaves Settings and ends its scope: the app's own scope and context keep the answer to say it.
                    val a = api!!
                    app.scope.launch {
                        runCatching { a.deleteAccount(account) }
                            .onSuccess { confirmDelete = false; android.widget.Toast.makeText(app, dev.botdot.app.data.AccountDeletion.said(it), android.widget.Toast.LENGTH_LONG).show() }
                            .onError { tell(it.message ?: tr("Couldn't delete the account")) }
                        deleting = false
                    }
                }) { Text(tr("Delete account"), color = p.err) }
            },
            dismissButton = { TextButton(enabled = !deleting, onClick = { confirmDelete = false }) { Text(tr("Cancel"), color = p.text) } },
        )
    }
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
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(onClick = onClick).padding(vertical = Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Text(text, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            if (!value.isNullOrBlank()) Text(value, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s12).widthIn(max = 220.dp))
            Text("›", color = p.faint, fontSize = Type.s16, modifier = Modifier.padding(start = Space.s12))
        }
        Rule()
    }
}

/** A row that only says something: its name and its [value], and a thin line under it. */
@Composable
private fun Fact(text: String, value: String) {
    val p = LocalPaper.current
    Column {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(vertical = Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Text(text, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Text(value, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = Space.s12).widthIn(max = 220.dp))
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

/** The Backups row's value: the off-site backup's state, or when the account's data last went off-site (ADR 158). */
internal fun backupValue(b: dev.botdot.app.data.BackupInfo, preparing: Boolean): String {
    val o = b.offsite
    return when {
        preparing || b.preparing -> tr("Preparing…")
        o == null || o.state == "off" -> tr("Off")
        o.state == "backing-up" -> tr("Backing up…")
        o.state == "failed" -> tr("Failed")
        else -> o.lastSuccess?.let { shortTime(it) } ?: tr("No backup yet")
    }
}
