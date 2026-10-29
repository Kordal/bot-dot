package dev.botdot.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.ProjectChats
import dev.botdot.app.data.tr

/**
 * A bot's or a team's chat over the Projects screen (#705; web: public/dock.js at phone width): it slides up from the
 * bottom, half or full height. The handle on top switches them (tap) or moves the sheet (drag: up full, down half,
 * then closed); a tap above it, Back and the chat's own back close it. The chat itself is the app's own chat screen
 * ([content]), so sending, blocks, cards and mentions are the chat's own. While the keyboard is up it is full height.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ProjectChatSheet(open: ProjectChats.Open?, at: ProjectChats.Height, onHeight: (ProjectChats.Height) -> Unit, content: @Composable (ProjectChats.Open) -> Unit) {
    val p = LocalPaper.current
    val shown = open != null && at != ProjectChats.Height.CLOSED
    BackHandler(shown) { onHeight(ProjectChats.Height.CLOSED) }
    AnimatedVisibility(shown, enter = fadeIn(), exit = fadeOut()) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onHeight(ProjectChats.Height.CLOSED) })
    }
    BoxWithConstraints(Modifier.fillMaxSize().imePadding(), contentAlignment = Alignment.BottomCenter) {
        val full = at == ProjectChats.Height.FULL || WindowInsets.isImeVisible
        val tall by animateDpAsState(if (full) maxHeight else maxHeight * 0.55f, label = "sheet")
        AnimatedVisibility(shown, enter = slideInVertically { it }, exit = slideOutVertically { it }) {
            val density = LocalDensity.current
            val dragged = remember { mutableFloatStateOf(0f) }
            val drag = rememberDraggableState { dy -> dragged.floatValue += with(density) { dy.toDp().value } }
            Column(
                Modifier.widthIn(max = 640.dp).fillMaxWidth().height(tall)
                    // Full height, the sheet keeps clear of the status bar; half, the chat's own bar needs no room for it.
                    .then(if (full) Modifier.statusBarsPadding() else Modifier.consumeWindowInsets(WindowInsets.statusBars))
                    .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp)).background(p.bg),
            ) {
                Box(
                    Modifier.fillMaxWidth().height(22.dp)
                        .draggable(drag, Orientation.Vertical, onDragStopped = { onHeight(ProjectChats.settle(at, dragged.floatValue)); dragged.floatValue = 0f })
                        .clickable(onClickLabel = if (full) tr("Half height") else tr("Full height")) { onHeight(ProjectChats.settle(at, 0f, tap = true)) },
                    contentAlignment = Alignment.Center,
                ) { Box(Modifier.size(width = 36.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(p.line2)) }
                // The chat's back closes the sheet: it has no list to show beside it.
                CompositionLocalProvider(LocalListToggle provides null) {
                    Box(Modifier.weight(1f).fillMaxWidth()) { open?.let { content(it) } }
                }
            }
        }
    }
}
