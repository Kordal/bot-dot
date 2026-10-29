package dev.botdot.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.Run
import dev.botdot.app.data.RunSteps
import dev.botdot.app.data.tr

/**
 * One run of a bot's chat as one block (#625; `runBlockHTML` in public/bot-chat.js): what started it, what was steered
 * into it, its step line, its reply, and the runs that reply to it as further rounds (#627). No frame (#636): the
 * owner's pill and the plain reply say where it begins and ends. A long press offers what can be done with it:
 * [onReply] "Reply to this task", [onDetails] its steps, [copy] the reply's text.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RunBlock(onReply: (() -> Unit)? = null, onDetails: (() -> Unit)? = null, copy: String? = null, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    var sheet by remember { mutableStateOf(false) }
    val offers = onReply != null || onDetails != null || !copy.isNullOrBlank()
    Column(
        Modifier.fillMaxWidth()
            .then(if (offers) Modifier.pointerInput(onReply, onDetails, copy) { detectTapGestures(onLongPress = { sheet = true }) } else Modifier)
            .padding(vertical = Space.s4),
        verticalArrangement = Arrangement.spacedBy(Space.s12), content = content,
    )
    if (sheet) ModalBottomSheet(onDismissRequest = { sheet = false }, containerColor = p.panel) {
        Column(Modifier.padding(bottom = Space.s8)) {
            onReply?.let { SheetRow(Icons.AutoMirrored.Outlined.Reply, REPLY_TO_TASK) { sheet = false; it() } }
            onDetails?.let { SheetRow(Icons.Outlined.ExpandMore, DETAILS) { sheet = false; it() } }
            copy?.takeIf { it.isNotBlank() }?.let { text -> SheetRow(Icons.Outlined.ContentCopy, COPY) { sheet = false; copyToClipboard(context, text) } }
        }
    }
}

/** What a long press on a run offers (#627, #636), as on the web page. */
internal val REPLY_TO_TASK: String get() = tr("Reply to this task")
internal val DETAILS: String get() = tr("Details")
internal val COPY: String get() = tr("Copy")

@Composable
private fun SheetRow(icon: ImageVector, text: String, onClick: () -> Unit) {
    val p = LocalPaper.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(onClick = onClick).padding(horizontal = Space.s16),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s16),
    ) {
        Icon(icon, null, tint = p.text, modifier = Modifier.size(24.dp))
        Text(text, color = p.text, fontSize = Type.s16)
    }
}

/** The line between two rounds of a block (#627). */
@Composable
fun RoundRule() = Spacer(Modifier.fillMaxWidth().padding(horizontal = Space.s4).height(1.dp).background(LocalPaper.current.line))

/** Above the message box while a Reply is picked (#627): what it replies to, and ✕. */
@Composable
fun ReplyChip(text: String, onClear: () -> Unit) {
    val p = LocalPaper.current
    val shape = Radius.card
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s4).raised(shape).padding(start = Space.s12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(tr("Reply to: {text}", "text" to text), color = p.muted, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        IconButton(onClick = onClear) { Icon(Icons.Outlined.Close, tr("Don't reply to it"), tint = p.muted, modifier = Modifier.size(18.dp)) }
    }
}

/**
 * A run's step line ([RunSteps]), one line with no box (#636): folded, a check, how many steps it took, each skill it
 * changed by name, each bot it messaged, and how long it took; a run at work shows a spinner (a still dot while it
 * waits for the owner's OK), what it is doing in the server's words ([line]), its [count] so far and Stop ([onStop]).
 * A tap, or Details on the run's long press, opens the timeline: a row per step with its time. [open]: the timeline
 * shows; [onOpen]: it is opened or closed.
 */
@Composable
fun StepLine(r: Run, line: String?, count: Int, held: Boolean, color: String?, open: Boolean, onOpen: (Boolean) -> Unit, onStop: (() -> Unit)? = null) {
    val p = LocalPaper.current
    val skills = remember(r) { RunSteps.skills(r) }
    val bots = remember(r) { RunSteps.messaged(r) }
    val took = if (r.isRunning) "" else RunSteps.took(r.startedAt, r.endedAt)
    val now = when { held -> OpeningLine.WAITING_FOR_OK; !line.isNullOrBlank() -> line; else -> tr("Working") }
    val label = if (r.isRunning) listOf(now, RunSteps.countWords(count)).filter { it.isNotEmpty() }.joinToString(", ")
    else (listOf(RunSteps.countWords(count)) + skills.map { tr("the skill {name}", "name" to it) } + bots.map { it.name } + took).filter { it.isNotEmpty() }.joinToString(", ")
    Column {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 32.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.weight(1f).clip(Radius.small).clickable(onClickLabel = if (open) tr("Hide the steps") else tr("Show the steps")) { onOpen(!open) }
                    .heightIn(min = 32.dp).padding(end = Space.s8)
                    .semantics(mergeDescendants = true) { contentDescription = label; if (r.isRunning) liveRegion = LiveRegionMode.Polite },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8),
            ) {
                if (r.isRunning) {
                    val accent = parseColor(color, p.ok)
                    if (held) Canvas(Modifier.size(8.dp)) { drawCircle(accent.copy(alpha = .5f)) }
                    else CircularProgressIndicator(Modifier.size(13.dp), strokeWidth = 2.dp, color = p.muted)
                    Text(now, color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (count > 0) { Dot(); Text(RunSteps.countWords(count), color = p.muted, fontSize = Type.s12, fontFamily = FontFamily.Monospace, maxLines = 1) }
                } else {
                    Icon(if (open) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight, null, tint = p.muted, modifier = Modifier.size(15.dp))
                    Icon(Icons.Outlined.Check, null, tint = p.ok, modifier = Modifier.size(15.dp))
                    Text(stepWords(count, skills, bots.map { it.name }, took, p.muted, p.dot, p.faint), fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (r.isRunning && onStop != null) WordButton(tr("Stop"), p.err, onStop)
        }
        Unfold(open) { Timeline(r) }
    }
}

/** A finished run's step line in words: "23 steps · backup-check · Infra Admin · 7 min", the count in mono and each skill in the dot's colour. */
private fun stepWords(count: Int, skills: List<String>, bots: List<String>, took: String, muted: Color, skill: Color, faint: Color) = buildAnnotatedString {
    var first = true
    fun part(text: String, style: SpanStyle) {
        if (text.isEmpty()) return
        if (!first) withStyle(SpanStyle(color = faint)) { append(" · ") }
        first = false
        withStyle(style) { append(text) }
    }
    part(RunSteps.countWords(count), SpanStyle(color = muted, fontFamily = FontFamily.Monospace))
    skills.forEach { part(it, SpanStyle(color = skill)) }
    bots.forEach { part(it, SpanStyle(color = muted)) }
    part(took, SpanStyle(color = faint))
}

@Composable
private fun Dot() = Text("·", color = LocalPaper.current.faint, fontSize = Type.s14)

/** The open step line: a row per step, message and skill change, each with its time, along a thin line. */
@Composable
private fun Timeline(r: Run) {
    val p = LocalPaper.current
    val rows = remember(r) { RunSteps.timeline(r) }
    if (rows.isEmpty()) return
    val rule = p.line2
    Column(
        Modifier.padding(start = Space.s16, top = Space.s8).drawBehind { drawLine(rule, Offset(0f, 0f), Offset(0f, size.height), strokeWidth = 1.dp.toPx()) }.padding(start = Space.s16),
        verticalArrangement = Arrangement.spacedBy(Space.s4),
    ) {
        rows.forEach { row ->
            Row(Modifier.padding(vertical = Space.s4), horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
                Text(row.at?.let { shortTime(it).substringAfterLast(", ") }.orEmpty(), color = p.faint, fontSize = Type.s12, fontFamily = FontFamily.Monospace, maxLines = 1, softWrap = false, modifier = Modifier.widthIn(min = 40.dp))
                val icon: ImageVector = when (row.kind) { RunSteps.MESSAGE -> Icons.AutoMirrored.Outlined.Chat; RunSteps.SKILL, RunSteps.CHANGED -> Icons.Outlined.AutoAwesome; else -> Icons.Outlined.Check }
                Icon(icon, null, tint = when (row.kind) { RunSteps.SKILL, RunSteps.CHANGED -> p.dot; "" -> p.ok; else -> p.muted }, modifier = Modifier.size(16.dp).padding(top = 1.dp))
                Column {
                    val (head, rest) = row.text.split("\n", limit = 2).let { it[0] to it.getOrNull(1) }
                    val strong = row.kind == RunSteps.CHANGED || (row.kind == RunSteps.MESSAGE && rest != null) // what it sent and what it changed
                    Text(if (row.n > 1) "$head ×${row.n}" else head, color = if (strong) p.text else p.muted, fontSize = Type.s14, fontWeight = if (strong) FontWeight.Medium else FontWeight.Normal)
                    if (!rest.isNullOrBlank()) Text(rest, color = p.faint, fontSize = Type.s12, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/**
 * The footer of a run at work whose step line does not show ([RunSteps.shows]): when it started, and Stop for that
 * run. A step line has Stop on it (#636), and a finished run's time is in its step line or under its reply.
 */
@Composable
fun BlockFoot(r: Run, onStop: () -> Unit) {
    if (!r.isRunning) return
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().padding(start = Space.s4), verticalAlignment = Alignment.CenterVertically) {
        Text(shortTime(r.startedAt), color = p.faint, fontSize = Type.s12)
        Spacer(Modifier.weight(1f))
        WordButton(tr("Stop"), p.err, onStop)
    }
}
