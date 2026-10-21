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
 * Commands (#237): "/" and one of a bot's skills at the very start of a message in that bot's own chat runs the skill,
 * with the rest of the message as its arguments. Typing "/" there lists the bot's skills; a name it has no skill of is
 * plain text. Not in the Chief chat or a group. The botdot server does the running; the app lists and picks.
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
    /** "@all" in a group ([World.all], #124): every member at once, and no member's mention. */
    private const val ALL = "all"
    /** The feature of a botdot that runs a skill sent as "/" and its name (#237). */
    const val SKILL_COMMANDS = "skill-commands"
    /** The text before the cursor while a command's name is typed, and a message that may run a skill (#237). */
    private val COMMAND_TYPING = Regex("^/($NAME*)\\z")
    private val COMMAND = Regex("^/($NAME+)(?:\\s+([\\s\\S]*))?\\z")

    /** "Fleet Doctor" → "FleetDoctor", "Chief of Staff" → "ChiefOfStaff", "Morning check" → "MorningCheck". */
    fun shortName(name: String): String =
        name.trim().split(SPACES).joinToString("") { w -> w.take(1).uppercase() + w.drop(1) }.replace(NOT_NAME, "")

    private fun same(a: String, b: String) = a.lowercase() == b.lowercase()

    /** The Chief's mention by its role, which still means it after the owner named it (#41); never suggested. */
    const val CHIEF_ALIAS = "ChiefOfStaff"

    /**
     * What can be mentioned in one chat. [chat] is [CHIEF] or the id of the bot whose chat it is; [bots] include the
     * Chief; [library] is the names of the whole skill library. Skills in scope: the whole library in the Chief chat,
     * the bot's picked skills in its own chat. [all]: a group's chat on a server that knows "@all" (#124): it is
     * offered first while typed at the start of a message, and is no member's mention (a member named All is neither
     * matched nor suggested). [about]: the library's descriptions by name, shown beside a skill to run. [runsSkills]:
     * the server runs a skill sent as "/" and its name (feature `skill-commands`, #237); without it "/" lists nothing.
     */
    class World(val chat: String, val bots: List<Bot>, val library: List<String>, val all: Boolean = false, val about: Map<String, String> = emptyMap(),
                val runsSkills: Boolean = true) {
        val skills: List<String> = if (chat == CHIEF) library else bots.firstOrNull { it.id == chat }
            ?.takeIf { it.useSkills }?.let { b -> library.filter { it in b.skills } }.orEmpty()
        /** The skills "/" runs here: a bot's own chat only. */
        val commands: List<String> = if (!runsSkills || chat == CHIEF || bots.none { it.id == chat }) emptyList() else skills
        fun bot(id: String?) = bots.firstOrNull { it.id == id }
    }

    enum class Kind { BOT, JOB, SKILL, ALL, COMMAND }

    /** One mention in a text: [start] until [end] is [text]. [bot] and [job] are ids, [skill] a name. */
    data class Found(val kind: Kind, val text: String, val start: Int, val end: Int, val bot: String? = null, val job: String? = null, val skill: String? = null)

    /** One suggestion: picking it puts [text] plus a space in place of the "@…" (or the "/…") being typed. [about]: a
     *  skill to run's description. */
    data class Row(val kind: Kind, val text: String, val label: String, val bot: String? = null, val job: String? = null, val skill: String? = null, val about: String = "")

    /** The mentions in a text, in order. */
    fun find(text: String, w: World): List<Found> {
        if ('@' !in text) return emptyList()
        return TOKEN.findAll(text).mapNotNull { m ->
            val a = m.groupValues[1]
            val b = m.groups[2]?.value
            val start = m.range.first
            if (w.all && same(a, ALL)) return@mapNotNull null
            // The Chief keeps its role's mention beside the name the owner gave it (CHIEF_ALIAS).
            val bot = w.bots.firstOrNull { same(shortName(it.name), a) } ?: if (same(CHIEF_ALIAS, a)) w.bots.firstOrNull { it.id == CHIEF } else null
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
     * The suggestion rows for the text typed up to the cursor, when it ends in a word starting with "@". "@all" first
     * in a group ([World.all]), then bots, then jobs, then skills, at most [MAX_ROWS]. After "@Bot/" only that bot's jobs.
     * "/" at the very start of a bot's own chat lists its skills to run instead ([Kind.COMMAND]).
     */
    fun suggest(typed: String, w: World): List<Row> {
        fun has(name: String, q: String) = name.lowercase().contains(q.lowercase())
        COMMAND_TYPING.find(typed)?.let { c ->
            return w.commands.filter { has(it, c.groupValues[1]) }.take(MAX_ROWS).map { Row(Kind.COMMAND, "/$it", it, skill = it, about = w.about[it].orEmpty()) }
        }
        val m = TYPING.find(typed) ?: return emptyList()
        val bots = w.bots.filter { shortName(it.name).isNotEmpty() && !(w.all && same(shortName(it.name), ALL)) } // a name of only emoji can't be mentioned
        fun jobRow(bot: Bot, j: Job) = Row(Kind.JOB, "@${shortName(bot.name)}/${shortName(j.name)}", "${bot.name} · ${j.name}", bot = bot.id, job = j.id)
        val q = m.groupValues[1]
        val after = m.groups[2]?.value
        val rows = if (after != null) {
            val bot = bots.firstOrNull { same(shortName(it.name), q) }
            bot?.jobs?.filter { has(shortName(it.name), after) }?.map { jobRow(bot, it) }.orEmpty()
        } else {
            val botNames = bots.map { shortName(it.name).lowercase() }.toSet()
            val all = if (w.all && typed.substring(0, m.range.first).isBlank() && has(ALL, q)) listOf(Row(Kind.ALL, "@$ALL", "all: every member at once")) else emptyList()
            all + bots.filter { has(shortName(it.name), q) }.map { Row(Kind.BOT, "@${shortName(it.name)}", it.name, bot = it.id) } +
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
        val at = (if (row.kind == Kind.COMMAND) COMMAND_TYPING else TYPING).find(text.substring(0, cursor))?.range?.first ?: return null
        val end = cursor + (WORD_REST.find(text.substring(cursor))?.value?.length ?: 0)
        val spaced = text.getOrNull(end) == ' '
        return Picked(text.substring(0, at) + row.text + (if (spaced) "" else " ") + text.substring(end),
            at + row.text.length + 1, jobsNext = row.kind == Kind.BOT && !spaced)
    }

    /** What sending a message runs (#237): the skill and its arguments (the rest, trimmed). */
    data class Command(val skill: String, val args: String)

    /** [text] as a command: it starts with "/" and the name of a skill the bot has; null when it is plain text. */
    fun command(text: String, w: World): Command? {
        val m = COMMAND.find(text) ?: return null
        val skill = w.commands.firstOrNull { same(it, m.groupValues[1]) } ?: return null
        return Command(skill, m.groupValues[2].trim())
    }
}
