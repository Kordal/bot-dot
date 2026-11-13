package dev.botdot.app.data

/**
 * Spaces (#836, #840): Home and every open project are spaces of one view, in place of the "Bots | Projects" switch.
 * From 840 dp a rail on the left picks one; on a phone the title does, with a sheet. With no project yet both are
 * there with Home and New project (#853); on a botdot without projects neither is, and Home is the bots' home. The space on screen is remembered on the device (the old
 * place's key, Settings.space): `home` or a project's id; a project that is gone falls back to Home.
 */
object Spaces {
    const val HOME = "home"
    /** What the place's key held before spaces: the projects were open. */
    const val LEGACY_PROJECTS = "company"

    /** One project as the rail and the sheet show it: its name, its colour and what waits for the owner in it. */
    data class Space(val id: String, val name: String, val color: String, val asks: Int)

    /**
     * The projects a space is drawn for, in the order they were made: every open project from a botdot with
     * `projects-many` ([list]), else the one company of an older botdot ([single]), else none.
     */
    fun projects(features: Collection<String>?, list: List<Company>, single: Company?): List<Company> = when {
        !CompanySetup.shows(features) -> emptyList()
        ManyProjects.many(features) -> ManyProjects.open(list)
        else -> listOfNotNull(single)
    }

    /** What waits for the owner from each bot: the cards in Needs you about it, and its open question. */
    fun asksOf(bots: List<Bot>, waiting: List<Waiting>): (String) -> Int {
        val waits = waiting.mapNotNull { it.bot?.takeIf(String::isNotEmpty) }.groupingBy { it }.eachCount()
        val asking = bots.filter { it.asks != null && !it.running }.map { it.id }.toSet()
        return { id -> (waits[id] ?: 0) + if (id in asking) 1 else 0 }
    }

    /** The rail's and the sheet's projects, each with its count. */
    fun list(projects: List<Company>, bots: List<Bot>, waiting: List<Waiting>): List<Space> {
        val asks = asksOf(bots, waiting)
        return projects.map { c -> Space(c.id, ManyProjects.nameOf(c), c.color ?: ManyProjects.DEFAULT_COLOR, ManyProjects.waits(c, bots, asks)) }
    }

    /**
     * The space to open: the one [saved] when it is still there; [LEGACY_PROJECTS] (the switch was on Projects) is the
     * project shown then ([project]), else the first; anything else, or a project that is gone, is Home.
     */
    fun remembered(saved: String?, ids: List<String>, project: String?): String = when {
        saved == LEGACY_PROJECTS -> project?.takeIf { it in ids } ?: ids.firstOrNull() ?: HOME
        saved != null && saved in ids -> saved
        else -> HOME
    }

    /** [space] while it is still there; Home once its project is gone. */
    fun still(space: String, ids: List<String>): String = if (space == HOME || space in ids) space else HOME

    /** The primary contact (ADR 234). Null while setup or the selected bot's list is still loading.
     * PROJECT_CHIEF names a project whose Chief chat must be made before opening it.
     */
    fun defaultChat(project: Company?, bots: List<Bot>?, features: Collection<String>?): String? {
        if (project == null) return CHIEF
        if (!project.running) return null
        if (ManyProjects.MANAGER_BOT in features.orEmpty() && project.lead != null) {
            if (bots == null) return null
            if (bots.any { it.id == project.lead }) return "bot/${project.lead}"
        }
        if (ManyProjects.CHIEF !in features.orEmpty()) return CHIEF
        return project.chiefChat?.takeIf { it.isNotEmpty() }?.let { "chief/$it" } ?: "$PROJECT_CHIEF${project.id}"
    }

    const val PROJECT_CHIEF = "project-chief/"

    const val CHIEF = "chief/latest"

    // ---------- each bot in one space (#841) ----------

    /** The bots in a team of one of [projects]. */
    fun teamBots(projects: List<Company>): Set<String> = projects.flatMap { c -> c.teams.flatMap { it.bots } + c.bots }.toSet()

    /** The project each team bot is in, as the rail draws it: Home's Needs you marks a project's ask with its square. */
    fun spaceOfBot(projects: List<Company>): Map<String, Space> = buildMap {
        for (c in projects) { val s = Space(c.id, ManyProjects.nameOf(c), c.color ?: ManyProjects.DEFAULT_COLOR, 0); for (b in c.teams.flatMap { it.bots } + c.bots) putIfAbsent(b, s) }
    }

    /**
     * A project's Needs you: what waits about one of its team bots, and what was asked in one of its teams' group chats
     * (the Chief's there too). Home lists all of it; a bot of no team, or the Chief's own chat, waits on Home only.
     */
    fun needsIn(project: Company, waiting: List<Waiting>, groups: List<Group> = emptyList()): List<Waiting> {
        val bots = teamBots(listOf(project))
        val teams = project.teams.map { it.id }.toSet()
        val chats = groups.filter { it.team != null && it.team in teams }.map { it.id }.toSet()
        return waiting.filter { (it.bot != null && it.bot in bots) || (it.group != null && it.group in chats) }
    }

    /** The lead a member's ask is drawn under in [project] (ADR 148); null for a lead of any of its teams (ADR 199), a bot of none of them, or a team without another lead. */
    fun leadOf(project: Company, bot: String?): String? {
        if (bot == null) return null
        val ts = project.teams.filter { bot in it.bots }
        if (ts.isEmpty() || ts.any { it.lead == bot }) return null
        return ts.first().lead?.takeIf { it.isNotEmpty() }
    }

    /** [waiting] as a project draws it: a member's ask under its lead, with the lead's face and the member's words and chat (ADR 148). */
    fun underLeads(project: Company, waiting: List<Waiting>, bots: List<Bot>): List<Waiting> = waiting.map { w ->
        val lead = leadOf(project, w.bot)?.let { id -> bots.firstOrNull { it.id == id } }
        if (lead == null) w else w.copy(color = lead.color ?: w.color, outfit = lead.outfit ?: w.outfit)
    }

    /** The bots of a project that ask the owner a question: its teams' only. */
    /** The team of [project] a bot's own ask is shown on (ADR 205): the team it leads, else its first team; null in none. */
    fun homeTeam(project: Company, bot: String?): String? {
        if (bot == null) return null
        val ts = project.teams.filter { bot in it.bots }
        return (ts.firstOrNull { it.lead == bot } ?: ts.firstOrNull())?.id
    }

    /** What waits for the owner on one team (ADR 205): the bots whose own asks wait, in the order they asked, and how many asks wait in its chat. */
    data class TeamWait(val bots: List<String> = emptyList(), val chat: Int = 0)

    /**
     * What waits on each team of [project] (ADR 205), by team id: an ask in a team's chat on that team, a bot's own ask
     * ([waiting] with its bot, or a bot in [asking] with a question in its chat) on its [homeTeam] only.
     */
    fun teamWaits(project: Company, waiting: List<Waiting>, groups: List<Group>, asking: List<String> = emptyList()): Map<String, TeamWait> {
        val teams = project.teams.map { it.id }.toSet()
        val chats = groups.mapNotNull { g -> g.team?.takeIf { it in teams }?.let { g.id to it } }.toMap()
        val bots = linkedMapOf<String, MutableList<String>>()
        val chat = mutableMapOf<String, Int>()
        fun bot(id: String) { val t = homeTeam(project, id) ?: return; val l = bots.getOrPut(t) { mutableListOf() }; if (id !in l) l += id }
        for (w in waiting) {
            val t = w.group?.let { chats[it] }
            if (t != null) chat[t] = (chat[t] ?: 0) + 1 else w.bot?.takeIf { it.isNotEmpty() }?.let(::bot)
        }
        asking.forEach(::bot)
        // A question a member put in the team's chat, which is its chat's own.
        for (g in groups) { val t = chats[g.id] ?: continue; if (g.asksValue is kotlinx.serialization.json.JsonObject && (chat[t] ?: 0) == 0) chat[t] = 1 }
        return (bots.keys + chat.keys).associateWith { TeamWait(bots[it].orEmpty(), chat[it] ?: 0) }
    }

    fun askingIn(project: Company, bots: List<Bot>, asks: (Bot) -> Boolean): List<Bot> = teamBots(listOf(project)).let { t -> bots.filter { it.id in t && asks(it) } }
}
