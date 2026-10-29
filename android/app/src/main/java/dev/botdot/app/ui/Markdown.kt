package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.FilePaths
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay

/** The words in the home screen's search box, marked in the chats you open (each word, and words it starts). */
object SearchMarks {
    var terms by androidx.compose.runtime.mutableStateOf(emptyList<String>())
    private val MARK = Color(0x6BE8B83A)
    fun of(query: String): List<String> =
        if (query.trim().length < 2) emptyList() else Regex("[\\p{L}\\p{N}]+").findAll(query.lowercase()).map { it.value }.filter { it.length > 1 }.distinct().toList()

    // Made once per search, not for every piece of text marked.
    private var reFor: List<String>? = null
    private var re: Regex? = null
    private fun regexOf(t: List<String>): Regex = re?.takeIf { reFor == t }
        ?: Regex("(?<![\\p{L}\\p{N}])(?:${t.joinToString("|") { Regex.escape(it) }})[\\p{L}\\p{N}]*", RegexOption.IGNORE_CASE).also { re = it; reFor = t }

    /** The text with the searched words marked (unchanged when nothing is searched). */
    fun mark(s: AnnotatedString): AnnotatedString {
        val t = terms
        if (t.isEmpty()) return s
        val found = regexOf(t).findAll(s.text).toList()
        if (found.isEmpty()) return s
        return buildAnnotatedString { append(s); found.forEach { addStyle(SpanStyle(background = MARK), it.range.first, it.range.last + 1) } }
    }
    fun mark(s: String): AnnotatedString = mark(AnnotatedString(s))
}

/** Where the chat on screen opens on the web page ([chatOnWeb]). A chat gives it to its messages; a board tile or a
 *  skill is in no chat and has none. */
val LocalChatOnWeb = compositionLocalOf<String?> { null }

/** A chat's address on the web page, which opens it from `#chief/<chatId>`, `#bot/<id>` or `#group/<id>` (public/boot.js). */
internal fun chatOnWeb(baseUrl: String, kind: String, id: String) = baseUrl.trimEnd('/') + "/#$kind/" + id

/** The link under a block: the app draws no diagram, so a `mermaid` block is its code with "Open on web" under it,
 *  where the web page draws it (#177). Only in a chat: null for any other block or without [onWeb]. */
internal fun webLinkUnder(b: Block, onWeb: String?): String? = onWeb?.takeIf { b is Block.Code && b.lang == "mermaid" }

/** What a block's Copy button copies (#285): a code block's text as written, a diagram's block its source; null for
 *  every other block, so an inline `code` has none (test/code-copy-web.test.js on the web page). */
internal fun copyTextOf(b: Block): String? = (b as? Block.Code)?.text

/** A code block's Copy button: [text] to the system clipboard, and a check for 1.5 s. */
@Composable
private fun CopyCode(text: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
    IconButton(onClick = { copyToClipboard(context, text); copied = true }, modifier = modifier.size(40.dp)) {
        Icon(if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy, contentDescription = if (copied) tr("Copied") else tr("Copy code"),
            tint = LocalPaper.current.muted, modifier = Modifier.size(16.dp))
    }
}

/**
 * What a file path in a bot's reply does (#251, [FilePaths]): a tap opens it in the viewer, a long press offers Open
 * and Copy path. A bot's chat gives it to its replies, from a server with `document-viewer`; without one, a path is text.
 */
class PathActions(val from: String, val open: (path: String, name: String) -> Unit, val menu: (String) -> Unit)
val LocalPathActions = compositionLocalOf<PathActions?> { null }

/** The paths in plain text, outside `code` and web addresses (test/fixtures/file-paths.json). */
internal fun filePathsIn(text: String): List<FilePaths.Found> =
    FilePaths.find(text, chatLinks(text).map { it.start until it.start + it.text.length })

private const val PATH_TAG = "path"
/** The small file icon before a path ([PathText] draws it; elsewhere it is a space). */
private const val FILE_ICON = "file-icon"
/** A site's icon before a web link (#530): its inline content is "site:<host>", "site:" for the globe, and
 *  [SITE_TAG] holds the host where it stands. */
private const val SITE_ICON = "site:"
private const val SITE_TAG = "site"

/** Site icons before the links of a reply: a chat's screen turns them on for the replies in it ([sitesShown]), not
 *  for a tile or a page. */
val LocalSiteIcons = compositionLocalOf { false }
/** Whether a chat shows site icons: only from a server whose features name `site-icons` (#530). */
internal fun sitesShown(features: List<String>?) = features?.contains("site-icons") == true

/** Enough Markdown for bots' replies: headings, lists, quotes, code, tables, bold, links. [onWeb]: where this chat
 *  opens on the web page, for the link under a diagram's code ([webLinkUnder]). [paths]: what a file path does.
 *  [copy]: a Copy button on each code block (#285); none in a reply still being written (its code may be cut short)
 *  or on a tile (a tap runs the tile), as on the web page. */
@Composable
fun MarkdownText(text: String, color: Color = LocalPaper.current.text, modifier: Modifier = Modifier, onWeb: String? = LocalChatOnWeb.current, paths: PathActions? = LocalPathActions.current, copy: Boolean = true) {
    val p = LocalPaper.current
    val blocks = remember(text) { parseBlocks(text) }
    val sites = LocalSiteIcons.current
    // Its styled text, made once (and again only when the text, the searched words or the colours change), not on
    // every redraw of the chat.
    val terms = SearchMarks.terms
    val styled = remember(blocks, terms, color, p, paths, sites) {
        blocks.map { b ->
            when (b) {
                is Block.Heading -> listOf(inline(b.text, color, p, paths, sites))
                is Block.Para -> listOf(inline(b.text, color, p, paths, sites))
                is Block.Item -> listOf(inline(b.text, color, p, paths, sites))
                is Block.Quote -> listOf(inline(b.text, color, p, paths, sites))
                is Block.Table -> b.rows.flatMap { row -> row.map { inline(it, color, p, paths, sites) } }
                else -> emptyList()
            }
        }
    }
    val icons = remember(styled) { siteIconsIn(styled.flatten()) }
    // Shopping results as product cards (Products.kt, #685), from a server that has them; else their code.
    val cards = LocalProductCards.current
    val products = remember(blocks, cards) { blocks.map { b -> if (cards && b is Block.Code && b.lang == "products") Products.parse(b.text) else null } }
    QuotableSelection(modifier) { // selectable, with Quote in its menu inside a chat (QuoteUi.kt)
        Column {
            blocks.forEachIndexed { i, b ->
                val st = styled[i]
                val above = Modifier.padding(top = gapAbove(blocks.getOrNull(i - 1), b))
                when (b) {
                    is Block.Heading -> Text(st[0], color = color, fontWeight = FontWeight.SemiBold, fontSize = headingSize(b.level), modifier = above, inlineContent = icons)
                    is Block.Para -> PathText(st[0], color, paths, above, icons)
                    // The indent moves the whole row, so a sub-item's text starts right of its parent's text.
                    is Block.Item -> Row(above.padding(start = itemIndent(b.indent))) {
                        // A task item shows its checkbox in place of the marker; it only says done or not (#267).
                        if (b.task != null) Icon(if (b.task == "done") Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank, contentDescription = null, tint = p.muted,
                            modifier = Modifier.padding(top = 3.dp, end = 6.dp).size(18.dp).semantics {
                                role = Role.Checkbox
                                toggleableState = if (b.task == "done") ToggleableState.On else ToggleableState.Off
                            })
                        else Text(if (b.number != null) "${b.number}." else "•", color = p.muted, style = MaterialTheme.typography.bodyLarge,
                            maxLines = 1, softWrap = false, modifier = Modifier.widthIn(min = markerWidth(b.number != null)).padding(end = 4.dp))
                        PathText(st[0], color, paths, Modifier, icons)
                    }
                    is Block.Quote -> Text(st[0], style = MaterialTheme.typography.bodyLarge, color = p.muted,
                        modifier = above.padding(start = 10.dp), inlineContent = icons)
                    is Block.Code -> if (products[i] != null) ProductCards(products[i]!!, above) else {
                        // Copy in its top-right corner (#285), in a column of its own that the code scrolls beside.
                        Row(above.fillMaxWidth().background(p.sunk, RoundedCornerShape(10.dp))) {
                            Text(b.text, fontFamily = GeistMono, fontSize = 12.5.sp, color = color,
                                modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState()).padding(10.dp))
                            if (copy) copyTextOf(b)?.let { key(i, it) { CopyCode(it) } }
                        }
                        webLinkUnder(b, onWeb)?.let { url ->
                            Text(buildAnnotatedString { withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = p.muted, textDecoration = TextDecoration.Underline)))) { append(tr("Open on web")) } },
                                fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                    is Block.Table -> Box(above) { Table(b.rows, st, color, p, icons) }
                    Block.Rule -> Box(above.fillMaxWidth().height(1.dp).background(p.line2))
                }
            }
        }
    }
}

/** A paragraph or an item's text; with [paths], a long press on a file path in it offers Open and Copy path. */
@Composable
private fun PathText(text: AnnotatedString, color: Color, paths: PathActions?, modifier: Modifier, sites: Map<String, InlineTextContent> = emptyMap()) {
    if (paths == null || text.getStringAnnotations(PATH_TAG, 0, text.length).isEmpty()) {
        return Text(text, style = MaterialTheme.typography.bodyLarge, color = color, modifier = modifier, inlineContent = sites)
    }
    val p = LocalPaper.current
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val icon = remember(p) {
        mapOf(FILE_ICON to InlineTextContent(Placeholder(15.sp, 15.sp, PlaceholderVerticalAlign.TextCenter)) {
            Icon(Icons.Outlined.Description, contentDescription = null, tint = p.mention)
        })
    }
    Text(text, style = MaterialTheme.typography.bodyLarge, color = color, inlineContent = icon + sites, onTextLayout = { layout = it },
        modifier = modifier.pathLongPress(text, { layout }, paths.menu))
}

/** A press held on a file path, seen before the text's own links and selection: [onPath] with its path. */
private fun Modifier.pathLongPress(text: AnnotatedString, layout: () -> TextLayoutResult?, onPath: (String) -> Unit): Modifier = pointerInput(text) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        val at = layout()?.getOffsetForPosition(down.position) ?: return@awaitEachGesture
        val path = text.getStringAnnotations(PATH_TAG, at, at + 1).firstOrNull()?.item ?: return@awaitEachGesture
        val released = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
            while (true) {
                val e = awaitPointerEvent(PointerEventPass.Initial)
                if (e.changes.none { it.pressed } || e.changes.any { (it.position - down.position).getDistance() > viewConfiguration.touchSlop }) break
            }
            true
        }
        if (released != null) return@awaitEachGesture
        onPath(path)
        while (true) {
            val e = awaitPointerEvent(PointerEventPass.Initial)
            e.changes.forEach { it.consume() }
            if (e.changes.none { it.pressed }) break
        }
    }
}

/** A title is larger than the text (15sp), down to level 4, which is the text's size in semi-bold. */
internal fun headingSize(level: Int): TextUnit = when (level) { 1 -> 20.sp; 2 -> 18.sp; 3 -> 16.5.sp; else -> 15.sp }

/** The space above a block: none above the first, more above a title, less between two items of a list. */
internal fun gapAbove(previous: Block?, block: Block): Dp = when {
    previous == null -> 0.dp
    block is Block.Heading -> 16.dp
    block is Block.Item && previous is Block.Item -> 4.dp
    else -> 6.dp
}

/** How far right an item at this depth starts: further than the widest marker of the item above it. */
internal fun itemIndent(depth: Int): Dp = (depth * 26).dp

/** The room a marker takes at least; a longer number ("10.") takes what it needs. */
internal fun markerWidth(numbered: Boolean): Dp = if (numbered) 24.dp else 16.dp

/** A grid with columns as wide as their widest cell (up to a limit, then wrapping), the header row bold and
 *  underlined, scrolling sideways when it's wider than the chat. */
@Composable
private fun Table(rows: List<List<String>>, cells: List<AnnotatedString>, color: Color, p: Paper, sites: Map<String, InlineTextContent> = emptyMap()) {
    val cols = rows.maxOf { it.size }
    // cells: each row's styled cells, one after another (rows can be shorter than the widest).
    val starts = rows.runningFold(0) { at, row -> at + row.size }
    Layout(
        content = {
            for ((ri, row) in rows.withIndex()) for (c in 0 until cols) {
                Text(if (c < row.size) cells[starts[ri] + c] else AnnotatedString(""), color = color, fontSize = 14.sp, inlineContent = sites,
                    fontWeight = if (ri == 0) FontWeight.SemiBold else null)
            }
            Box(Modifier.background(p.line2))
        },
        modifier = Modifier.fillMaxWidth().background(p.sunk.copy(alpha = 0.6f), RoundedCornerShape(10.dp))
            .horizontalScroll(rememberScrollState()).padding(10.dp),
    ) { measurables, _ ->
        val gapX = 14.dp.roundToPx(); val gapY = 6.dp.roundToPx(); val maxCell = 240.dp.roundToPx()
        val cells = measurables.dropLast(1)
        val widths = IntArray(cols) { c -> rows.indices.maxOf { r -> cells[r * cols + c].maxIntrinsicWidth(Int.MAX_VALUE).coerceAtMost(maxCell) } }
        val placed = cells.mapIndexed { k, m -> m.measure(Constraints(maxWidth = widths[k % cols])) }
        val heights = rows.indices.map { r -> (0 until cols).maxOf { c -> placed[r * cols + c].height } }
        val totalW = widths.sum() + gapX * (cols - 1)
        val rule = measurables.last().measure(Constraints.fixed(totalW, 1.dp.roundToPx().coerceAtLeast(1)))
        val headerExtra = gapY + rule.height
        val totalH = heights.sum() + gapY * (rows.size - 1) + if (rows.size > 1) headerExtra else 0
        layout(totalW, totalH) {
            var y = 0
            for (r in rows.indices) {
                var x = 0
                for (c in 0 until cols) { placed[r * cols + c].place(x, y); x += widths[c] + gapX }
                y += heights[r] + gapY
                if (r == 0 && rows.size > 1) { rule.place(0, y); y += headerExtra }
            }
        }
    }
}

internal sealed interface Block {
    data class Heading(val level: Int, val text: String) : Block
    data class Para(val text: String) : Block
    /** [task]: "done" or "todo" for an item that starts with [x] or [ ], null for any other. */
    data class Item(val text: String, val number: Int?, val indent: Int, val task: String? = null) : Block
    data class Quote(val text: String) : Block
    /** [lang]: the word after the opening fence ("mermaid", "kotlin"), "" without one. */
    data class Code(val text: String, val lang: String = "") : Block
    data class Table(val rows: List<List<String>>) : Block
    data object Rule : Block
}

/** A fence line's word, as the web page reads it: only a word, alone on the line after the backticks. */
private val FENCE = Regex("""^```(\w*)$""")
private val ITEM = Regex("""^(\s*)(?:[-*•+]|(\d{1,9})[.)])\s+(.*)$""")
private val HEADING = Regex("""^(#{1,6})\s+(.*)$""")
private val BOLD_LINE = Regex("""^\*\*([^*]+)\*\*:?\s*$""")
private val TASK = Regex("""^\[([ xX])]\s+(.*)$""")
private val TABLE_RULE = Regex("""^[|:\-\s]+$""")
private val RULES = setOf("---", "***", "___")

/**
 * A reply draft (docs/api.md, "The reply draft") as it can be drawn while it still grows, by the rules the web page
 * shares (the `stream` cases of test/fixtures/markdown-cases.json; draftSource in public/app.js): a code block that is
 * not closed yet is drawn as code, a `mermaid` one is plain code even once closed (its fence loses the word: no
 * "Open on web" under a draft, ADR 041), a table row that is still being written waits, and so does the line of a
 * fence that is still being opened. An unclosed ** or [ needs nothing: it is drawn as the text it is. A `products`
 * fence that is not closed yet waits whole: its cards are drawn once it is (test/fixtures/products-cases.json).
 */
internal fun draftSource(src: String): String {
    var lines = src.replace("\r\n", "\n").replace('\r', '\n').split("\n").toMutableList()
    val fence = Regex("^\\s*```")
    var open = -1
    lines.forEachIndexed { i, l -> if (fence.containsMatchIn(l)) open = if (open < 0) i else -1 }
    if (open >= 0 && Regex("^\\s*```products\\s*$").matches(lines[open])) lines = lines.subList(0, open).toMutableList()
    if (lines.isEmpty()) return ""
    val last = lines.last()
    if (lines.count { fence.containsMatchIn(it) } % 2 == 1) {
        // In a code block: a fence that is still being opened (```mer) or closed (``) waits; the rest is code.
        if (Regex("^\\s*`+\\w*$").matches(last)) lines.removeAt(lines.lastIndex)
        if (lines.count { fence.containsMatchIn(it) } % 2 == 1) lines += "```"
    } else if (Regex("^\\s*(\\||`{1,2}$)").containsMatchIn(last)) lines.removeAt(lines.lastIndex) // a row of a table is drawn once its line has ended
    return lines.joinToString("\n") { it.replace(Regex("^(\\s*```)mermaid$"), "$1") }
}

/**
 * A reply as a flat list of blocks, by the rules the web page shares (test/fixtures/markdown-cases.json; mdBlocks in
 * public/app.js): an item's depth is how many open items start left of its marker, a numbered list counts up from
 * its first number, a text line under an item belongs to it, and a short line that is only bold is a title.
 */
internal fun parseBlocks(src: String): List<Block> {
    val out = mutableListOf<Block>()
    val para = mutableListOf<String>()
    // The open list: the marker columns of the open items, the last number at each depth, and where its last item is.
    val stack = mutableListOf<Int>()
    val nums = mutableListOf<Int?>()
    var item = -1
    var blank = false
    fun flush() { if (para.isNotEmpty()) out += Block.Para(para.joinToString("\n")); para.clear() }
    fun endList() { stack.clear(); nums.clear(); item = -1; blank = false }
    val lines = src.replace("\r\n", "\n").replace('\r', '\n').lines()
    fun isTable(t: String) = t.length > 1 && t.startsWith("|") && t.endsWith("|")
    // A line that is only bold is a section title when it is short, is no sentence and something follows it.
    fun title(line: String, at: Int): String? {
        val text = BOLD_LINE.find(line)?.groupValues?.get(1)?.removeSuffix(":")?.trim() ?: return null
        if (text.isEmpty() || text.length > 60 || text.last() in ".!?") return null
        return text.takeIf { lines.drop(at + 1).any { it.isNotBlank() } }
    }
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val t = line.trim()
        val m = ITEM.find(line)
        when {
            t.startsWith("```") -> {
                flush(); endList()
                val lang = FENCE.find(t)?.groupValues?.get(1).orEmpty()
                val code = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("```")) { code.appendLine(lines[i]); i++ }
                out += Block.Code(code.toString().trimEnd(), lang)
            }
            isTable(t) -> {
                // Tables, without the separator row.
                flush(); endList()
                val rows = mutableListOf<List<String>>()
                while (i < lines.size && isTable(lines[i].trim())) {
                    val r = lines[i].trim()
                    if (!TABLE_RULE.matches(r)) rows += r.substring(1, r.length - 1).split("|").map { it.trim() }
                    i++
                }
                i--
                if (rows.isNotEmpty()) out += Block.Table(rows)
            }
            t.isEmpty() -> { flush(); if (item >= 0) blank = true }
            t in RULES -> { flush(); endList(); out += Block.Rule }
            HEADING.matches(t) -> { flush(); endList(); val h = HEADING.find(t)!!; out += Block.Heading(h.groupValues[1].length.coerceAtMost(4), h.groupValues[2]) }
            t.startsWith(">") -> {
                flush(); endList()
                val quoted = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith(">")) { quoted += lines[i].trim().removePrefix(">").trim(); i++ }
                i--
                out += Block.Quote(quoted.joinToString("\n"))
            }
            m != null -> {
                flush()
                // An item is the child of the open item whose marker starts left of its own; depth stops at 3.
                val column = m.groupValues[1].length
                while (stack.isNotEmpty() && stack.last() >= column) stack.removeAt(stack.lastIndex)
                while (stack.size > 3) stack.removeAt(stack.lastIndex)
                val depth = stack.size
                stack += column
                while (nums.size > depth + 1) nums.removeAt(nums.lastIndex)
                while (nums.size < depth + 1) nums += null
                // The first number of a list is the one written; the next ones count up, whatever is written.
                val number = m.groupValues[2].toIntOrNull()?.let { written -> nums[depth]?.plus(1) ?: written }
                nums[depth] = number
                // An item that starts with [ ] or [x] is a task, drawn with a checkbox in place of its marker (#267).
                val text = m.groupValues[3].trim()
                val task = TASK.find(text)
                out += if (task == null) Block.Item(text, number, depth)
                else Block.Item(task.groupValues[2], number, depth, if (task.groupValues[1] == " ") "todo" else "done")
                item = out.lastIndex
                blank = false
            }
            // A text line right under an item, or indented under it after a blank line, belongs to that item.
            item >= 0 && (!blank || line.first().isWhitespace()) -> {
                val open = out[item] as Block.Item
                out[item] = open.copy(text = open.text + "\n" + t)
                blank = false
            }
            else -> {
                val heading = title(line, i)
                if (heading != null) { flush(); endList(); out += Block.Heading(3, heading) } else { endList(); para += t }
            }
        }
        i++
    }
    flush()
    return out
}

// An address without https:// is a domain with a path, like x.com/dhh/status/1, on a common top-level domain, so that
// file names like README.md or lib/bots.js stay text (test/fixtures/chat-links.json, shared with the web page).
private const val BARE_TLDS = "com|org|net|io|dev|app|ai|co|pl|me|gg|tv|xyz|edu|gov|info|eu|uk|de|fr|ly|so|be|fm|to|tech|blog|news|page|site|social|cloud|art|link"
private const val BARE_URL = """(?<![\p{L}\p{N}_@./:-])(?i:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:$BARE_TLDS))/[^\s<>"\x27`]*"""
private val INLINE = Regex("""\*\*(.+?)\*\*|__(.+?)__|(`+)([\s\S]*?)\3|\[([^\]]+)]\(((?:[^()\s]|\([^()\s]*\))+)\)|((?<![\p{L}\p{N}_:/])(?i:https?://)[^\s<>"\x27`]+|$BARE_URL)|(?<![*\w])\*([^*\n]+)\*(?!\w)|(?<![_\w])_([^_\n]+)_(?!\w)|~~([^~\s](?:[^~\n]*[^~\s])?)~~""")
private val WEB_URL = Regex("""(?<![\p{L}\p{N}_:/])(?i:https?://)[^\s<>"\x27`]+|$BARE_URL""")
private val CODE_SPAN = Regex("""(`+)[\s\S]*?\1""")

/** A web address in plain chat text, outside `code`: where it starts, as written, and where it goes. */
internal data class ChatLink(val start: Int, val text: String, val url: String)

internal fun chatLinks(text: String): List<ChatLink> {
    val code = CODE_SPAN.findAll(text).map { it.range }.toList()
    return WEB_URL.findAll(text).mapNotNull { match ->
        if (code.any { it.first <= match.range.last && it.last >= match.range.first }) return@mapNotNull null
        var url = match.value
        while (url.isNotEmpty()) {
            val last = url.last()
            val open = when (last) { ')' -> '('; ']' -> '['; '}' -> '{'; else -> null }
            if (last in ".,;:!?" || (open != null && url.count { it == last } > url.count { it == open })) url = url.dropLast(1)
            else break
        }
        val target = if (url.startsWith("http://", true) || url.startsWith("https://", true)) url else "https://$url"
        val host = runCatching { java.net.URI(target).host }.getOrNull()
        if (host.isNullOrEmpty()) null else ChatLink(match.range.first, url, target)
    }.toList()
}

/** Link plain chat text without changing its characters, mentions or search marks; with [sites], each link has its
 *  site's icon before it ([siteIcon]). */
internal fun linkedChatText(source: AnnotatedString, color: Color, sites: Boolean = false): AnnotatedString = buildAnnotatedString {
    val styles = TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline))
    var at = 0
    chatLinks(source.text).forEach { link ->
        val end = link.start + link.text.length
        if (source.getLinkAnnotations(link.start, end).isNotEmpty()) return@forEach
        append(source.subSequence(at, link.start))
        if (sites) siteIcon(link.url)
        val start = length
        append(source.subSequence(link.start, end))
        addLink(LinkAnnotation.Url(link.url, styles), start, length)
        at = end
    }
    append(source.subSequence(at, source.length))
}

/** The host botdot is asked for a link's icon, or null for one it would refuse (an IP address, a local name): the
 *  web page's linkHost (test/fixtures/site-hosts.json). */
internal fun siteHostOf(url: String): String? {
    val host = runCatching { java.net.URI(url).host }.getOrNull()?.lowercase() ?: return null
    return host.takeIf { it.contains('.') && !NOT_A_SITE.containsMatchIn(it) }
}
private val NOT_A_SITE = Regex("""^[\d.]+$|^\[|\.(local|localhost|lan|internal|home\.arpa)$""")

/** A site's icon before a link: drawn by [SiteIcon] where the text's inlineContent has [siteIconsIn]. */
private fun AnnotatedString.Builder.siteIcon(url: String) {
    val host = siteHostOf(url).orEmpty()
    val start = length
    appendInlineContent(SITE_ICON + host, " ")
    addStringAnnotation(SITE_TAG, host, start, length)
}

/** The inline content for the site icons in [texts]: one per site. */
internal fun siteIconsIn(texts: List<AnnotatedString>): Map<String, InlineTextContent> =
    texts.flatMap { t -> t.getStringAnnotations(SITE_TAG, 0, t.length).map { it.item } }.toSet().associate { host ->
        SITE_ICON + host to InlineTextContent(Placeholder(16.sp, 16.sp, PlaceholderVerticalAlign.TextCenter)) { SiteIcon(host) }
    }

/** The icon botdot keeps for [host] (/api/favicon), on a light rounded backing so a dark icon shows on the dark
 *  page; a grey globe where it keeps none. */
@Composable
private fun SiteIcon(host: String) {
    val p = LocalPaper.current
    val api by dev.botdot.app.BotDotApp.of(LocalContext.current).api.collectAsState()
    var failed by remember(host) { mutableStateOf(false) }
    val a = api
    if (host.isEmpty() || failed || a == null) return Icon(Icons.Outlined.Language, contentDescription = null, tint = p.faint, modifier = Modifier.fillMaxSize().padding(1.dp))
    Box(Modifier.fillMaxSize().padding(1.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xFFE6E6E6)), contentAlignment = Alignment.Center) {
        coil3.compose.AsyncImage(model = a.url("/favicon?host=" + dev.botdot.app.data.Api.enc(host)), contentDescription = null,
            onState = { if (it is coil3.compose.AsyncImagePainter.State.Error) failed = true }, modifier = Modifier.fillMaxSize().padding(1.dp))
    }
}

private fun inline(s: String, color: Color, p: Paper, paths: PathActions? = null, sites: Boolean = false): AnnotatedString = SearchMarks.mark(inlineText(s, color, p, paths, sites))

/** A file path as a link: blue, a tap opens it, and tagged for [pathLongPress]. */
private fun AnnotatedString.Builder.pathLink(path: String, p: Paper, paths: PathActions, content: AnnotatedString.Builder.() -> Unit) {
    val start = length
    withLink(LinkAnnotation.Clickable(path, TextLinkStyles(SpanStyle(color = p.mention)), { paths.open(path, path.substringAfterLast('/')) })) { content() }
    addStringAnnotation(PATH_TAG, path, start, length)
}

/** Plain text with its web addresses linked and, with [paths], its file paths. */
private fun linkedReplyText(s: String, color: Color, p: Paper, paths: PathActions?, sites: Boolean): AnnotatedString {
    if (paths == null) return linkedChatText(AnnotatedString(s), color, sites)
    return buildAnnotatedString {
        var at = 0
        for (f in filePathsIn(s)) {
            append(linkedChatText(AnnotatedString(s.substring(at, f.start)), color, sites))
            appendInlineContent(FILE_ICON, " ")
            pathLink(f.text, p, paths) { append(f.text) }
            at = f.start + f.text.length
        }
        append(linkedChatText(AnnotatedString(s.substring(at)), color, sites))
    }
}

internal fun inlineText(s: String, color: Color, p: Paper, paths: PathActions? = null, sites: Boolean = false): AnnotatedString = buildAnnotatedString {
    val links = TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline))
    var at = 0
    for (m in INLINE.findAll(s)) {
        append(linkedReplyText(s.substring(at, m.range.first), color, p, paths, sites))
        val g = m.groupValues
        when {
            g[1].isNotEmpty() || g[2].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(inlineText(g[1].ifEmpty { g[2] }, color, p, paths, sites)) }
            g[3].isNotEmpty() && paths != null && FilePaths.isPath(g[4]) -> pathLink(g[4], p, paths) {
                withStyle(SpanStyle(fontFamily = GeistMono, background = p.sunk, fontSize = 13.sp)) { append(g[4]) }
            }
            g[3].isNotEmpty() -> withStyle(SpanStyle(fontFamily = GeistMono, background = p.sunk, fontSize = 13.sp)) { append(g[4]) }
            g[5].isNotEmpty() -> {
                val target = runCatching { java.net.URI(g[6]) }.getOrNull()
                if (target?.scheme?.lowercase() in listOf("http", "https") && !target?.host.isNullOrEmpty()) {
                    if (sites) siteIcon(g[6])
                    withLink(LinkAnnotation.Url(g[6], links)) { append(g[5]) }
                } else append(g[5])
            }
            g[7].isNotEmpty() -> append(linkedChatText(AnnotatedString(g[7]), color, sites))
            g[8].isNotEmpty() || g[9].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(inlineText(g[8].ifEmpty { g[9] }, color, p, paths, sites)) }
            g[10].isNotEmpty() -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(inlineText(g[10], color, p, paths, sites)) }
        }
        at = m.range.last + 1
    }
    append(linkedReplyText(s.substring(at), color, p, paths, sites))
}
