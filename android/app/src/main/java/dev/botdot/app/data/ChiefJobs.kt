package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.decodeFromJsonElement

/** One of the Chief's own scheduled jobs (#408, docs/api.md "The Chief's own jobs"): it reads on a schedule and tells the owner, and changes nothing. */
@Serializable
data class ChiefJob(
    val id: String,
    val name: String = "",
    val task: String = "",
    val cron: String? = null,
    val at: String? = null,
    val on: Boolean = true,
    val `when`: String = "",
    val lastRunAt: String? = null,
)

@Serializable
data class ChiefJobList(val jobs: List<ChiefJob> = emptyList())

/** The Chief's jobs in its settings: listed with when they run, switched and removed there, made by chat. */
object ChiefJobs {
    const val FEATURE = "chief-jobs"
    const val TITLE = "Scheduled jobs"
    const val EMPTY = "None yet."

    fun shows(features: Collection<String>?): Boolean = features?.contains(FEATURE) == true

    /** When it runs, and "paused" when it is switched off. */
    fun line(job: ChiefJob): String = job.`when` + if (job.on) "" else " · paused"

    /** The whole list a feed's `chief_jobs` carries, or null for another event or one this app can't read. */
    fun event(ev: FeedEvent): List<ChiefJob>? {
        if (ev.type != "chief_jobs") return null
        val list = ev.data["jobs"] as? JsonArray ?: return null
        return runCatching { list.map { Api.JSON.decodeFromJsonElement<ChiefJob>(it) } }.getOrNull()
    }
}
