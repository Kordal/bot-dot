package dev.botdot.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A bot's workspace in its settings (#296; docs/api.md, "A bot's workspace"): every file in its folder on botdot,
 * to open in the viewer, save, upload into, rename, move and delete, and, for a bot that uses the computer, its
 * folder there, to open, save and delete in while the computer runs. Only from a server whose `features` name
 * `workspace-files`; an older one keeps only the Files section.
 */
object WorkspaceFiles {
    const val FEATURE = "workspace-files"
    /** #576: the computer's folder takes writes too, and a whole folder is uploaded. */
    const val FOLDERS = "workspace-folders"
    /** The files of one uploaded folder, at most. */
    const val MAX_FOLDER_FILES = 1000
    const val SERVER = "server"
    const val COMPUTER = "computer"
    const val MAX_FILES = 10
    const val MAX_BYTES = 25L * 1024 * 1024

    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features
    fun folders(features: Collection<String>?): Boolean = features != null && FOLDERS in features

    /** A bot's, or the Chief's own folder ([UploadedFiles.CHIEF], #383), which has none on the computer. */
    private fun base(botId: String) = UploadedFiles.owner(botId) + "/workspace"
    /** A shared project's folder as a root (#578): "project/<name>", asked as ?root=project&project=<name>. */
    fun projectRoot(name: String) = "${Projects.ROOT}/$name"
    fun projectOf(root: String): String? = root.takeIf { it.startsWith("${Projects.ROOT}/") }?.substringAfter('/')
    private fun rootQuery(root: String) = projectOf(root)?.let { "?root=${Projects.ROOT}&project=${Api.enc(it)}" } ?: "?root=${Api.enc(root)}"
    private fun query(root: String, path: String) = rootQuery(root) + "&path=${Api.enc(path)}"

    /** A folder's listing, a count before a delete, and the delete itself. */
    fun list(botId: String, root: String, path: String) = base(botId) + query(root, path)
    fun count(botId: String, root: String, path: String) = base(botId) + "/count" + query(root, path)
    /** Files and folders whose name holds [q], in every place of the bot (#604, `workspace-search`). */
    fun search(botId: String, q: String) = base(botId) + "/search?root=all&q=${Api.enc(q)}"
    /** A file, for the viewer (DocumentView) and Save. */
    fun file(botId: String, root: String, path: String) = base(botId) + "/file" + query(root, path)
    /** [made]: the folders of [path] that are not there yet are made first (a folder's upload, #576). */
    fun upload(botId: String, path: String, root: String = SERVER, made: Boolean = false) = base(botId) + "/upload" + query(root, path) + if (made) "&folders=1" else ""
    fun folder(botId: String, root: String = SERVER) = base(botId) + "/folder" + rootQuery(root)
    fun move(botId: String, root: String = SERVER) = base(botId) + "/move" + rootQuery(root)
    /** Files (#603, `files-explorer`): a copy into a folder, an image for the grid, and keeping a file on botdot in mind. */
    fun copy(botId: String, root: String = SERVER) = base(botId) + "/copy" + rootQuery(root)
    fun thumb(botId: String, root: String, path: String) = base(botId) + "/thumb" + query(root, path)
    fun keep(botId: String) = base(botId) + "/keep"

    /** The entries as shown: folders first, then files, by name or newest first; dot-names only with [hidden]. */
    fun sorted(entries: List<WorkspaceEntry>, byDate: Boolean = false, hidden: Boolean = false): List<WorkspaceEntry> {
        val byName = compareBy<WorkspaceEntry, String>(String.CASE_INSENSITIVE_ORDER) { it.name }
        val order = if (byDate) compareByDescending<WorkspaceEntry> { it.at.orEmpty() }.then(byName) else byName
        return entries.filter { hidden || !it.name.startsWith(".") }.sortedWith(compareBy<WorkspaceEntry> { if (it.type == "folder") 0 else 1 }.then(order))
    }

    fun hiddenCount(entries: List<WorkspaceEntry>): Int = entries.count { it.name.startsWith(".") }

    /** The breadcrumb: the top, named [top], then each folder on the way, as (name, path). */
    fun crumbs(path: String, top: String): List<Pair<String, String>> {
        val parts = path.split('/').filter { it.isNotEmpty() }
        return listOf(top to "") + parts.mapIndexed { i, name -> name to parts.take(i + 1).joinToString("/") }
    }

    fun parentOf(path: String): String = path.substringBeforeLast('/', "")

    /** The new path of [path] renamed to [name]. */
    fun renamed(path: String, name: String): String = parentOf(path).let { if (it.isEmpty()) name.trim() else "$it/${name.trim()}" }

    /** The new path of [path] moved into [folder] (a path in the same root; empty for the top). */
    fun movedTo(path: String, folder: String): String {
        val f = folder.trim().trim('/')
        val name = path.substringAfterLast('/')
        return if (f.isEmpty()) name else "$f/$name"
    }

    /** The line under an entry's name: its size (a file) and when it changed. */
    fun detail(e: WorkspaceEntry, time: String): String = listOfNotNull(
        when (e.type) { "file" -> UploadedFiles.size(e.size ?: 0); "link" -> "A link: botdot doesn't follow it"; else -> null },
        time.ifBlank { null },
    ).joinToString(" · ")

    /** The confirmation of a delete: what goes, counted (at most 10,000). */
    fun deleteWords(name: String, c: WorkspaceCount): String {
        if (c.type != "folder") return "Delete $name? This can't be undone."
        fun many(n: Int, one: String) = "${String.format(java.util.Locale.ROOT, "%,d", n)} $one${if (n == 1) "" else "s"}"
        val held = if (c.files + c.folders == 0) "It is empty."
            else "It holds ${if (c.capped) "more than " else ""}${listOfNotNull(if (c.files > 0) many(c.files, "file") else null, if (c.folders > 0) many(c.folders, "folder") else null).joinToString(" and ")}, which go with it."
        return "Delete the folder $name? $held This can't be undone."
    }

    /** Whether an entry may be deleted here: on botdot a link is never changed; on the computer deleting one takes the link alone. */
    fun deletes(root: String, listing: WorkspaceListing, e: WorkspaceEntry): Boolean = root != SERVER || (!e.kept && e.type != "link" && !listing.readOnly)
    /** Whether a folder takes uploads and new folders: on botdot, and on the computer from a server with [FOLDERS]. */
    fun writes(root: String, listing: WorkspaceListing, folders: Boolean): Boolean = (root == SERVER || folders) && !listing.readOnly
    /** Whether an entry may be renamed or moved: where [writes], and not a file the owner gave the bot (uploads/). */
    fun changes(root: String, listing: WorkspaceListing, e: WorkspaceEntry, folders: Boolean = false): Boolean = (root == SERVER || folders) && deletes(root, listing, e) && !e.keepsName

    /** Where a file of an uploaded folder goes: [dir], its folder inside the picked one ("" at its top), in [into]. */
    fun folderDir(into: String, dir: String): String = listOf(into, dir).filter { it.isNotEmpty() }.joinToString("/")

    /** A new name is one name: with a / in it, it would be a move. */
    fun nameOk(name: String): Boolean = name.isNotBlank() && '/' !in name
}

/** One entry of a folder. [path] is relative to its root; [type] is folder, file, link or other. */
@Serializable
data class WorkspaceEntry(
    val name: String = "",
    val path: String = "",
    val type: String = "file",
    val size: Long? = null,
    val at: String? = null,
    /** Kept by botdot (CLAUDE.md, .claude, uploads…): not renamed, moved or deleted. */
    @SerialName("protected") val kept: Boolean = false,
    /** A file the owner gave the bot, in uploads/: deleted, never renamed or moved (the Files section goes by its name). */
    val keepsName: Boolean = false,
    /** How many entries a folder holds (`files-explorer`, #603). */
    val items: Int? = null,
)

/** A folder (`GET /api/bots/:id/workspace`): at most 1,000 entries, and how many [more] there are. */
@Serializable
data class WorkspaceListing(
    val root: String = WorkspaceFiles.SERVER,
    val path: String = "",
    val entries: List<WorkspaceEntry> = emptyList(),
    val more: Int = 0,
    /** A folder botdot keeps as it is: nothing is uploaded into it or changed in it. */
    val readOnly: Boolean = false,
)

/** What a delete takes (`GET /api/bots/:id/workspace/count`). */
@Serializable
data class WorkspaceCount(val type: String = "file", val files: Int = 0, val folders: Int = 0, val capped: Boolean = false)

/** What a copy or a move into a folder answers (#603): where it landed, under the name it got. */
@Serializable
data class WorkspaceCarried(val path: String = "", val root: String = WorkspaceFiles.SERVER, val project: String? = null)

/** What making a folder answers: its path, under the name it got. */
@Serializable
data class WorkspaceMade(val path: String = "")
