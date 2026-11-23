package dev.botdot.app.data

/**
 * The question a quick answer answers, shown over the owner's bubble (design/answer-context-mockup.html, A). The web
 * page's `questionOf` and `answerQuoteHTML` have the same rules, both checked against
 * test/fixtures/answer-question-cases.json.
 */
object AnswerQuote {
    /** A run that answers a question: the reply it answers, and the question to show over it. */
    data class Quote(val runId: String, val text: String)

    const val WORDS = 12
    private const val LONGEST = 200

    private val FENCE = Regex("```[\\s\\S]*?(```|\$)")
    private val LINK = Regex("!?\\[([^\\]]*)\\]\\([^)]*\\)")
    private val MARKER = Regex("^\\s{0,3}(?:#{1,6}|>|[-*+]|\\d+[.)])\\s+", RegexOption.MULTILINE)
    private val EMPHASIS = Regex("\\*\\*|__|~~|[*`]")
    private val SENTENCE = Regex(".+?(?:[.!?…]+[\"')\\]”»]*(?=\\s|\$)|\$)")
    private val ASKS = Regex("\\?[\"')\\]”»]*\$")
    private val SPACES = Regex("\\s+")

    private fun sentences(text: String?): List<String> = text.orEmpty()
        .replace(FENCE, " ")
        .replace(LINK, "$1")
        .replace(MARKER, "")
        .replace(EMPHASIS, "")
        .split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        .flatMap { line -> SENTENCE.findAll(line).map { it.value.trim() }.toList() }
        .filter { it.isNotEmpty() }

    /**
     * The question a reply asked: the last sentence of its [text] that ends in a question mark, else the last of its
     * card's [questions], else its first twelve words. Markdown marks, the address of a link and code blocks are
     * left out. At most 200 characters.
     */
    fun questionOf(text: String?, questions: List<String>? = null): String {
        val said = sentences(text)
        val asked = said.lastOrNull { ASKS.containsMatchIn(it) } ?: questions.orEmpty().map { it.trim() }.lastOrNull { it.isNotEmpty() }
        val words = said.joinToString(" ").split(SPACES).filter { it.isNotEmpty() }
        val out = asked ?: (words.take(WORDS).joinToString(" ") + if (words.size > WORDS) "…" else "")
        return if (out.length > LONGEST) out.take(LONGEST - 1).trimEnd() + "…" else out
    }

    /** Which of a reply's paragraphs holds its question: the last that asks, else the last. -1 for none. */
    fun questionParagraph(paragraphs: List<String>): Int {
        val at = paragraphs.indexOfLast { p -> sentences(p).any { ASKS.containsMatchIn(it) } }
        return if (at >= 0) at else paragraphs.lastIndex
    }

    /**
     * What to show over the owner's message that started [r]: null unless it answers a question ([Run.answers]) of a
     * reply the chat holds ([held], by id) that does not stand right above it ([above]: the ids of the rounds
     * before it, in the block before and its own). A card of questions answers with the questions in its text, so it
     * has none. The web page also lets a day divider between them bring the quote back; the phone draws none.
     */
    fun of(r: Run, held: Map<String, Run>, above: Set<String>): Quote? {
        val id = r.answers ?: return null
        if ("\n→ " in r.prompt || id in above) return null
        val q = held[id] ?: return null
        return Quote(q.id, questionOf(q.result, q.questions))
    }
}
