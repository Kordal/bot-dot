package dev.botdot.app.ui

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.botdot.app.data.InteractivePages
import dev.botdot.app.data.InteractiveView
import dev.botdot.app.data.NotesWake
import dev.botdot.app.data.UploadedFiles
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.serialization.json.JsonObject

/**
 * A bot's interactive page (#399, ADR 072) in the viewer: the bar that says it is isolated, with Full screen, Versions
 * and Download, and the page in a WebView on the sandbox's own address. The WebView has JavaScript for the page and
 * nothing else: no bridge to the app, no files, no storage, no new windows. A tap on a link out, or the page's own
 * request for one, asks the owner first and opens in the browser.
 */
@Composable
fun InteractiveBar(site: InteractiveView, full: Boolean, onFull: () -> Unit, onVersions: () -> Unit, onDownload: () -> Unit, onRollBack: () -> Unit, onCurrent: () -> Unit) {
    val p = LocalPaper.current
    if (full) return
    Column(Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            Icon(Icons.Filled.Lock, contentDescription = null, tint = p.okText, modifier = Modifier.size(14.dp))
            Text(InteractivePages.ISOLATED, color = p.muted, fontSize = Type.s12, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            SecondaryButton(onClick = onFull) { Text(tr("Full screen"), color = p.text, fontSize = Type.s14) }
            SecondaryButton(onClick = onVersions) { Text(tr("Versions"), color = p.text, fontSize = Type.s14) }
            SecondaryButton(onClick = onDownload) { Text(tr("Download"), color = p.text, fontSize = Type.s14) }
        }
        if (site.shown != site.current) Column(Modifier.fillMaxWidth().background(p.warnSoft).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            Text(tr("You are looking at version {shown}. The page shows version {current}.", "shown" to site.shown, "current" to site.current), color = p.text, fontSize = Type.s14)
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                Button(onClick = onRollBack, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Go back to this version"), fontSize = Type.s14) }
                TextButton(onClick = onCurrent) { Text(tr("Show the current one"), color = p.text, fontSize = Type.s14) }
            }
        }
    }
}

/** The page itself; without the sandbox's address on this machine, only what to do instead. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun InteractiveFrame(site: InteractiveView, values: JsonObject?, onDownload: () -> Unit) {
    val p = LocalPaper.current
    val frame = site.frame
    var asking by remember { mutableStateOf<String?>(null) }
    if (frame == null) {
        ViewerState(tr("This machine can't show interactive pages yet"), tr("They need an address of their own, which the admin's next update of botdot sets up. Download it to open it on your phone.")) {
            Button(onClick = onDownload, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Save to Downloads")) }
        }
        return
    }
    val bg = p.bg.toArgb()
    // A new address (another version, or a new publish) is a new WebView, so what it may load is checked against it.
    key(frame) { AndroidView(modifier = Modifier.fillMaxSize(), factory = { ctx ->
        WebView(ctx).apply {
            setBackgroundColor(bg)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = false
            settings.databaseEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.setGeolocationEnabled(false)
            settings.mediaPlaybackRequiresUserGesture = true
            settings.saveFormData = false
            android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    when (val go = InteractivePages.go(frame, request.url.toString())) {
                        InteractivePages.Go.Stay -> false
                        is InteractivePages.Go.Ask -> { asking = go.url; true }
                        InteractivePages.Go.Block -> true
                    }
                override fun onPageFinished(view: WebView, url: String?) {
                    view.evaluateJavascript(InteractivePages.LISTENER, null)
                    (view.tag as? JsonObject)?.let { view.evaluateJavascript(InteractivePages.valuesScript(it), null) }
                }
            }
            tag = values
            loadUrl(frame)
        }
    }, update = { web ->
        if (web.tag !== values) {
            web.tag = values
            values?.let { web.evaluateJavascript(InteractivePages.valuesScript(it), null) }
        }
    }) }
    asking?.let { url -> LinkOut(url) { asking = null } }
}

/** A link out of the page: where it leads, before it opens in the browser. */
@Composable
private fun LinkOut(url: String, onDone: () -> Unit) {
    val p = LocalPaper.current
    val context = androidx.compose.ui.platform.LocalContext.current
    val host = runCatching { java.net.URI(url).host }.getOrNull().orEmpty()
    AlertDialog(onDismissRequest = onDone, containerColor = p.panel,
        title = { Text(tr("Open a link?"), color = p.text) },
        text = { Column { Text(tr("The page wants to open {host}:", "host" to host), color = p.text); Text(url, color = p.muted, fontFamily = GeistMono, fontSize = Type.s12) } },
        confirmButton = {
            TextButton(onClick = {
                onDone()
                runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))) }
            }) { Text(tr("Open"), color = p.text) }
        },
        dismissButton = { TextButton(onClick = onDone) { Text(tr("Cancel"), color = p.muted) } })
}

/** The versions kept, newest first: show one, or make it the page again. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VersionsSheet(title: String, site: InteractiveView, onShow: (Int) -> Unit, onCurrent: (Int) -> Unit, onDismiss: () -> Unit) {
    val p = LocalPaper.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = p.panel) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = Space.s16, end = Space.s16, bottom = Space.s24), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
            Text(tr("Versions of “{title}”", "title" to title), color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s16)
            Text(tr("Each time the bot publishes it, a new version. The last ten are kept."), color = p.muted, fontSize = Type.s14)
            site.versions.forEach { v ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                    Column(Modifier.weight(1f)) {
                        Text(tr("Version {n}", "n" to v.n) + if (v.n == site.current) " · " + tr("on the page") else "", color = if (v.n == site.current) p.okText else p.text, fontSize = Type.s14)
                        Text("${NotesWake.ago(v.at)} · ${UploadedFiles.size(v.bytes)} · " + trn(v.files, "{n} file", "{n} files"), color = p.faint, fontSize = Type.s12)
                    }
                    TextButton(onClick = { onShow(v.n) }) { Text(tr("Show"), color = p.text) }
                    if (v.n != site.current) SecondaryButton(onClick = { onCurrent(v.n) }) { Text(tr("Go back to it"), color = p.text, fontSize = Type.s14) }
                }
            }
        }
    }
}
