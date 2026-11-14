package dev.botdot.app.data

/**
 * An empty chat (#727), as on the web page: the head and name in the middle, the message box right under them and the
 * jobs under it as chips, a tap on one runs it now. The jobs it offers: a bot's approved jobs that are on, the Chief's
 * own jobs (#408) that are on, each as (id, name).
 */
object EmptyChatJobs {
    fun botJobs(jobs: List<Job>): List<Pair<String, String>> = jobs.filter { it.approved && it.enabled }.map { it.id to it.name }
    fun chiefJobs(jobs: List<ChiefJob>): List<Pair<String, String>> = jobs.filter { it.on }.map { it.id to it.name }
}
