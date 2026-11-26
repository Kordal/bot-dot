package dev.botdot.app.data

/**
 * A bot's name in a message, as a link to its chat (botNameLinks in public/app.js; test/fixtures/bot-names.json is the
 * rules both follow): the name as written, or with one of the endings an offered language gives it (its phrases'
 * `nameEndings`, ADR 280, which come with the dictionary: Polish's QA Testera, QA Testerowi), the case the name has, as
 * a whole word, the longest name first: no letter, number or "_" of a longer word on either side, except Chinese,
 * Japanese and Korean, which have no spaces between words ("AlfredがQA Testerに", "请让Alfred发送"): a name stands beside
 * them. A name two bots share is nobody's, and so are a name of one letter and a name after @, / or -.
 */
object BotNames {
    private fun endings(all: List<String>): String = all.filter { it.isNotEmpty() }.distinct().sortedByDescending { it.length }.joinToString("|") { escape(it) }
    private const val REGEX_MARKS = ".*+?^$()[]{}|\\"

    // A character of a longer word: a letter, number or "_" that is not Han, Kana or Hangul (CJK_CHARS in public/app.js).
    private const val CJK_CHARS = "\\u1100-\\u11FF\\u3040-\\u30FF\\u3130-\\u318F\\u31F0-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF\\uFF66-\\uFF9F"
    private const val WORD_CHAR = "(?![$CJK_CHARS])[\\p{L}\\p{N}_]"

    /** A bot a message can name. */
    data class Bot(val id: String, val name: String)

    /** A name in a text: where it starts, the name with its ending as written, and the id of the bot. */
    data class Found(val start: Int, val text: String, val id: String)

    // The regex of the last names and endings asked for: a chat draws with the same bots again and again.
    private var last: Pair<List<String>, Regex>? = null

    fun find(text: String, bots: List<Bot>, nameEndings: List<String> = I18n.phrases("nameEndings")): List<Found> {
        val ids = LinkedHashMap<String, String?>()
        for (b in bots) {
            val name = b.name.trim()
            if (name.length >= 2) ids[name] = if (ids.containsKey(name) && ids[name] != b.id) null else b.id
        }
        val names = ids.filterValues { it != null }.keys.sortedByDescending { it.length }
        if (names.isEmpty()) return emptyList()
        val ends = endings(nameEndings)
        val key = names + "\u0000$ends"
        val regex = last?.takeIf { it.first == key }?.second ?: Regex(
            """(?<![@/-])(?<!$WORD_CHAR)(${names.joinToString("|") { escape(it) }})${if (ends.isEmpty()) "" else "(?:$ends)?"}(?!$WORD_CHAR)""",
        ).also { last = key to it }
        return regex.findAll(text).map { m -> Found(m.range.first, m.value, ids.getValue(m.groupValues[1])!!) }.toList()
    }

    private fun escape(name: String) = name.map { if (it in REGEX_MARKS) "\\$it" else it.toString() }.joinToString("")
}
