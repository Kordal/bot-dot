package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// A project as a phone draws it, for both phones (ADR 242, #1366): the spaces, a project's board, its teams and its
// chats, from the rules of the Android app's Company screens (ui/CompanyHome.kt, ui/ProjectTree.kt,
// ui/ProjectCardsRow.kt, ui/ProjectSettings.kt). The iPhone draws [ProjectState] and hands each tap to [ProjectDesk].

/** The rules of a project's page that Android's Compose code held: both phones read them here. */
object ProjectRules {
    /** A bot's open question, while it is not working: what its key and its row say. */
    fun question(b: Bot): String? = b.asks?.text?.takeIf { !b.running }?.replace('\n', ' ')?.take(120)

    /** What a bot's key says under its name: its question, what it does now while it works, else what it is for. */
    fun lineOf(b: Bot, line: String?): String = question(b) ?: if (b.running) OpeningLine.status(line, working = true) else b.description

    /** The words the project's "New bot" starts a Chief chat with (ADR 233). */
    fun newBotWords(c: Company): String = tr("A new bot for {project}:", "project" to c.name.ifBlank { c.start }) + " "

    /** The words a team's "New bot" starts a Chief chat with. */
    fun newBotWords(c: Company, t: CompanyTeam): String =
        tr("A new bot for the {team} team in {project}:", "team" to t.name, "project" to c.name.ifBlank { c.start }) + " "

    /** The bots a team's "+" offers: those not in it, the ones in another team last and saying which. */
    fun offered(c: Company, t: CompanyTeam, bots: List<Bot>): List<Bot> =
        CompanyFloor.addable(c, t, bots).map { (b, other) -> if (other != null) b.copy(description = tr("In {team}", "team" to other)) else b }

    /** What waits for the owner in the project's own Chief chat: its unread replies and the Chief's cards asked in it. */
    fun chiefWaiting(c: Company, chief: ChiefOverview?, needs: Needs?): Int {
        val id = c.chiefChat ?: return 0
        return (chief?.chats?.firstOrNull { it.id == id }?.unread ?: 0) + needs?.asks.orEmpty().count { it.chatId == id }
    }

    /** The default chat's count (ADR 235): the Chief's whole count for [Spaces.CHIEF], else the project's own chat's. */
    fun chatWaiting(route: String, c: Company, chief: ChiefOverview?, needs: Needs?): Int =
        if (route == Spaces.CHIEF) chief?.unread ?: 0 else chiefWaiting(c, chief, needs)

    /**
     * What a team's row says it is at (ADR 205): who waits, by name, then its chat ("Needs you: Ada, Team chat"), the
     * first two and "+N"; else how many of its bots work; else nothing. [asks] true: it is drawn as waiting.
     */
    data class TeamWord(val text: String, val asks: Boolean)

    fun teamWord(w: Spaces.TeamWait, bots: List<Bot>, working: Int): TeamWord {
        val who = w.bots.mapNotNull { id -> bots.firstOrNull { it.id == id }?.name } + if (w.chat > 0) listOf(tr("Team chat")) else emptyList()
        val whoText = if (who.size > 2) "${who.take(2).joinToString(", ")} +${who.size - 2}" else who.joinToString(", ")
        return when {
            who.isNotEmpty() -> TeamWord(tr("Needs you: {who}", "who" to whoText), true)
            working > 0 -> TeamWord(trn(working, "{n} working", "{n} working"), false)
            else -> TeamWord("", false)
        }
    }

    /** A count on a head or a space: "99+" past 99 (Android's ProjectChiefButton). */
    fun countText(n: Int): String = if (n > 99) "99+" else n.toString()

    /** How long a card's ask may be (Android's ask field). */
    const val ASK_MAX = 200

    /** When a file of the Files tile changed, in this phone's zone ([ProjectFiles.whenOf]). */
    fun fileWhen(at: Long): String = ProjectFiles.whenOf(at)

    /** A team's chat (#697): the group of team [teamId], on a botdot that has team chats; null otherwise. */
    fun teamChat(features: Collection<String>?, groups: List<Group>, teamId: String): String? =
        if (features != null && Groups.TEAM_CHATS in features) Groups.teamChat(groups, teamId)?.id else null
}

/**
 * A bot's key on a project's page: the bot as it is now, its line, whether it asks, whether it leads its team (the
 * first when none is set, as Android's team panel says "Lead"), and whether its head wears the crown: a lead of more
 * than one.
 */
data class ProjectKey(val bot: Bot, val line: String, val asks: Boolean, val lead: Boolean, val crown: Boolean = false)

/** A team's row: its keys (the lead first), what it is at ([word]), and its chat's group, when there is one. */
data class ProjectTeam(val team: CompanyTeam, val keys: List<ProjectKey>, val word: String, val asks: Boolean, val chat: String?, val objective: Objective?)

/** The project's default chat (ADR 235), as its field at the bottom shows it. [bot]: the Project Manager's chat; else the Chief's ([route]). */
data class ProjectChat(val route: String, val bot: Bot?, val name: String, val waiting: Int)

/** Everything a project's page draws, at one moment. */
class ProjectState(
    /** The botdot has projects (`company`): the switch of spaces is there, also before the first project. */
    val shows: Boolean,
    /** Every open project as the switch lists it, with what waits in it. */
    val spaces: List<Spaces.Space>,
    /** The project on screen; null before it is read, or while none is. */
    val project: Company?,
    val loaded: Boolean,
    val error: String?,
    val name: String,
    val color: String,
    /** Its gear: the settings, from a botdot with `project-settings`. */
    val settings: Boolean,
    /** Tidy up the board, from a botdot with `board-tidy`, on a running project. */
    val tidy: Boolean,
    val tidying: Boolean,
    /** The Chief's head beside the gear: the project's own Chief chat (`project-chief`), and what waits there. */
    val chief: Boolean,
    val chiefName: String,
    val chiefWaiting: Int,
    /** The Project Manager's head, from a botdot with `project-manager-bot`. */
    val manager: Bot?,
    /** "Day N of 90" over the board; null when the board doesn't show the days. */
    val day: Int?,
    /** What waits in this project only (#841), what stops its bots' work first. */
    val needs: List<Waiting>,
    /** The objectives on the board, the goal when there are none. */
    val goals: List<Objective>,
    val goal: String,
    /** The cards row (#776): null where the board has no cards. */
    val cards: List<ProjectCards.Slot>?,
    /** The cards built a moment ago: a green outline for a few seconds. */
    val fresh: Set<String>,
    /** Words a card's ask was refused with: back in its field when it opens again. */
    val refused: String?,
    /** The board's pieces not on it yet, offered under a new card's ask. */
    val pieces: List<String>,
    val teams: List<ProjectTeam>,
    /** The project's own bots in no team (ADR 233), from a botdot with `project-bots`. */
    val ownBots: Boolean,
    val own: List<ProjectKey>,
    /** What "Add bot" offers: the account's bots not in the project. None: the Chief is asked for a new one. */
    val addable: List<Bot>,
    /** A change of the project's own bots is on its way: one at a time, each sends the whole list. */
    val ownSaving: Boolean,
    /** The Files tile: a running project's folder, on a botdot with `project-files`, and its newest files. */
    val filesTile: Boolean,
    val folder: ProjectFolder?,
    val files: List<RecentFile>,
    /** The default chat's field at the bottom; null while it isn't known. */
    val chat: ProjectChat?,
    /** Project Manager choices in the settings: the Chief (null) or one of the project's bots. */
    val leadChoices: List<Bot>,
    /** What a failed tap said, once per [noticeCount]. */
    val notice: String?,
    val noticeCount: Int,
) {
    val running: Boolean get() = project?.running == true
}

/**
 * The project on a phone's screen, for both phones (ADR 242): what [ProjectState] says, from the shared [Store], and
 * what each tap sends. A change botdot answers is taken into the Store ([Store.tookProject]), so the page and the
 * switch follow it at once; a refused one says why ([ProjectState.notice]) and reads the project again.
 */
class ProjectDesk(private val store: Store, private val api: Api, private val scope: CoroutineScope) {
    /** What the page holds beside the Store: the card's ask that is open, cards on their way off, the Files tile's files. */
    private data class Local(
        val open: String? = null, val refused: String? = null, val closing: Set<String> = emptySet(), val removing: Set<String> = emptySet(),
        val fresh: Set<String> = emptySet(), val files: List<RecentFile> = emptyList(), val tidying: Boolean = false, val ownSaving: Boolean = false,
        val notice: String? = null, val noticeCount: Int = 0,
    )
    private val local = MutableStateFlow(Local())
    private var cardsBefore: List<ProjectCard> = emptyList()
    private var cardsOf: String? = null
    private var filesJob: Job? = null
    /** The projects whose Chief chat is being made: a second tap meanwhile asks nothing. */
    private val openingChief = mutableSetOf<String>()
    private val _state = MutableStateFlow(stateOf(null, emptyList(), null, null, null, emptyList(), null, null, null, emptyMap(), ChiefName.role, Local()))
    /** Everything the page draws; each change of the Store or of a tap here sends a new one. */
    val state: StateFlow<ProjectState> = _state

    init {
        val parts = combine(store.version.value, store.projectList, store.company.value, store.bots.value, store.groups.value) { v, l, c, b, g -> Parts(v, l, c, b, g) }
        val others = combine(store.waiting, store.chief.value, store.needs.value, store.lines.lines, store.chiefName) { w, ch, n, l, name -> Others(w, ch, n, l, name) }
        scope.launch {
            combine(parts, others, store.company.error, local) { p, o, e, x -> Triple(p, o, e to x) }.collect { (p, o, ex) ->
                val (e, x) = ex
                fresh(p.company?.company)
                _state.value = stateOf(p.version, p.list, p.company, p.bots, p.groups, o.waiting, o.chief, o.needs, e, o.lines, o.name, x)
            }
        }
    }

    private class Parts(val version: VersionInfo?, val list: List<Company>, val company: CompanyHeld?, val bots: List<Bot>?, val groups: List<Group>?)
    private class Others(val waiting: List<Waiting>, val chief: ChiefOverview?, val needs: Needs?, val lines: Map<String, String>, val name: String)

    /** A card that was building and is ready now is fresh for four seconds. */
    private fun fresh(c: Company?) {
        if (c == null) return
        if (cardsOf != c.id) { cardsOf = c.id; cardsBefore = c.cards; return }
        val built = ProjectCards.justBuilt(cardsBefore, c.cards)
        cardsBefore = c.cards
        if (built.isEmpty()) return
        local.update { it.copy(fresh = it.fresh + built) }
        scope.launch {
            delay(FRESH_MS)
            local.update { it.copy(fresh = it.fresh - built) }
        }
    }

    private fun stateOf(
        version: VersionInfo?, list: List<Company>, held: CompanyHeld?, botsNow: List<Bot>?, groupsNow: List<Group>?, waiting: List<Waiting>,
        chief: ChiefOverview?, needs: Needs?, error: String?, lines: Map<String, String>, chiefName: String, x: Local,
    ): ProjectState {
        val features = version?.features
        val f = features.orEmpty()
        val bots = botsNow.orEmpty()
        val groups = groupsNow.orEmpty()
        val projects = Spaces.projects(features, list, held?.company)
        val c = held?.company
        fun on(k: String) = c != null && ProjectBoard.shows(c, k)
        val asks = { id: String -> (waiting.count { it.bot == id }) + if (bots.firstOrNull { it.id == id }?.let(ProjectRules::question) != null) 1 else 0 }
        fun key(b: Bot, lead: Boolean, crown: Boolean = false) = ProjectKey(b, ProjectRules.lineOf(b, lines["bot:${b.id}"]), asks(b.id) > 0, lead, crown)
        val here = if (c == null) emptyList() else Spaces.underLeads(c, Spaces.needsIn(c, waiting, groups), bots).sortedBy { if (it.act != null) 0 else 1 }
        val waits = if (c == null) emptyMap() else Spaces.teamWaits(c, waiting, groups, bots.filter { ProjectRules.question(it) != null }.map { it.id })
        val teams = if (c == null) emptyList() else ManyProjects.branches(c, bots).map { br ->
            val t = br.team
            val word = ProjectRules.teamWord(waits[t.id] ?: Spaces.TeamWait(), bots, br.bots.count { it.running })
            ProjectTeam(t, br.bots.mapIndexed { i, b -> key(b, b.id == t.lead || (t.lead == null && i == 0), b.id == t.lead && br.bots.size > 1) }, word.text, word.asks, ProjectRules.teamChat(features, groups, t.id), CompanyFloor.objectiveOf(t, c.objectives))
        }
        val route = Spaces.defaultChat(c, botsNow, features)
        val chat = if (c == null || route == null) null else {
            val manager = route.takeIf { it.startsWith("bot/") }?.removePrefix("bot/")?.let { id -> bots.firstOrNull { it.id == id } }
            if (manager != null) ProjectChat(route, manager, manager.name, manager.unread)
            else ProjectChat(route, null, chiefName, ProjectRules.chatWaiting(route, c, chief, needs))
        }
        val ownBots = ProjectBots.FEATURE in f
        return ProjectState(
            shows = CompanySetup.shows(features),
            spaces = Spaces.list(projects, bots, waiting),
            project = c,
            loaded = held != null,
            error = error,
            name = c?.let(ManyProjects::nameOf) ?: tr("New project"),
            color = c?.color ?: ManyProjects.DEFAULT_COLOR,
            settings = c != null && ManyProjects.SETTINGS in f,
            tidy = c != null && c.phase == "running" && ManyProjects.TIDY in f,
            tidying = x.tidying,
            chief = c != null && ManyProjects.CHIEF in f,
            chiefName = chiefName,
            chiefWaiting = if (c == null) 0 else ProjectRules.chiefWaiting(c, chief, needs),
            manager = if (c != null && ManyProjects.MANAGER_BOT in f) ManyProjects.manager(c, bots) else null,
            day = c?.day?.takeIf { on("days") },
            needs = here,
            // With "Show as" (#690) the objectives are the board's "goals" piece; before it, always on the whiteboard.
            goals = if (c == null) emptyList() else if (CompanyFloor.DISPLAY !in f || on("goals")) c.objectives else emptyList(),
            goal = c?.goal.orEmpty(),
            cards = if (c != null && ProjectCards.shows(features, c)) ProjectCards.slots(c.cards, x.open?.takeIf { it == ProjectCards.NEW || c.cards.any { k -> k.id == it } }, x.closing, x.removing) else null,
            fresh = x.fresh,
            refused = x.refused,
            pieces = if (c != null && x.open == ProjectCards.NEW) ProjectBoard.missing(f, c) else emptyList(),
            teams = teams,
            ownBots = ownBots,
            own = if (c == null || !ownBots) emptyList() else c.bots.mapNotNull { id -> bots.firstOrNull { it.id == id } }.map { key(it, false) },
            addable = if (c == null) emptyList() else ProjectBots.addable(c, bots),
            ownSaving = x.ownSaving,
            filesTile = c != null && ProjectFiles.FEATURE in f && on(ProjectFiles.PIECE) && c.phase == "running" && c.folder != null,
            folder = c?.folder,
            files = x.files,
            chat = chat,
            leadChoices = if (c == null) emptyList() else ManyProjects.leadChoices(c, bots),
            notice = x.notice,
            noticeCount = x.noticeCount,
        )
    }

    private fun say(text: String?) = local.update { it.copy(notice = text ?: tr("That didn't work"), noticeCount = it.noticeCount + 1) }

    private fun company(): Company? = store.company.value.value?.company

    /** Shows project [id] (the switch picked it): the Store reads the projects first when it hasn't yet. */
    fun show(id: String) {
        store.showProject(id)
        scope.launch { runCatching { store.company.refresh() } }
    }

    /** Pull to refresh: the project, the bots and what waits. */
    @Throws(Exception::class)
    suspend fun refresh() = coroutineScope {
        listOf(store.company, store.bots, store.groups, store.needs, store.chief).map { async { it.refresh() } }.awaitAll()
        Unit
    }

    /** Sends [block]; its answer is the project as botdot has it now. A refusal says why and reads the project again. Whether it went. */
    private suspend fun call(block: suspend (Api) -> Company): Boolean = try {
        store.tookProject(block(api))
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        say(e.message)
        scope.launch { runCatching { store.company.refresh() } }
        false
    }

    // ---------- the head of the page ----------

    /** Tidy up (web: Company.tidyHTML): the project's Chief arranges the board, asked in its chat, whose id comes back ("" for none). */
    @Throws(Exception::class)
    suspend fun tidy(): String {
        if (local.value.tidying) return ""
        local.update { it.copy(tidying = true) }
        return try {
            api.tidyBoard().also { if (it.isNotEmpty()) store.company.refresh() }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(e.message); ""
        } finally {
            local.update { it.copy(tidying = false) }
        }
    }

    /**
     * The project's own Chief chat (ADR 230), made on the first tap: its id, or "" when it couldn't be opened (said)
     * or is being made by a tap before, which opens it. Android's CompanyUi.openChief has the same rules.
     */
    @Throws(Exception::class)
    suspend fun chiefChat(): String {
        val c = company() ?: return ""
        c.chiefChat?.takeIf { it.isNotEmpty() && (!c.conversation || c.creationSent) }?.let { return it }
        if (!openingChief.add(c.id)) return ""
        return try {
            val chat = api.projectChiefChat(c.id)
            if (company()?.id == c.id && chat.isNotEmpty()) { store.company.refresh(); chat } else ""
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(e.message ?: tr("Couldn't open the chat")); ""
        } finally {
            openingChief.remove(c.id)
        }
    }

    // ---------- the cards (#776) ----------

    /** New card, or a card's Change: its ask field opens in its place. [id]: [ProjectCards.NEW] or the card's. */
    fun openCard(id: String) = local.update { it.copy(open = id, refused = null) }

    /** The ask field's Close: nothing is sent. */
    fun closeCard() = local.update { it.copy(open = null) }

    /** The ask field's Send: a new card, or the card's Change. Refused, the field opens again with the words. */
    @Throws(Exception::class)
    suspend fun ask(text: String) {
        val words = text.trim()
        if (words.isEmpty()) return
        val open = local.value.open ?: return
        closeCard()
        val ok = call { if (open == ProjectCards.NEW) it.addCard(words) else it.changeCard(open, words) }
        if (!ok) local.update { it.copy(open = open, refused = words) }
    }

    /** An answer to a card's question: a choice, or the words typed under them. */
    @Throws(Exception::class)
    suspend fun answer(card: String, text: String) {
        if (text.isBlank()) return
        call { it.answerCard(card, text.trim()) }
    }

    /** X on a card's questions: it leaves the row at once, before the server answers. */
    @Throws(Exception::class)
    suspend fun closeQuestions(card: String) = leave(card, closing = true) { it.cancelCard(card) }

    @Throws(Exception::class)
    suspend fun refreshCard(card: String) { call { it.refreshCard(card) } }

    /** A card's Remove: off the row at once; a refusal puts it back. */
    @Throws(Exception::class)
    suspend fun removeCard(card: String) = leave(card, closing = false) { it.removeCard(card) }

    private suspend fun leave(card: String, closing: Boolean, block: suspend (Api) -> Company) {
        fun change(add: Boolean) = local.update {
            val set = { s: Set<String> -> if (add) s + card else s - card }
            if (closing) it.copy(closing = set(it.closing)) else it.copy(removing = set(it.removing))
        }
        change(true)
        try { call(block) } finally { change(false) }
    }

    /** A board piece picked under a new card's ask (#780): it is put on the board. */
    @Throws(Exception::class)
    suspend fun putPiece(piece: String) {
        val c = company() ?: return
        closeCard()
        call { it.patchCompany(buildJsonObject { put("board", JsonArray(ProjectBoard.toggled(c, piece).map { p -> JsonPrimitive(p) })) }) }
    }

    // ---------- the teams and the project's own bots ----------

    /**
     * The project's own bots become [ids] (ADR 233): Add bot adds to them, ✕ takes one out. One change at a time, as on
     * Android: each sends the whole list, so a tap while one is on its way does nothing. Whether it went.
     */
    @Throws(Exception::class)
    suspend fun setOwnBots(ids: List<String>): Boolean {
        if (local.value.ownSaving) return false
        local.update { it.copy(ownSaving = true) }
        return try { call { it.setProjectBots(ids) } } finally {
            local.update { it.copy(ownSaving = false) }
        }
    }

    /** Add bot's picks: added to the project's own bots. */
    @Throws(Exception::class)
    suspend fun addOwn(ids: List<String>): Boolean {
        val c = company() ?: return false
        return setOwnBots(c.bots + ids.filter { it !in c.bots })
    }

    /** ✕ on one of the project's own bots. */
    @Throws(Exception::class)
    suspend fun removeOwn(id: String): Boolean {
        val c = company() ?: return false
        return setOwnBots(c.bots - id)
    }

    /** The bots a team's "+" offers ([ProjectRules.offered]). */
    fun offered(team: String): List<Bot> {
        val c = company() ?: return emptyList()
        val t = c.teams.firstOrNull { it.id == team } ?: return emptyList()
        return ProjectRules.offered(c, t, store.bots.value.value.orEmpty())
    }

    /** A team's "+" picks, added to it. */
    @Throws(Exception::class)
    suspend fun addToTeam(team: String, ids: List<String>): Boolean {
        val t = company()?.teams?.firstOrNull { it.id == team } ?: return false
        return call { it.setTeamBots(t.id, t.bots + ids.filter { id -> id !in t.bots }) }
    }

    /** Make lead, in the team's panel. */
    @Throws(Exception::class)
    suspend fun makeLead(team: String, bot: String): Boolean = call { it.makeLead(team, bot) }

    /** What a Chief chat about a new bot starts with: the project's, or a team's. */
    fun newBotWords(team: String?): String {
        val c = company() ?: return ""
        val t = team?.let { id -> c.teams.firstOrNull { it.id == id } }
        return if (t != null) ProjectRules.newBotWords(c, t) else ProjectRules.newBotWords(c)
    }

    // ---------- the settings (#701) ----------

    /** A new name; an empty one is not sent. */
    @Throws(Exception::class)
    suspend fun rename(name: String): Boolean {
        val n = name.trim().take(80)
        if (n.isEmpty() || n == company()?.name) return false
        return call { it.patchCompany(CompanySetup.patchText("name", n)) }
    }

    /** One of [ManyProjects.COLORS]. */
    @Throws(Exception::class)
    suspend fun setColor(color: String): Boolean {
        if (color.equals(company()?.color, ignoreCase = true)) return false
        return call { it.patchCompany(buildJsonObject { put("color", color) }) }
    }

    /** The Project Manager (ADR 230): one of the project's bots, or the Chief ([bot] null). */
    @Throws(Exception::class)
    suspend fun setLead(bot: String?): Boolean {
        if (bot == company()?.lead) return false
        return call { it.patchCompany(if (bot == null) buildJsonObject { put("lead", JsonNull) } else buildJsonObject { put("lead", bot) }) }
    }

    /** Archive, or Unarchive. */
    @Throws(Exception::class)
    suspend fun setArchived(on: Boolean): Boolean = call { it.patchCompany(buildJsonObject { put("archived", on) }) }

    // ---------- the Files tile ----------

    /**
     * The Files tile's newest files, asked when the page shows and each minute while it does ([ProjectFiles.AGAIN_MS]);
     * [on] false stops it. Nothing is asked of a botdot or a project without the tile.
     */
    fun follow(on: Boolean) {
        filesJob?.cancel()
        filesJob = null
        if (!on) return
        filesJob = scope.launch {
            state.map { s -> s.project?.id?.takeIf { s.filesTile } }.distinctUntilChanged().collectLatest { id ->
                local.update { it.copy(files = emptyList()) }
                while (id != null) {
                    try {
                        val r = api.projectFiles(id)
                        if (company()?.id == id) local.update { it.copy(files = r.files) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                    }
                    delay(ProjectFiles.AGAIN_MS)
                }
            }
        }
    }

    /** The page went: nothing is followed. */
    fun close() = follow(false)

    companion object {
        const val FRESH_MS = 4_000L
    }
}
