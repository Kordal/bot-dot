package dev.botdot.app.answerview

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.floor
import kotlin.math.round

// What an answer view says as text, for both phones (#1626, ADR 264): the numbers of a chart as a table (its "Data"), and a
// reply with views as the plain text a Copy writes: a view is its `alt`, a table a Markdown table, as the spec says.

/** A table of a view, or of a chart's numbers: its [title], head and rows. */
data class ViewTable(val title: String?, val head: List<String>, val rows: List<List<String>>)

/** A number as it is read on a screen: whole as it is, else to two decimals. */
fun viewNumber(d: Double): String = jsNumberText(round(d * 100) / 100)

private fun JsonElement.num(): Double? = asNumber()
private fun JsonElement.obj() = this as? JsonObject
private fun JsonElement.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

/** The numbers of a table, a chart, a pie, a scatter, a histogram, a sparkline or a gauge as a table; null for any other component. */
fun ViewNode.dataTable(): ViewTable? {
    val title = text("title") ?: text("label")
    return when (type) {
        "table" -> ViewTable(title, items("columns").map { it.obj()?.text("label").orEmpty() }, items("rows").map { r -> (r as? JsonArray).orEmpty().map { it.str().orEmpty() } })
        "chart" -> {
            val series = items("series").mapNotNull { it.obj() }
            val labels = items("labels").map { it.str().orEmpty() }
            val n = series.maxOfOrNull { (it["points"] as? JsonArray)?.size ?: 0 } ?: 0
            val unit = text("unit")?.let { " ($it)" }.orEmpty()
            ViewTable(title, listOf("") + series.mapIndexed { i, s -> (s.text("label") ?: "${i + 1}") + unit },
                (0 until n).map { i -> listOf(labels.getOrNull(i) ?: "${i + 1}") + series.map { s -> (s["points"] as? JsonArray)?.getOrNull(i)?.num()?.let(::viewNumber).orEmpty() } })
        }
        "pie" -> ViewTable(title, emptyList(), items("slices").mapNotNull { it.obj() }.map { listOf(it.text("label").orEmpty(), it["value"]?.num()?.let(::viewNumber).orEmpty()) })
        "scatter" -> ViewTable(title, listOf("", text("xLabel") ?: "x", text("yLabel") ?: "y"), items("series").mapNotNull { it.obj() }.flatMapIndexed { i, s ->
            (s["points"] as? JsonArray).orEmpty().mapNotNull { it.obj() }.map { listOf(s.text("label") ?: "${i + 1}", it["x"]?.num()?.let(::viewNumber).orEmpty(), it["y"]?.num()?.let(::viewNumber).orEmpty()) }
        })
        "histogram" -> histogram(title)
        "sparkline" -> ViewTable(title, emptyList(), items("points").mapIndexed { i, v -> listOf("${i + 1}", v.num()?.let(::viewNumber).orEmpty()) })
        "gauge" -> ViewTable(title, emptyList(), listOf(listOf(number("value")?.let(::viewNumber).orEmpty() + (text("unit")?.let { " $it" }.orEmpty()), "${viewNumber(number("min") ?: 0.0)} – ${number("max")?.let(::viewNumber) ?: "100"}")))
        else -> null
    }
}

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

/** A histogram's bins: how many values fall in each, `bins` of them (10 unless it says). */
fun ViewNode.histogramBins(): List<Triple<Double, Double, Int>> {
    val values = items("values").mapNotNull { it.num() }
    if (values.isEmpty()) return emptyList()
    val bins = (number("bins") ?: 10.0).toInt().coerceIn(1, 40)
    val lo = values.min()
    val hi = values.max()
    val width = if (hi > lo) (hi - lo) / bins else 1.0
    val counts = IntArray(bins)
    for (v in values) counts[if (hi > lo) minOf(bins - 1, floor((v - lo) / width).toInt()) else 0]++
    return counts.mapIndexed { i, c -> Triple(lo + i * width, lo + (i + 1) * width, c) }
}

private fun ViewNode.histogram(title: String?) = ViewTable(title, emptyList(), histogramBins().map { (a, b, c) -> listOf("${viewNumber(a)} – ${viewNumber(b)}", "$c") })

/** A table as Markdown, its cells kept to one line each. */
fun ViewTable.markdown(): String {
    fun cell(s: String) = s.replace("|", "\\|").replace('\n', ' ')
    val head = head.ifEmpty { List(rows.maxOfOrNull { it.size } ?: 0) { "" } }
    val cols = head.size
    val out = StringBuilder()
    title?.let { out.append(it).append("\n\n") }
    out.append("| ").append(head.joinToString(" | ") { cell(it) }).append(" |\n")
    out.append("|").append(" --- |".repeat(cols))
    for (r in rows) out.append("\n| ").append((0 until cols).joinToString(" | ") { cell(r.getOrNull(it).orEmpty()) }).append(" |")
    return out.toString()
}

/** Every table of a view, in the order it is drawn. */
fun ViewNode.tables(): List<ViewTable> =
    (if (type == "table") listOfNotNull(dataTable()) else emptyList()) + children.orEmpty().flatMap { it.tables() }

/**
 * A reply as the plain text a Copy writes (and an export): the text as it is, each view as its `alt` with its tables as
 * Markdown tables under it, a fence that can't be drawn as its `alt` and its code, and a fence still being written as nothing.
 */
fun AnswerViews.copyText(reply: String, done: Boolean = true): String =
    split(reply, done).mapNotNull { part ->
        when (part) {
            is ReplyPart.Text -> part.text
            is ReplyPart.View -> (listOf(part.alt) + part.root.tables().map { it.markdown() }).joinToString("\n\n")
            is ReplyPart.Code -> listOfNotNull(part.alt.takeIf { it.isNotEmpty() }, "```ui\n${part.code}\n```").joinToString("\n\n")
            ReplyPart.Drawing -> null
        }
    }.joinToString("\n\n")
