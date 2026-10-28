package dev.botdot.app.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

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
        val x = a.lowercase(Locale.ROOT); val y = b.lowercase(Locale.ROOT)
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
    private fun extOf(name: String) = name.substringAfterLast('.', "").lowercase(Locale.ROOT).takeIf { it.length in 1..8 && '.' in name }.orEmpty()

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
    fun whenOf(iso: String?, zone: ZoneId = ZoneId.systemDefault(), today: LocalDate = LocalDate.now(zone)): String {
        if (iso.isNullOrBlank()) return ""
        return runCatching {
            val t = Instant.parse(iso).atZone(zone)
            val day = t.toLocalDate()
            when {
                day == today -> t.format(DateTimeFormatter.ofPattern("HH:mm", I18n.locale))
                day == today.minusDays(1) -> tr("Yesterday")
                day.year == today.year -> t.format(DateTimeFormatter.ofPattern("d MMM", I18n.locale))
                else -> t.format(DateTimeFormatter.ofPattern("d MMM yyyy", I18n.locale))
            }
        }.getOrDefault("")
    }

    fun detail(e: WorkspaceEntry, zone: ZoneId = ZoneId.systemDefault(), today: LocalDate = LocalDate.now(zone)): String =
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

    /** A search hit's place as a root string: "server", "computer" or "project/<name>". */
    fun placeOf(hit: FoundFile): String = if (hit.root == Projects.ROOT && hit.project != null) WorkspaceFiles.projectRoot(hit.project) else hit.root
}
