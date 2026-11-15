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

    /**
     * The suggestions for the box's [text] with the cursor at [cursor] (UTF-16, as Kotlin's strings count): none when
     * no "@" or "/" is being typed just before it.
     */
    fun suggest(text: String, cursor: Int): List<Mentions.Row> =
        world()?.let { Mentions.suggest(text.substring(0, cursor.coerceIn(0, text.length)), it) }.orEmpty()

    /** [text] with [row] picked in place of the "@…" before [cursor] and the rest of its word, the cursor after its space; null when none is typed there. */
    fun pick(text: String, cursor: Int, row: Mentions.Row): Mentions.Picked? = Mentions.pick(text, cursor.coerceIn(0, text.length), row)

    /** What the suggestions need, read once when nothing has yet: the bots and the skills. */
    @Throws(Exception::class)
    suspend fun load() {
        if (store.bots.value.value == null) store.bots.refresh()
        if (store.skills.value.value == null) store.skills.refresh()
    }
}
