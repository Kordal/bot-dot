package dev.botdot.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.ToLatest
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/**
 * The button to a chat's newest message (#1120, data/ToLatest.kt): a round down arrow above the message box, with
 * the small head of who wrote the newest message and no words, while it waits below what is on screen. A tap goes
 * to the end. [chat] names the chat on screen, [newest] its newest message (any value that changes with it), and
 * [bottom] the height of the message box the list scrolls behind.
 */
@Composable
fun BoxScope.ToLatestButton(listState: LazyListState, chat: Any?, newest: Any?, bottom: Dp, head: @Composable () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val near = with(LocalDensity.current) { ToLatest.NEAR_DP.dp.roundToPx() }
    val atEnd by remember(listState, near) { derivedStateOf { ToLatest.atEnd(listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset, near) } }
    var shown by remember(chat) { mutableStateOf(false) }
    var was by remember(chat) { mutableStateOf<Any?>(null) }
    LaunchedEffect(chat, newest, atEnd) {
        shown = ToLatest.next(shown, was, newest, atEnd)
        was = newest
    }
    AnimatedVisibility(shown, Modifier.align(Alignment.BottomEnd).padding(end = Space.s16, bottom = bottom + Space.s12), enter = fadeIn(), exit = fadeOut()) {
        Box {
            RoundButton(Icons.Filled.ArrowDownward, tr("Latest"), Modifier.shadow(6.dp, CircleShape).background(p.fill, CircleShape)) {
                shown = false
                scope.launch { listState.animateScrollToItem(0) }
            }
            Box(Modifier.align(Alignment.TopStart).offset((-6).dp, (-6).dp)) { head() }
        }
    }
}
