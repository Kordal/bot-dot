package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One row of Storage: a group's folder or file, or one of the largest files; [where] when Files opens it. */
class StorageRow(val key: String, val name: String, val owner: String?, val bytes: Long, val dir: Boolean, val files: Long, val opens: Boolean, val into: String, val where: Storage.Where?, val share: Float) {
    /** Delete… is offered ([Storage.deletable]). */
    val deletable: Boolean get() = Storage.deletable(where)
}

/** Storage at one moment: the total (of the folder open), the groups or the folder's rows, the largest files, and what it says. */
class StorageState(
    val answer: Storage.Answer?,
    val error: String?,
    /** The folder open, by its names from a group; empty for the groups. */
    val trail: List<String>,
    val title: String,
    val total: String,
    val groups: List<Storage.Group>,
    val rows: List<StorageRow>,
    val largest: List<StorageRow>,
    val busy: Boolean,
    val notice: String?,
    val noticeCount: Int,
) {
    val checking: Boolean get() = answer?.checking == true
}

/**
 * Settings → Storage for both phones (docs/api.md, Storage; Android's StorageScreen): the total, the groups, the
 * largest files; a group or a folder [open]s to what it holds, largest first, and [back] goes up. Check again asks
 * botdot to measure again and reads it every few seconds while it does. Delete and Clear the caches ask first (the
 * phone's question, [deleteWords] / [clearWords]) and say what happened. It opens at [trail] (empty for the
 * groups), so a phone that kept the folder open over a rotation opens there again once the answer is read.
 */
class StorageDesk(private val scope: CoroutineScope, private val api: Api, trail: List<String>) {
    private var answer: Storage.Answer? = null
    private var error: String? = null
    /** The folder open; [trail] at first: one the phone kept over a rotation or its process going. */
    private var trail: List<String> = trail
    private var busy = false
    private var notice: String? = null
    private var noticeCount = 0
    private val _state = MutableStateFlow(snapshot())
    val state: StateFlow<StorageState> = _state.asStateFlow()

    fun watch(onChange: (StorageState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    /** Read it, and again every few seconds while botdot measures. */
    @Throws(Exception::class)
    suspend fun load() {
        read()
        while (answer?.checking == true) { delay(CHECK_MS); read() }
    }

    private suspend fun read() {
        try { answer = api.storage(); error = null } catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.message ?: tr("Couldn't load it") }
        publish()
    }

    /** A group's or a folder's row tapped: what it holds. */
    fun open(name: String) { trail = trail + name; publish() }

    /** Back: one folder up; false at the groups (the screen goes). */
    fun back(): Boolean { if (trail.isEmpty()) return false; trail = trail.dropLast(1); publish(); return true }

    /** Check again. */
    @Throws(Exception::class)
    suspend fun check() {
        try { answer = api.checkStorage(); publish() } catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message ?: tr("Couldn't check")) }
        load()
    }

    fun deleteWords(r: StorageRow): String =
        if (r.dir) tr("Delete {name}? {size}, {count}.", "name" to r.name, "size" to Storage.size(r.bytes), "count" to trn(r.files.toInt(), "{n} file", "{n} files"))
        else tr("Delete {name}? {size}.", "name" to r.name, "size" to Storage.size(r.bytes))

    /** Delete: the folder or file gone from where it is (a deleted bot's from Storage itself), read again. */
    @Throws(Exception::class)
    suspend fun delete(r: StorageRow): Boolean {
        val w = r.where ?: return false
        if (busy || !Storage.deletable(w)) return false
        busy = true; publish()
        return try {
            if (w.place.gone) api.deleteGone(w) else api.deleteFromWorkspace(Storage.ownerOf(w.place), Storage.rootOf(w.place), w.path)
            busy = false; say(tr("Deleted")); read(); true
        } catch (e: CancellationException) { throw e } catch (e: Exception) { busy = false; say(e.message ?: tr("Couldn't delete")); false }
    }

    fun clearWords(g: Storage.Group): String = tr("Clear the caches? {size}.", "size" to Storage.size(g.bytes))

    /** Clear the caches. */
    @Throws(Exception::class)
    suspend fun clearCaches(): Boolean {
        if (busy) return false
        busy = true; publish()
        return try {
            val a = api.clearCaches()
            answer = a; busy = false; say(tr("Cleared {size}", "size" to Storage.size(a.freed))); true
        } catch (e: CancellationException) { throw e } catch (e: Exception) { busy = false; say(e.message ?: tr("Couldn't clear")); false }
    }

    /** Ask the Chief about a row: the words its chat opens with ([whose]: the bot's or project's name). */
    fun askWords(r: StorageRow, whose: String): String =
        tr("What is {name} ({size}) in {whose}’s files, and can it go?", "name" to (r.where?.path ?: r.name), "size" to Storage.size(r.bytes), "whose" to whose)

    /** Whose files a row's are, in words: a project's, the Chief's, else its bot's (from [botName]). */
    fun whose(r: StorageRow, botName: (String) -> String?): String {
        val p = r.where?.place ?: return ""
        return p.project ?: if (p.bot == UploadedFiles.CHIEF) tr("Chief of Staff") else botName(p.bot.orEmpty()).orEmpty()
    }

    /** Open in Files: the folder of a row (its own for a folder). */
    fun filesFolder(r: StorageRow): String = r.where?.let { if (r.dir) it.path else it.path.substringBeforeLast('/', "") }.orEmpty()

    private fun say(text: String) { notice = text; noticeCount++; publish() }

    private fun publish() { _state.value = snapshot() }

    private fun snapshot(): StorageState {
        val d = answer
        val opened = d?.let { Storage.open(it, trail) }
        if (d != null && trail.isNotEmpty() && opened == null) trail = emptyList()
        val rows = opened?.node?.kids.orEmpty().filter { it.bytes > 0 }.let { kids ->
            val top = kids.firstOrNull()?.bytes?.coerceAtLeast(1) ?: 1
            kids.mapIndexed { i, k -> StorageRow("k:$i", Storage.nameOf(k), null, k.bytes, k.dir, k.files, k.kids.isNotEmpty(), k.name, Storage.where(k, opened), share(k.bytes, top)) }
        }
        val largest = d?.largest.orEmpty().take(10).let { l ->
            val top = l.firstOrNull()?.bytes?.coerceAtLeast(1) ?: 1
            l.mapIndexed { i, f -> StorageRow("l:$i", f.name, f.owner, f.bytes, false, 0, false, f.name, f.place?.let { Storage.Where(it, f.path) }, share(f.bytes, top)) }
        }
        return StorageState(
            answer = d, error = error, trail = trail,
            title = opened?.crumbs?.lastOrNull() ?: tr("Storage"),
            total = if (d == null) "" else if (d.checkedAt == null) "—" else Storage.size(opened?.node?.bytes ?: d.total),
            groups = if (opened == null) d?.groups.orEmpty().filter { it.bytes > 0 } else emptyList(),
            rows = rows, largest = if (opened == null) largest else emptyList(),
            busy = busy, notice = notice, noticeCount = noticeCount,
        )
    }

    private fun share(bytes: Long, top: Long): Float = (bytes.toFloat() / top).coerceIn(0.05f, 1f)

    companion object {
        /** How often it is read again while botdot measures. */
        const val CHECK_MS = 3_000L
    }
}
