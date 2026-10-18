package dev.botdot.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.Mark
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Face
import dev.botdot.app.data.Layers
import dev.botdot.app.data.Place
import dev.botdot.app.data.Tone
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.math.min

/** The definition every bot is drawn from: the server's, or the copy the app was built with (null: neither can be used). */
val LocalFigure = compositionLocalOf<FigureDef?> { null }

/** The definition to draw from: the one in use, or the one built-in bare head (no states, no movement, no hat). */
@Composable
internal fun figure(): FigureDef = LocalFigure.current ?: FigureDef.BARE

/** The colours of one bot's mark: its own, its deep tone on this background, and the definition's white and ink. */
internal class Tones(val main: Color, val deep: Color, val white: Color, val ink: Color) {
    fun of(t: Tone) = when (t) { Tone.MAIN -> main; Tone.DEEP -> deep; Tone.WHITE -> white; Tone.INK -> ink }
}

@Composable
private fun tones(color: String?, def: FigureDef): Tones {
    // The app is dark only (#14).
    return remember(color, def) { tonesOf(color, dark = true, def) }
}

/** A bot without a colour, or with one that isn't a colour, is grey. */
internal fun tonesOf(color: String?, dark: Boolean, def: FigureDef): Tones {
    val main = parseColor(color, opaque(FigureDef.GREY))
    return Tones(main, opaque(FigureDef.deep(main.rgb(), dark)), opaque(def.white), opaque(def.ink))
}

private fun opaque(rgb: Int) = Color(0xFF000000 or rgb.toLong())
private fun Color.rgb(): Int = ((red * 255 + 0.5f).toInt() shl 16) or ((green * 255 + 0.5f).toInt() shl 8) or (blue * 255 + 0.5f).toInt()

/**
 * A bot: a head in its colour with the face of its [state] and its hat (its [outfit]: { hat }, or [FigureDef.CHIEF]
 * for the Chief of Staff's), like .fig on the web page. The head, the faces, their movements and the hats come from
 * the definition (data/Figure.kt); a state it doesn't know is drawn as its default, and a hat it can't draw is left
 * out. Without a definition every bot is one bare head. Nothing is behind the head and nothing is clipped: a hat
 * reaches a little past the mark's own square.
 */
@Composable
fun BotFigure(color: String?, state: String = "idle", size: Int = 44, outfit: JsonElement? = null) {
    val def = figure()
    val tones = tones(color, def)
    val face = remember(def, state) { def.face(state) }
    val hat = remember(def, outfit) { def.hat(outfit) }
    val still = LocalFigureClock.current.still
    val clock = movingClock(def, state)
    Canvas(Modifier.size(size.dp)) {
        // Reading the clock here draws a moving head again each frame, and nothing else. Between two movements (an
        // idle head between blinks) nothing is read: it is drawn once, where the clock says it holds.
        val seconds = if (still) null else (clock?.ms?.longValue ?: FigureClock.now()) / 1000.0
        drawFigure(def, face, def.layers(state, seconds), hat, def.opacity(state), tones, floatArrayOf(0f, 0f, def.box.first, def.box.second))
    }
}

/**
 * The mark beside a bot's name in text, and for each thing that waits in "Needs you": the head and its hat, without
 * eyes, and it never moves (the definition's `small`, like .fig-small on the web page). [modifier] gives its size.
 */
@Composable
fun SmallFigure(color: String?, outfit: JsonElement?, modifier: Modifier = Modifier) {
    val def = figure()
    val tones = tones(color, def)
    val hat = remember(def, outfit) { def.hat(outfit) }
    Canvas(modifier) { drawFigure(def, null, null, hat, 1f, tones, def.small) }
}

/** A small mark [height] tall, as wide as the definition makes it. */
@Composable
fun SmallFigure(color: String?, outfit: JsonElement?, height: Dp) = SmallFigure(color, outfit, Modifier.size(width = height * figure().smallAspect, height = height))

/**
 * A bot's head with its face and its hat as a picture [px] wide and high, for where Compose doesn't draw (the sender
 * of a notification). It is drawn by the function that draws every bot ([drawFigure]), still, looking as the
 * definition's default state does, and framed so that a crop to a circle cuts nothing ([FigureDef.portrait]).
 * [dark]: the picture goes on a dark background.
 */
fun figureBitmap(def: FigureDef, color: String?, outfit: JsonElement?, px: Int, dark: Boolean): Bitmap {
    val image = ImageBitmap(px, px)
    drawPortrait(androidx.compose.ui.graphics.Canvas(image), def, color, outfit, px, dark)
    return image.asAndroidBitmap()
}

/** Draws that picture on [canvas], [px] wide and high. */
internal fun drawPortrait(canvas: androidx.compose.ui.graphics.Canvas, def: FigureDef, color: String?, outfit: JsonElement?, px: Int, dark: Boolean) {
    val hat = def.hat(outfit)
    CanvasDrawScope().draw(Density(1f), LayoutDirection.Ltr, canvas, Size(px.toFloat(), px.toFloat())) {
        drawFigure(def, def.face(null), def.layers(null), hat, 1f, tonesOf(color, dark, def), def.portrait(hat))
    }
}

/** A small mark's place in a line of text: appended to the text as inline content with this id, the colour and the outfit. */
const val FIGURE_INLINE = "fig:"

/** A bot named in running text: its small mark (the head with its hat), then its name. */
fun AnnotatedString.Builder.bot(name: String, color: String?, outfit: JsonElement?) {
    appendInlineContent("$FIGURE_INLINE${color.orEmpty()} ${outfit ?: ""}", "\u200B") // read aloud as nothing: the name follows
    append("\u00A0$name")
}

fun AnnotatedString.Builder.bot(b: Named) = bot(b.name, b.color, b.outfit)

/** Bots named one after another, with commas. */
fun AnnotatedString.Builder.bots(all: List<Named>) = all.forEachIndexed { i, b ->
    if (i > 0) append(", ")
    bot(b)
}

/** A bot as text names it: its name, and the colour and outfit of its small mark. */
data class Named(val name: String, val color: String?, val outfit: JsonElement?)

/** The Chief of Staff, named in text: coral, in the outfit the definition gives it. */
val CHIEF_NAMED = Named("Chief of Staff", CHIEF_COLOR, FigureDef.CHIEF)

fun Bot.named() = Named(name, color, outfit)

/** A bot a message names by [name] and [color]: drawn as it is [now] (its colour and hat today), when it still exists. */
fun named(now: Bot?, name: String, color: String?) = Named(name, now?.color ?: color, now?.outfit)

/** The small marks a text names (see [bot]), for Text's inlineContent: each a little taller than the line's letters. */
@Composable
fun figureInlines(text: AnnotatedString): Map<String, InlineTextContent> {
    val aspect = figure().smallAspect
    return remember(text, aspect) {
        text.getStringAnnotations(INLINE_CONTENT_TAG, 0, text.length).map { it.item }.filter { it.startsWith(FIGURE_INLINE) }.distinct().associateWith { id ->
            val (color, outfit) = id.removePrefix(FIGURE_INLINE).let { it.substringBefore(' ') to it.substringAfter(' ', "") }
            // The outfit is read back as data: what isn't one draws a bare head.
            val hat = outfit.takeIf { it.isNotEmpty() }?.let { runCatching { Json.parseToJsonElement(it) }.getOrNull() }
            InlineTextContent(Placeholder(width = (SMALL_EM * aspect).em, height = SMALL_EM.em, placeholderVerticalAlign = PlaceholderVerticalAlign.TextCenter)) {
                SmallFigure(color.ifEmpty { null }, hat, Modifier.fillMaxSize())
            }
        }
    }
}
private const val INLINE_CONTENT_TAG = "androidx.compose.foundation.text.inlineContent"
private const val SMALL_EM = 1.5f // as on the web page: the whole box, hat included, is one and a half letters tall

/** Text that names bots (built with [bot]): each with its small mark. */
@Composable
fun FigureText(text: AnnotatedString, color: Color, fontSize: TextUnit = TextUnit.Unspecified, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE, style: TextStyle = LocalTextStyle.current) =
    Text(text, color = color, fontSize = fontSize, modifier = modifier, maxLines = maxLines, overflow = TextOverflow.Ellipsis, inlineContent = figureInlines(text), style = style)

/**
 * Draws a bot's mark with the part [view] (x, y, width, height, in the definition's units) scaled to fill [size] (the
 * canvas, or a part of it at the origin): the head's circle, the [face] (none for the small mark) and the [hat] over
 * it, each layer in its place ([layers]; none: nothing is moved). A faded mark fades as one, not shape by shape.
 */
internal fun DrawScope.drawFigure(def: FigureDef, face: Face?, layers: Layers?, hat: List<Mark>, opacity: Float, tones: Tones, view: FloatArray, size: Size = this.size) {
    val k = min(size.width / view[2], size.height / view[3])
    val dx = (size.width - view[2] * k) / 2 - view[0] * k
    val dy = (size.height - view[3] * k) / 2 - view[1] * k
    fun draw() = withTransform({ translate(dx, dy); scale(k, k, Offset.Zero) }) {
        layer(layers?.head, def.pivotHead) {
            drawMarks(listOf(def.head), tones)
            if (face != null) layer(layers?.eyes, def.pivotEyes) {
                drawMarks(face.eyes, tones)
                layer(layers?.pupils, NO_PIVOT) { drawMarks(face.pupils, tones) }
            }
            drawMarks(hat, tones) // last: over the head and the face
        }
    }
    if (opacity >= 1f) return draw()
    drawIntoCanvas { canvas ->
        val pad = size.minDimension / 2 // room for a hat that reaches past the mark
        canvas.saveLayer(Rect(-pad, -pad, size.width + pad, size.height + pad), Paint().apply { alpha = opacity })
        draw()
        canvas.restore()
    }
}

private val NO_PIVOT = 0.0 to 0.0
private val REST = Place()

/** Draws what is inside one layer: moved, turned and scaled about its pivot as the definition says. */
private inline fun DrawScope.layer(place: Place?, pivot: Pair<Double, Double>, draw: DrawScope.() -> Unit) {
    if (place == null || place == REST) return draw()
    val m = place.matrix(pivot.first, pivot.second)
    val matrix = Matrix().also {
        it[0, 0] = m[0]; it[0, 1] = m[1]
        it[1, 0] = m[2]; it[1, 1] = m[3]
        it[3, 0] = m[4]; it[3, 1] = m[5]
    }
    withTransform({ transform(matrix) }, draw)
}

/** Draws marks in their own units (the canvas is already scaled to them). */
private fun DrawScope.drawMarks(marks: List<Mark>, tones: Tones) {
    for (m in marks) {
        val stroke = m.stroke?.let { Stroke(m.width, cap = StrokeCap.Round, join = StrokeJoin.Round) }
        when (m) {
            is Mark.Disc -> {
                val at = Offset(m.x, m.y)
                m.fill?.let { drawCircle(tones.of(it), m.r, at) }
                if (stroke != null) drawCircle(tones.of(m.stroke!!), m.r, at, style = stroke)
            }
            is Mark.Outline -> {
                val path = Path()
                for (s in m.steps) {
                    val a = s.at
                    when (s.op) {
                        'M' -> path.moveTo(a[0], a[1])
                        'L' -> path.lineTo(a[0], a[1])
                        'Q' -> path.quadraticTo(a[0], a[1], a[2], a[3])
                        'C' -> path.cubicTo(a[0], a[1], a[2], a[3], a[4], a[5])
                        'Z' -> path.close()
                    }
                }
                m.fill?.let { drawPath(path, tones.of(it)) }
                if (stroke != null) drawPath(path, tones.of(m.stroke!!), style = stroke)
            }
        }
    }
}
