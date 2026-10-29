package dev.botdot.app.ui

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.ComputerInfo
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/**
 * A bot's desktop, live: botdot's own screen page (noVNC) in a web view. Watching only, unless you take control (then
 * taps and typing go to the bot's screen). Reset erases the account's computer for every bot that works on it, after a
 * confirmation in the server's words (#107); Update makes it again from a newer desktop when one is offered; a bot's
 * old computer of its own is shown above the screen, with Copy its files and Erase it. Under the screen, what each bot
 * uses of the account's computer (#109), in the server's words. Nothing turns it off: it is always on. As on the web.
 */
@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveScreen(app: BotDotApp, botId: String, botName: String, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    var control by remember { mutableStateOf(false) }
    var state by remember { mutableStateOf("checking") } // checking | starting | running | off | error | resetting | reset | updating
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<ComputerInfo?>(null) } // the server's words for it (#107)
    var askReset by remember { mutableStateOf(false) }
    var askUpdate by remember { mutableStateOf(false) }
    var askErase by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }

    suspend fun describe() { api?.let { a -> runCatching { a.computer(botId) }.onSuccess { info = it } } }

    fun reset() {
        val a = api ?: return
        val before = state
        val all = info?.resetsAll == true
        state = "resetting"; control = false
        scope.launch {
            runCatching { if (all) a.resetAccountComputer() else a.resetComputer(botId) }
                .onSuccess { state = "reset"; describe() }
                .onError { state = before; snack.showSnackbar(it.message ?: tr("Couldn't reset")) }
        }
    }

    fun update() {
        val a = api ?: return
        state = "updating"; control = false
        scope.launch {
            runCatching { a.updateAccountComputer() }
                .onSuccess { r ->
                    state = if (r.state == "running") "running" else "error"
                    if (!r.updated) error = r.error
                    r.error?.let { snack.showSnackbar(it) }
                    describe()
                }
                .onError { state = "running"; snack.showSnackbar(it.message ?: tr("Couldn't update")) }
        }
    }

    fun copyOld() {
        val a = api ?: return
        scope.launch {
            runCatching { a.copyOldComputer(botId) }
                .onSuccess { snack.showSnackbar(tr("Copied into {place}", "place" to it.copied)) }
                .onError { snack.showSnackbar(it.message ?: tr("Couldn't copy its files")) }
        }
    }

    fun eraseOld() {
        val a = api ?: return
        scope.launch {
            runCatching { a.resetComputer(botId) }
                .onSuccess { describe() }
                .onError { snack.showSnackbar(it.message ?: tr("Couldn't erase it")) }
        }
    }

    fun startScreen() {
        val a = api ?: return
        state = "starting"
        scope.launch {
            runCatching { a.startComputer(botId) }
                .onSuccess { state = "running"; describe() }
                .onError { state = "error"; error = it.message }
        }
    }

    LaunchedEffect(api) {
        val a = api ?: return@LaunchedEffect
        val found = runCatching { a.computer(botId) }.getOrNull()
        info = found
        // Its own screen off (#134): say so, and start it only when asked, rather than a viewer that can't connect.
        if (found?.state == "running") { state = if (found.screenOff != null) "off" else "running"; return@LaunchedEffect }
        state = "starting"
        runCatching { a.startComputer(botId) }
            .onSuccess { state = "running" }
            .onError { state = "error"; error = it.message }
    }

    Scaffold(
        containerColor = Color.Black,
        topBar = {
            TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(botName.ifBlank { tr("Its screen") }, style = MaterialTheme.typography.titleMedium) },
                actions = {
                    if (state == "running") TextButton(onClick = { control = !control }) {
                        Text(if (control) tr("Stop controlling") else tr("Take control"), color = if (control) p.err else p.text)
                    }
                    info?.update?.let { u -> if (state == "running") TextButton(onClick = { askUpdate = true }) { Text(u.yes.ifBlank { tr("Update") }, color = p.text) } }
                    if (state == "running" || state == "error") TextButton(onClick = { askReset = true }) { Text(tr("Reset"), color = p.err) }
                })
        },
        snackbarHost = { SnackbarHost(snack) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            // The bot's old computer of its own, kept and stopped until its files are copied and it is erased (#107).
            info?.old?.let { old ->
                Column(Modifier.fillMaxWidth().background(p.sunk).padding(horizontal = Space.s16, vertical = Space.s12)) {
                    Text(old.text, color = p.text, fontSize = Type.s14)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { copyOld() }) { Text(old.copy.ifBlank { tr("Copy its files") }, color = p.text) }
                        TextButton(onClick = { askErase = true }) { Text(old.erase.ifBlank { tr("Erase it") }, color = p.err) }
                    }
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                when (state) {
                    "running" -> {
                        val url = api?.screenUrl(botId, control) ?: return@Box
                        AndroidView(
                            factory = { ctx ->
                                if (dev.botdot.app.BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
                                WebView(ctx).apply {
                                    // Fill the space: with the default "as tall as its content", the page's 100% height is 0.
                                    layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
                                    settings.javaScriptEnabled = true
                                    settings.domStorageEnabled = true
                                    webViewClient = WebViewClient() // stay inside the view
                                    setBackgroundColor(android.graphics.Color.BLACK)
                                }
                            },
                            update = {
                                if (it.url != url) {
                                    // The page and its WebSocket go through the front door: they carry the app's session (ADR 028).
                                    val a = api
                                    a?.session?.token(a.baseUrl)?.let { token ->
                                        android.webkit.CookieManager.getInstance().setCookie(a.baseUrl, "${dev.botdot.app.data.Session.COOKIE}=$token; Path=/; Secure; HttpOnly")
                                    }
                                    it.loadUrl(url)
                                }
                            },
                            onRelease = { it.destroy() },
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                    "off" -> Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(Space.s24)) {
                        Text(info?.screenOff?.text.orEmpty(), color = Color.White)
                        TextButton(onClick = { startScreen() }) { Text(info?.screenOff?.start?.ifBlank { null } ?: tr("Start its screen"), color = Color.White) }
                    }
                    "error" -> Text(error ?: tr("Couldn't start its computer."), color = Color.White, modifier = Modifier.padding(Space.s24))
                    "reset" -> Text(
                        if (info?.resetsAll == true) tr("The account's computer was erased. The next computer tool of any bot starts it again, fresh.")
                        else tr("Its computer was erased. The next run starts from a fresh desktop."),
                        color = Color.White, modifier = Modifier.padding(Space.s24),
                    )
                    else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = Color.White)
                        Text(when (state) { "starting" -> tr("Starting its computer…"); "resetting" -> tr("Resetting…"); "updating" -> tr("Updating…"); else -> "" }, color = Color.White, modifier = Modifier.padding(top = Space.s12))
                    }
                }
            }
            // What each bot uses of the account's computer, most memory first (#109).
            info?.usage?.let { u ->
                Column(Modifier.fillMaxWidth().background(p.sunk).padding(horizontal = Space.s16, vertical = Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                    if (u.text.isNotBlank()) Text(u.text, color = p.muted, fontSize = Type.s12)
                    (u.bots + listOfNotNull(u.other)).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(row.name, color = p.text, fontSize = Type.s14, maxLines = 1, modifier = Modifier.weight(1f, fill = false).padding(end = Space.s12))
                            Text(row.text, color = p.muted, fontSize = Type.s14)
                        }
                    }
                }
            }
        }
    }

    // The confirmation names the bots that work on the account's computer and what is lost: the server's words.
    if (askReset) {
        val words = (info ?: ComputerInfo()).resetWords(botName)
        AlertDialog(
            onDismissRequest = { askReset = false },
            title = { Text(words.title) },
            text = { Text(words.text) },
            confirmButton = { TextButton(onClick = { askReset = false; reset() }) { Text(words.yes.ifBlank { tr("Reset") }, color = p.err) } },
            dismissButton = { TextButton(onClick = { askReset = false }) { Text(tr("Keep"), color = p.text) } },
        )
    }
    info?.update?.let { u ->
        if (askUpdate) AlertDialog(
            onDismissRequest = { askUpdate = false },
            text = { Text(u.text) },
            confirmButton = { TextButton(onClick = { askUpdate = false; update() }) { Text(u.yes.ifBlank { tr("Update") }, color = p.text) } },
            dismissButton = { TextButton(onClick = { askUpdate = false }) { Text(tr("Not now"), color = p.text) } },
        )
    }
    info?.old?.let { old ->
        if (askErase) AlertDialog(
            onDismissRequest = { askErase = false },
            text = { Text(old.confirm) },
            confirmButton = { TextButton(onClick = { askErase = false; eraseOld() }) { Text(old.erase.ifBlank { tr("Erase it") }, color = p.err) } },
            dismissButton = { TextButton(onClick = { askErase = false }) { Text(tr("Keep"), color = p.text) } },
        )
    }
}
