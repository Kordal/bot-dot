package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Api
import dev.botdot.app.data.Usage
import kotlinx.coroutines.launch

/**
 * Settings → Usage (#301): a timeframe (Today, 7 days, 30 days or custom days), the totals of that timeframe, a bar a
 * day and a row a bot, the Chief of Staff among them. Shown only from a server whose features have `token-usage`.
 */
@Composable
fun UsageSection(api: Api) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var preset by remember { mutableStateOf(Usage.Preset.WEEK) }
    var answer by remember { mutableStateOf<Usage.Answer?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var changed by remember { mutableStateOf("from") }

    suspend fun load(f: String?, t: String?) {
        runCatching { api.usage(f, t) }
            .onSuccess { answer = it; error = null; from = it.from; to = it.to }
            .onFailure { error = it.message ?: "Couldn't load the usage" }
    }
    fun pick(next: Usage.Preset) {
        preset = next
        val today = answer?.today ?: return
        if (next == Usage.Preset.CUSTOM) return
        val r = Usage.rangeOf(next, today) ?: return
        scope.launch { load(r.first, r.second) }
    }
    // The first answer says the account's today; the 7 days are counted from it.
    LaunchedEffect(api) {
        runCatching { api.usage() }
            .onSuccess { first ->
                val r = Usage.rangeOf(Usage.Preset.WEEK, first.today)
                if (r == null) { answer = first; from = first.from; to = first.to } else load(r.first, r.second)
            }
            .onFailure { error = it.message ?: "Couldn't load the usage" }
    }

    FoldSection("Usage") {
        Hint("Tokens as Claude Code reports them, for your bots and the Chief of Staff, counted from this update on.")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Usage.Preset.entries.forEach { option ->
                if (option == preset) Button(onClick = { pick(option) }, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(option.label) }
                else OutlinedButton(onClick = { pick(option) }) { Text(option.label, color = p.text) }
            }
        }
        if (preset == Usage.Preset.CUSTOM) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(from, { from = it.trim(); changed = "from" }, label = { Text("From") }, placeholder = { Text("YYYY-MM-DD") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, autoCorrectEnabled = false), modifier = Modifier.weight(1f))
                OutlinedTextField(to, { to = it.trim(); changed = "to" }, label = { Text("To") }, placeholder = { Text("YYYY-MM-DD") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, autoCorrectEnabled = false), modifier = Modifier.weight(1f))
            }
            val range = Usage.custom(from, to, changed)
            OutlinedButton(enabled = range != null, onClick = { range?.let { r -> scope.launch { load(r.first, r.second) } } }) { Text("Show", color = p.text) }
        }
        val a = answer
        when {
            error != null -> Text(error ?: "", color = p.err, style = MaterialTheme.typography.bodySmall)
            a == null -> Hint("Loading…")
            else -> {
                if (a.from == a.to) Hint(Usage.dayLabel(a.from)) else Hint("${Usage.dayLabel(a.from)} to ${Usage.dayLabel(a.to)}")
                Totals(a.totals)
                if (a.days.size > 1) DayBars(a.days)
                Text("By bot", color = p.text, style = MaterialTheme.typography.titleSmall)
                if (a.bots.isEmpty()) Hint("No tokens used in this timeframe.")
                val top = a.bots.maxOfOrNull { it.totalTokens }?.coerceAtLeast(1L) ?: 1L
                a.bots.forEach { b -> BotRow(b, b.totalTokens.toFloat() / top) }
            }
        }
    }
}

@Composable
private fun Totals(t: Usage.Totals) {
    val cells = listOf(
        "Input tokens" to Usage.tokens(t.inputTokens), "Output tokens" to Usage.tokens(t.outputTokens),
        "Cache read" to Usage.tokens(t.cacheReadTokens), "Cache write" to Usage.tokens(t.cacheWriteTokens),
        "All tokens" to Usage.tokens(t.totalTokens),
    )
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        cells.forEach { (label, value) -> Stat(label, value) }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    val p = LocalPaper.current
    Column(Modifier.background(p.sunk, RoundedCornerShape(12.dp)).padding(horizontal = 10.dp, vertical = 8.dp)) {
        Text(label, color = p.faint, style = MaterialTheme.typography.bodySmall)
        Text(value, color = p.text, style = MaterialTheme.typography.titleMedium)
    }
}

/** One bar a day, its height the day's tokens against the busiest day of the range. */
@Composable
private fun DayBars(days: List<Usage.Day>) {
    val p = LocalPaper.current
    val shares = Usage.bars(days)
    Column {
        Row(Modifier.fillMaxWidth().height(96.dp).semantics { contentDescription = "Tokens per day" }, horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
            shares.forEach { share ->
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
                    if (share > 0f) Box(Modifier.fillMaxWidth().fillMaxHeight(share).background(p.muted, RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)))
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(p.line2))
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Text(Usage.dayLabel(days.first().day), color = p.faint, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            Text(Usage.dayLabel(days.last().day), color = p.faint, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun BotRow(b: Usage.Bot, share: Float) {
    val p = LocalPaper.current
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(if (b.gone) "${b.name} (deleted)" else b.name, color = p.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text(Usage.tokens(b.totalTokens), color = p.muted, style = MaterialTheme.typography.bodySmall)
        }
        Box(Modifier.fillMaxWidth().padding(top = 3.dp).height(4.dp).background(p.sunk, RoundedCornerShape(2.dp))) {
            Box(Modifier.fillMaxWidth(share.coerceIn(0f, 1f)).fillMaxHeight().background(p.muted, RoundedCornerShape(2.dp)))
        }
    }
}
