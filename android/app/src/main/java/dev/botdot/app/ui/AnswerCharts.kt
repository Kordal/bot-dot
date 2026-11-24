package dev.botdot.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.botdot.app.answerview.ViewNode
import dev.botdot.app.answerview.ViewTable
import dev.botdot.app.answerview.dataTable
import dev.botdot.app.answerview.flag
import dev.botdot.app.answerview.histogramBins
import dev.botdot.app.answerview.number
import dev.botdot.app.answerview.text
import dev.botdot.app.answerview.viewNumber
import dev.botdot.app.data.Block
import dev.botdot.app.data.ChartBar
import dev.botdot.app.data.ChartSeries
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.max
import kotlin.math.min

/*
 * The charts of an answer view (#1626, ADR 264): line, area, bar, stacked and horizontal bars and a histogram on the block
 * kit's chart (BlockKit.kt, the same gridlines, legend and tooltip), a pie or ring, a scatter, a sparkline and a gauge.
 * A bot names a series by its number, never a colour: the series take the Paper's tokens in turn. Every chart has a "Data"
 * toggle that shows its numbers as a table, and TalkBack reads a chart as one line that says what it is and where its numbers are.
 */

/** A series' colour by its number; colour is never the only way to tell them apart (the legend names each). */
@Composable
internal fun seriesColor(i: Int): Color {
    val p = LocalPaper.current
    val base = listOf(p.mention, p.ok, p.warn, p.err, p.muted, p.dot)[i % 6]
    return if (i < 6) base else base.copy(alpha = 0.6f)
}

private val SERIES_NAMES = listOf(null, "ok", "warn", "bad", "muted", "text")

/** A chart-like component, with its source under it and its Data toggle. */
@Composable
internal fun ViewChart(n: ViewNode) {
    val p = LocalPaper.current
    var data by remember(n) { mutableStateOf(false) }
    val table = n.dataTable()
    val title = n.text("title") ?: n.text("label")
    val kind = when (n.type) {
        "chart" -> when (n.text("style")) { "area" -> tr("Area chart"); "bar" -> tr("Bar chart"); "stacked" -> tr("Stacked bar chart"); "hbar" -> tr("Horizontal bar chart"); else -> tr("Line chart") }
        "pie" -> if (n.flag("donut") == true) tr("Donut chart") else tr("Pie chart")
        "scatter" -> tr("Scatter chart")
        "histogram" -> tr("Histogram")
        "heatmap" -> tr("Heatmap")
        "sparkline" -> tr("Sparkline")
        else -> tr("Gauge")
    }
    val spoken = listOfNotNull(kind, title, table?.rows?.size?.let { trn(it, "{n} point", "{n} points") }).joinToString(", ") + ". " + tr("Data shows the numbers as a table.")
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        if (data && table != null) {
            title?.let { Text(it, color = p.muted, fontSize = Type.s12) }
            DataGrid(table)
        } else Box(Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = spoken }) { ChartBody(n) }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { SourceLine(n) }
            if (table != null) Box(
                Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp).clip(Radius.small)
                    .clickable(role = Role.Button) { data = !data }
                    .semantics { contentDescription = if (data) tr("Show the chart") else tr("Show the numbers as a table"); stateDescription = if (data) tr("Showing the numbers") else tr("Showing the chart") }
                    .padding(horizontal = Space.s12),
                contentAlignment = Alignment.Center,
            ) { Text(if (data) tr("Chart") else tr("Data"), color = p.muted, fontSize = Type.s12) }
        }
    }
}

@Composable
private fun ChartBody(n: ViewNode) {
    val p = LocalPaper.current
    when (n.type) {
        "chart" -> {
            val labels = n.strings("labels")
            val series = n.objects("series").mapIndexed { i, s -> ChartSeries(s.points(), s.text("label"), SERIES_NAMES[i % SERIES_NAMES.size]) }
            val unit = n.text("unit")
            val style = n.text("style")
            val bars = if (style == "hbar") series.firstOrNull()?.points.orEmpty().mapIndexedNotNull { i, v ->
                v?.let { ChartBar(labels.getOrNull(i) ?: "${i + 1}", viewNumber(it) + (unit?.let { u -> " $u" } ?: ""), (it / (series.first().points.filterNotNull().maxOrNull()?.takeIf { m -> m > 0 } ?: 1.0)).coerceAtLeast(0.0)) }
            } else emptyList()
            KitChart(Block(type = "chart", text = n.text("title"), unit = unit, style = style?.takeIf { it != "line" }, series = series, labels = labels, bars = bars), p.mention, axes = true)
        }
        "histogram" -> {
            val bins = n.histogramBins()
            val b = Block(type = "chart", text = n.text("title"), unit = n.text("unit"), style = "bar", series = listOf(ChartSeries(bins.map { it.third.toDouble() })), labels = bins.map { tr("{lo} to {hi}", "lo" to viewNumber(it.first), "hi" to viewNumber(it.second)) })
            KitChart(b, p.mention, axes = true)
        }
        "sparkline" -> Column(verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            n.text("label")?.let { Text(it, color = p.muted, fontSize = Type.s12) }
            val tone = toneColors(n.text("tone"))
            KitSpark(n.numbers("points").filterNotNull(), if (n.text("tone").isNeutralTone()) p.mention else tone.accent, Modifier.fillMaxWidth().height(40.dp))
        }
        "gauge" -> Gauge(n)
        "heatmap" -> HeatmapGrid(n)
        "pie" -> Pie(n)
        "scatter" -> Scatter(n)
    }
}

private fun JsonObject.points(): List<Double?> =
    (this["points"] as? JsonArray).orEmpty().map { it.let { e -> (e as? JsonPrimitive)?.takeIf { x -> !x.isString && x !is JsonNull }?.content?.toDoubleOrNull() } }

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

/** One value on a half dial between its min and max, the value in its middle. */
@Composable
private fun Gauge(n: ViewNode) {
    val p = LocalPaper.current
    val lo = n.number("min") ?: 0.0
    val hi = (n.number("max") ?: 100.0).let { if (it > lo) it else lo + 1 }
    val value = n.number("value") ?: lo
    val share = ((value - lo) / (hi - lo)).coerceIn(0.0, 1.0).toFloat()
    val tone = toneColors(n.text("tone"))
    val arc = if (n.text("tone").isNeutralTone()) p.mention else tone.accent
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        Text(n.text("label").orEmpty(), color = p.muted, fontSize = Type.s12)
        Box(Modifier.width(160.dp).height(88.dp), contentAlignment = Alignment.BottomCenter) {
            Canvas(Modifier.width(160.dp).height(88.dp)) {
                val stroke = 12.dp.toPx()
                val box = Size(size.width - stroke, (size.height - stroke / 2) * 2)
                val at = Offset(stroke / 2, stroke / 2)
                drawArc(p.sunk, 180f, 180f, false, at, box, style = Stroke(stroke, cap = StrokeCap.Round))
                if (share > 0f) drawArc(arc, 180f, 180f * share, false, at, box, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            Text(viewNumber(value) + (n.text("unit")?.let { " $it" } ?: ""), color = p.text, fontSize = Type.s20, fontWeight = FontWeight.SemiBold)
        }
        Row(Modifier.width(160.dp)) {
            Text(viewNumber(lo), color = p.faint, fontSize = Type.s12, modifier = Modifier.weight(1f))
            Text(viewNumber(hi), color = p.faint, fontSize = Type.s12)
        }
    }
}

/** Parts of a whole: slices (or a ring), and under them a line for each with its value and its share, so no slice is told by colour alone. */
@Composable
private fun Pie(n: ViewNode) {
    val p = LocalPaper.current
    val slices = n.objects("slices").map { (it.text("label").orEmpty()) to max(0.0, it.number("value") ?: 0.0) }
    val total = slices.sumOf { it.second }
    val donut = n.flag("donut") == true
    val unit = n.text("unit")?.let { " $it" }.orEmpty()
    val colors = slices.indices.map { seriesColor(it) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        n.text("title")?.let { Text(it, color = p.muted, fontSize = Type.s12) }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s16), verticalAlignment = Alignment.CenterVertically) {
            Canvas(Modifier.size(96.dp)) {
                if (total <= 0.0) return@Canvas
                var from = -90f
                val sweepGap = if (slices.size > 1) 1.5f else 0f
                slices.forEachIndexed { i, s ->
                    val sweep = (s.second / total * 360.0).toFloat()
                    if (sweep <= 0f) return@forEachIndexed
                    if (donut) {
                        val w = 18.dp.toPx()
                        drawArc(colors[i], from, max(0.5f, sweep - sweepGap), false, Offset(w / 2, w / 2), Size(size.width - w, size.height - w), style = Stroke(w))
                    } else drawArc(colors[i], from, max(0.5f, sweep - sweepGap), true, Offset.Zero, size)
                    from += sweep
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                slices.forEachIndexed { i, s ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
                        Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(colors[i]))
                        Text(s.first, color = p.text, fontSize = Type.s14, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                        Text(viewNumber(s.second) + unit + if (total > 0) ", ${viewNumber(s.second / total * 100)}%" else "", color = p.muted, fontSize = Type.s12, maxLines = 1)
                    }
                }
            }
        }
    }
}

/** Points placed by two numbers, a series to a colour, with the range of each axis at its ends. */
@Composable
private fun Scatter(n: ViewNode) {
    val p = LocalPaper.current
    val series = n.objects("series").map { s ->
        (s.text("label").orEmpty()) to (s["points"] as? JsonArray).orEmpty().mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val x = o.number("x") ?: return@mapNotNull null
            val y = o.number("y") ?: return@mapNotNull null
            x to y
        }
    }
    val all = series.flatMap { it.second }
    if (all.isEmpty()) return
    val x0 = all.minOf { it.first }; val x1 = all.maxOf { it.first }.let { if (it > x0) it else x0 + 1 }
    val y0 = all.minOf { it.second }; val y1 = all.maxOf { it.second }.let { if (it > y0) it else y0 + 1 }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
        n.text("title")?.let { Text(it, color = p.muted, fontSize = Type.s12) }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
            series.forEachIndexed { i, s -> if (s.first.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(seriesColor(i))); Text(" ${s.first}", color = p.muted, fontSize = Type.s12) } }
        }
        val grid = p.line2
        val colors = series.indices.map { seriesColor(it) }
        Canvas(Modifier.fillMaxWidth().height(120.dp)) {
            val dash = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx()))
            listOf(0f, 0.5f, 1f).forEach { f -> drawLine(grid, Offset(0f, f * size.height), Offset(size.width, f * size.height), 1f, pathEffect = dash) }
            val r = 4.dp.toPx()
            series.forEachIndexed { i, s ->
                s.second.forEach { (x, y) ->
                    drawCircle(colors[i], r, Offset(r + ((x - x0) / (x1 - x0)).toFloat() * (size.width - 2 * r), size.height - r - ((y - y0) / (y1 - y0)).toFloat() * (size.height - 2 * r)))
                }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            Text(listOfNotNull(n.text("xLabel"), viewNumber(x0)).joinToString(" "), color = p.faint, fontSize = Type.s12, modifier = Modifier.weight(1f))
            Text(listOfNotNull(viewNumber(x1)).joinToString(" "), color = p.faint, fontSize = Type.s12)
        }
        Text(listOfNotNull(n.text("yLabel"), tr("{lo} to {hi}", "lo" to viewNumber(y0), "hi" to viewNumber(y1))).joinToString(": "), color = p.faint, fontSize = Type.s12)
    }
}

/** A chart's numbers as a table: its rows under their headings, scrolling sideways when there are many columns. */
@Composable
internal fun DataGrid(t: ViewTable) {
    val p = LocalPaper.current
    val cols = max(t.head.size, t.rows.maxOfOrNull { it.size } ?: 0)
    if (cols == 0) return
    val wide = cols > 4
    val scroll = if (wide) Modifier.horizontalScroll(rememberScrollState()) else Modifier
    Column(Modifier.fillMaxWidth().then(scroll).background(p.sunk.copy(alpha = 0.6f), Radius.small).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        if (t.head.any { it.isNotEmpty() }) Row { t.head.forEachIndexed { c, h -> GridCell(h, c, wide, header = true) } }
        t.rows.forEach { row ->
            val spoken = row.mapIndexed { c, v -> (t.head.getOrNull(c)?.takeIf { it.isNotEmpty() }?.let { "$it: " }.orEmpty()) + v }.joinToString(", ")
            Row(Modifier.semantics(mergeDescendants = true) { contentDescription = spoken }) { (0 until cols).forEach { c -> GridCell(row.getOrNull(c).orEmpty(), c, wide, header = false) } }
        }
    }
}

@Composable
private fun RowScope.GridCell(text: String, column: Int, wide: Boolean, header: Boolean) {
    val p = LocalPaper.current
    Text(
        text, color = if (header) p.muted else p.text, fontSize = Type.s14, fontWeight = if (header) FontWeight.SemiBold else null,
        textAlign = if (column == 0) TextAlign.Start else TextAlign.End, maxLines = 2,
        modifier = (if (wide) Modifier.width(if (column == 0) 96.dp else 72.dp) else Modifier.weight(1f)).padding(end = Space.s8),
    )
}
