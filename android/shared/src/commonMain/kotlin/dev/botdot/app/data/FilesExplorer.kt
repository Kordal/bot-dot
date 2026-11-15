package dev.botdot.app.data

import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.toLocalDateTime
import kotlinx.datetime.todayIn

/**
 * Files (#603; docs/api.md, "A bot's workspace"): a bot's files as a file manager shows them, full screen, opened from
 * its chat and its settings. Its places are its folder on botdot, its folder on the account's computer, each shared
 * project it is in, and what is kept in mind. As the web page's Files (public/files.js). Only from a server whose
 * `features` name `files-explorer`; an older one keeps the Workspace and Files sections in the settings.
 */
object FilesExplorer {
    const val FEATURE = "files-explorer"
    /** #604: search by name across its places. */
    const val SEARCH = "workspace-search"
    /** The place of what is kept in mind: files in uploads/ on botdot, listed from its Files. */
    const val KEPT = "kept"

    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features
    fun searches(features: Collection<String>?): Boolean = features != null && SEARCH in features

    /** Every place of the bot, in the order the place sheet lists them; the Chief has its folder on botdot alone. */
    fun places(botId: String, computer: String, projects: List<Project>): List<String> =
        listOf(WorkspaceFiles.SERVER) + if (computer == "linux") listOf(WorkspaceFiles.COMPUTER) + Projects.of(botId, projects).map { WorkspaceFiles.projectRoot(it.name) } else emptyList()

    fun placeName(root: String): String = when (root) {
        WorkspaceFiles.SERVER -> tr("On botdot")
        WorkspaceFiles.COMPUTER -> tr("Computer")
        KEPT -> tr("Kept in mind")
        else -> WorkspaceFiles.projectOf(root) ?: root
    }

    /** The root a place's files are asked of: what is kept in mind is on botdot. */
    fun rootOf(place: String): String = if (place == KEPT) WorkspaceFiles.SERVER else place

    enum class Sort { NAME, DATE, SIZE; val label: String get() = when (this) { NAME -> tr("Name"); DATE -> tr("Date"); SIZE -> tr("Size") } }

    /**
     * The entries as shown: folders first, then the rest by name, newest first or largest first (a folder by how many
     * it holds). Names starting with a dot are listed too: a bot's .env or .gitignore is its owner's to open or change.
     */
    fun sorted(entries: List<WorkspaceEntry>, sort: Sort = Sort.NAME): List<WorkspaceEntry> {
        val byName = Comparator<WorkspaceEntry> { a, b -> natural(a.name, b.name) }
        val order = when (sort) {
            Sort.NAME -> byName
            Sort.DATE -> compareByDescending<WorkspaceEntry> { it.at.orEmpty() }.then(byName)
            Sort.SIZE -> compareByDescending<WorkspaceEntry> { if (it.type == "folder") (it.items ?: 0).toLong() else it.size ?: 0 }.then(byName)
        }
        return entries.sortedWith(compareBy<WorkspaceEntry> { if (it.type == "folder") 0 else 1 }.then(order))
    }

    /** Names as people read them: case aside, and "w9" before "w10". */
    fun natural(a: String, b: String): Int {
        val x = a.lowercase(); val y = b.lowercase()
        var i = 0; var j = 0
        while (i < x.length && j < y.length) {
            if (x[i].isDigit() && y[j].isDigit()) {
                val si = i; while (i < x.length && x[i].isDigit()) i++
                val sj = j; while (j < y.length && y[j].isDigit()) j++
                val c = compareValues(x.substring(si, i).trimStart('0').length, y.substring(sj, j).trimStart('0').length)
                    .takeIf { it != 0 } ?: x.substring(si, i).trimStart('0').compareTo(y.substring(sj, j).trimStart('0'))
                if (c != 0) return c
            } else {
                if (x[i] != y[j]) return x[i].compareTo(y[j])
                i++; j++
            }
        }
        return (x.length - i).compareTo(y.length - j)
    }

    enum class Kind { FOLDER, LOCK, LINK, SHEET, IMAGE, DOC, FILE }

    private val SHEETS = setOf("csv", "tsv", "xlsx", "xls", "ods")
    private val IMAGES = setOf("png", "jpg", "jpeg", "gif", "webp", "svg")
    private val THUMBS = setOf("png", "jpg", "jpeg", "gif", "webp")
    private val DOCS = setOf("md", "markdown", "txt", "docx", "pdf", "rst", "odt", "rtf")
    private fun extOf(name: String) = name.substringAfterLast('.', "").lowercase().takeIf { it.length in 1..8 && '.' in name }.orEmpty()

    /** An entry's kind, for its icon; what botdot keeps has a lock (its uploads/ folder stays a folder). */
    fun kindOf(e: WorkspaceEntry): Kind = when {
        e.kept && e.type != "folder" -> Kind.LOCK
        e.type == "folder" -> if (e.kept && e.name != "uploads") Kind.LOCK else Kind.FOLDER
        e.type == "link" -> Kind.LINK
        else -> extOf(e.name).let { x -> if (x in SHEETS) Kind.SHEET else if (x in IMAGES) Kind.IMAGE else if (x in DOCS) Kind.DOC else Kind.FILE }
    }

    /** Whether the grid shows the image itself (the server answers PNG, JPEG, GIF and WebP up to 1 MB). */
    fun thumbs(e: WorkspaceEntry): Boolean = e.type == "file" && extOf(e.name) in THUMBS && (e.size ?: 0) <= 1024 * 1024

    /** A folder's size is how many entries it holds; a file's, its bytes. */
    fun sizeOf(e: WorkspaceEntry): String = when (e.type) {
        "folder" -> e.items?.let { trn(it, "{n} item", "{n} items") }.orEmpty()
        "file" -> UploadedFiles.size(e.size ?: 0)
        else -> ""
    }

    /** When it changed, as short as a row needs it: the time today, "Yesterday", then the day ("20 Oct"). */
    fun whenOf(iso: String?, zone: TimeZone = TimeZone.currentSystemDefault(), today: LocalDate = Clock.System.todayIn(zone)): String {
        if (iso.isNullOrBlank()) return ""
        return runCatching {
            val t = Instant.parse(iso)
            val day = t.toLocalDateTime(zone).date
            when {
                day == today -> formatDate(t, "HH:mm", I18n.language, zone)
                day == today.minus(1, DateTimeUnit.DAY) -> tr("Yesterday")
                day.year == today.year -> formatDate(t, "d MMM", I18n.language, zone)
                else -> formatDate(t, "d MMM yyyy", I18n.language, zone)
            }
        }.getOrDefault("")
    }

    fun detail(e: WorkspaceEntry, zone: TimeZone = TimeZone.currentSystemDefault(), today: LocalDate = Clock.System.todayIn(zone)): String =
        listOf(sizeOf(e), whenOf(e.at, zone, today)).filter { it.isNotEmpty() }.joinToString(" · ")

    /** What can be done to an entry where it is. */
    data class Can(val open: Boolean, val rename: Boolean, val move: Boolean, val copy: Boolean, val download: Boolean, val keep: Boolean, val unpin: Boolean, val delete: Boolean)

    /**
     * On botdot what botdot keeps and links are never changed; on the computer and in a project box changes anything
     * but a folder botdot keeps as it is; a file the owner gave the bot keeps its name and place. [pinned]: the paths
     * of the files kept in mind.
     */
    fun can(place: String, listing: WorkspaceListing?, e: WorkspaceEntry, pinned: Set<String>): Can {
        val kept = place == KEPT
        val computer = place != WorkspaceFiles.SERVER && !kept
        val writes = !kept && listing?.readOnly != true && (computer || (!e.kept && e.type != "link"))
        val file = e.type == "file"
        val isPinned = file && !computer && e.path in pinned
        return Can(
            open = file || e.type == "folder",
            rename = writes && !e.keepsName && e.type != "link",
            move = writes && !e.keepsName && e.type != "link",
            copy = !kept && (file || e.type == "folder"),
            download = file,
            keep = place == WorkspaceFiles.SERVER && file && !isPinned,
            unpin = isPinned,
            delete = !kept && (writes || (computer && e.type == "link")),
        )
    }

    /** What is kept in mind, as entries of the place: each a file in uploads/ on botdot. */
    fun keptEntries(files: List<UploadedFile>): List<WorkspaceEntry> =
        files.filter { it.pinned }.map { WorkspaceEntry(it.name, it.file, "file", it.size, at = it.at.ifBlank { null }) }

    /** Whether [folder] of [to] can take [paths] from [from]: not the folder they are in, nor one of them or inside one. */
    fun takes(from: String, paths: Collection<String>, to: String, folder: String): Boolean =
        rootOf(from) != to || paths.none { p -> WorkspaceFiles.parentOf(p) == folder || folder == p || folder.startsWith("$p/") }

    /** The breadcrumb on a phone: the bot's name, then each folder on the way. */
    fun crumbs(path: String, top: String): List<Pair<String, String>> = WorkspaceFiles.crumbs(path, top)

    /** What a finished move or copy says: "Moved 2 items to Website / data". */
    fun carriedWords(move: Boolean, names: List<String>, to: String, folder: String): String {
        val what = if (names.size == 1) names[0] else trn(names.size, "{n} item", "{n} items")
        val place = listOf(placeName(to), folder.substringAfterLast('/')).filter { it.isNotEmpty() }.joinToString(" / ")
        return if (move) tr("Moved {what} to {place}", "what" to what, "place" to place) else tr("Copied {what} to {place}", "what" to what, "place" to place)
    }

    /** The confirmation of a delete of several: folders go with what they hold. */
    fun deleteManyWords(n: Int): String = trn(n, "Delete {n} item? Folders go with what they hold. This can't be undone.", "Delete {n} items? Folders go with what they hold. This can't be undone.")

    /** Whether the owner's Files opens: a bot's from a server with `files-explorer`, the Chief's also with `chief-files`. */
    fun opensFor(ownerId: String, features: Collection<String>?): Boolean =
        shows(features) && (ownerId != UploadedFiles.CHIEF || UploadedFiles.chiefShows(features))

    /** The computer whose places Files lists: none for the Chief, a project's folder is on the computer, else the bot's. */
    fun computerOf(ownerId: String, bot: Bot?): String = when {
        ownerId == UploadedFiles.CHIEF -> "none"
        UploadedFiles.folderOf(ownerId) != null -> "linux"
        else -> bot?.computer ?: "none"
    }

    /** The places of [ownerId]'s Files: a project's folder (#703) has its one place, the others [places]. */
    fun placesOf(ownerId: String, computer: String, projects: List<Project>): List<String> =
        UploadedFiles.folderOf(ownerId)?.let { listOf(WorkspaceFiles.projectRoot(it)) } ?: places(ownerId, computer, projects)

    /** The place Files opens on: the one asked for, a project folder's own, else on botdot. */
    fun firstPlace(ownerId: String, start: String = ""): String =
        start.ifEmpty { null } ?: UploadedFiles.folderOf(ownerId)?.let(WorkspaceFiles::projectRoot) ?: WorkspaceFiles.SERVER

    /** Whether the place sheet offers New project: a bot that uses the computer, from a server with `projects`. */
    fun makesProjects(ownerId: String, computer: String, features: Collection<String>?): Boolean =
        ownerId != UploadedFiles.CHIEF && UploadedFiles.folderOf(ownerId) == null && computer == "linux" && Projects.shows(features)

    /** Whether Files searches its places: not a project's folder. */
    fun searchesFor(ownerId: String, features: Collection<String>?): Boolean = UploadedFiles.folderOf(ownerId) == null && searches(features)

    /** The entries shown: a search's hits, what is kept in mind, or the folder [sorted]. */
    fun shown(found: List<FoundFile>?, place: String, kept: List<UploadedFile>, listing: WorkspaceListing?, sort: Sort): List<WorkspaceEntry> = when {
        found != null -> found.map { WorkspaceEntry(it.name, it.path, it.type, it.size, at = it.at) }
        place == KEPT -> keptEntries(kept)
        else -> sorted(listing?.entries.orEmpty(), sort)
    }

    /** Where each shown entry is: a search finds them in every place, the rest are in [place]'s root. */
    fun shownAt(found: List<FoundFile>?, shown: List<WorkspaceEntry>, place: String): List<String> = found?.map { placeOf(it) } ?: shown.map { rootOf(place) }

    /** Whether the folder shown takes uploads and new folders. */
    fun writesHere(found: List<FoundFile>?, place: String, listing: WorkspaceListing?): Boolean = found == null && place != KEPT && listing?.readOnly == false

    /** A file of [ownerId]'s, in [at], as the viewer opens it: a file on the computer can start it (not a project's folder). */
    fun opening(ownerId: String, at: String, e: WorkspaceEntry, from: String): DocumentView.Opening =
        DocumentView.Opening(WorkspaceFiles.file(ownerId, at, e.path), e.name, from, botId = if (at != WorkspaceFiles.SERVER && UploadedFiles.folderOf(ownerId) == null) ownerId else null)

    /** What the folder's space shows: what went wrong reading it, that it is still coming, that it is empty, or its entries. */
    enum class Pane { COMPUTER_OFF, GONE, FAILED, LOADING, EMPTY, ENTRIES, SEARCH_FAILED }

    /** [searchFailed]: the search couldn't be made (offline, a server error): said, with Try again, never "Nothing by that name". */
    fun pane(found: List<FoundFile>?, place: String, failed: Throwable?, listing: WorkspaceListing?, shown: List<WorkspaceEntry>, searchFailed: Throwable? = null): Pane {
        val read = found == null && place != KEPT
        return when {
            searchFailed != null -> Pane.SEARCH_FAILED
            read && failed != null -> when ((failed as? ApiException)?.status) { 409 -> Pane.COMPUTER_OFF; 404 -> Pane.GONE; else -> Pane.FAILED }
            read && listing == null -> Pane.LOADING
            shown.isEmpty() -> Pane.EMPTY
            else -> Pane.ENTRIES
        }
    }

    /** What a search came to: what it found, or why it couldn't be made (then [found] is null). */
    data class Searched(val found: List<FoundFile>?, val failed: Throwable?)

    /** Searches [ownerId]'s files for [query], for both phones: a failure is kept, not turned into "found nothing". */
    @Throws(Exception::class)
    suspend fun search(api: Api, ownerId: String, query: String): Searched = try {
        Searched(api.searchFiles(ownerId, query.trim()).results, null)
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        Searched(null, e)
    }

    /** What a failed search says: its reason, else "Couldn't search". */
    fun searchFailedWords(e: Throwable?): String = e?.message?.ifBlank { null } ?: tr("Couldn't search")

    /** What an empty list says: a search found nothing, or the folder holds nothing. */
    fun emptyWords(found: List<FoundFile>?): String = if (found != null) tr("Nothing by that name.") else tr("Empty.")

    /** A search hit's place as a root string: "server", "computer" or "project/<name>". */
    fun placeOf(hit: FoundFile): String = if (hit.root == Projects.ROOT && hit.project != null) WorkspaceFiles.projectRoot(hit.project) else hit.root
}
