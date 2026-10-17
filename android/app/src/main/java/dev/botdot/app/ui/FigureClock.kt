package dev.botdot.app.ui

import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import dev.botdot.app.data.FigureDef
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.sin

/** The colours a bot can have (= COLORS in lib/bots.js). The Chief is coral, like the logo's dot. */
val BotColors = listOf(
    "#1d9e75" to "Teal", "#378add" to "Blue", "#7f77dd" to "Purple", "#d4537e" to "Pink",
    "#e24b4a" to "Red", "#ef9f27" to "Amber", "#639922" to "Green", "#888780" to "Grey",
)
const val CHIEF_COLOR = "#d85a30"

private const val LOOP = 36f // seconds; every period below divides it, so the loop has no jump

/**
 * One clock for everything that moves (the bots' heads, the small marks of what waits for you, the logo), running only
 * while one of them is moving on screen: a list of idle bots asks for frames only while they blink, and a list of
 * paused ones for none at all. With animations switched off in Android's settings it never runs (each head still
 * holds its state's face).
 */
class FigureClock(val still: Boolean) {
    /** Seconds, 0 until [LOOP], then again: read it while drawing, so only what moves is drawn again. */
    val t = mutableFloatStateOf(0f)
    /** The frame's own time in milliseconds, never starting again: for movements whose length comes from the definition. */
    val ms = mutableLongStateOf(0L)
    internal var users by mutableIntStateOf(0)

    companion object {
        /** The time the frames carry, in milliseconds, for when no frame is asked for: where a head holds between two movements. */
        fun now(): Long = System.nanoTime() / 1_000_000
    }
}

val LocalFigureClock = staticCompositionLocalOf { FigureClock(still = true) }

@Composable
fun ProvideFigureClock(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val clock = remember { FigureClock(Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f) }
    if (clock.users > 0 && !clock.still) LaunchedEffect(Unit) {
        // The frame's own time: what moves carries on where it was when the clock stopped and starts again.
        while (true) withFrameMillis { ms -> clock.t.floatValue = (ms % (LOOP * 1000).toLong()) / 1000f; clock.ms.longValue = ms }
    }
    CompositionLocalProvider(LocalFigureClock provides clock, content = content)
}

/** The clock's time for something that moves (while it's on screen), or null when it stands still. */
@Composable
internal fun movingClock(moving: Boolean): FigureClock? {
    val clock = LocalFigureClock.current
    val on = moving && !clock.still
    DisposableEffect(on) {
        // The first to move sets the time itself: the frames that keep it only start with the next one.
        if (on) { if (clock.users == 0) clock.ms.longValue = FigureClock.now(); clock.users++ }
        onDispose { if (on) clock.users-- }
    }
    return clock.takeIf { on }
}

/**
 * The clock's time for a head in [state] while its face moves, or null while it holds still: in a state without a
 * movement, between two movements (an idle head between blinks), or with animations off.
 */
@Composable
internal fun movingClock(def: FigureDef, state: String): FigureClock? {
    val still = LocalFigureClock.current.still
    val moving by produceState(false, def, state, still) {
        value = false
        if (still) return@produceState
        while (true) {
            val (wait, run) = def.nextMove(state, FigureClock.now() / 1000.0) ?: return@produceState
            // Awake a frame or two before it moves, so the clock is running when it does.
            if (wait > EARLY) { value = false; delay(((wait - EARLY) * 1000).toLong()) }
            value = true
            delay(((minOf(wait, EARLY) + run) * 1000).toLong().coerceAtLeast(1))
        }
    }
    return movingClock(moving)
}
private const val EARLY = 0.05 // seconds

/**
 * What waits for you, as small marks: one per thing, the head of its bot with its hat, hopping one after another
 * (standing still with animations off).
 */
@Composable
fun NeedsFigures(who: List<Named>, max: Int = 8) {
    val def = figure()
    val clock = movingClock(who.isNotEmpty())
    val shown = who.take(max)
    val dark = LocalPaper.current == DarkPaper
    val marks = remember(def, shown, dark) {
        shown.map { b ->
            tonesOf(b.color, dark, def) to def.hat(b.outfit)
        }
    }
    val tall = 20.dp
    val wide = tall * def.smallAspect
    val step = wide + 3.dp
    Canvas(Modifier.size(width = step * shown.size, height = tall + 8.dp)) {
        marks.forEachIndexed { i, (tones, hat) ->
            // Each hops a little after the one before it, and squashes when it lands.
            // Without the clock (animations off) each stands as it is.
            val q = clock?.let { (((it.t.floatValue % 1.8f) / 1.8f) - i * 0.08f + 1f) % 1f }
            val up = if (q != null && q < 0.36f) sin(PI * q / 0.36f).toFloat() else 0f
            val squash = if (q != null && q in 0.36f..0.5f) sin(PI * (q - 0.36f) / 0.14f).toFloat() * 0.12f else 0f
            translate(left = i * step.toPx(), top = size.height - tall.toPx() - up * 7.dp.toPx()) {
                scale(1 + squash, 1 - squash, pivot = Offset(wide.toPx() / 2, tall.toPx())) {
                    drawFigure(def, null, null, hat, 1f, tones, def.small, Size(wide.toPx(), tall.toPx()))
                }
            }
        }
    }
}
