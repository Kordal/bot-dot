package dev.botdot.app.data

/**
 * A bot's live runs above its message box (#501). With two or three runs going at once (ADR 062) each is a row in
 * the look of the plan dock: a spinner in the bot's colour, what it was asked, what it is doing now (its working
 * line, in the server's words) and Stop for that run. With one run the status line under the chat says it, as
 * before ([OpeningLine]); the card is not drawn then. A row whose run ended shows a check, then folds away.
 * `/btw` side runs and script runs are not listed: they are not counted in the bot's `runningCount` either.
 * `public/live-runs.js` is the web page's side of the same rules.
 */
object LiveRuns {
    /** How long a row whose run ended shows its check, then how long it takes to fold away, in ms. */
    const val DONE = 700L
    const val GONE = 900L

    /** The runs of a bot that are listed: those going, not a side question or a script, in the order they started. */
    fun listed(runs: List<Run>, botId: String): List<Run> =
        runs.filter { it.botId == botId && it.isRunning && it.kind != "script" && !it.btw }.sortedWith(compareBy({ it.startedAt }, { it.id }))

    /** What a run was asked, as one line: its job's name, its main assignment, or the first line of its message. */
    fun ask(r: Run): String {
        if (!r.jobName.isNullOrEmpty()) return r.jobName
        if (!r.customPrompt && r.continues == null) return "Main assignment" // a run that carries on has its request as its prompt
        return r.prompt.trim().lineSequence().first().trim().ifEmpty { if (r.trigger == "schedule") "Scheduled run" else "Working" }
    }

    /** One row: [line] is what it does now ("" says "Working"); [held]: it waits for the owner's OK. */
    data class Row(val id: String, val ask: String, val line: String, val held: Boolean, val startedAt: String, val done: Boolean = false, val gone: Boolean = false) {
        /** The words under its ask. */
        val doing: String get() = when { done -> "Done"; held -> OpeningLine.WAITING_FOR_OK; else -> line.trim().ifEmpty { "Working" } }
    }

    /**
     * What the card holds as runs go and end: the live runs, and for a moment those that just ended. [rows] takes the
     * live rows and answers the rows to draw, in the order the runs started: none when there are fewer than two (the
     * status line says it then). A run that was a row of the card drawn last and is not live any more stays, `done`,
     * for [DONE] ms, then `gone` (its fold) for [GONE] ms, then leaves. [next] says when the rows change by
     * themselves, so the screen draws again then.
     */
    class Keeper {
        private var drawn = LinkedHashMap<String, Row>()
        private val ending = LinkedHashMap<String, Pair<Row, Long>>()
        private val order = compareBy<Row>({ it.startedAt }, { it.id })

        fun rows(live: List<Row>, now: Long): List<Row> {
            val ids = live.map { it.id }.toSet()
            for ((id, row) in drawn) if (id !in ids && id !in ending) ending[id] = row to now
            ending.entries.removeAll { (id, e) -> id in ids || now - e.second >= DONE + GONE }
            val out = (live + ending.values.map { (row, at) -> row.copy(done = true, gone = now - at >= DONE) }).sortedWith(order)
            if (out.size < 2) { drawn = LinkedHashMap(); ending.clear(); return emptyList() }
            drawn = LinkedHashMap(live.associateBy { it.id })
            return out
        }

        /** When the rows change next by themselves (a check folds, a fold ends), in ms from [now]; null for never. */
        fun next(now: Long): Long? = ending.values.flatMap { (_, at) -> listOf(at + DONE, at + DONE + GONE) }.filter { it > now }.minOrNull()?.minus(now)
    }
}
