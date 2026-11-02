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

    /**
     * The chat a space opens with, as a route: the Chief's on Home; in a project its team's chat (the first team that has
     * one, on a botdot with team chats), else the Chief's (ADR 119).
     */
    fun defaultChat(project: Company?, groups: List<Group>, features: Collection<String>?): String {
        if (project == null || features == null || Groups.TEAM_CHATS !in features) return CHIEF
        val chat = project.teams.firstNotNullOfOrNull { t -> Groups.teamChat(groups, t.id) } ?: return CHIEF
        return "group/${chat.id}"
    }

    const val CHIEF = "chief/latest"

    // ---------- each bot in one space (#841) ----------

    /** The bots in a team of one of [projects]: they are drawn in that project, not on Home. */
    fun teamBots(projects: List<Company>): Set<String> = projects.flatMap { c -> c.teams.flatMap { it.bots } }.toSet()

    /** Home's bots: all but those in a project's team. One that leaves its team is back in its own category. */
    fun homeBots(bots: List<Bot>, projects: List<Company>): List<Bot> = teamBots(projects).let { t -> bots.filter { it.id !in t } }

    /** Home's groups: all but the team chats of [projects]' teams. */
    fun homeGroups(groups: List<Group>, projects: List<Company>): List<Group> {
        val teams = projects.flatMap { c -> c.teams.map { it.id } }.toSet()
        return groups.filter { it.team == null || it.team !in teams }
    }

    /** The project each team bot is in, as the rail draws it: Home's Needs you marks a project's ask with its square. */
    fun spaceOfBot(projects: List<Company>): Map<String, Space> = buildMap {
        for (c in projects) { val s = Space(c.id, ManyProjects.nameOf(c), c.color ?: ManyProjects.DEFAULT_COLOR, 0); for (t in c.teams) for (b in t.bots) putIfAbsent(b, s) }
    }

    /** A project's Needs you: what waits about one of its team bots. Home lists all of it. */
    fun needsIn(project: Company, waiting: List<Waiting>): List<Waiting> = teamBots(listOf(project)).let { t -> waiting.filter { it.bot != null && it.bot in t } }
}
