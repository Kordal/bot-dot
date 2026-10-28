package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import java.time.Instant

/**
 * A run's steps, for its block in a bot's chat (docs/api.md, "A run's steps"; #625; `stepLineHTML` in
 * public/bot-chat.js): how many tool calls it made, and a timeline of them in the server's words. Folded, the block's
 * step line says the count, the skills the run changed and the bots it messaged; open, a row each, with the messages
 * it sent and the skills it changed among them, in the order they came.
 */
data class RunSteps(val count: Int, val rows: List<Row>) {
    /** A step: when it came, the server's words, its kind ("message", "skill" or ""), how many times it came in a row. */
    data class Row(val at: String?, val text: String, val kind: String = "", val n: Int = 1)

    companion object {
        const val MESSAGE = "message"
        const val SKILL = "skill"
        /** A row of a skill it wrote or changed (what it learned): the app's own kind, never the server's. */
        const val CHANGED = "changed"
        val SKILL_KINDS = setOf("skill", "skill-updated")

        /** The steps as the server sends them, or null for none (a run from before them, or anything that is not one). */
        fun of(e: JsonElement?): RunSteps? {
            val o = e as? JsonObject ?: return null
            val count = (o["count"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: 0
            val rows = (o["rows"] as? JsonArray).orEmpty().mapNotNull { x ->
                val r = x as? JsonObject ?: return@mapNotNull null
                val text = r["text"].textOrNull() ?: return@mapNotNull null
                Row(r["at"].textOrNull(), text, r["kind"].textOrNull().orEmpty(), (r["n"] as? JsonPrimitive)?.intOrNull?.coerceAtLeast(1) ?: 1)
            }
            return if (count > 0 || rows.isNotEmpty()) RunSteps(maxOf(count, rows.size), rows) else null
        }

        /** The names of the skills [r] wrote or changed, each once. */
        fun skills(r: Run): List<String> = r.learned.orEmpty().filter { it.kind in SKILL_KINDS }.mapNotNull { it.skill?.ifBlank { null } ?: it.chipValue.textOrNull() ?: it.text.ifBlank { null } }.distinct()

        /** The bots [r] messaged, each once. */
        fun messaged(r: Run): List<SentTo> = r.sentToAll?.takeIf { it.isNotEmpty() } ?: listOfNotNull(r.sentTo)

        /** Whether [r]'s block has a step line: it is at work, or it took a step, changed a skill or messaged a bot. */
        fun shows(r: Run): Boolean = r.isRunning || (r.steps?.count ?: 0) > 0 || skills(r).isNotEmpty() || messaged(r).isNotEmpty()

        /**
         * Whether [r]'s step line is open, from [opened]: the runs whose steps the owner opened, each with whether it was at
         * work then. One opened to watch the run at work folds when the run ends, so a finished run's steps are folded.
         */
        fun open(opened: Map<String, Boolean>, r: Run): Boolean = when (opened[r.id]) { null -> false; true -> r.isRunning; false -> true }

        /** What the line says of a finished run's count: "23 steps", or "" for none. */
        fun countWords(n: Int): String = when { n <= 0 -> ""; n == 1 -> "1 step"; else -> "$n steps" }

        /** A message's first line, as one plain line of at most 160 characters. */
        fun firstLine(text: String?): String = dev.botdot.app.feed.plainText(text.orEmpty().lineSequence().firstOrNull { it.isNotBlank() }.orEmpty()).trim().take(160)

        /**
         * The rows of [r]'s open step line, in the order they came: its steps, then the messages it sent and the skills it
         * changed, each at its time; one without a time at the end. A message row's [Row.text] is "Messaged <bot>" and
         * its first line follows after a newline.
         */
        fun timeline(r: Run): List<Row> {
            val sent = messaged(r).filter { !it.text.isNullOrBlank() }.map { Row(it.at, "Messaged ${it.name}\n${firstLine(it.text)}", MESSAGE) }
            // A message it sent stands as its own row, with what it said: the last step that messaged that bot is not
            // drawn twice. Earlier messages to the same bot keep their step.
            val steps = r.steps?.rows.orEmpty().toMutableList()
            messaged(r).filter { !it.text.isNullOrBlank() && it.name.isNotEmpty() }.forEach { t ->
                val i = steps.indexOfLast { it.kind == MESSAGE && it.text.endsWith(t.name) }
                if (i >= 0) steps.removeAt(i)
            }
            val changed = r.learned.orEmpty().filter { it.kind in SKILL_KINDS }.mapNotNull { x -> (x.chipValue.textOrNull() ?: x.text.ifBlank { null })?.let { Row(x.at, it, CHANGED) } }
            val all = (steps + sent + changed).withIndex()
            return all.sortedWith(compareBy<IndexedValue<Row>> { millis(it.value.at) ?: Long.MAX_VALUE }.thenBy { it.index }).map { it.value }
        }

        /** How long a run took, from [start] to [end]: "18s", "7m 37s", "1h 02m"; "" when either is not known. */
        fun took(start: String?, end: String?): String {
            val a = millis(start) ?: return ""
            val b = millis(end) ?: return ""
            val s = ((b - a) / 1000).coerceAtLeast(0)
            return when { s < 60 -> "${s}s"; s < 3600 -> "${s / 60}m ${s % 60}s"; else -> "${s / 3600}h ${"%02d".format((s / 60) % 60)}m" }
        }

        /** A reply longer than this folds on the phone to its first paragraph and "More" (#625). */
        const val LONG_REPLY = 600

        /**
         * A long reply folded: its first paragraph and every paragraph that holds a link (a link is never folded), or null
         * when it is not long, has one paragraph, or holds code (a code block is never cut).
         */
        fun folded(text: String?): String? {
            val t = text.orEmpty().trim()
            if (t.length < LONG_REPLY || "```" in t) return null
            val parts = t.split(Regex("\n\\s*\n")).filter { it.isNotBlank() }
            if (parts.size < 2) return null
            val kept = parts.filterIndexed { i, x -> i == 0 || LINK.containsMatchIn(x) }
            return if (kept.size == parts.size) null else kept.joinToString("\n\n")
        }
        private val LINK = Regex("https?://|\\]\\(")

        private fun millis(t: String?): Long? = t?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    }
}
