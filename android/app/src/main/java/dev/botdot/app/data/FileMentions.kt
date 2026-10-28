package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable

/** A file or folder the workspace's search found (#604, docs/api.md "A bot's workspace"): where it is and what it is. */
@Serializable
data class FoundFile(val name: String = "", val path: String = "", val type: String = "file", val root: String = "server", val project: String? = null, val size: Long? = null, val at: String? = null)

@Serializable
data class FileSearch(val results: List<FoundFile> = emptyList(), val more: Boolean = false)

/**
 * Files in a bot's own chat (#604, [Mentions.FILE_MENTIONS]): "@" and part of a name lists the bot's files and folders
 * in every place it has (its workspace on botdot, its folder on the account's computer, its shared projects), found by
 * the workspace's search, above the other mentions. A folder opens in the list: picked, or "/" typed after its name
 * ("@reports/"); its header goes back up. A picked file or folder goes in the message as its mention
 * ("@[botdot:reports/summary.md]", [Mentions.fileText]). The same as public/file-mentions.js on the web page.
 * [find] and [list] ask the server; an answer is kept a little.
 */
class FileMentions(private val find: suspend (String) -> List<FoundFile>, private val list: suspend (Dir) -> List<WorkspaceEntry>, private val now: () -> Long = System::currentTimeMillis) {
    /** A folder: its place ([root] "server", "computer" or "project", then [project]) and its path there. */
    data class Dir(val root: String, val path: String, val project: String? = null) {
        val ref get() = Mentions.FileRef(root, path, project)
        /** As the workspace's other routes name a root (WorkspaceFiles). */
        val apiRoot get() = if (root == "project") WorkspaceFiles.projectRoot(project.orEmpty()) else root
    }

    /** A row of the list: a file or folder, what it puts in the message ([text]), what was typed ([q]); [inFolder]: listed in
     *  a folder opened, where it needs no place beside it. */
    data class Row(val name: String, val type: String, val ref: Mentions.FileRef, val text: String, val q: String, val inFolder: Boolean) {
        val folder get() = type == "folder"
    }

    /** What the list shows: the file rows, and the folder opened (null: a search). */
    data class View(val rows: List<Row> = emptyList(), val dir: Dir? = null) {
        val empty get() = rows.isEmpty() && dir == null
    }

    private var walk: Walk? = null // a folder opened: where its "@" is, the text from it that opened it, the folder
    private data class Walk(val start: Int, val prefix: String, val dir: Dir)
    private var last = View()
    private val keptFound = HashMap<String, Pair<Long, List<FoundFile>>>()
    private val keptListed = HashMap<Dir, Pair<Long, List<WorkspaceEntry>>>()

    private suspend fun found(q: String): List<FoundFile> = kept(keptFound, q.lowercase()) { find(q) }
    private suspend fun listed(d: Dir): List<WorkspaceEntry> = kept(keptListed, d) { list(d) }

    /** An answer kept for [KEEP_MS]; one that failed is empty and not kept, and a cancelled look stops here. */
    private suspend fun <K, T> kept(map: HashMap<K, Pair<Long, List<T>>>, key: K, ask: suspend () -> List<T>): List<T> {
        map[key]?.takeIf { now() - it.first < KEEP_MS }?.let { return it.second }
        val got = try { ask() } catch (e: CancellationException) { throw e } catch (e: Exception) { return emptyList() }
        map.entries.removeAll { now() - it.value.first >= KEEP_MS }
        map[key] = now() to got
        return got
    }

    /** The folder [names] lead to from [from], or with none from the best folder of the first name found; null when not. */
    private suspend fun follow(from: Dir?, names: List<String>): Dir? {
        var d = from
        for (n in names) {
            // The name as typed before one in another case, and the nearest.
            fun fit(name: String, path: String) = (if (name == n) 0 else 100) + path.split('/').size
            d = if (d == null) found(n).filter { it.type == "folder" && it.name.equals(n, true) }.minByOrNull { fit(it.name, it.path) }?.let { Dir(it.root, it.path, it.project) }
            else listed(d).filter { it.type == "folder" && it.name.equals(n, true) }.minByOrNull { fit(it.name, it.path) }?.let { e -> d!!.copy(path = e.path) }
            if (d == null) return null
        }
        return d
    }

    /**
     * What the list shows for the text typed before the cursor. A search waits [WAIT_MS] first (call it from a
     * LaunchedEffect keyed on the text: a later key cancels it); a folder opened answers at once.
     */
    suspend fun look(typed: String): View {
        var dir: Dir? = null
        var rest: String? = null
        walk?.let { w ->
            if (typed.length >= w.start + w.prefix.length && typed.substring(w.start, w.start + w.prefix.length) == w.prefix) {
                rest = typed.substring(w.start + w.prefix.length).takeIf { r -> r.none { it.isWhitespace() || it == '@' || it == '[' || it == ']' } }
                if (rest != null) dir = w.dir
            }
        }
        if (rest == null) walk = null
        val t = if (rest == null) Mentions.fileTyping(typed) else null
        if (rest == null && t == null) return View().also { last = it }
        val names = (rest?.split('/') ?: (t!!.folders + t.q)).toMutableList()
        val q = names.removeAt(names.size - 1)
        if (dir == null && names.isEmpty() && q.isEmpty()) return View().also { last = it } // "@" alone: the other mentions
        if (dir == null || names.isNotEmpty()) delay(WAIT_MS)
        val d = if (names.isNotEmpty()) follow(dir, names) else dir
        val rows = when {
            d != null -> listed(d).filter { it.type != "other" && !it.name.startsWith(".") && it.name.none { c -> c == ']' || c == '\n' } && (q.isEmpty() || it.name.contains(q, true)) }
                .take(FOLDER_ROWS).mapNotNull { e -> row(e.name, e.type, Mentions.FileRef(d.root, e.path, d.project), q, true) }
            names.isEmpty() -> found(q).filter { it.type != "other" }.mapNotNull { h -> row(h.name, h.type, Mentions.FileRef(h.root, h.path, h.project), q, false) }.take(FILES_FIRST)
            else -> emptyList()
        }
        return View(rows, d).also { last = it }
    }

    private fun row(name: String, type: String, ref: Mentions.FileRef, q: String, inFolder: Boolean) =
        Mentions.fileText(ref)?.let { Row(name, type, ref, it, q, inFolder) }

    private fun startOf(text: String, cursor: Int) = walk?.start ?: Mentions.fileTyping(text.substring(0, cursor))?.start

    /** A folder row picked: it opens, and the text says so ("@reports/"). The new text and cursor, or null. */
    fun enter(text: String, cursor: Int, row: Row): Pair<String, Int>? {
        val at = startOf(text, cursor) ?: return null
        val prefix = "@${row.name}/"
        val end = Mentions.fileWordEnd(text, cursor)
        walk = Walk(at, prefix, Dir(row.ref.root, row.ref.path, row.ref.project))
        return (text.substring(0, at) + prefix + text.substring(end)) to at + prefix.length
    }

    /** Up one folder; from a place's top back to "@". */
    fun back(text: String, cursor: Int): Pair<String, Int>? {
        val d = last.dir ?: return null
        val at = startOf(text, cursor) ?: return null
        val end = Mentions.fileWordEnd(text, cursor)
        val up = if ('/' in d.path) d.copy(path = d.path.substringBeforeLast('/')) else null
        val prefix = up?.let { "@${it.path.substringAfterLast('/')}/" } ?: "@"
        walk = up?.let { Walk(at, prefix, it) }
        last = View()
        return (text.substring(0, at) + prefix + text.substring(end)) to at + prefix.length
    }

    /** A file or folder picked: its mention and a space in place of the "@" and all typed after it. */
    fun put(text: String, cursor: Int, mention: String): Pair<String, Int>? {
        val at = startOf(text, cursor) ?: return null
        walk = null
        last = View()
        return Mentions.putAt(text, at, cursor, mention).let { it.text to it.cursor }
    }

    /** The folder opened, as its mention; null at a place's top. */
    fun self(): String? = last.dir?.takeIf { it.path.isNotEmpty() }?.let { Mentions.fileText(it.ref) }

    companion object {
        const val FILES_FIRST = 4 // file rows above the other mentions
        const val FOLDER_ROWS = 50 // rows of a folder opened
        const val WAIT_MS = 150L // after the last key, before a search goes
        const val KEEP_MS = 15_000L // a search or a folder is asked again after this

        /** What a file looks like by its name: a table, an image, a document; a folder is a folder. */
        fun kindOf(name: String, type: String): String {
            if (type == "folder") return "folder"
            return when (name.substringAfterLast('.', "").lowercase()) {
                "csv", "tsv", "xlsx", "xls", "ods" -> "table"
                "png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp" -> "image"
                else -> "doc"
            }
        }

        /** Where a found file lives, beside its name: its folder, or its place. */
        fun whereOf(ref: Mentions.FileRef): String = ref.path.substringBeforeLast('/', "").substringAfterLast('/').ifEmpty { placeName(ref.root, ref.project) }

        fun placeName(root: String, project: String?) = when (root) { "server" -> tr("On botdot"); "computer" -> tr("Computer"); else -> project.orEmpty() }
    }
}
