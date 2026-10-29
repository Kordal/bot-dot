package dev.botdot.app.ui

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay

/** How often the app asks for the desktop again while it is open: keeps the machine on, and is under boat.dev's 10 minutes. */
private const val ASK_AGAIN_MS = 4 * 60_000L
private const val STARTING_MS = 3_000L

/**
 * The desktop of a bot's machine on boat.dev (#564): boat.dev's stream in a web view, from a new address botdot asks
 * for each time the screen opens, and again every few minutes while it is open, which keeps the machine on. The address
 * is shown, never kept. Watching only, unless you take control (then taps and typing go to the machine). As on the web.
 */
@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoatScreen(app: BotDotApp, botId: String, botName: String, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    var control by remember { mutableStateOf(false) }
    var url by remember { mutableStateOf<String?>(null) } // the stream shown; a new one only after it stopped showing
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(api) {
        val a = api ?: return@LaunchedEffect
        while (true) {
            val wait = runCatching { a.boatDesktop(botId) }.fold(
                onSuccess = { d ->
                    error = null
                    if (d.running) { if (url == null) url = d.url; ASK_AGAIN_MS } else { url = null; control = false; STARTING_MS }
                },
                onFailure = { e -> url = null; control = false; error = e.message ?: tr("Couldn't open its screen."); ASK_AGAIN_MS },
            )
            delay(wait)
        }
    }

    Scaffold(
        containerColor = Color.Black,
        topBar = {
            TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(botName.ifBlank { tr("Its screen") }, style = MaterialTheme.typography.titleMedium) },
                actions = {
                    if (url != null) TextButton(onClick = { control = !control }) {
                        Text(if (control) tr("Stop controlling") else tr("Take control"), color = if (control) p.err else p.text)
                    }
                })
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize(), contentAlignment = Alignment.Center) {
            val shown = url
            when {
                shown != null -> {
                    AndroidView(
                        factory = { ctx ->
                            WebView(ctx).apply {
                                layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                settings.mediaPlaybackRequiresUserGesture = false // the stream plays at once
                                webViewClient = WebViewClient() // stay inside the view
                                setBackgroundColor(android.graphics.Color.BLACK)
                            }
                        },
                        update = {
                            it.isFocusable = control
                            it.isFocusableInTouchMode = control
                            if (it.tag != shown) { it.tag = shown; it.loadUrl(shown) }
                        },
                        onRelease = { it.destroy() },
                        modifier = Modifier.fillMaxSize(),
                    )
                    // Watching: a shield over the stream keeps taps off the machine until you take control.
                    if (!control) Box(Modifier.fillMaxSize().pointerInput(Unit) {
                        awaitPointerEventScope { while (true) awaitPointerEvent().changes.forEach { c -> c.consume() } }
                    })
                }
                error != null -> Text(error.orEmpty(), color = Color.White, modifier = Modifier.padding(Space.s24))
                else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Color.White)
                    Text(tr("Starting…"), color = Color.White, modifier = Modifier.padding(top = Space.s12))
                }
            }
        }
    }
}
