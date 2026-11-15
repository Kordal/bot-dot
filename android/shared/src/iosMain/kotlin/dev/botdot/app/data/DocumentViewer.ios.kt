package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancel
import kotlinx.io.files.Path

/** A file as the viewer read it: its start ([view]), what its body shows ([pane]) and, when it failed, why. */
class Viewed(val view: FileView?, val pane: DocumentView.Pane, val failed: String?) {
    /** How it is first shown ([DocumentView.modeOf]) and the switches over it. */
    val mode: String get() = DocumentView.modeOf(view?.kind.orEmpty())
    val modes: List<String> get() = DocumentView.modes(view?.kind.orEmpty()).map { it.first }
    fun modeLabel(mode: String): String = DocumentView.modes(view?.kind.orEmpty()).firstOrNull { it.first == mode }?.second.orEmpty()
    /** The switches the iPhone shows: a CSV's, and Markdown's, rendered or its source. */
    val switches: List<String> get() = modes
    /** Whether [mode] draws the file as Markdown. */
    fun rendered(mode: String): Boolean = view?.kind == "markdown" && mode == "rendered"
    /** A bot's interactive page (#399), drawn in its own isolated frame. */
    val site: InteractiveView? get() = view?.interactive
    /** Whether [mode] draws the file as a table. */
    fun table(mode: String): Boolean = view?.kind == "csv" && mode == "table"
}

/**
 * The document viewer on the iPhone (#1368), for one file ([opening]): its start read as Android's viewer reads it
 * (`?view=1`), what its body shows decided by the shared rules (DocumentView), and the file itself saved where the
 * phone's own previewer (QuickLook) and Share take it.
 */
class DocumentViewer(val api: Api, val opening: DocumentView.Opening) {
    /** A bot's page: an interactive one draws in its frame. */
    val page: Boolean get() = opening.slug != null

    /** An interactive page's version shown; null for the one the page shows. */
    var version: Int? = null

    /** The file's start, or what went wrong reading it: only a cancelled read throws. */
    @Throws(Exception::class)
    suspend fun load(): Viewed = try {
        val v = api.viewFile(version?.let { DocumentView.withQuery(opening.src, "version=$it") } ?: opening.src)
        Viewed(v, DocumentView.pane(v, null, page), null)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Viewed(null, DocumentView.pane(null, e, page), e.message ?: tr("Couldn't open it"))
    }

    /** Version [n] made what the page shows again (Go back to it); what to say after. */
    @Throws(Exception::class)
    suspend fun setVersion(n: Int): String {
        val botId = opening.botId ?: return ""
        val slug = opening.slug ?: return ""
        return try {
            api.setPageVersion(botId, slug, n)
            version = null
            InteractivePages.shownAgain(n)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            e.message ?: tr("Couldn't go back to it")
        }
    }

    /** Where a navigation in an interactive page's frame goes ([InteractivePages.go]). */
    fun go(frame: String, url: String): InteractivePages.Go = InteractivePages.go(frame, url)

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

    private val scope = kotlinx.coroutines.MainScope()
    private var features: List<String>? = null

    /** The botdot's features, read once: what the page's bar and Export offer. */
    @Throws(Exception::class)
    suspend fun features(): List<String>? = features ?: runCatching { api.version().features }.getOrNull().also { features = it }

    /** A Markdown page's bar (PageDesk): Board, Keep up to date, Refresh now, Stop; null for a file that isn't a page. */
    @Throws(Exception::class)
    suspend fun pageDesk(): PageDesk? = pageDesk(features())

    /** The bar on a botdot with [features] (read by [pageDesk]). */
    fun pageDesk(features: List<String>?): PageDesk? {
        val botId = opening.botId ?: return null
        val slug = opening.slug ?: return null
        return PageDesk(scope, api, botId, slug, opening.from, features)
    }

    /** Export… (#348), on a botdot with document-export: a Markdown file's words made a Word document, PDF or Markdown by botdot. */
    @Throws(Exception::class)
    suspend fun exports(view: FileView?): Boolean = view?.kind == "markdown" && view.text != null && DocumentExport.shows(features())

    /** The export in [format] ([DocumentExport.FORMATS]) saved in the folder [dir]; answers where it is. */
    @Throws(Exception::class)
    suspend fun export(text: String, format: String, dir: String): String = api.exportDocument(opening.name, text, format, Path(dir)).toString()

    /** The viewer went: its page's bar follows nothing more. */
    fun close() = scope.cancel()

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
