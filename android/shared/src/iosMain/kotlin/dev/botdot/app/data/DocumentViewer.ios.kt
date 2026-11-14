package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.io.files.Path

/** A file as the viewer read it: its start ([view]), what its body shows ([pane]) and, when it failed, why. */
class Viewed(val view: FileView?, val pane: DocumentView.Pane, val failed: String?) {
    /** How it is first shown ([DocumentView.modeOf]) and the switches over it. */
    val mode: String get() = DocumentView.modeOf(view?.kind.orEmpty())
    val modes: List<String> get() = DocumentView.modes(view?.kind.orEmpty()).map { it.first }
    fun modeLabel(mode: String): String = DocumentView.modes(view?.kind.orEmpty()).firstOrNull { it.first == mode }?.second.orEmpty()
    /** The switches the iPhone shows: a CSV's. Markdown is shown as its text until the iPhone draws Markdown (#1390). */
    val switches: List<String> get() = if (view?.kind == "markdown") emptyList() else modes
    /** Whether [mode] draws the file as a table. */
    fun table(mode: String): Boolean = view?.kind == "csv" && mode == "table"
}

/**
 * The document viewer on the iPhone (#1368), for one file ([opening]): its start read as Android's viewer reads it
 * (`?view=1`), what its body shows decided by the shared rules (DocumentView), and the file itself saved where the
 * phone's own previewer (QuickLook) and Share take it.
 */
class DocumentViewer(val api: Api, val opening: DocumentView.Opening) {
    /** The file's start, or what went wrong reading it: only a cancelled read throws. */
    @Throws(Exception::class)
    suspend fun load(): Viewed = try {
        val v = api.viewFile(opening.src)
        Viewed(v, DocumentView.pane(v, null, page = false), null)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Viewed(null, DocumentView.pane(null, e, page = false), e.message ?: tr("Couldn't open it"))
    }

    /** The header's second line: who it is from, its size and when it changed. */
    fun subtitle(view: FileView?): String = DocumentView.subtitle(opening.from, view, FilesExplorer.whenOf(view?.at))

    /** The file itself, saved in the folder [dir] under its name; answers where it is. */
    @Throws(Exception::class)
    suspend fun save(dir: String): String {
        val name = opening.name.substringAfterLast('/').takeIf { it.isNotBlank() && it != "." && it != ".." } ?: "file"
        val dest = Path(dir, name)
        api.downloadTo(opening.src, dest)
        return dest.toString()
    }

    /** The owner's tap on Start the computer, for a file on it. */
    @Throws(Exception::class)
    suspend fun startComputer() { opening.botId?.let { api.startComputer(it) } }

    /** Text and code as lines, each drawn with its number. */
    fun lines(text: String): List<String> = text.removeSuffix("\n").split("\n")

    /** A CSV as its table ([DocumentView.table]): [sortCol] -1 for the file's order. */
    fun table(text: String, sortCol: Int, ascending: Boolean, find: String): DocumentView.Table =
        DocumentView.table(text, DocumentView.sepOf(opening.name), sortCol.takeIf { it >= 0 }, ascending, find)

    /** The table's row numbers and cells, without the pairs Swift can't type. */
    fun rowNumber(t: DocumentView.Table, i: Int): Int = t.rows[i].first
    fun rowCells(t: DocumentView.Table, i: Int): List<String> = t.rows[i].second

    /** The count over the table: "12 rows · 3 columns". */
    fun tableCount(t: DocumentView.Table): String = trn(t.total, "{n} row", "{n} rows") + " · " + trn(t.cols, "{n} column", "{n} columns")
}
