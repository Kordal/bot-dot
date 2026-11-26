package dev.botdot.app.data

import kotlinx.serialization.Serializable

/**
 * The document viewer (#251; docs/api.md, "The document viewer"): a file opened in the app instead of handed to
 * another one. botdot sends its start as JSON ([FileView], `?view=1` on its download's address) and the app draws it.
 * Only from a server whose `features` name `document-viewer`; an older one keeps the download.
 */
object DocumentView {
    const val FEATURE = "document-viewer"

    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** The address of [src] (an API path, as the web page's data-view has it) with [query] added. */
    fun withQuery(src: String, query: String): String = src + (if ('?' in src) "&" else "?") + query

    /** A file a bot attached to its reply ("<runId>/<name>"). */
    fun runFile(file: String): String = "/files/" + file.split('/').joinToString("/") { Api.enc(it) }

    /** One of a bot's files (#235), or the Chief's ([UploadedFiles.CHIEF], #383), by its path in its folder ("uploads/…"). */
    fun botFile(botId: String, file: String): String = UploadedFiles.owner(botId) + "/files/${Api.enc(file.substringAfterLast('/'))}"

    /** A file a path in a bot's reply names, or one the owner sent it (relative to its folder). */
    fun pathFile(botId: String, path: String): String = "/bots/${Api.enc(botId)}/path?path=${Api.enc(path)}"

    /**
     * A file to open in the viewer: [src] its API path, [name] its title, [from] who it is from, [botId] whose computer
     * the viewer may start for it, [path] the path as a reply wrote it.
     */
    data class Opening(val src: String, val name: String, val from: String = "", val botId: String? = null, val path: String? = null,
                       /** A bot's page (#346): its slug, beside [botId]; null for a file. */
                       val slug: String? = null)

    /**
     * A file path in [botId]'s reply ([FilePaths]) as a tap opens it (#251): the file it names, relative to the bot's
     * folder, from [from]. What a chat's file link hands the viewer, on Android and the iPhone.
     */
    fun ofPath(botId: String, path: String, from: String = "", name: String = path.substringAfterLast('/')): Opening =
        Opening(pathFile(botId, path), name, from, botId, path)

    /** A bot's page (#346) as a tap opens it: its address, its title, from [from]. */
    fun ofPage(botId: String, slug: String, title: String, from: String = ""): Opening =
        Opening(Pages.src(botId, slug), title, from, botId, null, slug)

    /** What the viewer's body shows, in the order it is decided: what went wrong, the file still coming, then its kind. */
    enum class Pane { NOT_FOUND, COMPUTER_OFF, FAILED, LOADING, TOO_LARGE, INTERACTIVE, PDF, NO_PREVIEW, IMAGE, TEXT }

    /** [failed]: why the file couldn't be read (404: nothing there, 409: its computer is off). [page]: a bot's page. */
    fun pane(view: FileView?, failed: Throwable?, page: Boolean): Pane = when {
        failed != null -> when ((failed as? ApiException)?.status) { 404 -> Pane.NOT_FOUND; 409 -> Pane.COMPUTER_OFF; else -> Pane.FAILED }
        view == null -> Pane.LOADING
        !view.downloadable && view.kind == "none" -> Pane.TOO_LARGE
        view.interactive != null && page -> Pane.INTERACTIVE
        isPdf(view) -> Pane.PDF
        view.kind == "none" -> Pane.NO_PREVIEW
        view.kind == "image" -> Pane.IMAGE
        else -> Pane.TEXT
    }

    /** How a file is first shown: Markdown rendered, a CSV as a table, the rest as its text. */
    fun modeOf(kind: String): String = when (kind) { "markdown" -> "rendered"; "csv" -> "table"; else -> "source" }

    /** botdot shows an HTML file rendered (ADR 281): its view carries a frame on the sandbox's own address. */
    const val HTML_PREVIEW = "html-preview"
    private val HTML_NAME = Regex("""\.html?$""", RegexOption.IGNORE_CASE)
    /** The one shape of address a frame has: the sandbox's origin, the account, a signed token, index.html. Nothing else is framed. */
    private val HTML_FRAME = Regex("""^https?://[A-Za-z0-9.-]+(:\d{1,5})?/[a-z][a-z0-9-]{1,23}/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/index\.html$""")

    /** The frame an HTML file ([name]) is shown in, or null: from a server with `html-preview`, for a text view that carries one of that shape. */
    fun htmlFrame(view: FileView?, name: String, features: Collection<String>?): String? =
        view?.takeIf { it.kind == "text" && features != null && HTML_PREVIEW in features && HTML_NAME.containsMatchIn(name) }
            ?.preview?.frame?.takeIf { HTML_FRAME.matches(it) }

    /** The frame's address has run out ([now] past its `expires`): rendered again, it is signed anew. */
    fun frameStale(view: FileView?, now: kotlin.time.Instant): Boolean =
        view?.preview?.expires?.let { runCatching { kotlin.time.Instant.parse(it) < now }.getOrNull() } == true

    /** How a file is first shown, an HTML file with a frame rendered ([modeOf] for the rest). */
    fun modeFor(view: FileView, name: String, features: Collection<String>?): String =
        if (htmlFrame(view, name, features) != null) "rendered" else modeOf(view.kind)

    /** The switches over a file as [modes] has them, and over an HTML file with a frame, Rendered and Source. */
    fun modes(view: FileView, name: String, features: Collection<String>?): List<Pair<String, String>> =
        if (htmlFrame(view, name, features) != null) listOf("rendered" to tr("Rendered"), "source" to tr("Source code")) else modes(view.kind)

    /** The switches over a Markdown file or a CSV, as (mode, label); none for any other. */
    fun modes(kind: String): List<Pair<String, String>> = when (kind) {
        "markdown" -> listOf("rendered" to tr("Rendered"), "source" to tr("Source code"))
        "csv" -> listOf("table" to tr("Table"), "source" to tr("Source code"))
        else -> emptyList()
    }

    /** botdot serves the files the owner sent in a Chief chat or a group (#268); the apps open them in the viewer. */
    const val CHAT_FILES = "chat-attachments"

    fun opensChatFiles(features: Collection<String>?): Boolean = features != null && FEATURE in features && CHAT_FILES in features

    /** A file the owner sent in a Chief chat (#268), by its path in botdot's copy ("uploads/…"); null for any other. */
    fun chiefUpload(chatId: String, file: String): String? = upload(file)?.let { "/chief/chats/${Api.enc(chatId)}/uploads/$it" }

    /** A file the owner sent in a group (#268), as [chiefUpload]. */
    fun groupUpload(groupId: String, file: String): String? = upload(file)?.let { "/group-chats/${Api.enc(groupId)}/uploads/$it" }

    private val UPLOAD = Regex("^uploads/[^/]+$")
    private fun upload(file: String): String? = file.takeIf { UPLOAD.matches(it) }?.let { Api.enc(it.removePrefix("uploads/")) }

    /** The header's second line: "From <bot> · 12 KB · 09:14", each part only when known. */
    fun subtitle(from: String, view: FileView?, time: String): String =
        listOfNotNull(from.ifBlank { null }?.let { tr("From {name}", "name" to it) }, view?.let { UploadedFiles.size(it.size) }, time.ifBlank { null }).joinToString(" · ")

    /** A CSV's rows, each a list of cells: a quoted cell may hold the separator, "" and line breaks. */
    fun csvRows(text: String, sep: Char = ','): List<List<String>> {
        val rows = mutableListOf<List<String>>()
        var row = mutableListOf<String>()
        val cell = StringBuilder()
        var quoted = false
        val s = text.removePrefix("\uFEFF")
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                quoted && c == '"' && s.getOrNull(i + 1) == '"' -> { cell.append('"'); i++ }
                quoted && c == '"' -> quoted = false
                quoted -> cell.append(c)
                c == '"' && cell.isEmpty() -> quoted = true
                c == sep -> { row += cell.toString(); cell.clear() }
                c == '\n' || c == '\r' -> {
                    if (c == '\r' && s.getOrNull(i + 1) == '\n') i++
                    row += cell.toString(); rows += row; row = mutableListOf(); cell.clear()
                }
                else -> cell.append(c)
            }
            i++
        }
        if (cell.isNotEmpty() || row.isNotEmpty()) { row += cell.toString(); rows += row }
        return rows
    }

    /** A PDF the app draws itself ([dev.botdot.app.ui.PdfPages]): botdot names it by its `type` (its `kind` stays
     *  "none", so an older app keeps its Save and Open buttons), and only one it can bring out whole. */
    fun isPdf(v: FileView?): Boolean = v != null && v.type == "application/pdf" && v.downloadable && v.interactive == null

    fun sepOf(name: String): Char = if (name.endsWith(".tsv", ignoreCase = true)) '\t' else ','

    private fun number(v: String): Double? = v.trim().takeIf { it.isNotEmpty() }?.replace(",", "")?.toDoubleOrNull()

    /** A table as shown: its header, then the rows (each with its number in the file) that hold [find], sorted by [sortCol] when asked. */
    data class Table(val head: List<String>, val rows: List<Pair<Int, List<String>>>, val total: Int, val cols: Int)

    fun table(text: String, sep: Char, sortCol: Int? = null, ascending: Boolean = true, find: String = ""): Table {
        val all = csvRows(text, sep)
        val head = all.firstOrNull().orEmpty()
        val body = all.drop(1)
        val cols = (listOf(head.size) + body.map { it.size }).maxOrNull() ?: 0
        var shown = body.mapIndexed { i, cells -> (i + 1) to cells }
        val q = find.trim().lowercase()
        if (q.isNotEmpty()) shown = shown.filter { (_, cells) -> cells.any { q in it.lowercase() } }
        if (sortCol != null) {
            val nums = shown.all { (_, c) -> c.getOrNull(sortCol).isNullOrEmpty() || number(c[sortCol]) != null }
            val cmp: Comparator<Pair<Int, List<String>>> = if (nums) compareBy<Pair<Int, List<String>>> { number(it.second.getOrNull(sortCol).orEmpty()) ?: 0.0 } else compareBy<Pair<Int, List<String>>> { it.second.getOrNull(sortCol).orEmpty() }
            shown = shown.sortedWith(if (ascending) cmp else cmp.reversed())
        }
        return Table(head, shown, body.size, cols)
    }
}

/** A file as the viewer gets it (`?view=1`). [kind]: markdown, text, csv, image or none (no preview, Download only). */
@Serializable
data class FileView(
    val name: String = "",
    val size: Long = 0,
    val at: String? = null,
    val kind: String = "none",
    val type: String = "",
    val text: String? = null,
    val truncated: Boolean = false,
    /** false: a file on the computer over 1 MB, which can't be brought out whole (no Save, Share or Open elsewhere). */
    val downloadable: Boolean = true,
    /** A bot's page (#346): what it is, beside its text. */
    val page: PageInfo? = null,
    /** A page with blocks (#395): its Markdown and its blocks to draw, the tiles they read, and its text with the blocks written out. */
    val parts: List<PagePart>? = null,
    val tiles: List<String> = emptyList(),
    val plain: String? = null,
    /** A bot's interactive page (#399): its frame on the sandbox's own address, its versions and its live values. */
    val interactive: InteractiveView? = null,
    /** An HTML file read whole (ADR 281): the address of its frame on the sandbox's own address; null when the machine has none. */
    val preview: HtmlPreview? = null,
)

/** The frame an HTML file is shown in (ADR 281), and when its address runs out. */
@Serializable
data class HtmlPreview(val frame: String = "", val expires: String? = null)

/**
 * File paths in a bot's reply (#251), by the rules the web page shares (test/fixtures/file-paths.json; filePaths in
 * public/app.js): under /home/box or /workspace, starting with ~/, or relative to the bot's workspace, with an
 * extension the apps know, no .. in it and no web address around it. A bare name that is one capitalised word
 * (Node.js) stays text.
 */
object FilePaths {
    private const val EXTS = "markdown|md|txt|text|log|jsonl|json|yaml|yml|toml|ini|conf|cfg|env|csv|tsv|xml|html|htm|css|mjs|cjs|js|tsx|ts|jsx|py|rb|go|rs|java|kts|kt|swift|cpp|hpp|c|h|sh|sql|pdf|png|jpeg|jpg|gif|webp|svg|docx|doc|xlsx|xls|pptx|ppt|odt|ods|zip|tgz|gz|tar"
    private val PATH = Regex("""(?<![\p{L}\p{N}_./:@~\\-])(?:~/|\./|/)?(?:[\p{L}\p{N}_.-]+/)*[\p{L}\p{N}_-][\p{L}\p{N}_.-]*\.(?i:$EXTS)(?![\p{L}\p{N}_/-]|\.[\p{L}\p{N}])""")
    private val CODE_SPAN = Regex("""(`+)[\s\S]*?\1""")
    private val CAPITALISED = Regex("""^\p{Lu}\p{Ll}+$""")

    /** A path in plain text: where it starts, and the path as written. */
    data class Found(val start: Int, val text: String)

    private fun ok(p: String): Boolean {
        if (p.split('/').contains("..")) return false
        if (p.startsWith("/")) return p.startsWith("/home/box/") || p.startsWith("/workspace/")
        val stem = p.removePrefix("~/").removePrefix("./").substringAfterLast('/').substringBeforeLast('.')
        if (stem.none { it.isLetter() }) return false
        return '/' in p || !CAPITALISED.matches(stem)
    }

    /** The paths in a text, outside `code` and the web addresses [taken] covers (start to end, end exclusive). */
    fun find(text: String, taken: List<IntRange> = emptyList()): List<Found> {
        val code = CODE_SPAN.findAll(text).map { it.range }.toList() + taken
        return PATH.findAll(text).filter { m ->
            code.none { it.first <= m.range.last && it.last >= m.range.first } && ok(m.value)
        }.map { Found(it.range.first, it.value) }.toList()
    }

    /** Whether a `code` span is exactly one path, and so linked as one. */
    fun isPath(s: String): Boolean = find(s).let { it.size == 1 && it[0].text == s }
}
