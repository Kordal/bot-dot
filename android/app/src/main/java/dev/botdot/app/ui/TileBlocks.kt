package dev.botdot.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * A tile's blocks (lib/tile-blocks.js on the server, like the web page's): what shows on a tile (its face)
 * and in the pop-up a tap opens (its panel). botdot fills them in; this only draws them. where: "panel", or a face:
 * "face" (a small tile), "wide" (a bigger one: a chart with its axes) or "compact" (half a phone's width: no sparkline).
 */

/** What the blocks can do. act: a control was used (done: false while the colour wheel is still being dragged). */
class TileControls(
    val act: (key: String, value: JsonElement?, done: Boolean) -> Unit,
    val openColor: (key: String) -> Unit,
    val openChat: (() -> Unit)?,
    val chatName: String?,
    val chatColor: String?,
    val chatOutfit: JsonElement?,
    /** A picture's full address, from its image block's src (an API path). */
    val imageUrl: (String) -> String?,
)

/** A colour from a tile's look: "#rrggbb", a theme name, or none (the tile's own colour). [words] takes ok's and warn's text shades. */
@Composable
fun tint(c: String?, fallback: Color, words: Boolean = false): Color {
    val p = LocalPaper.current
    return when (c) {
        null, "", "bot" -> fallback
        "ok" -> if (words) p.okText else p.ok
        "warn" -> if (words) p.warnText else p.warn
        "bad" -> p.err
        "faint" -> p.faint
        "muted" -> p.muted
        "text" -> p.text
        else -> parseColor(c, fallback)
    }
}

/** A tile's dot: filled when on, a ring when off, faint while it isn't known. Big on a switch or a light. */
@Composable
fun TileDotView(filled: Boolean?, color: Color, big: Boolean) {
    val p = LocalPaper.current
    val fill by animateColorAsState(if (filled == true) color else Color.Transparent, tween(200), label = "dot")
    Box(
        Modifier.size(if (big) 30.dp else 10.dp).alpha(if (filled == null) 0.5f else 1f).clip(CircleShape).background(fill)
            .then(if (filled != true) Modifier.border(if (big) 2.dp else 1.5.dp, p.line2, CircleShape) else Modifier),
    )
}

@Composable
fun Blocks(list: List<Block>, color: Color, where: String, ctl: TileControls, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(if (where == "panel") 18.dp else 8.dp)) {
        list.forEach { BlockView(it, color, where, ctl) }
    }
}

@Composable
private fun Faint() = Text("·", color = LocalPaper.current.faint)

private fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull
private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
private fun fmt(n: Double): String = ((n * 100).roundToInt() / 100.0).let { if (it == it.toLong().toDouble()) it.toLong().toString() else it.toString() }
private fun sliderText(b: Block, v: Double) = if (b.percent) "${(((v - b.min) / (b.max - b.min)) * 100).roundToInt()} %" else fmt(v) + (b.unit?.let { " $it" } ?: "")
/** Markdown, flattened for a few lines on a tile. */
private fun plain(md: String) = md.replace("**", "").replace(Regex("(?m)^\\s*[-*#]+\\s+"), "").replace(Regex("\\n\\s*\\n+"), "\n").trim()

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BlockView(b: Block, color: Color, where: String, ctl: TileControls) {
    val p = LocalPaper.current
    when (b.type) {
        "text" -> {
            val t = b.text.orEmpty()
            val size = when (b.size) { "small" -> 12.sp; "large" -> 18.sp; else -> 13.5.sp }
            when {
                t.isEmpty() -> Faint()
                b.markdown && b.lines == null -> MarkdownText(t, color = if (b.muted) p.muted else p.text, copy = false)
                else -> Text(if (b.markdown) plain(t) else t, color = if (b.muted) p.muted else p.text, fontSize = size, lineHeight = size * 1.45f,
                    fontWeight = if (b.size == "large") FontWeight.SemiBold else null, maxLines = b.lines ?: Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
            }
        }
        // With its recent values (a value tile's own number): drawn as a kpi, its change and a sparkline beside it.
        "value" -> if (b.points.size >= 2 || b.delta != null) KitKpi(b, tint(b.color, color), compact = where == "compact") else {
            val t = b.text.orEmpty()
            if (t.isEmpty()) Faint()
            else Text(buildAnnotatedString {
                append(t)
                b.unit?.let { withStyle(SpanStyle(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = p.muted)) { append(" $it") } }
            }, color = tint(b.color, p.text, words = true), fontSize = 26.sp, fontWeight = FontWeight.SemiBold, lineHeight = 30.sp)
        }
        "dot" -> Row(verticalAlignment = Alignment.CenterVertically) {
            TileDotView(b.filled, tint(b.color, color), b.big)
            b.label?.let { Spacer(Modifier.size(8.dp)); Text(it, color = p.text, fontSize = 13.5.sp) }
        }
        "list" -> Column {
            val max = b.max.toInt()
            if (b.items.isEmpty()) Faint()
            b.items.take(max).forEach { Text(it, color = p.text, fontSize = 13.5.sp, maxLines = if (where != "panel") 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(vertical = 2.dp)) }
            if (b.items.size > max) Text("…", color = p.faint, fontSize = 13.5.sp)
        }
        "progress" -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val c = tint(b.color, color)
            Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(99.dp)).background(p.sunk)) {
                Box(Modifier.fillMaxWidth((b.ratio ?: 0.0).toFloat()).height(6.dp).clip(RoundedCornerShape(99.dp)).background(c))
            }
            b.text?.takeIf { it.isNotEmpty() }?.let { Text(it, color = p.muted, fontSize = 12.5.sp) }
        }
        "gauge" -> Box(Modifier.widthIn(max = 150.dp).fillMaxWidth().aspectRatio(96f / 54f), contentAlignment = Alignment.BottomCenter) {
            val c = tint(b.color, color)
            val track = p.sunk
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 8.dp.toPx()
                val d = min(size.width - stroke, (size.height - stroke / 2) * 2)
                val topLeft = Offset((size.width - d) / 2, stroke / 2)
                drawArc(track, 180f, 180f, false, topLeft, Size(d, d), style = Stroke(stroke, cap = StrokeCap.Round))
                drawArc(c, 180f, 180f * (b.ratio ?: 0.0).toFloat(), false, topLeft, Size(d, d), style = Stroke(stroke, cap = StrokeCap.Round))
            }
            Text(b.text?.ifEmpty { "·" } ?: "·", color = p.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
        // A small tile's face has no room for the axes' numbers; the tooltip says them.
        "chart" -> KitChart(b, tint(b.color, color), axes = where == "panel" || where == "wide")
        "kpi" -> KitKpi(b, tint(b.color, color), compact = where == "compact")
        "status" -> KitStatus(b)
        "callout" -> KitCallout(b)
        "image" -> TileImage(b, ctl)
        "chat" -> if (ctl.openChat != null && ctl.chatName != null) TextButton(onClick = ctl.openChat) {
            SmallFigure(ctl.chatColor, ctl.chatOutfit, 17.dp)
            Text(" ${b.label ?: ctl.chatName} ›", color = p.muted)
        }
        "switch" -> Row(verticalAlignment = Alignment.CenterVertically) {
            var on by remember(b.on) { mutableStateOf(b.on == true) }
            Text(b.label.orEmpty(), color = p.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
            Switch(checked = on, onCheckedChange = { on = it; ctl.act(b.key!!, JsonPrimitive(it), true) },
                colors = SwitchDefaults.colors(checkedTrackColor = p.ok, checkedThumbColor = Color.White))
        }
        "button" -> OutlinedButton(onClick = { ctl.act(b.key!!, null, true) }) { Text(b.label.orEmpty(), color = p.text) }
        "slider" -> Column {
            val known = b.value.num()
            var v by remember(known) { mutableFloatStateOf((known ?: b.min).toFloat()) }
            var touched by remember(known) { mutableStateOf(known != null) }
            Row {
                Text(b.label.orEmpty(), color = p.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
                Text(if (touched) sliderText(b, v.toDouble()) else "·", color = p.muted, fontSize = 14.sp)
            }
            Slider(
                value = v, valueRange = b.min.toFloat()..b.max.toFloat(),
                onValueChange = { v = it; touched = true },
                onValueChangeFinished = { ctl.act(b.key!!, JsonPrimitive(((v - b.min) / b.step).roundToInt() * b.step + b.min), true) },
                colors = SliderDefaults.colors(thumbColor = p.text, activeTrackColor = p.text, inactiveTrackColor = p.line2),
                modifier = Modifier.alpha(if (touched) 1f else 0.5f),
            )
        }
        "color" -> if (where != "panel") {
            Box(Modifier.size(30.dp).clip(CircleShape).background(b.value.str()?.let { parseColor(it, p.line2) } ?: p.line2).clickable { ctl.openColor(b.key!!) })
        } else ColorWheel(b, ctl)
        "choice" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            b.label?.let { Text(it, color = p.text, fontSize = 14.sp) }
            var picked by remember(b.value) { mutableStateOf(b.value.str()) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                b.options.forEach { o ->
                    val on = o.value.str() == picked
                    Text(o.label, color = if (on) p.inkText else p.text, fontSize = 13.sp,
                        modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(if (on) p.ink else Color.Transparent)
                            .border(1.dp, if (on) p.ink else p.line2, RoundedCornerShape(99.dp))
                            .clickable { picked = o.value.str(); ctl.act(b.key!!, o.value, true) }.padding(horizontal = 12.dp, vertical = 6.dp))
                }
            }
        }
        "row" -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            b.blocks.forEach { Box(Modifier.weight(1f)) { BlockView(it, color, where, ctl) } }
        }
        "column" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            b.blocks.forEach { BlockView(it, color, where, ctl) }
        }
    }
}

/** A picture (a camera snapshot). The old one stays until the new one is in, so it doesn't blink. */
@Composable
private fun TileImage(b: Block, ctl: TileControls) {
    val p = LocalPaper.current
    val url = b.src?.let(ctl.imageUrl) ?: return
    val context = LocalContext.current
    // Decoded at the tile's size and kept in memory only (a snapshot is soon old). Its address changes with each new
    // snapshot (?v=…); the one showing stays as the placeholder until the new one is in.
    var showing by remember { mutableStateOf<String?>(null) }
    val request = remember(url) {
        coil3.request.ImageRequest.Builder(context).data(url)
            .diskCachePolicy(coil3.request.CachePolicy.DISABLED)
            .placeholderMemoryCacheKey(showing)
            .build()
    }
    val h = when (b.height) { "small" -> 90.dp; "large" -> 280.dp; else -> 160.dp }
    Box(Modifier.fillMaxWidth().height(h).clip(RoundedCornerShape(12.dp)).background(p.sunk)) {
        coil3.compose.AsyncImage(request, null, Modifier.fillMaxSize(), contentScale = if (b.fit == "contain") ContentScale.Fit else ContentScale.Crop,
            onSuccess = { showing = url })
    }
}

// The colour wheel: hue around it (red at the right, going clockwise), white in the middle. Brightness is a slider of its own.
private fun hsvHex(h: Double, s: Double): String {
    fun f(n: Int): Int { val k = (n + h / 60) % 6; return (255 * (1 - s * max(0.0, minOf(k, 4 - k, 1.0)))).roundToInt() }
    return "#%02x%02x%02x".format(f(5), f(3), f(1))
}
private fun hexHs(hex: String): Pair<Double, Double>? {
    if (!Regex("^#[0-9a-fA-F]{6}$").matches(hex)) return null
    val (r, g, b) = listOf(1, 3, 5).map { hex.substring(it, it + 2).toInt(16) / 255.0 }
    val mx = maxOf(r, g, b); val d = mx - minOf(r, g, b)
    var h = 0.0
    if (d > 0) h = when (mx) { r -> ((g - b) / d) % 6; g -> (b - r) / d + 2; else -> (r - g) / d + 4 }
    return ((h * 60 + 360) % 360) to (if (mx > 0) d / mx else 0.0)
}

@Composable
private fun ColorWheel(b: Block, ctl: TileControls) {
    val act by rememberUpdatedState(ctl.act)
    var hex by remember(b.value) { mutableStateOf(b.value.str()) }
    var last by remember { mutableLongStateOf(0L) }
    val density = LocalDensity.current
    val wheel = 220.dp
    fun pick(o: Offset, w: Int, done: Boolean) {
        val x = o.x / w - 0.5; val y = o.y / w - 0.5
        val picked = hsvHex((atan2(y, x) * 180 / PI + 360) % 360, min(hypot(x, y) * 2, 1.0))
        hex = picked
        val now = System.currentTimeMillis()
        if (done || now - last > 350) { last = now; act(b.key!!, JsonPrimitive(picked), done) }
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        b.label?.let { Text(it, color = LocalPaper.current.text, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) }
        Box(
            Modifier.size(wheel)
                .pointerInput(Unit) { detectTapGestures { pick(it, size.width, true) } }
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = { pick(it, size.width, false) },
                        onDragEnd = { hex?.let { act(b.key!!, JsonPrimitive(it), true) } },
                    ) { change, _ -> change.consume(); pick(change.position, size.width, false) }
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                drawCircle(Brush.sweepGradient(listOf(Color.Red, Color.Yellow, Color.Green, Color.Cyan, Color.Blue, Color.Magenta, Color.Red)))
                drawCircle(Brush.radialGradient(listOf(Color.White, Color.White.copy(alpha = 0f))))
            }
            hex?.let { h ->
                hexHs(h)?.let { (hue, sat) ->
                    val r = with(density) { wheel.toPx() } / 2
                    val a = hue * PI / 180
                    val mark = with(density) { 22.dp.toPx() }
                    Box(
                        Modifier.offset { IntOffset((r + cos(a) * sat * r - mark / 2).roundToInt(), (r + sin(a) * sat * r - mark / 2).roundToInt()) }
                            .size(22.dp).clip(CircleShape).background(parseColor(h, Color.White)).border(3.dp, Color.White, CircleShape),
                    )
                }
            }
        }
    }
}
