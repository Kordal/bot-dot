package dev.botdot.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.Run
import dev.botdot.app.data.RunSteps

/**
 * One run of a bot's chat as one block (#625; `runBlockHTML` in public/bot-chat.js): a frame that holds what started
 * it, what was steered into it, its step line, its reply and its footer, and the runs that reply to it as further
 * rounds (#627). A run at work has a lighter frame. [onReply]: a long press offers "Reply to this task".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RunBlock(running: Boolean, onReply: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPaper.current
    val shape = RoundedCornerShape(18.dp)
    var sheet by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().clip(shape).background(Color(0xFF050505)).border(1.dp, if (running) p.line2 else p.line, shape)
            .then(if (onReply != null) Modifier.pointerInput(onReply) { detectTapGestures(onLongPress = { sheet = true }) } else Modifier)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp), content = content,
    )
    if (sheet && onReply != null) ModalBottomSheet(onDismissRequest = { sheet = false }, containerColor = p.panel) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable { sheet = false; onReply() }.padding(horizontal = 20.dp).padding(bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Icon(Icons.AutoMirrored.Outlined.Reply, null, tint = p.text, modifier = Modifier.size(24.dp))
            Text("Reply to this task", color = p.text, fontSize = 16.sp)
        }
    }
}

/** The line between two rounds of a block (#627). */
@Composable
fun RoundRule() = Spacer(Modifier.fillMaxWidth().padding(horizontal = 4.dp).height(1.dp).background(LocalPaper.current.line))

/** Above the message box while a Reply is picked (#627): what it replies to, and ✕. */
@Composable
fun ReplyChip(text: String, onClear: () -> Unit) {
    val p = LocalPaper.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp).clip(shape).background(p.panel).border(1.dp, p.line2, shape).padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Reply to: $text", color = p.muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        IconButton(onClick = onClear) { Icon(Icons.Outlined.Close, "Don't reply to it", tint = p.muted, modifier = Modifier.size(18.dp)) }
    }
}

/**
 * A run's step line ([RunSteps]): folded, a check and how many steps it took, then a mark for each skill it changed
 * and each bot it messaged (on a phone the marks alone; TalkBack reads their names); a run at work shows a spinner
 * (a still dot while it waits for the owner's OK), what it is doing in the server's words ([line]) and its [count] so
 * far. A tap opens the timeline: a row per step with its time.
 */
@Composable
fun StepLine(r: Run, line: String?, count: Int, held: Boolean, color: String?) {
    val p = LocalPaper.current
    var open by rememberSaveable(r.id) { mutableStateOf(false) }
    val skills = remember(r) { RunSteps.skills(r) }
    val bots = remember(r) { RunSteps.messaged(r) }
    val now = when { held -> OpeningLine.WAITING_FOR_OK; !line.isNullOrBlank() -> line; else -> "Working" }
    val label = if (r.isRunning) listOf(now, RunSteps.countWords(count)).filter { it.isNotEmpty() }.joinToString(", ")
    else (listOf(RunSteps.countWords(count)) + skills.map { "the skill $it" } + bots.map { it.name }).filter { it.isNotEmpty() }.joinToString(", ")
    val shape = RoundedCornerShape(12.dp)
    Column {
        Row(
            Modifier.clip(shape).background(p.panel).border(1.dp, p.sunk, shape).clickable(onClickLabel = if (open) "Hide the steps" else "Show the steps") { open = !open }
                .heightIn(min = 40.dp).padding(horizontal = 10.dp)
                .semantics(mergeDescendants = true) { contentDescription = label; if (r.isRunning) liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(if (open) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight, null, tint = p.muted, modifier = Modifier.size(16.dp))
            if (r.isRunning) {
                val accent = parseColor(color, p.ok)
                if (held) Canvas(Modifier.size(8.dp)) { drawCircle(accent.copy(alpha = .5f)) }
                else CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = accent)
                Text(now, color = p.text, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (count > 0) { Dot(); Text(RunSteps.countWords(count), color = p.faint, fontSize = 12.sp, fontFamily = FontFamily.Monospace, maxLines = 1) }
            } else {
                Icon(Icons.Outlined.Check, null, tint = p.ok, modifier = Modifier.size(16.dp))
                if (count > 0) Text(RunSteps.countWords(count), color = p.muted, fontSize = 12.sp, fontFamily = FontFamily.Monospace, maxLines = 1)
                skills.forEach { _ -> Dot(); Icon(Icons.Outlined.AutoAwesome, null, tint = p.dot, modifier = Modifier.size(16.dp)) }
                bots.forEach { _ -> Dot(); Icon(Icons.AutoMirrored.Outlined.Chat, null, tint = p.muted, modifier = Modifier.size(16.dp)) }
            }
        }
        Unfold(open) { Timeline(r) }
    }
}

@Composable
private fun Dot() = Text("·", color = LocalPaper.current.faint, fontSize = 13.sp)

/** The open step line: a row per step, message and skill change, each with its time, along a thin line. */
@Composable
private fun Timeline(r: Run) {
    val p = LocalPaper.current
    val rows = remember(r) { RunSteps.timeline(r) }
    if (rows.isEmpty()) return
    val rule = p.line2
    Column(
        Modifier.padding(start = 14.dp, top = 8.dp).drawBehind { drawLine(rule, Offset(0f, 0f), Offset(0f, size.height), strokeWidth = 1.dp.toPx()) }.padding(start = 14.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        rows.forEach { row ->
            Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(row.at?.let { shortTime(it).substringAfterLast(", ") }.orEmpty(), color = p.faint, fontSize = 11.5.sp, fontFamily = FontFamily.Monospace, maxLines = 1, softWrap = false, modifier = Modifier.widthIn(min = 40.dp))
                val icon: ImageVector = when (row.kind) { RunSteps.MESSAGE -> Icons.AutoMirrored.Outlined.Chat; RunSteps.SKILL, RunSteps.CHANGED -> Icons.Outlined.AutoAwesome; else -> Icons.Outlined.Check }
                Icon(icon, null, tint = when (row.kind) { RunSteps.SKILL, RunSteps.CHANGED -> p.dot; "" -> p.ok; else -> p.muted }, modifier = Modifier.size(16.dp).padding(top = 1.dp))
                Column {
                    val (head, rest) = row.text.split("\n", limit = 2).let { it[0] to it.getOrNull(1) }
                    val strong = row.kind == RunSteps.CHANGED || (row.kind == RunSteps.MESSAGE && rest != null) // what it sent and what it changed
                    Text(if (row.n > 1) "$head ×${row.n}" else head, color = if (strong) p.text else p.muted, fontSize = 13.sp, fontWeight = if (strong) FontWeight.Medium else FontWeight.Normal)
                    if (!rest.isNullOrBlank()) Text(rest, color = p.faint, fontSize = 12.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** The footer of a run at work: when it started, and Stop for that run. A finished run's time is under its reply. */
@Composable
fun BlockFoot(r: Run, onStop: () -> Unit) {
    if (!r.isRunning) return
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(shortTime(r.startedAt), color = p.faint, fontSize = 12.sp)
        Spacer(Modifier.weight(1f))
        WordButton("Stop", p.err, onStop)
    }
}
