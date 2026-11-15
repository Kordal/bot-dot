package dev.botdot.app.data

import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** Recorded project activity from the server, with no inferred progress score (ADR 236). */
@Serializable
data class ProjectOverview(val projectId: String, val at: String, val goal: String = "", val work: List<OverviewEntry> = emptyList(), val blockers: List<OverviewEntry> = emptyList(), val replies: List<OverviewEntry> = emptyList()) {
    companion object { const val FEATURE = "project-overview" }
}

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

    /** A section's line when it has no entries. */
    val noWork: String get() = tr("No recorded work.")
    val noBlockers: String get() = tr("No failed work or open questions.")
    val noReplies: String get() = tr("No replies yet.")
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
        val s = _state.value
        val (snapshot, error) = try {
            api.projectOverview(projectId).takeIf { it.projectId == projectId }.let { (it ?: s.snapshot) to null }
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { s.snapshot to (e.message ?: tr("Couldn't refresh")) }
        val (files, filesError) = try { api.projectFiles(projectId) to null }
            catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { s.files to (e.message ?: tr("Couldn't load files")) }
        _state.value = OverviewState(snapshot, files, error, filesError)
    }

    fun watch(scope: kotlinx.coroutines.CoroutineScope, onChange: (OverviewState) -> Unit): kotlinx.coroutines.Job = scope.launch { state.collect { onChange(it) } }
}
