package dev.botdot.app.data

/**
 * Reply on a run's block in a bot's chat (#627, docs/api.md "A reply to a run"): the owner's next message goes to that
 * run, steered into it while it works, else as a run that continues it.
 */
object ReplyTo {
    const val FEATURE = "reply-to"

    /** Only a server that takes `replyTo` gets Reply. */
    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** What the chip above the message box names: what the first run of [run]'s block was asked, on one line. */
    fun asked(runs: List<Run>, run: Run): String {
        val byId = runs.associateBy { it.id }
        val seen = hashSetOf(run.id)
        var r = run
        while (true) r = r.replyTo?.let { byId[it] }?.takeIf { seen.add(it.id) } ?: break
        val words = r.jobName?.takeIf { it.isNotBlank() } ?: r.prompt
        return words.lineSequence().firstOrNull { it.isNotBlank() }?.trim()?.take(160).orEmpty()
    }
}
