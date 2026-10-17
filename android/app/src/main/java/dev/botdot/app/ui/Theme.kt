package dev.botdot.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
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

/** botdot's "Mono" look, the same colors as the web page (public/style.css). */
@Immutable
data class Paper(
    val bg: Color, val panel: Color, val sunk: Color, val line: Color, val line2: Color,
    val text: Color, val muted: Color, val faint: Color,
    val ink: Color, val inkText: Color,
    /** `ok` and `warn` colour dots, fills and switches; words take `okText` and `warnText`, which pass 4.5:1. */
    val ok: Color, val okSoft: Color, val err: Color, val errSoft: Color, val warn: Color, val warnSoft: Color,
    val okText: Color, val warnText: Color,
    /** The logo's dot, the blue of jobs and skills mentioned in your bubbles, and the border of a warning on a card: one value in light and dark. */
    val dot: Color, val mention: Color, val warnLine: Color,
)

val LightPaper = Paper(
    bg = Color(0xFFFFFFFF), panel = Color(0xFFFFFFFF), sunk = Color(0xFFF2F2F2), line = Color(0xFFEBEBEB), line2 = Color(0xFFDEDEDE),
    text = Color(0xFF000000), muted = Color(0xFF525252), faint = Color(0xFF6E6E6E),
    ink = Color(0xFF000000), inkText = Color(0xFFFFFFFF),
    ok = Color(0xFF1D9A68), okSoft = Color(0xFFE4F5EC), err = Color(0xFFCA3636), errSoft = Color(0xFFFBEAEA), warn = Color(0xFFB27A12), warnSoft = Color(0xFFFBF1DC),
    okText = Color(0xFF167A52), warnText = Color(0xFF8A5D0A),
    dot = Color(0xFFD85A30), mention = Color(0xFF378ADD), warnLine = Color(0xFFEF9F27),
)

val DarkPaper = Paper(
    bg = Color(0xFF000000), panel = Color(0xFF0D0D0D), sunk = Color(0xFF1A1A1A), line = Color(0xFF1F1F1F), line2 = Color(0xFF2B2B2B),
    text = Color(0xFFFFFFFF), muted = Color(0xFFA3A3A3), faint = Color(0xFF838383),
    ink = Color(0xFFFFFFFF), inkText = Color(0xFF000000),
    ok = Color(0xFF45C78E), okSoft = Color(0xFF16281F), err = Color(0xFFEF6A6A), errSoft = Color(0xFF2D1717), warn = Color(0xFFE2A846), warnSoft = Color(0xFF2C2413),
    okText = Color(0xFF45C78E), warnText = Color(0xFFE2A846),
    dot = Color(0xFFD85A30), mention = Color(0xFF378ADD), warnLine = Color(0xFFEF9F27),
)

val LocalPaper = staticCompositionLocalOf { LightPaper }

@Composable
fun BotDotTheme(content: @Composable () -> Unit) {
    val p = if (isSystemInDarkTheme()) DarkPaper else LightPaper
    val base = if (p == DarkPaper) darkColorScheme() else lightColorScheme()
    val scheme = base.copy(
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
