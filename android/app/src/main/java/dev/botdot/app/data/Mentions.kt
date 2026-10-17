package dev.botdot.app.data

/**
 * Mentions: "@" plus the name of a bot, a bot's job or a skill in a chat message, saying the message is about it
 * (CONTEXT.md: Mention). Reference only: nothing is sent, run, loaded or granted.
 *   - bot: its name without spaces, each word capitalised: @FleetDoctor (the Chief is @ChiefOfStaff)
 *   - job: bot then job: @FleetDoctor/MorningCheck
 *   - skill: its name as is: @weekly-report
 * Matching ignores case; a bot wins over a skill of the same name; "@" inside a word (an email) isn't one; anything
 * that matches nothing stays plain text.
 *
 * The same rules as lib/mentions.js on the botdot server, both checked against test/fixtures/mentions.json.
 */
object Mentions {
    const val MAX_ROWS = 6 // suggestions shown at once
    /** The Chief's id, and its chat's. */
    val CHIEF = ChiefInfo().id

    private const val NAME = "[\\p{L}\\p{N}_-]"
    private val TOKEN = Regex("(?<![\\p{L}\\p{N}_])@($NAME+)(?:/($NAME+))?")
    private val TYPING = Regex("(?<![\\p{L}\\p{N}_])@($NAME*)(?:/($NAME*))?\\z")
    private val WORD_REST = Regex("^[\\p{L}\\p{N}_/-]*") // the rest of a mention's word after the cursor
    private val SPACES = Regex("\\s+") // no (?U): Android's ICU regex rejects it, and its \s is Unicode already
    private val NOT_NAME = Regex("[^\\p{L}\\p{N}_-]")

    /** "Fleet Doctor" → "FleetDoctor", "Chief of Staff" → "ChiefOfStaff", "Morning check" → "MorningCheck". */
    fun shortName(name: String): String =
        name.trim().split(SPACES).joinToString("") { w -> w.take(1).uppercase() + w.drop(1) }.replace(NOT_NAME, "")

    private fun same(a: String, b: String) = a.lowercase() == b.lowercase()

    /**
     * What can be mentioned in one chat. [chat] is [CHIEF] or the id of the bot whose chat it is; [bots] include the
     * Chief; [library] is the names of the whole skill library. Skills in scope: the whole library in the Chief chat,
     * the bot's picked skills in its own chat.
     */
    class World(val chat: String, val bots: List<Bot>, val library: List<String>) {
        val skills: List<String> = if (chat == CHIEF) library else bots.firstOrNull { it.id == chat }
            ?.takeIf { it.useSkills }?.let { b -> library.filter { it in b.skills } }.orEmpty()
        fun bot(id: String?) = bots.firstOrNull { it.id == id }
    }

    enum class Kind { BOT, JOB, SKILL }

    /** One mention in a text: [start] until [end] is [text]. [bot] and [job] are ids, [skill] a name. */
    data class Found(val kind: Kind, val text: String, val start: Int, val end: Int, val bot: String? = null, val job: String? = null, val skill: String? = null)

    /** One suggestion: picking it puts [text] plus a space in place of the "@…" being typed. */
    data class Row(val kind: Kind, val text: String, val label: String, val bot: String? = null, val job: String? = null, val skill: String? = null)

    /** The mentions in a text, in order. */
    fun find(text: String, w: World): List<Found> {
        if ('@' !in text) return emptyList()
        return TOKEN.findAll(text).mapNotNull { m ->
            val a = m.groupValues[1]
            val b = m.groups[2]?.value
            val start = m.range.first
            val bot = w.bots.firstOrNull { same(shortName(it.name), a) }
            if (bot != null) {
                val job = b?.let { j -> bot.jobs.firstOrNull { same(shortName(it.name), j) } }
                if (job != null) Found(Kind.JOB, m.value, start, m.range.last + 1, bot = bot.id, job = job.id)
                else "@$a".let { Found(Kind.BOT, it, start, start + it.length, bot = bot.id) }
            } else {
                val skill = w.skills.firstOrNull { same(it, a) } ?: return@mapNotNull null
                val t = if (b == null) m.value else "@$a"
                Found(Kind.SKILL, t, start, start + t.length, skill = skill)
            }
        }.toList()
    }

    /**
     * The suggestion rows for the text typed up to the cursor, when it ends in a word starting with "@". Bots, then
     * jobs, then skills, at most [MAX_ROWS]. After "@Bot/" only that bot's jobs.
     */
    fun suggest(typed: String, w: World): List<Row> {
        val m = TYPING.find(typed) ?: return emptyList()
        val bots = w.bots.filter { shortName(it.name).isNotEmpty() } // a name of only emoji can't be mentioned
        fun has(name: String, q: String) = name.lowercase().contains(q.lowercase())
        fun jobRow(bot: Bot, j: Job) = Row(Kind.JOB, "@${shortName(bot.name)}/${shortName(j.name)}", "${bot.name} · ${j.name}", bot = bot.id, job = j.id)
        val q = m.groupValues[1]
        val after = m.groups[2]?.value
        val rows = if (after != null) {
            val bot = bots.firstOrNull { same(shortName(it.name), q) }
            bot?.jobs?.filter { has(shortName(it.name), after) }?.map { jobRow(bot, it) }.orEmpty()
        } else {
            val botNames = bots.map { shortName(it.name).lowercase() }.toSet()
            bots.filter { has(shortName(it.name), q) }.map { Row(Kind.BOT, "@${shortName(it.name)}", it.name, bot = it.id) } +
                bots.flatMap { b -> b.jobs.filter { has(shortName(it.name), q) }.map { jobRow(b, it) } } +
                w.skills.filter { has(it, q) && it.lowercase() !in botNames }.map { Row(Kind.SKILL, "@$it", it, skill = it) }
        }
        return rows.take(MAX_ROWS)
    }

    /** A picked suggestion: the new [text] and [cursor]. [jobsNext]: a bot was picked and its space is new, so a "/"
     *  typed next goes in place of the space and lists the bot's jobs. */
    data class Picked(val text: String, val cursor: Int, val jobsNext: Boolean)

    /**
     * Picking [row] while typing: the "@…" before [cursor] (and the rest of that word) becomes the row's text and a
     * space (unless a space follows already), and the cursor goes after the space. [text] is the whole message. Null
     * when no "@…" is being typed.
     */
    fun pick(text: String, cursor: Int, row: Row): Picked? {
        val at = TYPING.find(text.substring(0, cursor))?.range?.first ?: return null
        val end = cursor + (WORD_REST.find(text.substring(cursor))?.value?.length ?: 0)
        val spaced = text.getOrNull(end) == ' '
        return Picked(text.substring(0, at) + row.text + (if (spaced) "" else " ") + text.substring(end),
            at + row.text.length + 1, jobsNext = row.kind == Kind.BOT && !spaced)
    }
}
