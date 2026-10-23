package dev.botdot.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.LiveRuns
import kotlinx.coroutines.delay

/**
 * The rows of a bot's live runs ([LiveRuns]) for [live], kept by the chat [chat]: none with fewer than two. The rows
 * of runs that just ended come and go by themselves: the screen draws again when they change.
 */
@Composable
fun rememberLiveRows(chat: String, live: List<LiveRuns.Row>): List<LiveRuns.Row> {
    val keeper = remember(chat) { LiveRuns.Keeper() }
    var tick by remember(chat) { mutableIntStateOf(0) }
    val rows = remember(keeper, live, tick) { keeper.rows(live, System.currentTimeMillis()) }
    LaunchedEffect(keeper, rows) { keeper.next(System.currentTimeMillis())?.let { delay(it); tick++ } }
    return rows
}

/**
 * A bot's live runs in a dock above the message box, in the look of the plan dock ([PlanDock]): a row per run, a
 * spinner in the bot's colour (a still dot while it waits for the owner's OK), what it was asked, what it is doing
 * now, and Stop for that run. A row whose run ended shows a check, its ask struck through, then folds away.
 * [onStop]: Stop on a row. [onHeld]: a tap on a row that waits for the owner's OK. Nothing for no rows.
 */
@Composable
fun LiveRunsDock(rows: List<LiveRuns.Row>, color: String?, who: String, onStop: (String) -> Unit, onHeld: () -> Unit) {
    if (rows.isEmpty()) return
    val p = LocalPaper.current
    val accent = parseColor(color, p.ok)
    val shape = RoundedCornerShape(18.dp)
    Column(
        Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp).clip(shape).background(p.panel).border(1.dp, p.line2, shape).padding(6.dp)
            .semantics { paneTitle = "$who's runs" },
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        rows.forEach { r ->
            key(r.id) {
                AnimatedVisibility(visible = !r.gone, exit = fadeOut() + shrinkVertically()) { RunRow(r, accent, onStop, onHeld) }
            }
        }
    }
}

@Composable
private fun RunRow(r: LiveRuns.Row, accent: Color, onStop: (String) -> Unit, onHeld: () -> Unit) {
    val p = LocalPaper.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (!r.done && !r.held) p.sunk else Color.Transparent)
            .then(if (r.held && !r.done) Modifier.clickable(onClickLabel = "Show what it waits for", onClick = onHeld) else Modifier)
            .heightIn(min = 48.dp).padding(start = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
            when {
                r.done -> Icon(Icons.Filled.Check, null, tint = p.ok, modifier = Modifier.size(18.dp))
                r.held -> Canvas(Modifier.size(8.dp)) { drawCircle(accent.copy(alpha = .5f)) }
                else -> CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = accent)
            }
        }
        Column(Modifier.weight(1f).padding(vertical = 6.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }) {
            Text(r.ask, color = if (r.done) p.faint else p.text, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                textDecoration = if (r.done) TextDecoration.LineThrough else null)
            Text(r.doing, color = p.muted, fontSize = 12.5.sp, lineHeight = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (!r.done) WordButton("Stop", p.faint) { onStop(r.id) }
    }
}
