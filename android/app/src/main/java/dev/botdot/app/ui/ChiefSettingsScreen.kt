package dev.botdot.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.AppSettings
import dev.botdot.app.data.Checkup
import dev.botdot.app.data.SettingsInfo
import kotlinx.coroutines.launch

/** The Chief's settings (its figure and name in its chat): its model and reasoning, your rules for it and its earlier chats. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChiefSettingsScreen(app: BotDotApp, onChat: (String) -> Unit, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    var info by remember { mutableStateOf(SettingsInfo()) }
    var edit by remember { mutableStateOf(AppSettings()) }
    LaunchedEffect(api) { runCatching { api?.settings() }.onSuccess { if (it != null) { info = it; edit = it.settings } }.onError { tell(it.message ?: "Couldn't load") } }
    val overview by app.store.chief.value.collectAsState()
    val chats = overview?.chats.orEmpty()
    val canThink = { m: String -> info.models.firstOrNull { it.id == m }?.effort ?: true }
    // The checkup's two switches, only from a server that has it. Each saves at once; the feed says when another
    // app or the Chief changed them.
    val server by app.store.version.value.collectAsState()
    val hasCheckup = Checkup.shows(server?.features)
    var checkup by remember { mutableStateOf<Checkup?>(null) }
    LaunchedEffect(api, hasCheckup) { if (hasCheckup) runCatching { api?.checkup() }.onSuccess { checkup = it }.onError { tell(it.message ?: "Couldn't load") } else checkup = null }
    LaunchedEffect(Unit) { app.feed.events.collect { ev -> Checkup.event(ev)?.let { checkup = it } } }
    // A refused or failed change puts the switch back and says why.
    fun switch(before: Checkup, field: String, now: Checkup) {
        checkup = now
        scope.launch { runCatching { api!!.setCheckup(field, if (field == "on") now.on else now.webSearch) }.onSuccess { if (it != null) checkup = it }.onError { if (checkup == now) checkup = before; tell(it.message ?: "Couldn't save") } } // not over what the feed said meanwhile
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = { TopAppBar(navigationIcon = { if (LocalPanelClose.current == null) BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg), title = { Text("Chief of Staff", style = MaterialTheme.typography.titleMedium) }, actions = { PanelClose() }) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Section("Model and reasoning", "What the Chief uses to plan, create and manage your bots.") {
                Choice("Model", edit.chiefModel, listOf("" to "Same as the default") + info.models.map { it.id to it.label.ifBlank { it.id } }) { edit = edit.copy(chiefModel = it) }
                if (canThink(edit.chiefModel.ifBlank { edit.defaultModel })) Choice("Reasoning", edit.chiefEffort, listOf("" to "Same as the default") + info.efforts.map { it.id to it.label }) { edit = edit.copy(chiefEffort = it) }
            }
            Section("Your rules for it", "Added to its own instructions, for the Chief only.") {
                OutlinedTextField(edit.chiefRules, { edit = edit.copy(chiefRules = it.take(4000)) }, minLines = 3, modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("e.g. Always ask me before creating a bot. Talk to me like a colleague: short and direct.") })
            }
            Button(
                onClick = { scope.launch { runCatching { api!!.saveSettings(edit) }.onSuccess { info = it; edit = it.settings; tell("Saved. The Chief uses it from its next reply.") }.onError { tell(it.message ?: "Couldn't save") } } },
                enabled = edit != info.settings, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText),
            ) { Text("Save") }
            checkup?.takeIf { hasCheckup }?.let { c ->
                Section(null) {
                    SwitchRow(Checkup.LABEL, c.caption, c.on) { switch(c, "on", c.copy(on = it)) }
                    SwitchRow(Checkup.WEB_SEARCH, Checkup.WEB_SEARCH_HINT, c.webSearch, enabled = c.webSearchUsable) { switch(c, "webSearch", c.copy(webSearch = it)) }
                }
            }
            Section("Earlier chats") {
                chats.take(15).forEach { c ->
                    Text(c.title, color = p.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().clickable { onChat(c.id) }.padding(vertical = 10.dp))
                }
                if (chats.isEmpty()) Text("No earlier chats", color = p.muted)
            }
        }
    }
}
