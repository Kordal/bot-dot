package dev.botdot.app.data

import java.time.Instant

/**
 * The order of a bot's chat (#460, test/fixtures/chat-order.json; `public/unread.js` `Unread.order` on the web page):
 * what started a run stands when it started, a message steered into it when it was sent, its reply when it ended.
 * The reply of a run at work stays at the bottom, in the order the runs started. So a reply that ended after a
 * "/btw", or after another run, stands below it.
 */
object ChatOrder {
    sealed interface Piece {
        val run: Run
        val key: String

        /** What started the run. */
        data class Asked(override val run: Run) : Piece { override val key get() = "${run.id}:a" }

        /** Its steered message [i]. */
        data class Steered(override val run: Run, val i: Int) : Piece { override val key get() = "${run.id}:s$i" }

        /** Its reply, or its place while it works. */
        data class Reply(override val run: Run) : Piece { override val key get() = "${run.id}:r" }
    }

    private fun millis(t: String?): Long? = t?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

    /** The pieces of [runs] (in any order), oldest first. */
    fun pieces(runs: List<Run>): List<Piece> {
        val placed = mutableListOf<Pair<Piece, Long>>()
        for (r in runs.sortedWith(compareBy<Run> { millis(it.startedAt) ?: 0L }.thenBy { it.id })) {
            val at = millis(r.startedAt) ?: 0L
            placed += Piece.Asked(r) to at
            r.steered.forEachIndexed { i, x -> placed += Piece.Steered(r, i) to (millis(x.at) ?: at) }
            placed += Piece.Reply(r) to (if (r.isRunning) Long.MAX_VALUE else millis(r.endedAt) ?: at)
        }
        return placed.sortedBy { it.second }.map { it.first } // stable: ties keep the runs' order
    }

    /** The runs as blocks (#625), oldest first: each run is one block, where its reply ends; a run at work at the bottom. */
    fun blocks(runs: List<Run>): List<Run> = pieces(runs).filterIsInstance<Piece.Reply>().map { it.run }

    /**
     * The blocks of a chat (#625, #627), oldest first: each a run and the runs that reply to it ([Run.replyTo], followed
     * back while those runs are in [runs]) as its rounds, oldest first. A block stands where its newest round's reply does.
     */
    fun rounds(runs: List<Run>): List<List<Run>> {
        val byId = runs.associateBy { it.id }
        fun rootOf(r: Run): String { var x = r; var i = 0; while (i++ < 50) { x = x.replyTo?.let(byId::get) ?: break }; return x.id }
        val replies = blocks(runs)
        val at = replies.withIndex().associate { it.value.id to it.index }
        return replies.groupBy(::rootOf).values.sortedBy { b -> b.maxOf { at.getValue(it.id) } }
            .map { b -> b.sortedBy { millis(it.startedAt) ?: 0L } } // rounds in the order they started
    }

    /** The run whose reply is drawn last in the chat: its quick answers stand under it. */
    fun lastReply(pieces: List<Piece>): Run? = pieces.lastOrNull { it is Piece.Reply }?.run
}
