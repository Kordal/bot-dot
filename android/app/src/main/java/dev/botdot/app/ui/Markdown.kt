package dev.botdot.app.ui

import dev.botdot.app.data.without
import dev.botdot.app.markdown.WEB_ADDRESS
import dev.botdot.app.markdown.INLINE
import dev.botdot.app.markdown.linkLabel
import dev.botdot.app.markdown.chatLinks
import dev.botdot.app.markdown.parseBlocks
import dev.botdot.app.markdown.previewLines
import dev.botdot.app.markdown.Block
import dev.botdot.app.markdown.tableView
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
import dev.botdot.app.answerview.ReplyPart
import dev.botdot.app.answerview.ViewNode
import dev.botdot.app.data.BotNames
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
fun MarkdownText(text: String, color: Color = LocalPaper.current.text, modifier: Modifier = Modifier, onWeb: String? = LocalChatOnWeb.current, paths: PathActions? = LocalPathActions.current, copy: Boolean = true, bots: BotLinks? = LocalBotLinks.current, draft: Boolean = false) {
    // An answer view (a ```ui fence, ADR 264) is drawn from the catalog the server hands out: a reply with one is split into
    // its text, its views and the code of what can't be drawn. [draft]: the reply is still being written, so a fence not
    // closed yet waits as "Drawing a view…". Without the catalog (an older botdot), a fence is code like any other.
    val views = LocalAnswerViews.current
    val parts = remember(text, views, draft) { if (views != null && text.contains("```ui")) views.split(text, done = !draft) else null }
    if (parts == null) return MarkdownProse(text, color, modifier, onWeb, paths, copy, bots, draft)
    Column(modifier) {
        parts.forEachIndexed { i, part ->
            key(i) {
                val above = Modifier.padding(top = if (i == 0) 0.dp else 6.dp)
                // The text before a view is whole; only the last text of a reply being written is a draft.
                if (part is ReplyPart.Text) MarkdownProse(part.text, color, above, onWeb, paths, copy, bots, draft && i == parts.lastIndex) else AnswerPart(part, color, copy, above, i)
            }
        }
    }
}

@Composable
private fun MarkdownProse(text: String, color: Color, modifier: Modifier, onWeb: String?, paths: PathActions?, copy: Boolean, bots: BotLinks?, draft: Boolean) {
    val p = LocalPaper.current
    val sites = LocalSiteIcons.current
    val cards = LocalProductCards.current
    val terms = SearchMarks.terms
    // Each block styled once (and again only when the searched words or the colours change), not on every redraw of
    // the chat: a reply draft that grows with each draft the server sends restyles only its last block, and the blocks
    // before it, the same objects as before, are skipped when the chat draws again.
    val made = remember(terms, color, p, paths, sites, cards, bots, draft) { HashMap<Block, StyledBlock>() }
    val blocks = remember(text, made) {
        parseBlocks(text).map { b -> made.getOrPut(b) { styledBlock(b, color, p, paths, sites, cards, bots, draft) } }
            .also { shown -> made.keys.retainAll(shown.mapTo(HashSet()) { it.block }) }
    }
    QuotableSelection(modifier) { // selectable, with Quote in its menu inside a chat (QuoteUi.kt)
        Column {
            blocks.forEachIndexed { i, b -> key(i) { MarkdownBlock(b, gapAbove(blocks.getOrNull(i - 1)?.block, b.block), color, onWeb, copy, paths) } }
        }
    }
}

/**
 * A block of a reply with its styled text: its text, or its cells for a table, the site icons in them and its cards.
 * [view]: a table that is drawn as an answer view's table (ADR 264, amendment: [tableView]), whose [text] is its cells,
 * the header's first.
 */
internal class StyledBlock(val block: Block, val text: List<AnnotatedString>, val icons: Map<String, InlineTextContent>, val products: List<Product>?, val view: ViewNode? = null) {
    /** [text] by row, as the table's rows are. */
    val cells: List<List<AnnotatedString>> by lazy {
        var at = 0
        (block as? Block.Table)?.rows.orEmpty().map { r -> text.subList(at, at + r.size).also { at += r.size } }
    }
}

/** [draft]: the reply is still being written, so a table is drawn as it always was and becomes a view when the reply ends. */
private fun styledBlock(b: Block, color: Color, p: Paper, paths: PathActions?, sites: Boolean, cards: Boolean, bots: BotLinks?, draft: Boolean): StyledBlock {
    val text = when (b) {
        is Block.Heading -> listOf(inline(b.text, color, p, paths, sites, bots))
        is Block.Para -> listOf(inline(b.text, color, p, paths, sites, bots))
        is Block.Item -> listOf(inline(b.text, color, p, paths, sites, bots))
        is Block.Quote -> listOf(inline(b.text, color, p, paths, sites, bots))
        is Block.Table -> b.rows.flatMap { row -> row.map { inline(it, color, p, paths, sites, bots) } }
        else -> emptyList()
    }
    // Shopping results as product cards (Products.kt, #685), from a server that has them; else their code.
    val products = if (cards && b is Block.Code && b.lang == "products") Products.parse(b.text) else null
    return StyledBlock(b, text, siteIconsIn(text), products, view = if (!draft && b is Block.Table) tableView(b) else null)
}

@Composable
private fun MarkdownBlock(s: StyledBlock, gap: Dp, color: Color, onWeb: String?, copy: Boolean, paths: PathActions?) {
    val p = LocalPaper.current
    val st = s.text
    val icons = s.icons
    val above = Modifier.padding(top = gap)
    // Lines of text stop at about 62 characters (#726); code, tables and cards keep the width.
    val prose = above.widthIn(max = Space.answer)
    when (val b = s.block) {
        is Block.Heading -> Text(st[0], color = color, fontWeight = FontWeight.SemiBold, fontSize = headingSize(b.level), modifier = prose, inlineContent = icons)
        is Block.Para -> PathText(st[0], color, paths, prose, icons)
        // The indent moves the whole row, so a sub-item's text starts right of its parent's text.
        is Block.Item -> Row(prose.padding(start = itemIndent(b.indent))) {
            // A task item shows its checkbox in place of the marker; it only says done or not (#267).
            if (b.task != null) Icon(if (b.task == "done") Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank, contentDescription = null, tint = p.muted,
                modifier = Modifier.padding(top = Space.s4, end = Space.s8).size(18.dp).semantics {
                    role = Role.Checkbox
                    toggleableState = if (b.task == "done") ToggleableState.On else ToggleableState.Off
                })
            else Text(if (b.number != null) "${b.number}." else "•", color = p.muted, style = MaterialTheme.typography.bodyLarge,
                maxLines = 1, softWrap = false, modifier = Modifier.widthIn(min = markerWidth(b.number != null)).padding(end = Space.s4))
            PathText(st[0], color, paths, Modifier, icons)
        }
        is Block.Quote -> Text(st[0], style = MaterialTheme.typography.bodyLarge, color = p.muted,
            modifier = prose.padding(start = Space.s12), inlineContent = icons)
        is Block.Code -> if (s.products != null) ProductCards(s.products, above) else {
            PlainCode(b.text, color, copy, above)
            webLinkUnder(b, onWeb)?.let { url ->
                Text(buildAnnotatedString { withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = p.muted, textDecoration = TextDecoration.Underline)))) { append(tr("Open on web")) } },
                    fontSize = Type.s14, modifier = Modifier.padding(top = Space.s4))
            }
        }
        is Block.Table -> Box(above) { if (s.view != null) ViewTableList(s.view, s.cells, icons) else Table(b.rows, st, color, p, icons) }
        Block.Rule -> Box(above.fillMaxWidth().height(1.dp).background(p.line2))
    }
}

/** A block of code: its text in a box that scrolls sideways, with Copy in its top-right corner (#285) in a column of its own. */
@Composable
internal fun PlainCode(text: String, color: Color, copy: Boolean, modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    Row(modifier.fillMaxWidth().background(p.sunk, Radius.small)) {
        Text(text, fontFamily = GeistMono, fontSize = Type.s12, color = color,
            modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState()).padding(Space.s12))
        if (copy) key(text) { CopyCode(text) }
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
        mapOf(FILE_ICON to InlineTextContent(Placeholder(Type.s16, Type.s16, PlaceholderVerticalAlign.TextCenter)) {
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
internal fun headingSize(level: Int): TextUnit = if (level == 1) Type.s20 else Type.s16

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
    val num = numericColumns(rows)
    Layout(
        content = {
            for ((ri, row) in rows.withIndex()) for (c in 0 until cols) {
                Text(if (c < row.size) cells[starts[ri] + c] else AnnotatedString(""), color = color, fontSize = Type.s14, inlineContent = sites,
                    fontWeight = if (ri == 0) FontWeight.SemiBold else null)
            }
            Box(Modifier.background(p.line2))
        },
        modifier = Modifier.fillMaxWidth().background(p.sunk.copy(alpha = 0.6f), Radius.small)
            .horizontalScroll(rememberScrollState()).padding(Space.s12),
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
                for (c in 0 until cols) {
                    val m = placed[r * cols + c]
                    m.place(if (num[c]) x + widths[c] - m.width else x, y); x += widths[c] + gapX
                }
                y += heights[r] + gapY
                if (r == 0 && rows.size > 1) { rule.place(0, y); y += headerExtra }
            }
        }
    }
}

private val NUM_CELL = Regex("""^[-+−]?\d[\d\s.,:]*%?$""")

/** Which columns hold only numbers below the header (at least one, blanks allowed): they line up on the right, as on
 *  the web (app.js tableHTML). */
internal fun numericColumns(rows: List<List<String>>): BooleanArray {
    val cols = rows.maxOf { it.size }
    val body = rows.drop(1)
    return BooleanArray(cols) { c ->
        val cells = body.map { it.getOrElse(c) { "" } }
        cells.any { it.isNotEmpty() } && cells.all { it.isEmpty() || NUM_CELL.matches(it) }
    }
}


/** Link plain chat text, each address shown as its site ([linkLabel]), keeping the rest of its characters, mentions
 *  and search marks; with [sites], each link has its site's icon before it ([siteIcon]). */
internal fun linkedChatText(source: AnnotatedString, color: Color, sites: Boolean = false, bots: BotLinks? = null, botColor: Color = color): AnnotatedString = buildAnnotatedString {
    val styles = TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline))
    var at = 0
    chatLinks(source.text).forEach { link ->
        val end = link.start + link.text.length
        if (source.getLinkAnnotations(link.start, end).isNotEmpty()) return@forEach
        appendWithBots(source.subSequence(at, link.start), bots, botColor)
        if (sites) siteIcon(link.url)
        val start = length
        append(linkLabel(link.text))
        addLink(LinkAnnotation.Url(link.url, styles), start, length)
        at = end
    }
    appendWithBots(source.subSequence(at, source.length), bots, botColor)
}

/** [text], each bot's name in it a link that opens that bot's chat ([BotNames]), in [color]. */
private fun AnnotatedString.Builder.appendWithBots(text: AnnotatedString, bots: BotLinks?, color: Color) {
    if (bots == null || bots.bots.isEmpty()) { append(text); return }
    var at = 0
    for (f in BotNames.find(text.text, bots.bots)) {
        append(text.subSequence(at, f.start))
        withLink(LinkAnnotation.Clickable(f.id, TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline)), { bots.open(f.id) })) { append(text.subSequence(f.start, f.start + f.text.length)) }
        at = f.start + f.text.length
    }
    append(text.subSequence(at, text.length))
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
        SITE_ICON + host to InlineTextContent(Placeholder(Type.s16, Type.s16, PlaceholderVerticalAlign.TextCenter)) { SiteIcon(host) }
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

private fun inline(s: String, color: Color, p: Paper, paths: PathActions? = null, sites: Boolean = false, bots: BotLinks? = null): AnnotatedString = SearchMarks.mark(inlineText(s, color, p, paths, sites, bots))

/** A file path as a link: blue, a tap opens it, and tagged for [pathLongPress]. */
private fun AnnotatedString.Builder.pathLink(path: String, p: Paper, paths: PathActions, content: AnnotatedString.Builder.() -> Unit) {
    val start = length
    withLink(LinkAnnotation.Clickable(path, TextLinkStyles(SpanStyle(color = p.mention)), { paths.open(path, path.substringAfterLast('/')) })) { content() }
    addStringAnnotation(PATH_TAG, path, start, length)
}

/** Plain text with its web addresses linked and, with [paths], its file paths. */
private fun linkedReplyText(s: String, color: Color, p: Paper, paths: PathActions?, sites: Boolean, bots: BotLinks?): AnnotatedString {
    if (paths == null) return linkedChatText(AnnotatedString(s), color, sites, bots, p.mention)
    return buildAnnotatedString {
        var at = 0
        for (f in filePathsIn(s)) {
            append(linkedChatText(AnnotatedString(s.substring(at, f.start)), color, sites, bots, p.mention))
            appendInlineContent(FILE_ICON, " ")
            pathLink(f.text, p, paths) { append(f.text) }
            at = f.start + f.text.length
        }
        append(linkedChatText(AnnotatedString(s.substring(at)), color, sites, bots, p.mention))
    }
}

/** A reply in a few lines ([previewLines]), each styled as in a chat, its links shown as their site. */
internal fun previewText(s: String, color: Color, p: Paper, sites: Boolean = false): AnnotatedString = buildAnnotatedString {
    previewLines(s).forEachIndexed { i, line -> if (i > 0) append("\n"); append(inlineText(line, color, p, sites = sites)) }
}

internal fun inlineText(s: String, color: Color, p: Paper, paths: PathActions? = null, sites: Boolean = false, bots: BotLinks? = null): AnnotatedString = buildAnnotatedString {
    val links = TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline))
    var at = 0
    for (m in INLINE.findAll(s)) {
        append(linkedReplyText(s.substring(at, m.range.first), color, p, paths, sites, bots))
        val g = m.groupValues
        when {
            g[1].isNotEmpty() || g[2].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(inlineText(g[1].ifEmpty { g[2] }, color, p, paths, sites, bots)) }
            g[3].isNotEmpty() && paths != null && FilePaths.isPath(g[4]) -> pathLink(g[4], p, paths) {
                withStyle(SpanStyle(fontFamily = GeistMono, background = p.sunk, fontSize = Type.s14)) { append(g[4]) }
            }
            g[3].isNotEmpty() -> withStyle(SpanStyle(fontFamily = GeistMono, background = p.sunk, fontSize = Type.s14)) { append(g[4]) }
            g[5].isNotEmpty() -> {
                val target = runCatching { java.net.URI(g[6]) }.getOrNull()
                if (target?.scheme?.lowercase() in listOf("http", "https") && !target?.host.isNullOrEmpty()) {
                    if (sites) siteIcon(g[6])
                    withLink(LinkAnnotation.Url(g[6], links)) { append(if (WEB_ADDRESS.matches(g[5])) linkLabel(g[5]) else g[5]) }
                } else append(g[5])
            }
            g[7].isNotEmpty() -> append(linkedChatText(AnnotatedString(g[7]), color, sites))
            g[8].isNotEmpty() || g[9].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(inlineText(g[8].ifEmpty { g[9] }, color, p, paths, sites, bots)) }
            g[10].isNotEmpty() -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(inlineText(g[10], color, p, paths, sites, bots)) }
        }
        at = m.range.last + 1
    }
    append(linkedReplyText(s.substring(at), color, p, paths, sites, bots))
}
