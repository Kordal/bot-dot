package dev.botdot.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.platform.LocalContext
import dev.botdot.app.BotDotApp
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** botdot's "Mono" look, the same colors as the web page (public/style.css). Dark only, whatever the system says (#14). */
@Immutable
data class Paper(
    val bg: Color, val panel: Color, val sunk: Color, val line: Color, val line2: Color,
    val text: Color, val muted: Color, val faint: Color,
    val ink: Color, val inkText: Color,
    /** `ok` and `warn` colour dots, fills and switches; words take `okText` and `warnText`, which pass 4.5:1. */
    val ok: Color, val okSoft: Color, val err: Color, val errSoft: Color, val warn: Color, val warnSoft: Color,
    val okText: Color, val warnText: Color,
    /** The logo's dot, the blue of jobs and skills mentioned in your bubbles, and the border of a warning on a card: one value each. */
    val dot: Color, val mention: Color, val warnLine: Color,
)

val DarkPaper = Paper(
    bg = Color(0xFF000000), panel = Color(0xFF0D0D0D), sunk = Color(0xFF1A1A1A), line = Color(0xFF1F1F1F), line2 = Color(0xFF2B2B2B),
    text = Color(0xFFFFFFFF), muted = Color(0xFFA3A3A3), faint = Color(0xFF838383),
    ink = Color(0xFFFFFFFF), inkText = Color(0xFF000000),
    ok = Color(0xFF45C78E), okSoft = Color(0xFF16281F), err = Color(0xFFEF6A6A), errSoft = Color(0xFF2D1717), warn = Color(0xFFE2A846), warnSoft = Color(0xFF2C2413),
    okText = Color(0xFF45C78E), warnText = Color(0xFFE2A846),
    dot = Color(0xFFD85A30), mention = Color(0xFF378ADD), warnLine = Color(0xFFEF9F27),
)

val LocalPaper = staticCompositionLocalOf { DarkPaper }

@Composable
fun BotDotTheme(content: @Composable () -> Unit) {
    val p = DarkPaper
    val scheme = darkColorScheme().copy(
        primary = p.ink, onPrimary = p.inkText,
        background = p.bg, onBackground = p.text,
        surface = p.bg, onSurface = p.text, surfaceVariant = p.sunk, onSurfaceVariant = p.muted,
        surfaceContainer = p.panel, surfaceContainerHigh = p.panel, surfaceContainerLow = p.bg,
        outline = p.line2, outlineVariant = p.line,
        error = p.err, onError = Color.White,
        secondaryContainer = p.sunk, onSecondaryContainer = p.text,
    )
    val type = Typography(
        titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
        titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
        bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = TextStyle(fontSize = 12.5.sp, lineHeight = 17.sp),
        labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium),
    ).inGeist()
    val figure = (LocalContext.current.applicationContext as? BotDotApp)?.figure?.collectAsState()?.value
    CompositionLocalProvider(LocalPaper provides p, LocalFigure provides figure) {
        ProvideFigureClock { MaterialTheme(colorScheme = scheme, typography = type, content = content) }
    }
}

/**
 * botdot's motion (#496), the same values as the web page's --t1/--t2/--t3/--out/--in: three durations and two curves.
 * An enter takes [Out]; an exit takes [In] and is one step shorter. Only place and alpha move, nothing waits for a
 * movement before it takes a tap, and with the system's "Remove animations" Compose skips them all.
 */
object Motion {
    const val FAST = 120
    const val BASE = 200
    const val SLOW = 260
    val Out: Easing = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
    val In: Easing = CubicBezierEasing(0.4f, 0f, 1f, 1f)

    fun <T> enter(ms: Int = BASE) = tween<T>(ms, easing = Out)
    fun <T> exit(ms: Int = FAST) = tween<T>(ms, easing = In)

    /** A fold opening: its height and then its words. */
    val unfold: EnterTransition = expandVertically(enter()) + fadeIn(enter())
    val fold: ExitTransition = shrinkVertically(exit(BASE)) + fadeOut(exit())

    /** A panel from the right (the settings panel, the viewer): an eighth of its width, and in. */
    val panelIn: EnterTransition = slideInHorizontally(enter()) { it / 8 } + fadeIn(enter())
    val panelOut: ExitTransition = fadeOut(exit())
}

/** [content] shown while [open], opening and closing as a fold does ([Motion.unfold]). */
@Composable
fun Unfold(open: Boolean, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    AnimatedVisibility(open, modifier, enter = Motion.unfold, exit = Motion.fold) { content() }
}
