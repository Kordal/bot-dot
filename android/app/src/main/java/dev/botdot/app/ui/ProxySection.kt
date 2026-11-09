package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Api
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Proxies
import dev.botdot.app.data.Proxy
import dev.botdot.app.data.ProxyForm
import dev.botdot.app.data.ProxyList
import dev.botdot.app.data.ProxyTest
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/**
 * Settings → Proxy (ADR 171): the one the bots use, each proxy with its test, and a dialog to add or change one.
 * Drawn as the web page draws it (public/proxies.js). Shown only from a server whose features have `proxies`.
 */
@Composable
fun ProxySection(api: Api, tell: (String) -> Unit, saved: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<ProxyList?>(null) }
    var testing by remember { mutableStateOf(setOf<String>()) }
    var editing by remember { mutableStateOf<Proxy?>(null) }
    var adding by remember { mutableStateOf(false) }
    suspend fun load() { runCatching { api.proxies() }.onSuccess { list = it } }
    LaunchedEffect(api) { load() }
    val l = list ?: return
    val byId = { id: String -> l.proxies.firstOrNull { it.id == id } }

    FoldSection(tr("Proxy"), byId(l.default)?.name ?: tr("None")) {
        if (l.proxies.isNotEmpty()) {
            Choice(tr("Bots use"), l.default, listOf("" to tr("No proxy")) + l.proxies.map { it.id to it.name }) { to ->
                if (to == l.default) return@Choice
                scope.launch { runCatching { api.setDefaultProxy(to) }.onSuccess { list = it; saved() }.onError { tell(it.message ?: tr("Couldn't save")) } }
            }
            l.proxies.forEach { x ->
                Rule()
                ProxyItem(x, testing = x.id in testing, onEdit = { editing = x }) {
                    testing = testing + x.id
                    scope.launch {
                        runCatching { api.testProxy(x.id) }.onError { tell(it.message ?: tr("Couldn't test")) }
                        load()
                        testing = testing - x.id
                    }
                }
            }
        }
        SecondaryButton(onClick = { adding = true }) { Text(tr("Add proxy"), color = p.text) }
    }

    if (adding || editing != null) ProxyDialog(api, editing, tell, onClose = { adding = false; editing = null }) { done ->
        adding = false; editing = null
        scope.launch {
            // Its dot in the list: tested as it is saved.
            done?.let { runCatching { api.testProxy(it) } }
            load()
        }
    }
}

@Composable
private fun Dot(t: ProxyTest?) {
    val p = LocalPaper.current
    Box(Modifier.size(8.dp).background(if (t == null) p.faint else if (t.ok) p.ok else p.err, CircleShape))
}

@Composable
private fun ProxyItem(x: Proxy, testing: Boolean, onEdit: () -> Unit, onTest: () -> Unit) {
    val p = LocalPaper.current
    val t = x.lastTest
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
        Dot(t)
        Column(Modifier.weight(1f)) {
            Text(x.name, color = p.text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (t != null && !t.ok) Proxies.said(t.error) else Proxies.where(t).ifEmpty { "${x.host}:${x.port}" },
                color = if (t != null && !t.ok) p.err else p.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        SecondaryButton(onClick = onTest, enabled = !testing) { Text(tr("Test"), color = p.text) }
        Text("⋯", color = p.text, modifier = Modifier.clickable(onClickLabel = tr("Edit"), onClick = onEdit).padding(Space.s8))
    }
}

@Composable
private fun TestLine(r: ProxyTest) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().background(p.fill, RoundedCornerShape(14.dp)).padding(horizontal = Space.s16, vertical = Space.s12),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        Dot(r)
        if (!r.ok) Text(Proxies.said(r.error), color = p.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        else {
            Text(Proxies.where(r), color = p.text, style = MaterialTheme.typography.bodyMedium)
            Text(r.ip.orEmpty(), color = p.muted, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text("${(r.ms ?: 0.0).toLong()} ms", color = p.muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** Add a proxy ([x] null) or change one: a pasted address in Host fills the rest. [onDone] with the saved one's id, null when removed. */
@Composable
private fun ProxyDialog(api: Api, x: Proxy?, tell: (String) -> Unit, onClose: () -> Unit, onDone: (String?) -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var f by remember { mutableStateOf(ProxyForm(name = x?.name.orEmpty(), type = x?.type ?: "socks5", host = x?.host.orEmpty(), port = x?.port?.takeIf { it > 0 }?.toString().orEmpty(), username = x?.username.orEmpty())) }
    var result by remember { mutableStateOf(x?.lastTest) }
    var busy by remember { mutableStateOf(false) }
    var askRemove by remember { mutableStateOf(false) }
    val ready = f.host.isNotBlank() && f.port.toIntOrNull() != null

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(if (x == null) tr("Add proxy") else tr("Edit proxy")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s12)) {
                Field(f.name, { f = f.copy(name = it.take(60)) }, label = { Text(tr("Name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                    listOf("socks5" to "SOCKS5", "http" to "HTTP").forEach { (v, label) ->
                        if (f.type == v) androidx.compose.material3.Button(onClick = {}, colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(label) }
                        else SecondaryButton(onClick = { f = f.copy(type = v) }) { Text(label, color = p.text) }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                    Field(f.host, { typed -> f = (if (Regex("[:@]").containsMatchIn(typed)) Proxies.pasted(typed, f) else null) ?: f.copy(host = typed.trim()) },
                        label = { Text(tr("Host")) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.weight(1f))
                    Field(f.port, { f = f.copy(port = it.filter(Char::isDigit).take(5)) }, label = { Text(tr("Port")) }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(96.dp))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                    Field(f.username, { f = f.copy(username = it) }, label = { Text(tr("Login")) }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false), modifier = Modifier.weight(1f))
                    Field(f.password, { f = f.copy(password = it) }, label = { Text(tr("Password")) }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                        placeholder = { if (x?.hasPassword == true) Text("••••••••") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.weight(1f))
                }
                result?.let { TestLine(it) }
                Row(horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                    if (x != null) TextButton(onClick = { askRemove = true }) { Text(tr("Remove"), color = p.err) }
                    SecondaryButton(enabled = ready && !busy, onClick = {
                        busy = true
                        scope.launch {
                            result = runCatching { api.testProxyForm(f, x?.id) }.getOrElse { ProxyTest(ok = false, error = it.message) }
                            busy = false
                        }
                    }) { Text(tr("Test"), color = p.text) }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = ready && !busy, onClick = {
                busy = true
                scope.launch {
                    runCatching { if (x == null) api.addProxy(f) else api.saveProxy(x.id, f) }
                        .onSuccess { onDone(it.id) }.onError { tell(it.message ?: tr("Couldn't save")) }
                    busy = false
                }
            }) { Text(tr("Save"), color = p.text) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(tr("Cancel"), color = p.text) } },
    )
    if (askRemove && x != null) AlertDialog(
        onDismissRequest = { askRemove = false },
        title = { Text(tr("Remove {name}?", "name" to x.name)) },
        confirmButton = {
            TextButton(onClick = {
                askRemove = false
                scope.launch { runCatching { api.removeProxy(x.id) }.onSuccess { onDone(null) }.onError { tell(it.message ?: tr("Couldn't remove it")) } }
            }) { Text(tr("Remove"), color = p.err) }
        },
        dismissButton = { TextButton(onClick = { askRemove = false }) { Text(tr("Cancel"), color = p.text) } },
    )
}

/**
 * A bot's Proxy row (ADR 171), beside its computer: the account's (named), none, or one of the account's proxies.
 * Only once there is a proxy to pick, or the bot has a choice of its own.
 */
@Composable
fun BotProxyRow(api: Api, b: Bot, value: String, onChange: (String) -> Unit) {
    var list by remember { mutableStateOf<ProxyList?>(null) }
    LaunchedEffect(api) { runCatching { api.proxies() }.onSuccess { list = it } }
    val l = list ?: return
    if (l.proxies.isEmpty() && b.proxy.isEmpty()) return
    val account = l.proxies.firstOrNull { it.id == l.default }?.name ?: tr("No proxy")
    Choice(tr("Proxy"), value, listOf("" to tr("Account's ({name})", "name" to account), "none" to tr("No proxy")) + l.proxies.map { it.id to it.name }, onChange)
}
