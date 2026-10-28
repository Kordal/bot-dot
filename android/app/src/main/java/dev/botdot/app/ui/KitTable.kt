package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.Block
import dev.botdot.app.data.TableCell
import dev.botdot.app.data.TableSort
import dev.botdot.app.data.tr

/*
 * A table (#396; the web page's kitTable in public/blocks.js): the owner sorts it by a column's header, searches it and
 * filters it on one column, here on the phone, and it pages its rows ("10 of 58"). On a phone it is a list: the first
 * column as the title, a reference under it, a status pill on the right. lib/tile-blocks.js tableOf fills it in.
 */
object KitTable {
    /** What the owner sees: the page of rows, how many match, how many in all, the page and the pages, and the sort it has. */
    data class View(val rows: List<List<TableCell>>, val matching: Int, val total: Int, val page: Int, val pages: Int, val sort: TableSort?)

    fun view(b: Block, sort: TableSort?, query: String, filter: String, page: Int): View {
        var rows = b.rows.withIndex().toList()
        val f = b.filter?.takeIf { fl -> filter.isNotEmpty() && fl.options.any { it.equals(filter, ignoreCase = true) } }
        if (f != null) rows = rows.filter { it.value.getOrNull(f.column)?.text.orEmpty().equals(filter, ignoreCase = true) }
        val q = query.trim()
        if (q.isNotEmpty()) rows = rows.filter { r -> r.value.any { it.text.contains(q, ignoreCase = true) } }
        val s = sort?.takeIf { it.column in b.head.indices } ?: b.sort?.takeIf { it.column in b.head.indices }
        if (s != null) {
            val k = s.column
            val dir = if (s.dir == "desc") -1 else 1
            rows = rows.sortedWith { x, y ->
                val a = x.value.getOrNull(k) ?: TableCell()
                val c = y.value.getOrNull(k) ?: TableCell()
                // An empty cell goes last either way.
                if (a.text.isEmpty() != c.text.isEmpty()) return@sortedWith if (a.text.isNotEmpty()) -1 else 1
                val d = when {
                    a.n != null && c.n != null -> a.n.compareTo(c.n)
                    (a.n != null) != (c.n != null) -> if (a.n != null) -1 else 1
                    else -> String.CASE_INSENSITIVE_ORDER.compare(a.text, c.text)
                }
                (d * dir).takeIf { it != 0 } ?: (x.index - y.index)
            }
        }
        val size = (b.pageSize ?: 10).coerceAtLeast(1)
        val pages = maxOf((rows.size + size - 1) / size, 1)
        val at = page.coerceIn(0, pages - 1)
        return View(rows.drop(at * size).take(size).map { it.value }, rows.size, b.rows.size, at, pages, s)
    }

    /** The sort after a tap on a column's header: that column up, or down when it was up. */
    fun next(now: TableSort?, column: Int): TableSort = TableSort(column, if (now?.column == column && now.dir != "desc") "desc" else "asc")

    /** The footer's words: "2 of 3", "2 of 2 · 4 in all". */
    fun count(v: View): String = tr("{shown} of {matching}", "shown" to v.rows.size, "matching" to v.matching) + if (v.matching != v.total) " · " + tr("{total} in all", "total" to v.total) else ""

    /** On a phone: the list's line under a row's title (its first reference) and its pill (its first status), by column. */
    fun listColumns(b: Block): Pair<Int?, Int?> =
        b.head.indexOfFirst { it.type == "ref" }.takeIf { it > 0 } to b.head.indexOfFirst { it.type == "status" }.takeIf { it > 0 }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KitTableView(b: Block) {
    val p = LocalPaper.current
    // What the owner chose stays when the table is drawn again with new rows (a live value, the Board's refresh).
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(0) }
    var sortCol by rememberSaveable { mutableIntStateOf(-1) }
    var sortDir by rememberSaveable { mutableStateOf("asc") }
    val sort = if (sortCol >= 0) TableSort(sortCol, sortDir) else null
    val v = remember(b, sort, query, filter, page) { KitTable.view(b, sort, query, filter, page) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            b.text?.let { Text(it, color = p.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
            Text("${b.rows.size}", color = p.faint, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
        }
        if (b.search) BasicTextField(query, { query = it; page = 0 }, singleLine = true, textStyle = TextStyle(color = p.text, fontSize = 13.5.sp), cursorBrush = SolidColor(p.text),
            modifier = Modifier.fillMaxWidth().border(1.dp, p.line2, RoundedCornerShape(99.dp)).padding(horizontal = 14.dp, vertical = 8.dp),
            decorationBox = { inner -> if (query.isEmpty()) Text(tr("Search"), color = p.faint, fontSize = 13.5.sp); inner() })
        b.filter?.let { f ->
            val on = f.options.firstOrNull { it.equals(filter, ignoreCase = true) }.orEmpty()
            FlowRow(Modifier.border(1.dp, p.line2, RoundedCornerShape(99.dp)).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                (listOf("") + f.options).forEach { o ->
                    Text(o.ifEmpty { tr("All") }, color = if (o.equals(on, ignoreCase = true)) p.text else p.muted, fontSize = 12.5.sp,
                        modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(if (o.equals(on, ignoreCase = true)) p.sunk else androidx.compose.ui.graphics.Color.Transparent)
                            .clickable { filter = o; page = 0 }.padding(horizontal = 12.dp, vertical = 4.dp))
                }
            }
        }
        when {
            b.rows.isEmpty() -> Text(tr("No rows"), color = p.faint, fontSize = 13.sp)
            v.matching == 0 -> Text(tr("Nothing matches"), color = p.faint, fontSize = 13.sp)
            else -> BoxWithConstraints {
                if (maxWidth < 560.dp) TableList(b, v) else TableGrid(b, v) { col -> KitTable.next(sort ?: b.sort, col).let { sortCol = it.column; sortDir = it.dir; page = 0 } }
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(KitTable.count(v), color = p.faint, fontSize = 12.sp, modifier = Modifier.weight(1f))
            if (v.pages > 1) {
                Text("‹", color = if (v.page > 0) p.text else p.faint, fontSize = 16.sp, modifier = Modifier.clickable(enabled = v.page > 0) { page = v.page - 1 }.padding(horizontal = 10.dp))
                Text("${v.page + 1} / ${v.pages}", color = p.faint, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                Text("›", color = if (v.page < v.pages - 1) p.text else p.faint, fontSize = 16.sp, modifier = Modifier.clickable(enabled = v.page < v.pages - 1) { page = v.page + 1 }.padding(horizontal = 10.dp))
            }
        }
    }
}

private val RIGHT = setOf("number", "date")

@Composable
private fun TableGrid(b: Block, v: KitTable.View, onSort: (Int) -> Unit) {
    val p = LocalPaper.current
    val weight = { i: Int -> if (i == 0) 2f else 1f }
    Column {
        Row(Modifier.fillMaxWidth()) {
            b.head.forEachIndexed { i, h ->
                val on = v.sort?.column == i
                val arrow = if (!on) "" else if (v.sort?.dir == "desc") " ▼" else " ▲"
                Text(h.label + arrow, color = if (on) p.text else p.faint, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    textAlign = if (h.type in RIGHT) TextAlign.End else TextAlign.Start,
                    modifier = Modifier.weight(weight(i)).clickable { onSort(i) }.padding(horizontal = 10.dp, vertical = 8.dp))
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(p.line2))
        v.rows.forEach { r ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                b.head.forEachIndexed { i, h ->
                    Box(Modifier.weight(weight(i)).padding(horizontal = 10.dp, vertical = 6.dp), contentAlignment = if (h.type in RIGHT) Alignment.CenterEnd else Alignment.CenterStart) {
                        TableCellView(r.getOrNull(i) ?: TableCell(), h.type, soft = i > 0)
                    }
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(p.line))
        }
    }
}

@Composable
private fun TableList(b: Block, v: KitTable.View) {
    val p = LocalPaper.current
    val (ref, stat) = KitTable.listColumns(b)
    Column {
        v.rows.forEach { r ->
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(r.firstOrNull()?.text.orEmpty(), color = p.text, fontSize = 13.5.sp)
                    ref?.let { i -> r.getOrNull(i)?.takeIf { it.text.isNotEmpty() }?.let { TableCellView(it, "ref", soft = false, small = true) } }
                }
                stat?.let { i -> r.getOrNull(i)?.takeIf { it.text.isNotEmpty() }?.let { KitStatus(Block(type = "status", text = it.text, level = it.level)) } }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(p.line))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TableCellView(c: TableCell, type: String, soft: Boolean, small: Boolean = false) {
    val p = LocalPaper.current
    if (c.text.isEmpty()) return
    when (type) {
        "status" -> KitStatus(Block(type = "status", text = c.text, level = c.level))
        "ref" -> {
            val uri = LocalUriHandler.current
            val refs = c.refs.ifEmpty { listOf(dev.botdot.app.data.TableRef(c.text)) }
            FlowRow(itemVerticalAlignment = Alignment.CenterVertically) {
                refs.forEachIndexed { i, r ->
                    if (i > 0) Text(" · ", color = p.faint, fontSize = if (small) 11.5.sp else 12.sp, fontFamily = FontFamily.Monospace)
                    val url = r.url?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
                    Text(r.text, color = p.mention, fontSize = if (small) 11.5.sp else 12.sp, fontFamily = FontFamily.Monospace,
                        modifier = if (url != null) Modifier.clickable { runCatching { uri.openUri(url) } } else Modifier)
                }
            }
        }
        else -> Text(c.text, color = if (soft) p.muted else p.text, fontSize = if (soft) 12.5.sp else 13.5.sp)
    }
}
