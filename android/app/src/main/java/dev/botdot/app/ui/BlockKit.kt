package dev.botdot.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.Block
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Tile
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToInt

/*
 * The block kit (like the web page's public/blocks.js): a kpi (a number with its change, a sparkline and a bar), a
 * chart (line, area, bar, stacked, horizontal bars, with gridlines, a legend and a tooltip on tap), status pills and a
 * callout. lib/tile-blocks.js fills them in; this only draws them. And what the Board draws with them (#394).
 */
object BoardKit {
    private val CLOCK = DateTimeFormatter.ofPattern("HH:mm")

    /** A time as the owner's clock shows it: "08:00". */
    fun clock(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).format(CLOCK)

    fun num(n: Double): String = ((n * 100).roundToInt() / 100.0).let { if (it == floor(it)) it.toLong().toString() else it.toString() }

    /** "3s ago", "2 min ago", "2 h ago": the age of a value, as the web page says it. */
    fun ageWords(secs: Long): String {
        val s = maxOf(0L, secs)
        return when { s < 60 -> "${s}s"; s < 3600 -> "${s / 60} min"; else -> "${s / 3600} h" } + " ago"
    }

    /** When the newest value came, in epoch ms; 0 while none has. */
    fun newestAt(tiles: List<Tile>): Long = tiles.maxOfOrNull { t -> t.at?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: 0L } ?: 0L

    /** A tile whose face is one number (a value or a kpi): a kpi's head; a small one goes two across on a phone. */
    fun isKpiTile(t: Tile): Boolean = t.kind != "group" && t.look?.face?.singleOrNull()?.type in setOf("value", "kpi")

    /** A switch or a button as it comes (no blocks of its own): a row of a Controls box. */
    fun isControlRow(t: Tile): Boolean = t.kind in setOf("switch", "button") && t.look?.face.orEmpty().isEmpty() && t.size == "small" && !t.wide

    /** Beside a heading: the bots its tiles come from. */
    fun sectionBots(tiles: List<Tile>, bots: List<Bot>): String = tiles.mapNotNull { t -> bots.firstOrNull { it.id == t.bot }?.name }.distinct().joinToString(", ")

    /** Where a heading's tiles' values come from, when that is one for all of them (its end then says how long ago they read); else "". */
    fun sectionSource(tiles: List<Tile>): String = tiles.mapNotNull { it.source }.distinct().singleOrNull() ?: ""

    /** How a number changed: "▲ 0.8 since 08:00", or "" when it doesn't say. */
    fun deltaLine(b: Block, clock: (Long) -> String = ::clock): String {
        val d = b.delta ?: return ""
        val arrow = when (d.dir) { "up" -> "▲"; "down" -> "▼"; else -> "–" }
        val since = b.since?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }?.let { " since ${clock(it)}" } ?: ""
        return "$arrow ${d.text}$since"
    }

    /** How many columns a tile takes in a grid of [cols]: a kpi two across on a phone, the rest one across there. */
    fun span(t: Tile, cols: Int): Int = when {
        t.size == "row" -> cols
        t.size == "wide" || t.size == "big" || t.wide -> minOf(2, cols)
        cols <= 2 && isKpiTile(t) -> 1
        cols <= 2 -> cols
        else -> 1
    }

    /** The columns of the Board at a width in dp: four wide, three on a tablet, two on a phone. */
    fun columns(widthDp: Float): Int = when { widthDp >= 840 -> 4; widthDp >= 600 -> 3; else -> 2 }

    /** Whether blocks have Markdown text in them (a note): a value a bot wrote shows "written by AI" there. */
    fun hasMarkdown(list: List<Block>): Boolean = list.any { (it.type == "text" && it.markdown) || hasMarkdown(it.blocks) }

    fun level(l: String?): String = if (l in setOf("ok", "warn", "err", "info", "plan")) l!! else "info"
}

private val VIOLET = Color(0xFF8B7CF6)

/** A level's colours: its words and its soft background. */
@Composable
private fun levelColors(level: String?): Pair<Color, Color> {
    val p = LocalPaper.current
    return when (BoardKit.level(level)) {
        "ok" -> p.okText to p.okSoft
        "warn" -> p.warnText to p.warnSoft
        "err" -> p.err to p.errSoft
        "plan" -> p.muted to p.sunk
        else -> p.mention to p.mention.copy(alpha = 0.14f)
    }
}

@Composable
fun KitStatus(b: Block) {
    val (fg, bg) = levelColors(b.level)
    Row(Modifier.clip(RoundedCornerShape(99.dp)).background(bg).padding(horizontal = 10.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(fg))
        Spacer(Modifier.size(6.dp))
        Text(b.text.orEmpty(), color = fg, fontSize = 12.sp, maxLines = 1)
    }
}

@Composable
fun KitCallout(b: Block) {
    val p = LocalPaper.current
    val lv = BoardKit.level(b.level)
    val (fg, bg) = if (lv == "info" || lv == "plan") p.text to p.sunk else levelColors(lv)
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(bg).border(1.dp, if (lv == "info" || lv == "plan") p.line2 else fg.copy(alpha = 0.3f), shape).padding(horizontal = 14.dp, vertical = 10.dp)) {
        b.title?.let { Text(it, color = fg, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold) }
        MarkdownText(b.text.orEmpty(), color = p.text, copy = false)
    }
}

/** A sparkline: the line, and the area under it, faint. */
@Composable
fun KitSpark(points: List<Double>, color: Color, modifier: Modifier) {
    if (points.size < 2) return
    Canvas(modifier) {
        val lo = points.min(); val span = (points.max() - lo).takeIf { it > 0 } ?: 1.0
        val line = Path()
        val area = Path()
        points.forEachIndexed { i, v ->
            val x = size.width * i / (points.size - 1)
            val y = size.height - 2.dp.toPx() - ((v - lo) / span).toFloat() * (size.height - 4.dp.toPx())
            if (i == 0) { line.moveTo(x, y); area.moveTo(x, size.height); area.lineTo(x, y) } else { line.lineTo(x, y); area.lineTo(x, y) }
        }
        area.lineTo(size.width, size.height); area.close()
        drawPath(area, color.copy(alpha = 0.14f))
        drawPath(line, color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/**
 * A kpi: the number big with its unit and "of N", the line under it (its change, or what `sub` says), a sparkline
 * beside it (not when [compact]: half a phone's width) and a bar under it. A value with its recent values is drawn the same.
 * [small]: a card of the strip over the keys (#397): a smaller number, its sparkline under it.
 */
@Composable
fun KitKpi(b: Block, color: Color, compact: Boolean, small: Boolean = false) {
    val p = LocalPaper.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                b.label?.let { Text(it, color = p.muted, fontSize = 12.5.sp) }
                Text(buildAnnotatedString {
                    append(b.text?.ifEmpty { "·" } ?: "·")
                    b.unit?.let { withStyle(SpanStyle(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = p.faint)) { append(" $it") } }
                    b.of?.let { withStyle(SpanStyle(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = p.faint)) { append("  of $it") } }
                }, color = if (b.type == "value" && b.color != null) tint(b.color, p.text, words = true) else p.text, fontSize = if (small) 22.sp else 30.sp, fontWeight = FontWeight.SemiBold, lineHeight = if (small) 26.sp else 34.sp, maxLines = if (small) 1 else 2, overflow = TextOverflow.Ellipsis)
                b.delta?.let { d ->
                    Text(BoardKit.deltaLine(b), fontSize = 12.5.sp, color = when (d.good) { true -> p.okText; false -> p.err; null -> p.faint })
                }
                b.sub?.let { Text(it, fontSize = 12.5.sp, color = tint(b.subColor, p.muted, words = true)) }
            }
            if (b.points.size >= 2 && !compact) {
                Spacer(Modifier.size(12.dp))
                KitSpark(b.points, color, Modifier.weight(1f).height(44.dp))
            }
        }
        if (small && b.points.size >= 2) KitSpark(b.points, color, Modifier.fillMaxWidth().height(22.dp))
        b.ratio?.let { r ->
            Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(99.dp)).background(p.sunk)) {
                Box(Modifier.fillMaxWidth(r.toFloat().coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(99.dp)).background(color))
            }
        }
    }
}

/** A chart's series as drawn: from `series`, or (one line, or an older server) from `points` and `color`. */
private class Line(val label: String, val color: Color, val points: List<Double?>)

/** A chart. [axes]: the numbers of its axes (not on a small tile's face; the tooltip says them). A tap or a drag shows the tooltip. */
@Composable
fun KitChart(b: Block, color: Color, axes: Boolean) {
    val p = LocalPaper.current
    val palette = listOf(p.mention, p.ok, p.warn, VIOLET)
    val lines = if (b.series.isNotEmpty()) b.series.mapIndexed { i, s -> Line(s.label.orEmpty(), if (s.color != null) tint(s.color, color) else if (i == 0) color else palette[(i - 1) % palette.size], s.points) }
        else listOf(Line("", color, b.points))
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (b.text != null || lines.any { it.label.isNotEmpty() }) Row(verticalAlignment = Alignment.CenterVertically) {
            Text(b.text.orEmpty(), color = p.muted, fontSize = 12.5.sp, modifier = Modifier.weight(1f))
            lines.filter { it.label.isNotEmpty() }.forEach { l ->
                Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(l.color))
                Text(" ${l.label}", color = p.muted, fontSize = 12.sp, modifier = Modifier.padding(end = 10.dp))
            }
        }
        if (b.style == "hbar") {
            if (b.bars.isEmpty()) Text("·", color = p.faint)
            b.bars.forEach { bar ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(bar.label, color = p.text, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(0.35f))
                    Box(Modifier.weight(0.5f).height(8.dp).clip(RoundedCornerShape(99.dp)).background(p.sunk)) {
                        Box(Modifier.fillMaxWidth(bar.ratio.toFloat().coerceIn(0f, 1f)).height(8.dp).clip(RoundedCornerShape(99.dp)).background(color))
                    }
                    Text(bar.text, color = p.muted, fontSize = 12.sp, fontFamily = GeistMono, modifier = Modifier.padding(start = 10.dp))
                }
            }
            return@Column
        }
        val n = lines.maxOf { it.points.size }
        val bars = b.style == "bar" || b.style == "stacked"
        if (n < 2 && !(n == 1 && bars)) { Text("·", color = p.faint); return@Column }
        val vals = lines.flatMap { it.points }.filterNotNull()
        if (vals.isEmpty()) { Text("·", color = p.faint); return@Column }
        var lo = vals.min(); var hi = vals.max()
        if (b.style == "stacked") { lo = 0.0; hi = (0 until n).maxOf { i -> lines.sumOf { it.points.getOrNull(i) ?: 0.0 } } }
        if (bars) lo = minOf(lo, 0.0)
        if (hi == lo) { hi += 1; if (!bars) lo -= 1 }
        val names = (0 until n).map { i -> b.labels.getOrNull(i) ?: b.times.getOrNull(i)?.let(BoardKit::clock) ?: "" }
        val unit = b.unit?.let { " $it" } ?: ""
        var picked by remember(b) { mutableStateOf<Int?>(null) }
        val grid = p.line2
        val cursor = p.line2
        val pad = if (axes) 34.dp else 0.dp
        BoxWithConstraints(Modifier.fillMaxWidth().height(if (axes) 120.dp else 72.dp)) {
            val plotWidth = maxWidth - pad
            fun index(x: Float, w: Float): Int = if (bars) (x / w * n).toInt().coerceIn(0, n - 1) else (x / w * (n - 1)).roundToInt().coerceIn(0, n - 1)
            Canvas(
                Modifier.padding(start = pad).fillMaxSize()
                    .pointerInput(n, bars) { detectTapGestures { o -> picked = index(o.x, size.width.toFloat()) } }
                    .pointerInput(n, bars) { detectHorizontalDragGestures { change, _ -> change.consume(); picked = index(change.position.x, size.width.toFloat()) } },
            ) {
                val h = size.height
                fun y(v: Double) = (h - (v - lo) / (hi - lo) * h).toFloat()
                val dash = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx()))
                listOf(0f, 0.5f, 1f).forEach { f -> drawLine(grid, Offset(0f, f * h), Offset(size.width, f * h), 1f, pathEffect = dash) }
                if (bars) {
                    val w = size.width / n
                    val gap = minOf(w * 0.25f, 4.dp.toPx())
                    for (i in 0 until n) {
                        var base = 0.0
                        lines.forEachIndexed { k, l ->
                            val v = l.points.getOrNull(i) ?: return@forEachIndexed
                            if (b.style == "stacked") {
                                drawRect(l.color, Offset(i * w + gap / 2, y(base + v)), Size(w - gap, y(base) - y(base + v))); base += v
                            } else {
                                val bw = (w - gap) / lines.size
                                drawRect(l.color, Offset(i * w + gap / 2 + k * bw, y(maxOf(v, 0.0))), Size(bw, abs(y(v) - y(0.0))))
                            }
                        }
                    }
                } else lines.forEach { l ->
                    var path: Path? = null
                    l.points.forEachIndexed { i, v ->
                        if (v == null) { path?.let { drawPath(it, l.color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)) }; path = null; return@forEachIndexed }
                        val x = size.width * i / (n - 1)
                        path = (path ?: Path().also { it.moveTo(x, y(v)) }).also { it.lineTo(x, y(v)) }
                    }
                    path?.let { drawPath(it, l.color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)) }
                }
                picked?.let { i ->
                    val x = if (bars) (i + 0.5f) / n * size.width else size.width * i / (n - 1)
                    drawLine(cursor, Offset(x, 0f), Offset(x, h), 1.dp.toPx())
                }
            }
            if (axes) {
                Text(BoardKit.num(hi) + unit, color = p.faint, fontSize = 10.5.sp, fontFamily = GeistMono, modifier = Modifier.align(Alignment.TopStart).width(30.dp))
                Text(BoardKit.num(lo) + unit, color = p.faint, fontSize = 10.5.sp, fontFamily = GeistMono, modifier = Modifier.align(Alignment.BottomStart).width(30.dp))
            }
            picked?.let { i ->
                val density = LocalDensity.current
                val frac = if (bars) (i + 0.5f) / n else if (n > 1) i.toFloat() / (n - 1) else 0f
                val words = lines.mapNotNull { l -> l.points.getOrNull(i)?.let { v -> (if (l.label.isNotEmpty()) "${l.label} " else "") + BoardKit.num(v) + unit } }.joinToString(" · ")
                val tipWidth = 150.dp
                val x = (pad + plotWidth * frac - tipWidth / 2).coerceIn(0.dp, maxOf(0.dp, maxWidth - tipWidth))
                Column(
                    Modifier.offset { IntOffset(with(density) { x.roundToPx() }, 0) }.width(tipWidth).clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFF1C1C1C)).border(1.dp, p.line2, RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 6.dp),
                ) {
                    names.getOrNull(i)?.takeIf { it.isNotEmpty() }?.let { Text(it, color = p.text, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold) }
                    Text(words.ifEmpty { "·" }, color = p.text, fontSize = 12.sp)
                }
            }
        }
        val ends = when { b.labels.isNotEmpty() -> b.labels.first() to b.labels.last(); b.times.isNotEmpty() -> BoardKit.clock(b.times.first()) to BoardKit.clock(b.times.last()); else -> null }
        if (axes && ends != null) Row(Modifier.fillMaxWidth().padding(start = pad)) {
            Text(ends.first, color = p.faint, fontSize = 10.5.sp, fontFamily = GeistMono, modifier = Modifier.weight(1f))
            Text(ends.second, color = p.faint, fontSize = 10.5.sp, fontFamily = GeistMono)
        }
    }
}
