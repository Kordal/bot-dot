package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DragIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Dashboard
import dev.botdot.app.data.HomeTiles
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

/**
 * The tiles on home (#447): every approved tile of the Board, those on home first in their order with a handle, then
 * the rest. A tap checks or unchecks one, the handle drags a checked one to another place, and each change is saved
 * at once ([save]); the strip over the keys follows when the Board is read again.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HomeTilesSheet(dash: Dashboard, save: suspend (List<String>) -> Unit, onDismiss: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val titles = remember(dash) { dash.tiles.associate { it.id to it.title } }
    var on by remember { mutableStateOf(HomeTiles.rows(dash).first) }
    val rest = remember(dash, on) { dash.tiles.filter { it.approved && it.id !in on }.map { it.id } }
    // The server's list, when it changes while this is open (a save of ours coming back, the Chief's).
    LaunchedEffect(dash.home) { on = HomeTiles.rows(dash).first }
    fun change(next: List<String>) {
        val before = on
        on = next
        scope.launch { runCatching { save(next) }.onFailure { on = before } }
    }
    val listState = rememberLazyListState()
    val reorder = rememberReorderableLazyListState(listState) { from, to ->
        val a = from.key as? String ?: return@rememberReorderableLazyListState
        val b = to.key as? String ?: return@rememberReorderableLazyListState
        on = HomeTiles.move(on, a, b)
        haptic.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = p.panel) {
        LazyColumn(Modifier.fillMaxWidth().testTag(HOME_TILES), state = listState, contentPadding = PaddingValues(start = Space.s12, end = Space.s12, bottom = Space.s24)) {
            items(on, key = { it }) { id ->
                ReorderableItem(reorder, key = id) { lifted ->
                    HomeTileRow(titles[id].orEmpty(), checked = true, lifted = lifted, handle = Modifier.draggableHandle(
                        onDragStarted = { haptic.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate) },
                        onDragStopped = { change(on) },
                    )) { change(HomeTiles.toggle(on, id)) }
                }
            }
            if (on.isNotEmpty() && rest.isNotEmpty()) item(key = "sep") { Box(Modifier.fillMaxWidth().padding(horizontal = Space.s8, vertical = Space.s4).height(1.dp).background(p.line)) }
            items(rest, key = { it }) { id -> HomeTileRow(titles[id].orEmpty(), checked = false) { change(HomeTiles.toggle(on, id)) } }
        }
    }
}

@Composable
private fun HomeTileRow(title: String, checked: Boolean, lifted: Boolean = false, handle: Modifier? = null, onToggle: () -> Unit) {
    val p = LocalPaper.current
    Row(
        Modifier.fillMaxWidth().clip(Radius.small).background(if (lifted) p.sunk else p.panel)
            .clickable(role = Role.Checkbox, onClickLabel = if (checked) tr("Take off home") else tr("Put on home"), onClick = onToggle)
            .semantics { contentDescription = "$title, " + if (checked) tr("on home") else tr("not on home") }
            .padding(horizontal = Space.s12, vertical = Space.s12),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s12),
    ) {
        if (handle != null) Icon(Icons.Filled.DragIndicator, contentDescription = tr("Drag"), tint = p.faint, modifier = handle.size(20.dp))
        else Spacer(Modifier.size(20.dp))
        val box = RoundedCornerShape(5.dp)
        Box(Modifier.size(20.dp).clip(box).then(if (checked) Modifier.background(p.text) else Modifier.border(1.5.dp, p.faint, box)), contentAlignment = Alignment.Center) {
            if (checked) Icon(Icons.Filled.Check, contentDescription = null, tint = p.bg, modifier = Modifier.size(15.dp))
        }
        Text(title, color = if (checked) p.text else p.muted, fontSize = Type.s16, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
