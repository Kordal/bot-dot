package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Job
import dev.botdot.app.data.JobLast
import dev.botdot.app.data.RunNow
import dev.botdot.app.data.str
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/** A bot's scheduled jobs: pause or resume each one, run it now, or approve one that waits for your OK. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobsScreen(app: BotDotApp, botId: String, onNeedsYou: () -> Unit, onBack: () -> Unit) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    // The bot and its jobs as the app keeps them (Store), kept up to date from the live feed.
    val bots by app.store.bots.value.collectAsState()
    val bot = remember(bots, botId) { bots?.firstOrNull { it.id == botId } }
    val loadError by app.store.bots.error.collectAsState()

    suspend fun load() = app.store.bots.refresh()
    // A message at the bottom, without holding up what comes after it (showSnackbar waits until it's gone).
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    LaunchedEffect(loadError) { loadError?.let { tell(it) } }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(tr("Scheduled jobs"), style = MaterialTheme.typography.titleMedium) }, actions = { PanelClose() })
        },
    ) { pad ->
        val jobs = bot?.jobs.orEmpty()
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (bot != null && jobs.isEmpty()) item {
                Text(tr("{name} has no scheduled jobs. Ask it, or the Chief, for one: \"check the news every morning at 8\".", "name" to bot.name), color = p.muted, modifier = Modifier.padding(8.dp))
            }
            items(jobs, key = { it.id }) { j ->
                JobRow(j,
                    onToggle = { on ->
                        scope.launch {
                            // Show it right away; the server's answer (and next run) follows.
                            app.store.bots.update { list -> list.map { b -> if (b.id != botId) b else b.copy(jobs = b.jobs.map { if (it.id == j.id) it.copy(enabled = on, nextRunAt = if (on) it.nextRunAt else null) else it }) } }
                            val r = runCatching { api!!.setJobEnabled(botId, j.id, on) }
                            load()
                            tell(r.fold({ if (on) tr("Resumed") else tr("Paused. It won't run until you turn it back on.") }, { it.message ?: tr("Couldn't change it") }))
                        }
                    },
                    onRun = {
                        scope.launch {
                            val r = runCatching { api!!.runJob(botId, j.id) }
                            load()
                            tell(r.fold({ runNowSays(it) }, { it.message ?: tr("Couldn't start it") }))
                        }
                    },
                    onApprove = onNeedsYou,
                )
            }
        }
    }
}

@Composable
private fun JobRow(j: Job, onToggle: (Boolean) -> Unit, onRun: () -> Unit, onApprove: () -> Unit) {
    val p = LocalPaper.current
    Column(
        Modifier.fillMaxWidth().background(p.panel, RoundedCornerShape(16.dp)).border(1.dp, p.line, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("${if (j.kind == "script") "⚙️" else "🧠"} ${j.name}", style = MaterialTheme.typography.titleMedium, color = p.text)
                // A job with a change beside it runs on as approved: its line is that of a running job.
                val status = when {
                    !j.approved -> tr("Waits for your OK")
                    !j.enabled -> tr("Paused")
                    j.nextRunAt != null -> tr("Next: {time}", "time" to shortTime(j.nextRunAt))
                    else -> ""
                }
                Text(listOf(scheduleWords(j), status).filter { it.isNotBlank() }.joinToString(" · "),
                    color = if (!j.approved) p.warnText else p.muted, style = MaterialTheme.typography.bodyMedium)
            }
            Switch(
                checked = j.enabled, onCheckedChange = onToggle,
                colors = SwitchDefaults.colors(checkedTrackColor = p.ok, checkedThumbColor = androidx.compose.ui.graphics.Color.White, uncheckedTrackColor = p.line2, uncheckedBorderColor = p.line2, uncheckedThumbColor = p.faint),
            )
        }
        if (changeWaits(j)) Text(CHANGE_WAITS, color = p.warnText, style = MaterialTheme.typography.bodyMedium)
        callModeLine(j)?.let { Text(it, color = p.faint, style = MaterialTheme.typography.bodySmall) }
        j.notifyUrl?.takeIf { it.isNotBlank() }?.let { Text(notifyLine(it), color = p.faint, style = MaterialTheme.typography.bodySmall) }
        j.last?.let { l ->
            Text(jobLine(l, shortTime(l.at)), color = when (jobLineTone(l)) { JobTone.FAILED -> p.err; JobTone.MISSED -> p.warnText; JobTone.FINE -> p.faint }, style = MaterialTheme.typography.bodySmall)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!j.approved) OutlinedButton(onClick = onApprove) { Text(tr("Review and approve"), color = p.text) }
            else OutlinedButton(onClick = onRun) { Text(tr("Run now"), color = p.text) }
            if (changeWaits(j)) OutlinedButton(onClick = onApprove) { Text(tr("Review the change"), color = p.text) }
        }
    }
}

/** Under a job that takes signed calls (`callMode`, docs/api.md "A signed call"): how a sender gets in; null for any other. */
internal fun callModeLine(j: Job): String? =
    if (j.call && j.callMode == "signed") tr("Takes signed calls: each one is signed with the secret in the Vault, and runs once.") else null

/** Under a job with a notify address (`notifyUrl`, docs/api.md): where the end of each run goes. */
internal fun notifyLine(url: String): String = tr("Tells {url} when a run ends, signed with the secret in the Vault.", "url" to url)

/** Under an approved job that has a change beside it (`change`, docs/api.md): it runs as approved meanwhile. */
internal val CHANGE_WAITS: String get() = tr("A change waits for your OK")

/** Whether the jobs screen says [CHANGE_WAITS] under a job: it is approved, so it runs, and a change waits beside it. */
internal fun changeWaits(j: Job): Boolean = j.approved && j.change != null

/**
 * The line under a job. The server's own (`last.text`, with `job-line`: "Did not run at 08:00: botdot was off.") as
 * it is; from a server that sends none, the app's line as before: when it last ran ([time], in the phone's words) and
 * how that went.
 */
internal fun jobLine(last: JobLast, time: String): String = last.text ?: run {
    val what = mapOf("held" to tr("held till morning"), "quiet" to tr("nothing to report"), "success" to tr("done"), "error" to tr("failed"), "stopped" to tr("stopped"), "interrupted" to tr("cut off"))[last.status] ?: last.status
    tr("Last run {time}: {what}", "time" to time, "what" to what)
}

/** How the line under a job is coloured: its last run failed (also again and again), its time passed without a run, or neither. */
internal enum class JobTone { FAILED, MISSED, FINE }

internal fun jobLineTone(last: JobLast): JobTone = when {
    last.status == "error" || last.failures > 0 -> JobTone.FAILED
    last.status == "missed" -> JobTone.MISSED
    else -> JobTone.FINE
}

/** What "Run now" says, from the server's answer: it started, it waits for the bot, or it was skipped and why. */
internal fun runNowSays(answer: RunNow): String = when (answer) {
    RunNow.Started -> tr("Started")
    RunNow.Queued -> tr("It will run as soon as the bot is free")
    is RunNow.Skipped -> answer.why
}
