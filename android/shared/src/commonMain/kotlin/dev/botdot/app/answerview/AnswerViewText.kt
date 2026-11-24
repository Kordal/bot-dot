package dev.botdot.app.answerview

import dev.botdot.app.data.tr
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
    val unit = text("unit")?.let { " $it" }.orEmpty()
    fun n(e: JsonElement?, suffix: String = ""): String = e?.num()?.let { viewNumber(it) + suffix }.orEmpty()
    return when (type) {
        "table" -> ViewTable(title, items("columns").map { it.obj()?.text("label").orEmpty() }, items("rows").map { r -> (r as? JsonArray).orEmpty().map { it.str().orEmpty() } })
        "chart" -> {
            val series = items("series").mapNotNull { it.obj() }
            val labels = items("labels").map { it.str().orEmpty() }
            val len = series.maxOfOrNull { (it["points"] as? JsonArray)?.size ?: 0 } ?: 0
            ViewTable(title, listOf("") + series.mapIndexed { i, s -> s.text("label")?.takeIf { it.isNotEmpty() } ?: if (series.size > 1) tr("Series {n}", "n" to i + 1) else tr("Value") },
                (0 until len).map { i -> listOf(labels.getOrNull(i) ?: "${i + 1}") + series.map { s -> n((s["points"] as? JsonArray)?.getOrNull(i), unit) } })
        }
        "pie" -> {
            val slices = items("slices").mapNotNull { it.obj() }
            val total = slices.sumOf { it["value"]?.num() ?: 0.0 }
            ViewTable(title, listOf("", tr("Value"), "%"), slices.map { listOf(it.text("label").orEmpty(), n(it["value"], unit), if (total != 0.0) viewNumber((it["value"]?.num() ?: 0.0) / total * 100) + "%" else "") })
        }
        "scatter" -> {
            val series = items("series").mapNotNull { it.obj() }
            val many = series.size > 1
            ViewTable(title, listOf(if (many) tr("Series") else "", text("xLabel") ?: "x", text("yLabel") ?: "y"), series.flatMapIndexed { i, s ->
                (s["points"] as? JsonArray).orEmpty().mapNotNull { it.obj() }.map { listOf(if (many) s.text("label")?.takeIf { l -> l.isNotEmpty() } ?: tr("Series {n}", "n" to i + 1) else "", n(it["x"]), n(it["y"])) }
            })
        }
        "histogram" -> ViewTable(title, listOf(tr("Range"), tr("Count")), histogramBins().map { (a, b, c) -> listOf(tr("{lo} to {hi}", "lo" to viewNumber(a), "hi" to viewNumber(b)) + unit, "$c") })
        "sparkline" -> ViewTable(title, listOf("", text("label") ?: tr("Value")), items("points").mapIndexed { i, v -> listOf("${i + 1}", n(v)) })
        "gauge" -> ViewTable(title, listOf(text("label") ?: tr("Value"), tr("Minimum"), tr("Maximum")), listOf(listOf(n(props["value"]) + (text("unit")?.let { " $it" }.orEmpty()), viewNumber(number("min") ?: 0.0), viewNumber(number("max") ?: 100.0))))
        else -> null
    }
}

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

/**
 * A histogram's bins: how many values fall in each, `bins` of them (10 unless it says), the last closed at the top; all
 * values equal make one bin, from that value to itself.
 */
fun ViewNode.histogramBins(): List<Triple<Double, Double, Int>> {
    val values = items("values").mapNotNull { it.num() }
    if (values.isEmpty()) return emptyList()
    val lo = values.min()
    val hi = values.max()
    if (hi == lo) return listOf(Triple(lo, hi, values.size))
    val bins = (number("bins") ?: 10.0).toInt().coerceIn(1, 40)
    val width = (hi - lo) / bins
    val counts = IntArray(bins)
    for (v in values) counts[minOf(bins - 1, floor((v - lo) / width).toInt())]++
    return counts.mapIndexed { i, c -> Triple(lo + i * width, if (i == bins - 1) hi else lo + (i + 1) * width, c) }
}

/** A table as Markdown, its cells kept to one line each. */
fun ViewTable.markdown(): String {
    fun cell(s: String) = s.replace("|", "\\|").replace('\n', ' ')
    val head = head.ifEmpty { List(rows.maxOfOrNull { it.size } ?: 0) { "" } }
    val cols = head.size
    val out = StringBuilder()
    title?.let { out.append("**").append(it).append("**\n\n") }
    out.append("| ").append(head.joinToString(" | ") { cell(it) }).append(" |\n")
    out.append("|").append(" --- |".repeat(cols))
    for (r in rows) out.append("\n| ").append((0 until cols).joinToString(" | ") { cell(r.getOrNull(it).orEmpty()) }).append(" |")
    return out.toString()
}

/** Every table of a view, and the numbers of its charts, in the order they are drawn. */
fun ViewNode.tables(): List<ViewTable> = listOfNotNull(dataTable()?.takeIf { it.rows.isNotEmpty() }) + children.orEmpty().flatMap { it.tables() }

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
