package dev.botdot.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.ChiefName
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/**
 * The question for the Chief of Staff's name (#41), as the web page's first-run setup asks it: once, on a botdot
 * whose setup is not done and that has had no answer from any app ([ChiefName.ask]). Skip keeps "Chief of Staff";
 * either answer is the owner's, and nothing asks again. Later the owner asks the Chief for another name.
 */
@Composable
fun ChiefNameQuestion(app: BotDotApp) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val version by app.store.version.value.collectAsState()
    var asking by remember(api) { mutableStateOf(false) }
    LaunchedEffect(api, version?.features) {
        val a = api ?: return@LaunchedEffect
        val features = version?.features ?: return@LaunchedEffect
        if (ChiefName.FEATURE !in features) return@LaunchedEffect // a botdot from before the name: nothing to ask
        asking = ChiefName.ask(features, runCatching { a.setup() }.getOrNull())
    }
    if (!asking) return
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val answer = { given: String ->
        saving = true
        scope.launch {
            runCatching { api!!.nameChief(given) }
                .onSuccess { asking = false; app.store.chief.refresh() }
                .onError { error = it.message ?: tr("Couldn't save the name") } // a bot's name, or botdot away: the question stays
            saving = false
        }
        Unit
    }
    AlertDialog(
        onDismissRequest = {}, // answered with Save or Skip
        title = { Text(tr("Name your Chief of Staff")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                Text(tr("It runs your team of bots and talks with you. Leave it empty to keep “Chief of Staff”. You can ask it for another name any time."))
                Field(name, { name = it.take(ChiefName.MAX); error = null }, placeholder = { Text(ChiefName.role) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = p.err) }
            }
        },
        confirmButton = { TextButton(onClick = { answer(name) }, enabled = !saving) { Text(tr("Save"), color = p.text) } },
        dismissButton = { TextButton(onClick = { answer("") }, enabled = !saving) { Text(tr("Skip"), color = p.text) } },
    )
}
