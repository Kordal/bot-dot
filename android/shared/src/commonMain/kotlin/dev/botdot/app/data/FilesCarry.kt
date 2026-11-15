package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One folder of Move to… and Copy to…: a place ([depth] 0) or a folder in it, opened or not, and whether it takes what moves. */
data class CarryNode(val root: String, val path: String, val name: String, val depth: Int, val open: Boolean, val takes: Boolean, val picked: Boolean)

/** Move to… or Copy to… at one moment: its title, the folders as a tree, the one picked ([to] null while none) and its button's words. */
class CarryState(val title: String, val move: Boolean, val nodes: List<CarryNode>, val to: String?, val folder: String, val goWords: String)

/**
 * Move to… and Copy to… in the Files screen, for both phones (Android's CarryDialog): every place of the owner as a
 * tree, each folder opened as it is tapped ([toggle]); the folder the items are in, and the items themselves with what
 * they hold, are not offered ([FilesExplorer.takes]). [makeFolder] makes one in the folder picked and picks it; [go]
 * carries each item there and answers what to say: what went, or each that didn't with why ([say] for a failed read).
 */
class CarryDesk(
    private val scope: CoroutineScope, private val api: Api, private val ownerId: String, val move: Boolean,
    private val from: String, private val entries: List<WorkspaceEntry>, private val places: List<String>, private val say: (String) -> Unit,
) {
    /** A folder's folders, by "<root>\u0000<path>"; a key that is there is opened (null while it is read). */
    private val open = LinkedHashMap<String, List<WorkspaceEntry>?>()
    private var to: String? = null
    private var folder = ""
    private val _state = MutableStateFlow(snapshot())
    val state: StateFlow<CarryState> = _state.asStateFlow()

    init { load(FilesExplorer.rootOf(from), "") }

    fun watch(onChange: (CarryState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    private fun slot(root: String, path: String) = "$root\u0000$path"

    private fun load(root: String, path: String) {
        open[slot(root, path)] = null
        publish()
        scope.launch {
            try {
                val l = api.workspace(ownerId, root, path)
                open[slot(root, path)] = FilesExplorer.sorted(l.entries.filter { it.type == "folder" && !it.kept })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                open.remove(slot(root, path))
                say(e.message ?: tr("Couldn't load it"))
            }
            publish()
        }
    }

    /** A folder's chevron: opened (its folders read), or closed. */
    fun toggle(root: String, path: String) { if (slot(root, path) in open) { open.remove(slot(root, path)); publish() } else load(root, path) }

    /** A folder tapped: where they go, when it takes them. */
    fun pick(root: String, path: String) {
        if (!FilesExplorer.takes(from, entries.map { it.path }, root, path)) return
        to = root; folder = path; publish()
    }

    /** New folder, in the folder picked: made, shown and picked; false (said) when botdot didn't make it. */
    @Throws(Exception::class)
    suspend fun makeFolder(name: String): Boolean {
        val r = to ?: return false
        val n = name.trim().take(255).ifEmpty { return false }
        return try {
            val made = api.makeWorkspaceFolder(ownerId, folder, n, r)
            val inside = folder
            load(r, inside)
            to = r; folder = made; publish()
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(e.message ?: tr("Couldn't make it")); false
        }
    }

    /** Move here or Copy here: each item carried to the folder picked. What to say: what went, else each that didn't. */
    @Throws(Exception::class)
    suspend fun go(): String {
        val r = to ?: return ""
        val missed = mutableListOf<String>()
        for (x in entries) {
            try { api.carryInWorkspace(ownerId, x.path, folder, FilesExplorer.rootOf(from), r, move) }
            catch (e: CancellationException) { throw e } catch (e: Exception) { missed += "${x.name}: ${e.message}" }
        }
        return if (missed.isEmpty()) FilesExplorer.carriedWords(move, entries.map { it.name }, r, folder) else missed.joinToString("\n")
    }

    private fun publish() { _state.value = snapshot() }

    private fun snapshot(): CarryState {
        val paths = entries.map { it.path }
        val nodes = buildList {
            fun walk(root: String, path: String, depth: Int) {
                open[slot(root, path)]?.forEach { f ->
                    add(CarryNode(root, f.path, f.name, depth, slot(root, f.path) in open, FilesExplorer.takes(from, paths, root, f.path), to == root && folder == f.path))
                    walk(root, f.path, depth + 1)
                }
            }
            places.forEach { r ->
                add(CarryNode(r, "", FilesExplorer.placeName(r), 0, slot(r, "") in open, FilesExplorer.takes(from, paths, r, ""), to == r && folder == ""))
                walk(r, "", 1)
            }
        }
        val what = if (entries.size == 1) entries[0].name else trn(entries.size, "{n} item", "{n} items")
        return CarryState(
            title = if (move) tr("Move {what}", "what" to what) else tr("Copy {what}", "what" to what),
            move = move, nodes = nodes, to = to, folder = folder,
            goWords = if (move) tr("Move here") else tr("Copy here"),
        )
    }
}
