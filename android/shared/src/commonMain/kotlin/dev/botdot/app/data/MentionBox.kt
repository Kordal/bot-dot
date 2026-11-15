package dev.botdot.app.data

/**
 * The "@" in one chat's message box (Mentions), for the iPhone as Android's rememberMentions: who and what can be
 * mentioned here, read from the store (the bots with the Chief first, the skill library and the Claude account's skills,
 * and the pages, tiles and projects a botdot that takes them hands to the run), the suggestions for what is typed and
 * the text once one is picked. [chat]: a bot's id, or [Mentions.CHIEF].
 */
class MentionBox(private val store: Store, private val chat: String) {
    /** Who and what can be mentioned here; null until the bots are read. */
    fun world(): Mentions.World? {
        val bots = store.bots.value.value ?: return null
        val features = store.version.value.value?.features.orEmpty()
        val skills = store.skills.value.value
        val library = skills?.library.orEmpty()
        val account = skills?.machine.orEmpty()
        val pages = if (Mentions.PAGE_MENTIONS in features) store.pages.value.value.orEmpty().map { Mentions.PageRef(it.botId, it.slug, it.title) } else emptyList()
        val tiles = if (Mentions.PAGE_MENTIONS in features) store.dashboard.value.value?.tiles.orEmpty().filter { it.approved }.map { Mentions.TileRef(it.id, it.title, it.kind) } else emptyList()
        val projects = if (Mentions.PROJECT_MENTIONS in features) store.projects.value.value.orEmpty() else emptyList()
        val chief = Bot(id = Mentions.CHIEF, name = store.chiefName.value, color = CHIEF_COLOR, outfit = FigureDef.CHIEF)
        return Mentions.World(chat, listOf(chief) + bots, library.map { it.name },
            about = account.associate { it.name to it.description } + library.associate { it.name to it.description },
            runsSkills = Mentions.SKILL_COMMANDS in features, account = account.map { it.name },
            pages = pages, tiles = tiles, projects = projects)
    }

    /** The suggestions for [typed], the box's text with the cursor at its end: none when no "@" or "/" is being typed. */
    fun suggest(typed: String): List<Mentions.Row> = world()?.let { Mentions.suggest(typed, it) }.orEmpty()

    /** [typed] with [row] picked in place of the "@…" being typed at its end, and a space after it. */
    fun pick(typed: String, row: Mentions.Row): String = Mentions.pick(typed, typed.length, row)?.text ?: typed

    /** What the suggestions need, read once when nothing has yet: the bots and the skills. */
    @Throws(Exception::class)
    suspend fun load() {
        if (store.bots.value.value == null) store.bots.refresh()
        if (store.skills.value.value == null) store.skills.refresh()
    }
}
