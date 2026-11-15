package dev.botdot.app.data

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
                    a.n != null && c.n != null -> a.n!!.compareTo(c.n!!)
                    (a.n != null) != (c.n != null) -> if (a.n != null) -1 else 1
                    else -> a.text.compareTo(c.text, ignoreCase = true)
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
