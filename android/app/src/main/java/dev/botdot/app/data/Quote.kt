package dev.botdot.app.data

/**
 * Quote (#97): text selected in one chat message, added to the message box as a Markdown quote, so the bot sees which
 * part the owner means: "> " in front of each line, then a blank line, after whatever was typed already. No author name.
 * The same rules as public/quote.js on the web page, both checked against test/fixtures/quote-cases.json.
 */
object Quote {
    /** The message box after Quote: its text, and the cursor at its end. */
    data class Added(val text: String, val cursor: Int)

    /** The quote of the selected text: "" when there is nothing to quote. */
    fun block(selected: String): String {
        val lines = selected.replace("\r\n", "\n").replace('\r', '\n').replace(' ', ' ').split('\n').map { it.trimEnd() }.toMutableList()
        while (lines.isNotEmpty() && lines.first().isEmpty()) lines.removeAt(0)
        while (lines.isNotEmpty() && lines.last().isEmpty()) lines.removeAt(lines.size - 1)
        // Several blank lines in a row are one.
        val kept = lines.filterIndexed { i, l -> l.isNotEmpty() || lines[i - 1].isNotEmpty() }
        return kept.joinToString("\n") { if (it.isEmpty()) ">" else "> $it" }
    }

    /** [draft] with the quote of [selected] after it; null when there is nothing to quote (the box stays as it is). */
    fun add(draft: String, selected: String): Added? {
        val quote = block(selected)
        if (quote.isEmpty()) return null
        val kept = draft.trimEnd()
        val text = (if (kept.isEmpty()) "" else "$kept\n\n") + quote + "\n\n"
        return Added(text, text.length)
    }
}
