package dev.botdot.app.ui

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import kotlinx.coroutines.launch

/**
 * A bot's desktop, live: botdot's own screen page (noVNC) in a web view. Watching only, unless
 * you take control (then taps and typing go to the bot's computer). Reset erases the computer, as on the web.
 */
@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveScreen(app: BotDotApp, botId: String, botName: String, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    var control by remember { mutableStateOf(false) }
    var state by remember { mutableStateOf("checking") } // checking | starting | running | error | resetting | reset
    var error by remember { mutableStateOf<String?>(null) }
    var askReset by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }

    fun reset() {
        val a = api ?: return
        val before = state
        state = "resetting"; control = false
        scope.launch {
            runCatching { a.resetComputer(botId) }
                .onSuccess { state = "reset" }
                .onError { state = before; snack.showSnackbar(it.message ?: "Couldn't reset") }
        }
    }

    LaunchedEffect(api) {
        val a = api ?: return@LaunchedEffect
        val info = runCatching { a.computer(botId) }.getOrNull()
        if (info?.state == "running") { state = "running"; return@LaunchedEffect }
        state = "starting"
        runCatching { a.startComputer(botId) }
            .onSuccess { state = "running" }
            .onError { state = "error"; error = it.message }
    }

    Scaffold(
        containerColor = Color.Black,
        topBar = {
            TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(botName.ifBlank { "Its screen" }, style = MaterialTheme.typography.titleMedium) },
                actions = {
                    if (state == "running") TextButton(onClick = { control = !control }) {
                        Text(if (control) "Stop controlling" else "Take control", color = if (control) p.err else p.text)
                    }
                    if (state == "running" || state == "error") TextButton(onClick = { askReset = true }) { Text("Reset", color = p.err) }
                })
        },
        snackbarHost = { SnackbarHost(snack) },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize(), contentAlignment = Alignment.Center) {
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
                "error" -> Text(error ?: "Couldn't start its computer.", color = Color.White, modifier = Modifier.padding(24.dp))
                "reset" -> Text("Its computer was erased. The next run starts from a fresh desktop.", color = Color.White, modifier = Modifier.padding(24.dp))
                else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Color.White)
                    Text(when (state) { "starting" -> "Starting its computer…"; "resetting" -> "Resetting…"; else -> "" }, color = Color.White, modifier = Modifier.padding(top = 12.dp))
                }
            }
        }
    }

    if (askReset) AlertDialog(
        onDismissRequest = { askReset = false },
        title = { Text("Reset ${botName.ifBlank { "its" }}'s computer?") },
        text = { Text("Everything installed on it, its files and its browser logins are erased. The next run starts from a fresh desktop.") },
        confirmButton = { TextButton(onClick = { askReset = false; reset() }) { Text("Reset", color = p.err) } },
        dismissButton = { TextButton(onClick = { askReset = false }) { Text("Keep", color = p.text) } },
    )
}
