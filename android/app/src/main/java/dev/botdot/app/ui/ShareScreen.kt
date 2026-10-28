package dev.botdot.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.serialization.json.JsonElement

/** Share → botdot: who gets what you shared? The Chief, or one of your bots. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareScreen(app: BotDotApp, count: Int, text: String, onPick: (String) -> Unit, onCancel: () -> Unit) {
    val p = LocalPaper.current
    // The bots as the app keeps them (Store): there at once.
    val botsNow by app.store.bots.value.collectAsState()
    val bots = botsNow.orEmpty()
    val error by app.store.bots.error.collectAsState()

    val what = when {
        count > 1 -> trn(count, "Send {n} file to…", "Send {n} files to…")
        count == 1 -> tr("Send the file to…")
        else -> tr("Send the text to…")
    }
    Scaffold(
        containerColor = p.bg,
        topBar = {
            TopAppBar(
                navigationIcon = { BackButton(onCancel) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(what, style = MaterialTheme.typography.titleMedium) },
            )
        },
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            if (text.isNotBlank()) item {
                Text("“${text.take(200)}”", color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 3,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            }
            if (error != null) item { Text(error!!, color = p.err, modifier = Modifier.padding(20.dp)) }
            item { Pick(CHIEF_COLOR, LocalChiefName.current, tr("It can pass it on to the right bot"), FigureDef.CHIEF) { onPick("chief") } }
            items(bots.sortedBy { it.name.lowercase() }, key = { it.id }) { b -> Pick(b.color, b.name, b.description, b.outfit) { onPick(b.id) } }
        }
    }
}

@Composable
private fun Pick(color: String?, name: String, sub: String, outfit: JsonElement?, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        BotFigure(color, "idle", 42, outfit)
        Spacer(Modifier.size(12.dp))
        androidx.compose.foundation.layout.Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.titleMedium, color = p.text)
            if (sub.isNotBlank()) Text(sub, color = p.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
