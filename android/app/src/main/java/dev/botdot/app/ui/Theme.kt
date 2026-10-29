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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.addOutline
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.text.input.VisualTransformation
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
import androidx.compose.ui.unit.dp
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
    /** Depth (#723): higher is lighter. A pane takes [raise], a card, a menu or the composer [raise2] with [hi] along its top edge ([raised]); a secondary button is [fill]. */
    val raise: Color, val raise2: Color, val fill: Color, val hi: Color,
)

val DarkPaper = Paper(
    bg = Color(0xFF000000), panel = Color(0xFF0D0D0D), sunk = Color(0xFF1A1A1A), line = Color(0xFF1F1F1F), line2 = Color(0xFF2B2B2B),
    text = Color(0xFFFFFFFF), muted = Color(0xFFA3A3A3), faint = Color(0xFF838383),
    ink = Color(0xFFFFFFFF), inkText = Color(0xFF000000),
    ok = Color(0xFF45C78E), okSoft = Color(0xFF16281F), err = Color(0xFFEF6A6A), errSoft = Color(0xFF2D1717), warn = Color(0xFFE2A846), warnSoft = Color(0xFF2C2413),
    okText = Color(0xFF45C78E), warnText = Color(0xFFE2A846),
    dot = Color(0xFFD85A30), mention = Color(0xFF378ADD), warnLine = Color(0xFFEF9F27),
    raise = Color(0xFF0F0F0F), raise2 = Color(0xFF171717), fill = Color(0xFF232323), hi = Color(0x0FFFFFFF),
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
        titleLarge = TextStyle(fontSize = Type.s20, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
        titleMedium = TextStyle(fontSize = Type.s16, fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontSize = Type.s16, lineHeight = Type.line24),
        bodyMedium = TextStyle(fontSize = Type.s14, lineHeight = Type.line20),
        bodySmall = TextStyle(fontSize = Type.s12, lineHeight = Type.line16),
        labelMedium = TextStyle(fontSize = Type.s12, fontWeight = FontWeight.Medium),
    ).inGeist()
    val figure = (LocalContext.current.applicationContext as? BotDotApp)?.figure?.collectAsState()?.value
    CompositionLocalProvider(LocalPaper provides p, LocalFigure provides figure) {
        ProvideFigureClock { MaterialTheme(colorScheme = scheme, typography = type, content = content) }
    }
}

/**
 * botdot's scales (#720), the same steps as the web page's: six text sizes, eight spaces and three corners. A size or a
 * space between two steps takes the nearer one; text is no other size anywhere (TokenScaleTest keeps it so).
 */
object Type {
    val s12 = 12.sp
    val s14 = 14.sp
    val s16 = 16.sp
    val s20 = 20.sp
    val s24 = 24.sp
    val s32 = 32.sp
    val line16 = 16.sp
    val line20 = 20.sp
    val line24 = 24.sp
    val line28 = 28.sp
    val line32 = 32.sp
    val line40 = 40.sp
    /** The spacing of an eyebrow's capitals. */
    val wide = 1.5.sp
}

object Space {
    val s4 = 4.dp
    val s8 = 8.dp
    val s12 = 12.dp
    val s16 = 16.dp
    val s24 = 24.dp
    val s32 = 32.dp
    val s48 = 48.dp
    val s64 = 64.dp
}

/** Corners: 8 for small things, 14 for cards, the pill, and CircleShape for round ones. A chat bubble keeps its small corner by its sender. */
object Radius {
    val r8 = 8.dp
    val r14 = 14.dp
    val small = RoundedCornerShape(r8)
    val card = RoundedCornerShape(r14)
    val pill = RoundedCornerShape(50)
    val mine = RoundedCornerShape(r14, r14, 6.dp, r14)
    val theirs = RoundedCornerShape(r14, r14, r14, 6.dp)
}

/** A raised surface (#723): [color] in [shape], a line of light along its top edge, and no border. */
fun Modifier.raised(shape: Shape, color: Color = DarkPaper.raise2): Modifier = clip(shape).drawBehind {
    val outline = shape.createOutline(size, layoutDirection, this)
    drawOutline(outline, color)
    clipPath(Path().apply { addOutline(outline) }) { drawRect(DarkPaper.hi, size = Size(size.width, 1.dp.toPx())) }
}

/** A secondary button (#723): filled, not ringed. The same parameters as Material's OutlinedButton, whose place it takes. */
@Composable
fun SecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = ButtonDefaults.outlinedShape,
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    content: @Composable RowScope.() -> Unit,
) {
    val p = LocalPaper.current
    Button(
        onClick, modifier, enabled, shape,
        colors = ButtonDefaults.buttonColors(containerColor = p.fill, contentColor = p.text, disabledContainerColor = p.fill.copy(alpha = 0.5f), disabledContentColor = p.faint),
        elevation = null, contentPadding = contentPadding, content = content,
    )
}

/** A text field (#723): a surface of its own with no border at rest; the line shows only while it has the focus. */
@Composable
fun Field(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    textStyle: TextStyle = LocalTextStyle.current,
    label: @Composable (() -> Unit)? = null,
    placeholder: @Composable (() -> Unit)? = null,
    leadingIcon: @Composable (() -> Unit)? = null,
    trailingIcon: @Composable (() -> Unit)? = null,
    supportingText: @Composable (() -> Unit)? = null,
    isError: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    singleLine: Boolean = false,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    minLines: Int = 1,
    shape: Shape = Radius.card,
) {
    val p = LocalPaper.current
    OutlinedTextField(
        value, onValueChange, modifier, enabled, readOnly, textStyle, label, placeholder, leadingIcon, trailingIcon,
        supportingText = supportingText, isError = isError, visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions, keyboardActions = keyboardActions, singleLine = singleLine,
        maxLines = maxLines, minLines = minLines, shape = shape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = p.raise2, unfocusedContainerColor = p.raise2, disabledContainerColor = p.raise2, errorContainerColor = p.raise2,
            focusedBorderColor = p.muted, unfocusedBorderColor = Color.Transparent, disabledBorderColor = Color.Transparent,
        ),
    )
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
