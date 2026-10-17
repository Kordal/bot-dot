package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import kotlin.math.roundToInt

/**
 * How wide the list beside the chat is: the owner drags its edge ([ListGrip]). Widths in dp. The limits of the web
 * page and the Mac (72 to 480); the chat keeps less than there (280), so that an unfolded phone has a list to resize.
 */
object ListWidth {
    const val STANDARD = 300
    const val LEAST = 72
    const val MOST = 480
    const val CHAT = 280
    /** The line between the list and the chat. */
    const val LINE = 1

    /** A width the list may have in a window [window] wide. [wanted]: the owner's, null for a list nobody resized. */
    fun fitting(wanted: Int?, window: Int) = (wanted ?: STANDARD).coerceAtMost(minOf(MOST, window - CHAT - LINE)).coerceAtLeast(LEAST)

    /** What a list [width] wide shows of each row, as the web page's (style.css, @container side). */
    fun shows(width: Int) = if (width < 140) Shows.FIGURES else if (width < 240) Shows.NAMES else Shows.ALL

    enum class Shows {
        /** The figure, the name, the time and the newest line. */
        ALL,
        /** Under 240: the figure and the name. */
        NAMES,
        /** Under 140: the figure alone, with the dots of a new reply under it. */
        FIGURES,
    }
}

/** What the list shows of each row (HomeScreen): everything on a phone, and from its width beside the chat. */
val LocalListShows = compositionLocalOf { ListWidth.Shows.ALL }

/**
 * The line between the list and the chat, with a small handle on it: dragged, it makes the list wider or narrower;
 * tapped twice, it puts the list back. [width]: the list's now. [onWidth]: where the drag is, as a wanted width;
 * null: the standard one. [onKeep]: the finger let go.
 */
@Composable
fun ListGrip(width: Int, onWidth: (Int?) -> Unit, onKeep: () -> Unit) {
    val p = LocalPaper.current
    val density = LocalDensity.current.density
    val now by rememberUpdatedState(width)
    val keep by rememberUpdatedState(onKeep)
    val toWidth by rememberUpdatedState(onWidth)
    var at by remember { mutableFloatStateOf(0f) } // the list's width under the finger, in dp
    val drag = rememberDraggableState { px -> at += px / density; toWidth(at.roundToInt()) }
    // The line keeps its 1dp in the row; the strip that takes the finger is wider and lies over both neighbours.
    Box(Modifier.width(ListWidth.LINE.dp).fillMaxHeight().zIndex(1f).background(p.line), contentAlignment = Alignment.Center) {
        Box(
            Modifier.requiredWidth(20.dp).fillMaxHeight()
                .pointerInput(Unit) { detectTapGestures(onDoubleTap = { toWidth(null); keep() }) }
                .draggable(drag, Orientation.Horizontal, onDragStarted = { at = now.toFloat() }, onDragStopped = { keep() }),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.width(4.dp).height(36.dp).clip(RoundedCornerShape(2.dp)).background(p.line2))
        }
    }
}
