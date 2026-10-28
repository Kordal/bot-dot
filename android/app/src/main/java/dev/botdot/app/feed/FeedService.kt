package dev.botdot.app.feed

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dev.botdot.app.BotDotApp
import dev.botdot.app.MainActivity
import dev.botdot.app.R
import dev.botdot.app.data.Api
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Run
import dev.botdot.app.data.Waiting
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch

/**
 * Keeps the app's connection to botdot open in the background, so notifications arrive without a
 * push service (no Google, nothing in between). Android requires a small permanent notification
 * for this; its channel is set to the lowest importance, so it stays out of the way.
 */
class FeedService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val app = application as BotDotApp
        ServiceCompat.startForeground(this, 1, status(getString(R.string.app_name), tr("Connecting…")),
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
        // Each bot's latest finished run, as the feed tells it (for "didn't finish" in the last day).
        scope.launch {
            app.feed.events.collect { ev ->
                if (ev.type != "run_finished") return@collect
                runCatching { Api.JSON.decodeFromJsonElement(Run.serializer(), ev.data) }.getOrNull()?.let { r -> lastRuns.value = lastRuns.value + (r.botId to r) }
            }
        }
        // The notification says what matters now: a connection problem, what waits for you, a job that failed in the
        // last day, who's working, or that all is quiet. It's made from what the app already keeps (Store), which
        // follows the feed: no questions to botdot for it, except a failed bot's last run once.
        val store = app.store
        val quarterHours = flow { while (true) { emit(Unit); delay(15 * 60_000L) } } // a failure stops showing after a day
        val now = combine(store.waiting, store.bots.value, store.chief.value, lastRuns, quarterHours) { waiting, bots, chief, runs, _ ->
            whatsGoingOn(app, waiting, bots.orEmpty(), chief?.busy == true, runs)
        }
        scope.launch {
            combine(app.feed.state, now) { st, line ->
                when (st) {
                    Feed.State.Connected -> line
                    Feed.State.Connecting -> Status(tr("Connecting…"))
                    Feed.State.Retrying -> Status(tr("Can't reach botdot. Is Tailscale on? Trying again…"))
                    Feed.State.Off -> Status(tr("Not connected"))
                }
            }.distinctUntilChanged().collect { line ->
                getSystemService(android.app.NotificationManager::class.java).notify(1, status("botdot", line.text, line.open))
            }
        }
    }

    /** The line to show, and where tapping it goes (see Notifier.EXTRA_OPEN). */
    private data class Status(val text: String, val open: String? = null)

    private val lastRuns = MutableStateFlow<Map<String, Run>>(emptyMap())
    private val asked = mutableSetOf<String>() // failed bots whose last run was fetched once

    private fun whatsGoingOn(app: BotDotApp, waiting: List<Waiting>, bots: List<Bot>, chiefBusy: Boolean, runs: Map<String, Run>): Status {
        if (waiting.size == 1) return Status(waiting[0].text, "needs")
        if (waiting.size > 1) return Status(trn(waiting.size, "{n} thing waits for your OK", "{n} things wait for your OK"), "needs")

        // A bot whose latest run failed in the last 24 hours (its figure says "failed"; the run says when).
        val dayAgo = Instant.now().minus(Duration.ofHours(24))
        val failedBots = bots.filter { it.state == "failed" }
        failedBots.filter { it.id !in runs && asked.add(it.id) }.forEach { b ->
            scope.launch {
                runCatching { app.api.value?.runs(b.id, limit = 5) }.getOrNull()?.firstOrNull { !it.isRunning }
                    ?.let { r -> if (b.id !in lastRuns.value) lastRuns.value = lastRuns.value + (b.id to r) }
            }
        }
        val failed = failedBots.mapNotNull { runs[it.id] }
            .filter { it.status == "error" && runCatching { Instant.parse(it.endedAt ?: it.startedAt) }.getOrNull()?.isAfter(dayAgo) == true }
            .maxByOrNull { it.startedAt }
        if (failed != null) return Status(failed.jobName?.let { tr("{bot}: {job} didn't finish", "bot" to failed.botName, "job" to it) } ?: tr("{bot}: its last task didn't finish", "bot" to failed.botName), "bot:${failed.botId}")

        val working = bots.filter { it.running }
        val names = working.map { it.name } + if (chiefBusy) listOf(tr("the Chief")) else emptyList()
        return when {
            names.isEmpty() -> Status(tr("All quiet"))
            names.size == 1 -> Status(tr("{name} is working…", "name" to names[0].replaceFirstChar { it.uppercase() }), working.firstOrNull()?.let { "bot:${it.id}" })
            names.size == 2 -> Status(tr("{name} and {other} are working…", "name" to names[0].replaceFirstChar { it.uppercase() }, "other" to names[1]))
            else -> Status(trn(names.size, "{n} is working…", "{n} are working…"))
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        (application as BotDotApp).feed.retryNow()
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun status(title: String, text: String, open: String? = null) = NotificationCompat.Builder(this, Notifier.CH_CONNECTION)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setContentIntent(PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java).apply { if (open != null) putExtra(Notifier.EXTRA_OPEN, open) }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        .build()

    companion object {
        fun start(context: Context) = ContextCompat.startForegroundService(context, Intent(context, FeedService::class.java))
        fun stop(context: Context) = context.stopService(Intent(context, FeedService::class.java))
    }
}
