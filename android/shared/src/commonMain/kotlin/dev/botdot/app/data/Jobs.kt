package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job as Running
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.launch

/**
 * A bot's scheduled jobs as both phones draw them (Android's JobsScreen): each job's line, its last run, what waits for
 * the owner's OK, and what Run now and a pause say.
 */
object Jobs {
    /** Under an approved job that has a change beside it: it runs as approved meanwhile. */
    val CHANGE_WAITS: String get() = tr("A change waits for your OK")

    /** Whether [CHANGE_WAITS] stands under [j]: it is approved, so it runs, and a change waits beside it. */
    fun changeWaits(j: Job): Boolean = j.approved && j.change != null

    /** Under a job that takes signed calls (`callMode`): how a sender gets in; null for any other. */
    fun callModeLine(j: Job): String? =
        if (j.call && j.callMode == "signed") tr("Takes signed calls: each one is signed with the secret in Passwords, and runs once.") else null

    /** Under a job with a notify address (`notifyUrl`): where the end of each run goes. */
    fun notifyLine(url: String): String = tr("Tells {url} when a run ends, signed with the secret in Passwords.", "url" to url)

    /**
     * The line under a job: the server's own (`last.text`) as it is; from a server that sends none, when it last ran
     * ([time], in the phone's words) and how that went.
     */
    fun lastLine(last: JobLast, time: String): String = last.text ?: run {
        val what = mapOf("held" to tr("held till morning"), "quiet" to tr("nothing to report"), "success" to tr("done"), "error" to tr("failed"),
            "stopped" to tr("stopped"), "interrupted" to tr("cut off"))[last.status] ?: last.status
        tr("Last run {time}: {what}", "time" to time, "what" to what)
    }

    /** How the last run's line is coloured: it failed (also again and again), its time passed without a run, or neither. */
    enum class Tone { FAILED, MISSED, FINE }

    fun tone(last: JobLast): Tone = when {
        last.status == "error" || last.failures > 0 -> Tone.FAILED
        last.status == "missed" -> Tone.MISSED
        else -> Tone.FINE
    }

    /** What Run now says, from the server's answer: it started, it waits for the bot, or it was skipped and why. */
    fun runNowSays(answer: RunNow): String = when (answer) {
        RunNow.Started -> tr("Started")
        RunNow.Queued -> tr("It will run as soon as the bot is free")
        is RunNow.Skipped -> answer.why
    }

    /** The line under a job's name: its schedule, then its status ([status]). */
    fun line(j: Job, time: (String?) -> String): String = listOf(scheduleWords(j), status(j, time)).filter { it.isNotBlank() }.joinToString(" · ")

    /** Its status beside its schedule: it waits for the OK, it is paused, or when it runs next ([time]); "" for none. */
    fun status(j: Job, time: (String?) -> String): String = when {
        !j.approved -> tr("Waits for your OK")
        !j.enabled -> tr("Paused")
        j.nextRunAt != null -> tr("Next: {time}", "time" to time(j.nextRunAt))
        else -> ""
    }
}

/** One job as its row draws it. [line]: its schedule and status; [last]: its last run's line, coloured by [tone]. */
class JobView(
    val id: String,
    val name: String,
    val script: Boolean,
    val line: String,
    val waits: Boolean,
    val changeWaits: Boolean,
    val enabled: Boolean,
    val approved: Boolean,
    val last: String?,
    val tone: Jobs.Tone,
    /** With Advanced on: how it takes calls, and where it tells a run's end. */
    val advanced: List<String>,
)

/** A bot's jobs screen: [jobs] null until the bots are read; [empty] when it has none. */
class JobsState(val name: String, val jobs: List<JobView>?, val empty: String?)

/**
 * The jobs of the bot [botId], from the store's bots as the live feed keeps them: pause or resume one, and Run now.
 * [time] says a time in the phone's words.
 */
class JobsDesk(private val scope: CoroutineScope, private val api: Api, private val store: Store, val botId: String, private val time: (String?) -> String = { chatClock(it) }) {
    val state: StateFlow<JobsState> = store.bots.value.map { snapshot(it) }.stateIn(scope, SharingStarted.Eagerly, snapshot(store.bots.value.value))

    fun watch(onChange: (JobsState) -> Unit): Running = scope.launch { state.collect { onChange(it) } }

    private fun snapshot(bots: List<Bot>?): JobsState {
        val bot = bots?.firstOrNull { it.id == botId } ?: return JobsState("", null, null)
        val advanced = Advanced.on.value
        val jobs = bot.jobs.map { j ->
            JobView(j.id, j.name, j.kind == "script", Jobs.line(j, time),
                waits = !j.approved, changeWaits = Jobs.changeWaits(j), enabled = j.enabled, approved = j.approved,
                last = j.last?.let { Jobs.lastLine(it, time(it.at)) }, tone = j.last?.let { Jobs.tone(it) } ?: Jobs.Tone.FINE,
                advanced = if (!advanced) emptyList() else listOfNotNull(Jobs.callModeLine(j), j.notifyUrl?.takeIf { it.isNotBlank() }?.let { Jobs.notifyLine(it) }))
        }
        return JobsState(bot.name, jobs,
            if (jobs.isEmpty()) tr("{name} has no scheduled jobs. Ask it, or the Chief, for one: \"check the news every morning at 8\".", "name" to bot.name) else null)
    }

    /** The bots read again (pull to refresh). */
    @Throws(Exception::class)
    suspend fun refresh() { try { store.bots.refresh() } catch (e: CancellationException) { throw e } catch (_: Exception) {} }

    /** Paused or resumed at once on screen, then as botdot has it; what to say after. */
    @Throws(Exception::class)
    suspend fun setOn(jobId: String, on: Boolean): String {
        store.bots.update { list -> list.map { b -> if (b.id != botId) b else b.copy(jobs = b.jobs.map { if (it.id == jobId) it.copy(enabled = on, nextRunAt = if (on) it.nextRunAt else null) else it }) } }
        val said = try { api.setJobEnabled(botId, jobId, on); if (on) tr("Resumed") else tr("Paused. It won't run until you turn it back on.") }
            catch (e: CancellationException) { throw e } catch (e: Exception) { e.message ?: tr("Couldn't change it") }
        refresh()
        return said
    }

    /** Run now; what to say after. */
    @Throws(Exception::class)
    suspend fun run(jobId: String): String {
        val said = try { Jobs.runNowSays(api.runJob(botId, jobId)) } catch (e: CancellationException) { throw e } catch (e: Exception) { e.message ?: tr("Couldn't start it") }
        refresh()
        return said
    }
}
