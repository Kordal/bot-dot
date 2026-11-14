package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * One folder of Files on the iPhone (#1368), at one moment: what FilesStore read, and what Android's Files decides
 * from it (FilesExplorer): the entries in their order, what each can do, and what the folder's space shows.
 */
data class FilesState(
    val ownerId: String,
    /** Whose files: the bot's name, the Chief's, or a project's. */
    val name: String,
    val place: String,
    val path: String,
    val places: List<String>,
    val features: List<String>?,
    val listing: WorkspaceListing?,
    val failed: Throwable?,
    val kept: List<UploadedFile>,
    val query: String,
    val found: List<FoundFile>?,
    val sort: FilesExplorer.Sort,
) {
    /** The folder's name, or whose files at the top. */
    val title: String get() = path.substringAfterLast('/').ifEmpty { name }
    val placeName: String get() = FilesExplorer.placeName(place)
    fun placeName(of: String): String = FilesExplorer.placeName(of)
    /** The places to switch to, at the top: what is kept in mind last (none in a project's folder). */
    val placeChoices: List<String> get() = places + listOfNotNull(FilesExplorer.KEPT.takeIf { UploadedFiles.folderOf(ownerId) == null })
    /** The entries as shown, and where each is (a search finds them in every place). */
    val shown: List<WorkspaceEntry> by lazy { FilesExplorer.shown(found, place, kept, listing, sort) }
    val shownAt: List<String> by lazy { FilesExplorer.shownAt(found, shown, place) }
    val pane: FilesExplorer.Pane get() = FilesExplorer.pane(found, place, failed, listing, shown)
    val failedWords: String get() = failed?.message ?: tr("Couldn't load it.")
    val emptyWords: String get() = FilesExplorer.emptyWords(found)
    val writesHere: Boolean get() = FilesExplorer.writesHere(found, place, listing)
    /** Search is at the top of Files, as the folder's own field. */
    val searches: Boolean get() = path.isEmpty() && FilesExplorer.searchesFor(ownerId, features)
    private val pinned: Set<String> by lazy { kept.filter { it.pinned }.map { it.file }.toSet() }
    fun can(e: WorkspaceEntry): FilesExplorer.Can = FilesExplorer.can(place, listing, e, pinned)
    fun kind(e: WorkspaceEntry): FilesExplorer.Kind = FilesExplorer.kindOf(e)
    /** The line under the [i]th entry's name: its size and when it changed, or for a search hit where it is. */
    fun detail(i: Int): String {
        val e = shown[i]
        return if (found != null) listOf(placeName(shownAt[i]), WorkspaceFiles.parentOf(e.path)).filter { it.isNotEmpty() }.joinToString(" / ")
        else FilesExplorer.detail(e)
    }
    /** The [i]th entry, a file, as the viewer opens it. */
    fun opening(i: Int): DocumentView.Opening = FilesExplorer.opening(ownerId, shownAt[i], shown[i], name)
}

/**
 * What the iPhone keeps for one folder of a bot's, the Chief's or a project's files (#1368): it reads the folder, what
 * is kept in mind and the places, and does what Android's Files does there through the same calls. [watch] hands the
 * screen a new [FilesState] at every change, on the main thread; [close] it when the folder leaves the screen.
 */
class FilesStore(val api: Api, val ownerId: String, val name: String, place: String, path: String) {
    private val scope = MainScope()
    private val state = MutableStateFlow(
        FilesState(ownerId, name, FilesExplorer.firstPlace(ownerId, place), path, emptyList(), null, null, null, emptyList(), "", null, FilesExplorer.Sort.NAME),
    )
    private var searching: Job? = null

    /** Calls [onChange] with the state now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (FilesState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    /** Reads it all once the screen shows it. */
    fun start() { scope.launch { runCatching { refresh() } } }

    /** The folder, what is kept in mind, and the places (the bot's computer, its projects), read again. */
    @Throws(Exception::class)
    suspend fun refresh() = coroutineScope {
        val s = state.value
        launch {
            val features = runCatching { api.version().features }.getOrNull()
            val bot = if (ownerId == UploadedFiles.CHIEF || UploadedFiles.folderOf(ownerId) != null) null else runCatching { api.bots().firstOrNull { it.id == ownerId } }.getOrNull()
            val computer = FilesExplorer.computerOf(ownerId, bot)
            val projects = if (FilesExplorer.makesProjects(ownerId, computer, features)) runCatching { api.projects() }.getOrDefault(emptyList()) else emptyList()
            state.update { it.copy(features = features, places = FilesExplorer.placesOf(ownerId, computer, projects)) }
        }
        if (UploadedFiles.folderOf(ownerId) == null) launch { runCatching { api.botFiles(ownerId) }.onSuccess { r -> state.update { it.copy(kept = r.files) } } }
        if (s.place != FilesExplorer.KEPT) {
            try {
                val listing = api.workspace(ownerId, s.place, s.path)
                state.update { if (it.place == s.place) it.copy(listing = listing, failed = null) else it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update { if (it.place == s.place) it.copy(failed = e) else it }
            }
        }
    }

    /** Another place, at its top (the place menu). */
    fun go(place: String) {
        state.update { it.copy(place = place, path = "", listing = null, failed = null, query = "", found = null) }
        start()
    }

    fun sort(by: FilesExplorer.Sort) = state.update { it.copy(sort = by) }

    /** A search as it is typed, a moment after the last key; an empty one shows the folder again. */
    fun search(query: String) {
        val q = query.take(100)
        state.update { it.copy(query = q, found = if (q.isBlank()) null else it.found) }
        searching?.cancel()
        if (q.isBlank()) return
        searching = scope.launch {
            delay(250)
            val found = runCatching { api.searchFiles(ownerId, q.trim()).results }.getOrDefault(emptyList())
            state.update { if (it.query == q) it.copy(found = found) else it }
        }
    }

    /**
     * Uploads the files picked on the phone (Photos, Files) into this folder: [paths] where each is in the app's
     * storage, [names] what each is called. At most [WorkspaceFiles.MAX_FILES]; answers what went wrong, or null.
     */
    @Throws(Exception::class)
    suspend fun upload(paths: List<String>, names: List<String>): String? {
        val s = state.value
        val said = mutableListOf<String>()
        if (paths.size > WorkspaceFiles.MAX_FILES) said += tr("Upload at most {n} files at a time.", "n" to WorkspaceFiles.MAX_FILES)
        paths.zip(names).take(WorkspaceFiles.MAX_FILES).forEach { (p, n) ->
            try {
                api.uploadToWorkspace(outgoingFile(p, n), ownerId, s.path, FilesExplorer.rootOf(s.place))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                said += e.message ?: tr("Couldn't upload")
            }
        }
        refresh()
        return said.joinToString("\n").ifEmpty { null }
    }

    @Throws(Exception::class)
    suspend fun makeFolder(name: String) {
        val s = state.value
        api.makeWorkspaceFolder(ownerId, s.path, name.trim(), FilesExplorer.rootOf(s.place))
        refresh()
    }

    /** Renames [e] where it is; a name with / in it is refused with the sentence Android says. */
    @Throws(Exception::class)
    suspend fun rename(e: WorkspaceEntry, name: String) {
        if (!WorkspaceFiles.nameOk(name)) throw ApiException(tr("A name can't have / in it. To put it in another folder, use Move to…."))
        val to = WorkspaceFiles.renamed(e.path, name)
        if (to == e.path) return
        api.moveInWorkspace(ownerId, e.path, to, FilesExplorer.rootOf(state.value.place))
        refresh()
    }

    /** The question before [e] is deleted: what goes with it, counted. */
    @Throws(Exception::class)
    suspend fun deleteWords(e: WorkspaceEntry): String =
        WorkspaceFiles.deleteWords(e.name, api.workspaceCount(ownerId, FilesExplorer.rootOf(state.value.place), e.path))

    /** Deletes [e] and answers what to say. */
    @Throws(Exception::class)
    suspend fun delete(e: WorkspaceEntry): String {
        api.deleteFromWorkspace(ownerId, FilesExplorer.rootOf(state.value.place), e.path)
        refresh()
        return tr("Deleted {name}", "name" to e.name)
    }

    /** Keeps a file on botdot in mind, or no longer ([on] false), and answers what to say. */
    @Throws(Exception::class)
    suspend fun keep(e: WorkspaceEntry, on: Boolean): String {
        if (on) api.keepFromWorkspace(ownerId, e.path) else api.pinBotFile(ownerId, e.path, false)
        refresh()
        return if (on) tr("Keeping {name} in mind", "name" to e.name) else tr("{name} is no longer kept in mind", "name" to e.name)
    }

    /** The owner's tap on Start the computer: the folder is read again once it answers. */
    @Throws(Exception::class)
    suspend fun startComputer() {
        if (UploadedFiles.folderOf(ownerId) == null) api.startComputer(ownerId)
        refresh()
    }

    fun close() = scope.cancel()
}
