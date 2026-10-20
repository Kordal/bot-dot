package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
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

/** Enough Markdown for bots' replies: headings, lists, quotes, code, tables, bold, links. [onWeb]: where this chat
 *  opens on the web page, for the link under a diagram's code ([webLinkUnder]). */
@Composable
fun MarkdownText(text: String, color: Color = LocalPaper.current.text, modifier: Modifier = Modifier, onWeb: String? = LocalChatOnWeb.current) {
    val p = LocalPaper.current
    val blocks = remember(text) { parseBlocks(text) }
    // Its styled text, made once (and again only when the text, the searched words or the colours change), not on
    // every redraw of the chat.
    val terms = SearchMarks.terms
    val styled = remember(blocks, terms, color, p) {
        blocks.map { b ->
            when (b) {
                is Block.Heading -> listOf(inline(b.text, color, p))
                is Block.Para -> listOf(inline(b.text, color, p))
                is Block.Item -> listOf(inline(b.text, color, p))
                is Block.Quote -> listOf(inline(b.text, color, p))
                is Block.Table -> b.rows.flatMap { row -> row.map { inline(it, color, p) } }
                else -> emptyList()
            }
        }
    }
    QuotableSelection(modifier) { // selectable, with Quote in its menu inside a chat (QuoteUi.kt)
        Column {
            blocks.forEachIndexed { i, b ->
                val st = styled[i]
                val above = Modifier.padding(top = gapAbove(blocks.getOrNull(i - 1), b))
                when (b) {
                    is Block.Heading -> Text(st[0], color = color, fontWeight = FontWeight.SemiBold, fontSize = headingSize(b.level), modifier = above)
                    is Block.Para -> Text(st[0], style = MaterialTheme.typography.bodyLarge, color = color, modifier = above)
                    // The indent moves the whole row, so a sub-item's text starts right of its parent's text.
                    is Block.Item -> Row(above.padding(start = itemIndent(b.indent))) {
                        Text(if (b.number != null) "${b.number}." else "•", color = p.muted, style = MaterialTheme.typography.bodyLarge,
                            maxLines = 1, softWrap = false, modifier = Modifier.widthIn(min = markerWidth(b.number != null)).padding(end = 4.dp))
                        Text(st[0], style = MaterialTheme.typography.bodyLarge, color = color)
                    }
                    is Block.Quote -> Text(st[0], style = MaterialTheme.typography.bodyLarge, color = p.muted,
                        modifier = above.padding(start = 10.dp))
                    is Block.Code -> {
                        Text(b.text, fontFamily = GeistMono, fontSize = 12.5.sp, color = color,
                            modifier = above.fillMaxWidth().background(p.sunk, RoundedCornerShape(10.dp)).horizontalScroll(rememberScrollState()).padding(10.dp))
                        webLinkUnder(b, onWeb)?.let { url ->
                            Text(buildAnnotatedString { withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = p.muted, textDecoration = TextDecoration.Underline)))) { append("Open on web") } },
                                fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                    is Block.Table -> Box(above) { Table(b.rows, st, color, p) }
                    Block.Rule -> Box(above.fillMaxWidth().height(1.dp).background(p.line2))
                }
            }
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
private fun Table(rows: List<List<String>>, cells: List<AnnotatedString>, color: Color, p: Paper) {
    val cols = rows.maxOf { it.size }
    // cells: each row's styled cells, one after another (rows can be shorter than the widest).
    val starts = rows.runningFold(0) { at, row -> at + row.size }
    Layout(
        content = {
            for ((ri, row) in rows.withIndex()) for (c in 0 until cols) {
                Text(if (c < row.size) cells[starts[ri] + c] else AnnotatedString(""), color = color, fontSize = 14.sp,
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
    data class Item(val text: String, val number: Int?, val indent: Int) : Block
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
private val TABLE_RULE = Regex("""^[|:\-\s]+$""")
private val RULES = setOf("---", "***", "___")

/**
 * A reply draft (docs/api.md, "The reply draft") as it can be drawn while it still grows, by the rules the web page
 * shares (the `stream` cases of test/fixtures/markdown-cases.json; draftSource in public/app.js): a code block that is
 * not closed yet is drawn as code, a `mermaid` one is plain code even once closed (its fence loses the word: no
 * "Open on web" under a draft, ADR 041), a table row that is still being written waits, and so does the line of a
 * fence that is still being opened. An unclosed ** or [ needs nothing: it is drawn as the text it is.
 */
internal fun draftSource(src: String): String {
    val lines = src.replace("\r\n", "\n").replace('\r', '\n').split("\n").toMutableList()
    val fence = Regex("^\\s*```")
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
                out += Block.Item(m.groupValues[3].trim(), number, depth)
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
private val INLINE = Regex("""\*\*(.+?)\*\*|__(.+?)__|(`+)([\s\S]*?)\3|\[([^\]]+)]\(((?:[^()\s]|\([^()\s]*\))+)\)|((?<![\p{L}\p{N}_:/])(?i:https?://)[^\s<>"\x27`]+|$BARE_URL)|(?<![*\w])\*([^*\n]+)\*(?!\w)|(?<![_\w])_([^_\n]+)_(?!\w)""")
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

/** Link plain chat text without changing its characters, mentions or search marks. */
internal fun linkedChatText(source: AnnotatedString, color: Color): AnnotatedString = buildAnnotatedString {
    append(source)
    val styles = TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline))
    chatLinks(source.text).forEach { link ->
        val end = link.start + link.text.length
        if (source.getLinkAnnotations(link.start, end).isEmpty()) addLink(LinkAnnotation.Url(link.url, styles), link.start, end)
    }
}

private fun inline(s: String, color: Color, p: Paper): AnnotatedString = SearchMarks.mark(inlineText(s, color, p))

private fun inlineText(s: String, color: Color, p: Paper): AnnotatedString = buildAnnotatedString {
    val links = TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline))
    var at = 0
    for (m in INLINE.findAll(s)) {
        append(linkedChatText(AnnotatedString(s.substring(at, m.range.first)), color))
        val g = m.groupValues
        when {
            g[1].isNotEmpty() || g[2].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(inlineText(g[1].ifEmpty { g[2] }, color, p)) }
            g[3].isNotEmpty() -> withStyle(SpanStyle(fontFamily = GeistMono, background = p.sunk, fontSize = 13.sp)) { append(g[4]) }
            g[5].isNotEmpty() -> {
                val target = runCatching { java.net.URI(g[6]) }.getOrNull()
                if (target?.scheme?.lowercase() in listOf("http", "https") && !target?.host.isNullOrEmpty()) {
                    withLink(LinkAnnotation.Url(g[6], links)) { append(g[5]) }
                } else append(g[5])
            }
            g[7].isNotEmpty() -> append(linkedChatText(AnnotatedString(g[7]), color))
            g[8].isNotEmpty() || g[9].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(inlineText(g[8].ifEmpty { g[9] }, color, p)) }
        }
        at = m.range.last + 1
    }
    append(linkedChatText(AnnotatedString(s.substring(at)), color))
}
