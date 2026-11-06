package dev.botdot.app.data

import kotlinx.serialization.Serializable

/**
 * Settings → Storage (docs/api.md, Storage): what the account's files take on the disk. The server keeps its last check
 * and walks again on request; this holds its answer and what the screen works out of it: sizes as a Mac counts them,
 * the folder a trail of names opens, and the Files place and path of each row, which open it in Files and delete it
 * there. Only from a server whose `features` name `storage`.
 */
object Storage {
    const val FEATURE = "storage"
    val GROUPS = listOf("computer", "bots", "projects", "uploads", "chats", "caches", "other")

    /** Where Files opens a node: a bot's folder ({ bot, root }) or a project's ({ project }). [gone]: a deleted bot's,
     *  which no Files route opens: Storage deletes it itself ([goneQuery]). */
    @Serializable data class Place(val bot: String? = null, val root: String? = null, val project: String? = null, val gone: Boolean = false)
    @Serializable data class Node(
        val name: String = "", val bytes: Long = 0, val dir: Boolean = true, val files: Long = 0, val kids: List<Node> = emptyList(),
        val rest: Long = 0, val place: Place? = null, val path: String? = null, val label: String? = null,
    )
    @Serializable data class Group(val id: String = "", val bytes: Long = 0, val kids: List<Node> = emptyList())
    @Serializable data class Big(val name: String = "", val path: String = "", val bytes: Long = 0, val place: Place? = null, val owner: String? = null)
    @Serializable data class Answer(
        val checking: Boolean = false, val checkedAt: String? = null, val error: String? = null, val computer: String = "none",
        val total: Long = 0, val groups: List<Group> = emptyList(), val largest: List<Big> = emptyList(), val freed: Long = 0,
    )

    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    fun groupName(id: String): String = when (id) {
        "computer" -> tr("Computer"); "bots" -> tr("Bots’ files"); "projects" -> tr("Projects"); "uploads" -> tr("Uploads")
        "chats" -> tr("Chats and memory"); "caches" -> tr("Caches"); else -> tr("Other")
    }
    fun nameOf(n: Node): String = when (n.label) {
        "home" -> tr("Home"); "browser" -> tr("Browser"); "system" -> tr("Installed programs"); "runs" -> tr("Runs")
        "memory" -> tr("Memory"); "botdot" -> "botdot"; "computer" -> tr("Computer"); "disk" -> tr("System"); else -> n.name
    }

    /** 14 GB, 6.4 GB, 812 MB, 4 KB: by thousands, as a Mac counts. */
    fun size(bytes: Long): String {
        val units = listOf("B", "KB", "MB", "GB", "TB")
        var v = bytes.coerceAtLeast(0).toDouble()
        var i = 0
        while (v >= 1000 && i < units.size - 1) { v /= 1000; i++ }
        val text = if (i == 0 || v >= 10) String.format(I18n.locale, "%.0f", v) else String.format(I18n.locale, "%.1f", v).let { if (it.endsWith("0")) it.dropLast(2) else it }
        return "$text ${units[i]}"
    }

    /** What a trail of names opens: the node, the names on the way, and the nearest Files place with its path there. */
    data class Opened(val node: Node, val crumbs: List<String>, val place: Place?, val base: String)
    fun open(a: Answer, trail: List<String>): Opened? {
        val g = a.groups.firstOrNull { it.id == trail.firstOrNull() } ?: return null
        var node = Node(name = groupName(g.id), bytes = g.bytes, kids = g.kids)
        val crumbs = mutableListOf(node.name)
        var place: Place? = null
        var base = ""
        for (name in trail.drop(1)) {
            val kid = node.kids.firstOrNull { it.name == name } ?: return null
            if (kid.place != null) { place = kid.place; base = kid.path.orEmpty() } else if (place != null) base = join(base, kid.name)
            node = kid
            crumbs += nameOf(kid)
        }
        return Opened(node, crumbs, place, base)
    }

    /** A row's own Files place and path, when Files opens it; null when it doesn't (chats, the computer's own). */
    data class Where(val place: Place, val path: String)
    fun where(kid: Node, at: Opened?): Where? = when {
        kid.place != null -> Where(kid.place, kid.path.orEmpty())
        at?.place != null -> Where(at.place, join(at.base, kid.name))
        else -> null
    }
    /** A whole bot's folder, or its uploads folder, is never deleted from here; what a deleted bot left goes whole too. */
    fun deletable(w: Where?): Boolean = w != null && (w.place.gone || (w.path.isNotEmpty() && w.path != "uploads"))

    /** DELETE /api/storage/gone's query for what a deleted bot left. */
    fun goneQuery(w: Where, enc: (String) -> String): String = "/storage/gone?bot=${enc(w.place.bot.orEmpty())}&root=${enc(w.place.root ?: "server")}&path=${enc(w.path)}"

    /** Whose files these are, as [UploadedFiles.owner] takes it, and the root of their place. */
    fun ownerOf(p: Place): String = when {
        p.project != null -> UploadedFiles.FOLDER + p.project
        else -> p.bot.orEmpty()
    }
    fun rootOf(p: Place): String = if (p.project != null) WorkspaceFiles.projectRoot(p.project) else p.root ?: WorkspaceFiles.SERVER

    /** Each part's share of the bar (0 to 1), in the groups' order, only those that hold something. */
    fun bar(a: Answer): List<Pair<String, Float>> {
        val shown = a.groups.filter { it.bytes > 0 }
        val all = shown.sumOf { it.bytes }.coerceAtLeast(1)
        return shown.map { it.id to it.bytes.toFloat() / all }
    }

    private fun join(a: String, b: String) = listOf(a, b).filter { it.isNotEmpty() }.joinToString("/")

}
