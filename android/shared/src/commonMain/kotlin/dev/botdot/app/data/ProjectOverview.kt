package dev.botdot.app.data

import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** Recorded project activity from the server, with no inferred progress score (ADR 236). */
@Serializable
data class ProjectOverview(val projectId: String, val at: String, val work: List<OverviewEntry> = emptyList(), val blockers: List<OverviewEntry> = emptyList(), val replies: List<OverviewEntry> = emptyList()) {
    /** The questions waiting for the owner (a bot's, a team chat's, the Chief's): they stand in Needs you, not under Blockers. */
    fun questions(): List<OverviewEntry> = blockers.filter { it.state == ASKS }
    /** What Blockers shows: failed work, not the questions Needs you already holds. */
    fun failures(): List<OverviewEntry> = blockers.filter { it.state != ASKS }
    companion object {
        const val FEATURE = "project-overview"
        /** The overview is the board (ADR 245): its sections are board pieces, with no separate overview. */
        const val BOARD = "overview-board"
        /** Its sections as board pieces, in the order they first stand. */
        val PIECES = listOf("needs", "work", "blockers", "replies")
        const val ASKS = "asks"
        /** Needs you on the overview shows only when something waits: a card or a question. */
        fun needsYouShows(cards: Int, questions: Int): Boolean = cards > 0 || questions > 0
        /** A question in a chat that already has a card in Needs you (the Chief's chat) is that card's: shown once, as the card. */
        fun withoutCarded(questions: List<OverviewEntry>, cardChats: Set<String?>): List<OverviewEntry> = questions.filter { it.chatId == null || it.chatId !in cardChats }
    }
}

/** Needs you's rows ([Overviews.needsYou]): the questions, the Chief chat's cards, what waits for the bots. */
data class NeedsYou(val questions: List<OverviewEntry>, val asks: List<Ask>, val waiting: List<Waiting>)

@Serializable
data class OverviewEntry(val id: String, val botId: String? = null, val chatId: String? = null, val groupId: String? = null, val name: String = "", val state: String = "", val text: String = "", val at: String = "") {
    /** An owner-assigned to-do has no actor: it uses the same primary contact as the project field. */
    fun destination(project: Company, bots: List<Bot>?, features: Collection<String>?): String? = when {
        groupId != null -> "group/$groupId"
        chatId != null -> "chief/$chatId"
        botId != null -> "bot/$botId"
        else -> Spaces.defaultChat(project, bots, features)
    }
}

/** How both phones word a project's Overview (ADR 236): each entry's state, its line, and what the screen says. */
object Overviews {
    /** An entry's state in words. */
    fun label(state: String): String = when (state) {
        "working" -> tr("Working"); "planned" -> tr("Planned"); "failed" -> tr("Failed"); "asks" -> tr("Asks"); else -> tr("Reply")
    }

    /** Under an entry's name: its state, and how long ago. */
    fun meta(e: OverviewEntry): String = label(e.state) + if (e.at.isNotBlank()) " · ${NotesWake.ago(e.at)}" else ""

    /** Its words, or its state when it has none. */
    fun text(e: OverviewEntry): String = e.text.ifBlank { label(e.state) }

    /** Whose head stands beside an entry (web: head in public/project-overview.js). */
    sealed class Head {
        /** Its bot, drawn as everywhere else. */
        data class Of(val bot: Bot) : Head()
        /** A Chief chat's, working while its entry is. */
        data object Chief : Head()
        /** The owner's own to-do. */
        data object You : Head()
        /** A bot the app does not know yet, or a team chat's entry without one: its place stays empty, so the rows stay aligned. */
        data object Unknown : Head()
    }

    fun head(e: OverviewEntry, bots: List<Bot>?): Head = when {
        e.chatId != null -> Head.Chief
        e.botId == null && e.groupId == null -> Head.You
        else -> bots?.firstOrNull { it.id == e.botId }?.let { Head.Of(it) } ?: Head.Unknown
    }

    /** Where an entry opens ([OverviewEntry.destination]): a team's chat, a bot's, a Chief chat, the project's own Chief chat (made first), or the Chief. */
    sealed class Open {
        data class Team(val groupId: String) : Open()
        data class Bot(val botId: String) : Open()
        data class ChiefChat(val chatId: String) : Open()
        data object ProjectChief : Open()
        data object Chief : Open()
    }

    fun open(destination: String?): Open? = when {
        destination == null -> null
        destination.startsWith("group/") -> Open.Team(destination.removePrefix("group/"))
        destination.startsWith("bot/") -> Open.Bot(destination.removePrefix("bot/"))
        destination.startsWith(Spaces.PROJECT_CHIEF) -> Open.ProjectChief
        destination == Spaces.CHIEF -> Open.Chief
        destination.startsWith("chief/") -> Open.ChiefChat(destination.removePrefix("chief/"))
        else -> null
    }

    /** When a file of the folder last changed, in the phone's words. */
    fun fileWhen(f: RecentFile): String = ProjectFiles.whenOf(f.at)

    /** Whether a botdot has the Overview. */
    fun shows(features: Collection<String>?): Boolean = features != null && ProjectOverview.FEATURE in features

    /** The Overview as a page of its own (ADR 236): on a botdot with it but without overview-board, where the board is the page (ADR 245). */
    fun page(features: Collection<String>?): Boolean = shows(features) && ProjectOverview.BOARD !in features.orEmpty()

    /**
     * What Needs you holds on a project's Overview or board (ADR 245), or null when nothing waits: the questions in
     * its chats ([ProjectOverview.questions], less those a card already stands for), the cards asked in its own Chief
     * chat by a bot not in its teams, and what waits for its bots ([here], Android's NeedsRows).
     */
    fun needsYou(c: Company, here: List<Waiting>, needs: Needs?, questions: List<OverviewEntry>): NeedsYou? {
        val asks = needs?.asks.orEmpty()
        val team = Spaces.teamBots(listOf(c))
        val chief = asks.filter { c.chiefChat != null && it.chatId == c.chiefChat && it.bot?.id !in team }
        val q = ProjectOverview.withoutCarded(questions, asks.mapNotNull { it.chatId }.toSet())
        return if (ProjectOverview.needsYouShows(here.size + chief.size, q.size)) NeedsYou(q, chief, here) else null
    }

    /** A card in Needs you in a line: its title, else its line. */
    fun askText(a: Ask): String = a.title.ifBlank { a.line }

    /** A section's line when it has no entries. */
    val noWork: String get() = tr("No recorded work.")
    /** Blockers is failed work: the questions stand in Needs you ([ProjectOverview.failures]). */
    val noBlockers: String get() = tr("No failed work.")
    val noReplies: String get() = tr("No replies yet.")

    /**
     * How many of a tile's rows, with these [heights], to show in [available] height on an arranged board (web: `fit` in
     * public/project-overview.js, ADR 273): all when they fit; else as many whole rows as fit beside the line that says
     * how many more there are ([moreHeight]), one at least. The same unit for all three.
     */
    fun fit(heights: List<Int>, moreHeight: Int, available: Int): Int {
        if (heights.size < 2 || heights.sum() <= available) return heights.size
        var used = moreHeight
        var n = 0
        for (h in heights) {
            if (n > 0 && used + h > available) break
            used += h
            n++
        }
        return n
    }
}

/**
 * A project's Overview at one moment: what botdot recorded ([snapshot]) and its newest files, each with why it couldn't
 * be read again; the saved one shows meanwhile.
 */
class OverviewState(val snapshot: ProjectOverview? = null, val files: RecentFiles? = null, val error: String? = null, val filesError: String? = null) {
    /** The line at the top: when it was read, or that it is coming, or unavailable. */
    val status: String get() = snapshot?.let { tr("Updated {when}", "when" to NotesWake.ago(it.at)) } ?: if (error == null) tr("Loading…") else tr("Information unavailable")
    /** Why it couldn't be read again; null when it was. */
    val problem: String? get() = error?.let { "${tr("Couldn't refresh")}: $it" + if (snapshot != null) " · ${tr("Showing saved information")}" else "" }
    val filesProblem: String? get() = filesError?.let { "${tr("Couldn't load files")}: $it" + if (files != null) " · ${tr("Showing saved information")}" else "" }
    /** In place of the files list: coming, unavailable, the computer off, or none; null when there are files. */
    val filesLine: String? get() = when {
        files == null -> if (filesError == null) tr("Loading…") else tr("Information unavailable")
        files.state == "off" -> tr("Files are unavailable while the computer is off.")
        files.files.isEmpty() -> tr("No files yet.")
        else -> null
    }
}

/**
 * A project's Overview for both phones: [read] asks botdot for what it recorded and for the newest files, keeping what
 * was read before when a read fails. Each phone reads it while the Overview is on screen (Android every 30 seconds).
 */
class OverviewDesk(private val api: Api, val projectId: String) {
    private val _state = kotlinx.coroutines.flow.MutableStateFlow(OverviewState())
    val state: kotlinx.coroutines.flow.StateFlow<OverviewState> = _state

    /** How often it is read again while on screen. */
    val everyMs: Long = 30_000

    @Throws(Exception::class)
    suspend fun read() {
        readRecorded()
        val s = _state.value
        val (files, filesError) = try { api.projectFiles(projectId) to null }
            catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { s.files to (e.message ?: tr("Couldn't load files")) }
        _state.value = OverviewState(s.snapshot, files, s.error, filesError)
    }

    /** What botdot recorded only, not the files: for the board's Overview tiles (overview-board, ADR 245). */
    @Throws(Exception::class)
    suspend fun readRecorded() {
        val s = _state.value
        val (snapshot, error) = try {
            api.projectOverview(projectId).takeIf { it.projectId == projectId }.let { (it ?: s.snapshot) to null }
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { s.snapshot to (e.message ?: tr("Couldn't refresh")) }
        _state.value = OverviewState(snapshot, s.files, error, s.filesError)
    }

    fun watch(scope: kotlinx.coroutines.CoroutineScope, onChange: (OverviewState) -> Unit): kotlinx.coroutines.Job = scope.launch { state.collect { onChange(it) } }
}
