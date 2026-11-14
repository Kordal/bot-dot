package dev.botdot.app.markdown

import dev.botdot.app.data.parseUri

// A reply's Markdown, read as the web page reads it (public/app.js), for both phones (ADR 242): its blocks, a draft as
// it can be drawn while it grows, and the web addresses in its text (test/fixtures/markdown-cases.json, chat-links.json).
// Each phone draws them its own way: Android's ui/Markdown.kt, the iOS app's MarkdownView.

sealed interface Block {
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
 * fence that is still being opened. The marks the last line opens and has not closed yet are left out
 * ([hideOpenMarks]), so a reply never flashes its ** as text. A `products` fence that is not closed yet waits whole: its
 * cards are drawn once it is (test/fixtures/products-cases.json).
 */
fun draftSource(src: String): String {
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
    else if (!fence.containsMatchIn(last)) lines[lines.lastIndex] = hideOpenMarks(last) // a fence is no mark
    return lines.joinToString("\n") { it.replace(Regex("^(\\s*```)mermaid$"), "$1") }
}

/**
 * The line of a draft still being written, without the marks that open what is not closed yet, by the rules the web
 * page shares (hideOpenMarks in public/app.js): a `code` (its backticks; what follows is code being written), a **, __,
 * * or _ (an _ only at the start of a word: snake_case is text), and the [ of a link with its ](address so far. Only the
 * marks go: the text after them goes on being revealed and takes its style once they close. Nothing in a `code` or a
 * web address is a mark. A closed mark, a mark between spaces (2 * 3) and an item's task box being written ("- [x")
 * stay. A line that has ended keeps its marks: it is drawn as the reply will be.
 */
fun hideOpenMarks(line: String): String {
    if (TASK_BOX.matches(line)) return line
    val cut = HashSet<Int>()
    fun drop(from: Int, to: Int) { for (i in from until to) cut += i }
    val code = mutableListOf<IntRange>()
    var open = -1
    var size = 0
    for (m in TICKS.findAll(line)) {
        if (open < 0) { open = m.range.first; size = m.value.length }
        else if (m.value.length == size) { code += open until m.range.first + size; open = -1 }
    }
    val end = if (open < 0) line.length else open
    if (open >= 0) drop(open, open + size)
    // A web address is no mark either (https://x.dev/_a, x.com/a*b).
    for (m in MARK_FREE_URL.findAll(line)) code += m.range
    fun inCode(i: Int) = code.any { i in it }
    fun word(c: Char?) = c != null && WORD_CHAR.matches(c.toString())
    val opened = LinkedHashMap<String, Int>()
    for (m in EMPHASIS.findAll(line.substring(0, end))) {
        val at = m.range.first
        val mark = m.value
        if (inCode(at)) continue
        val before = line.getOrNull(at - 1)
        val after = if (at + mark.length < end) line[at + mark.length] else null
        val under = mark[0] == '_'
        val closes = before != null && !before.isWhitespace() && !(under && word(after))
        val opens = (after == null || !after.isWhitespace()) && !(under && word(before))
        if (mark in opened && closes) opened.remove(mark)
        else if (mark !in opened && opens) opened[mark] = at
    }
    for ((mark, at) in opened) drop(at, at + mark.length)
    val at = if (end > 0) line.lastIndexOf('[', end - 1) else -1
    val link = if (at >= 0 && !inCode(at)) LINK_BEING_WRITTEN.matchEntire(line.substring(at, end)) else null
    if (link != null) { drop(at, at + 1); val tail = link.groupValues[1]; if (tail.isNotEmpty()) drop(end - tail.length, end) }
    return if (cut.isEmpty()) line else line.filterIndexed { i, _ -> i !in cut }
}

private val TASK_BOX = Regex("""^\s*(?:[-*•+]|\d{1,9}[.)])\s+\[[ xX]?]?$""")
private val TICKS = Regex("`+")
// No (?U): Android's ICU regex rejects it and the app would stop on the first chat (#867); its \p{L}, \p{N} and \S
// are Unicode already.
private val MARK_FREE_URL = Regex("""(?:https?://|(?<![\p{L}\p{N}_@./-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/)\S*""")
private val WORD_CHAR = Regex("""[\p{L}\p{N}]""")
private val EMPHASIS = Regex("""\*\*|__|\*|_""")
private val LINK_BEING_WRITTEN = Regex("""^\[[^\]]*(](?:\([^)]*)?)?$""")

/**
 * A reply as a flat list of blocks, by the rules the web page shares (test/fixtures/markdown-cases.json; mdBlocks in
 * public/app.js): an item's depth is how many open items start left of its marker, a numbered list counts up from
 * its first number, a text line under an item belongs to it, and a short line that is only bold is a title.
 */
fun parseBlocks(src: String): List<Block> {
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
val INLINE = Regex("""\*\*(.+?)\*\*|__(.+?)__|(`+)([\s\S]*?)\3|\[([^\]]+)]\(((?:[^()\s]|\([^()\s]*\))+)\)|((?<![\p{L}\p{N}_:/])(?i:https?://)[^\s<>"\x27`]+|$BARE_URL)|(?<![*\w])\*([^*\n]+)\*(?!\w)|(?<![_\w])_([^_\n]+)_(?!\w)|~~([^~\s](?:[^~\n]*[^~\s])?)~~""")
private val WEB_URL = Regex("""(?<![\p{L}\p{N}_:/])(?i:https?://)[^\s<>"\x27`]+|$BARE_URL""")
private val CODE_SPAN = Regex("""(`+)[\s\S]*?\1""")

/** A web address in plain chat text, outside `code`: where it starts, as written, and where it goes. */
data class ChatLink(val start: Int, val text: String, val url: String)

fun chatLinks(text: String): List<ChatLink> {
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
        val host = parseUri(target)?.host
        if (host.isNullOrEmpty()) null else ChatLink(match.range.first, url, target)
    }.toList()
}

/** What a web address shows in a chat: its site, without www. (the web page's linkLabel, test/fixtures/chat-links.json).
 *  Read from the address as written, so a site in another script keeps its letters. */
fun linkLabel(url: String): String {
    val host = url.replace(SCHEME, "").split('/', '?', '#').first()
    return host.substring(host.lastIndexOf('@') + 1).replace(WWW, "").lowercase().ifEmpty { url }
}
private val SCHEME = Regex("^https?://", RegexOption.IGNORE_CASE)
private val WWW = Regex("^www\\.", RegexOption.IGNORE_CASE)
val WEB_ADDRESS = Regex("^https?://\\S+$", RegexOption.IGNORE_CASE)

/** A run of a line's text with its marks, as Android's inline text draws it: what a phone without Compose draws. */
data class InlineRun(val text: String, val bold: Boolean = false, val italic: Boolean = false, val code: Boolean = false, val strike: Boolean = false, val link: String? = null)

/**
 * A line of a block as runs of text with their marks ([INLINE]: **bold**, `code`, [label](address), a web address,
 * *italic*, ~~struck~~), each web address in plain text linked and shown as its site ([chatLinks], [linkLabel]). The
 * same reading as Android's inlineText, without its file paths and site icons.
 */
fun inlineRuns(s: String, bold: Boolean = false, italic: Boolean = false, strike: Boolean = false): List<InlineRun> {
    val out = mutableListOf<InlineRun>()
    fun plain(t: String) {
        var at = 0
        for (link in chatLinks(t)) {
            if (link.start > at) out += InlineRun(t.substring(at, link.start), bold, italic, strike = strike)
            out += InlineRun(linkLabel(link.text), bold, italic, strike = strike, link = link.url)
            at = link.start + link.text.length
        }
        if (at < t.length) out += InlineRun(t.substring(at), bold, italic, strike = strike)
    }
    var at = 0
    for (m in INLINE.findAll(s)) {
        plain(s.substring(at, m.range.first))
        val g = m.groupValues
        when {
            g[1].isNotEmpty() || g[2].isNotEmpty() -> out += inlineRuns(g[1].ifEmpty { g[2] }, bold = true, italic = italic, strike = strike)
            g[3].isNotEmpty() -> out += InlineRun(g[4], bold, italic, code = true, strike = strike)
            g[5].isNotEmpty() -> {
                val target = parseUri(g[6])
                if (target?.scheme?.lowercase() in listOf("http", "https") && !target?.host.isNullOrEmpty()) {
                    out += InlineRun(if (WEB_ADDRESS.matches(g[5])) linkLabel(g[5]) else g[5], bold, italic, strike = strike, link = g[6])
                } else out += InlineRun(g[5], bold, italic, strike = strike)
            }
            g[7].isNotEmpty() -> plain(g[7])
            g[8].isNotEmpty() || g[9].isNotEmpty() -> out += inlineRuns(g[8].ifEmpty { g[9] }, bold = bold, italic = true, strike = strike)
            g[10].isNotEmpty() -> out += inlineRuns(g[10], bold = bold, italic = italic, strike = true)
        }
        at = m.range.last + 1
    }
    plain(s.substring(at))
    return out
}
