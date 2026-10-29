package dev.botdot.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Plan
import dev.botdot.app.data.PlanView
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn

/**
 * A bot's or the Chief's plan in a dock above the message box (docs/api.md, "The plan"). Folded, as it starts on a
 * phone: one line, "Plan · step 3 of 5", the step at work and a thin bar; a tap opens it. Open: a grab handle that
 * folds it, "Plan 2 of 5" with a ring, then the steps: done ones struck through, the one at work with its words. A
 * long plan folds the steps that are done into one row, and its list has a most height and fades at its end. A
 * stopped plan says "Stopped at step N of M", with Dismiss and nothing to carry on: the owner just writes.
 */
@Composable
fun PlanDock(view: PlanView?, color: String?, who: String, folded: Boolean, onFold: (Boolean) -> Unit, onDismiss: () -> Unit) {
    if (view == null) return
    val p = LocalPaper.current
    val accent = parseColor(color, p.ok)
    val plan = view.plan
    val shape = Radius.card
    Column(
        Modifier.fillMaxWidth().padding(start = Space.s12, end = Space.s12, top = Space.s8).clip(shape).background(p.panel).border(1.dp, p.line2, shape)
            .semantics { paneTitle = if (view.stopped) tr("{who}'s plan, stopped", "who" to who) else tr("{who}'s plan", "who" to who) },
    ) {
        when {
            view.stopped -> Stopped(plan, onDismiss)
            folded -> Folded(plan, accent) { onFold(false) }
            else -> Open(plan, accent) { onFold(true) }
        }
    }
}

@Composable
private fun Folded(plan: Plan, accent: Color, onOpen: () -> Unit) {
    val p = LocalPaper.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClickLabel = tr("Open the plan"), role = Role.Button, onClick = onOpen)
            .semantics { stateDescription = tr("Folded") }.padding(horizontal = Space.s16),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12),
    ) {
        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = accent)
        Text(tr("Plan"), color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s14)
        Text(tr("step {step} of {total}", "step" to plan.step, "total" to plan.total), color = p.muted, fontFamily = FontFamily.Monospace, fontSize = Type.s12)
        Text(plan.now?.let { it.doing.ifEmpty { it.text } }.orEmpty(), color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
    }
    Bar(plan, accent)
}

@Composable
private fun Open(plan: Plan, accent: Color, onFold: () -> Unit) {
    val p = LocalPaper.current
    var showDone by remember(plan.total) { mutableStateOf(false) }
    // The grab handle: a tap folds the plan to its one line.
    Box(
        Modifier.fillMaxWidth().height(24.dp).clickable(onClickLabel = tr("Fold the plan"), role = Role.Button, onClick = onFold).semantics { stateDescription = tr("Open") },
        contentAlignment = Alignment.Center,
    ) { Box(Modifier.width(32.dp).height(4.dp).clip(CircleShape).background(Color(0xFF5F5F5F))) }
    Row(Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s16, bottom = Space.s8), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
        Text(tr("Plan"), color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s16)
        Text(tr("{done} of {total}", "done" to plan.done, "total" to plan.total), color = p.muted, fontFamily = FontFamily.Monospace, fontSize = Type.s12)
        Spacer(Modifier.weight(1f))
        Ring(plan, accent)
    }
    val hide = !showDone && plan.total > Plan.MANY && plan.done > 1
    val shown = if (hide) plan.steps.filter { it.status != Plan.DONE } else plan.steps
    val long = plan.total > Plan.MANY
    Column(
        Modifier.fillMaxWidth().heightIn(max = 280.dp)
            .then(if (long) Modifier.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }.drawWithContent {
                drawContent()
                // The list fades at its end: there is more below.
                drawRect(Brush.verticalGradient(listOf(Color.Black, Color.Transparent), startY = size.height - 28.dp.toPx(), endY = size.height), blendMode = BlendMode.DstIn)
            } else Modifier)
            .verticalScroll(rememberScrollState()).padding(bottom = if (long) Space.s16 else Space.s8),
    ) {
        if (hide) Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(onClickLabel = tr("Show the steps that are done"), role = Role.Button) { showDone = true }.padding(horizontal = Space.s16),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s16),
        ) {
            Icon(Icons.Filled.Check, null, tint = p.ok, modifier = Modifier.size(20.dp))
            Text(trn(plan.done, "{n} step done · show", "{n} steps done · show"), color = p.muted, fontSize = Type.s14)
        }
        shown.forEach { StepRow(it, accent) }
    }
}

@Composable
private fun StepRow(s: Plan.Step, accent: Color) {
    val p = LocalPaper.current
    Row(
        Modifier.fillMaxWidth().background(if (s.status == Plan.DOING) p.sunk else Color.Transparent).heightIn(min = 40.dp).padding(horizontal = Space.s16, vertical = Space.s8)
            .semantics(mergeDescendants = true) { stateDescription = when (s.status) { Plan.DONE -> tr("Done"); Plan.DOING -> tr("In progress"); else -> tr("To do") } },
        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(Space.s16),
    ) {
        Box(Modifier.size(20.dp).padding(top = 1.dp), contentAlignment = Alignment.Center) {
            when (s.status) {
                Plan.DONE -> Icon(Icons.Filled.Check, null, tint = p.ok, modifier = Modifier.size(20.dp))
                Plan.DOING -> CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = accent)
                else -> Box(Modifier.size(13.dp).border(1.5.dp, Color(0xFF5F5F5F), CircleShape))
            }
        }
        Column(Modifier.weight(1f)) {
            Text(s.text, color = when (s.status) { Plan.DONE -> p.faint; Plan.DOING -> p.text; else -> Color(0xFFD0D0D0) }, fontSize = Type.s14, lineHeight = Type.line20,
                textDecoration = if (s.status == Plan.DONE) TextDecoration.LineThrough else null)
            if (s.status == Plan.DOING && s.doing.isNotEmpty() && s.doing != s.text) Text(s.doing, color = p.muted, fontSize = Type.s12)
        }
    }
}

@Composable
private fun Stopped(plan: Plan, onDismiss: () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s16, top = Space.s12, bottom = Space.s4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
        Text(tr("Plan"), color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s16)
        Text(tr("Stopped at step {step} of {total}", "step" to plan.step, "total" to plan.total), color = p.warnText, fontFamily = FontFamily.Monospace, fontSize = Type.s12)
    }
    if (plan.done > 0) StoppedRow(trn(plan.done, "{n} step done", "{n} steps done"), p.faint) { Icon(Icons.Filled.Check, null, tint = p.ok, modifier = Modifier.size(20.dp)) }
    plan.now?.takeIf { it.status != Plan.DONE }?.let { now -> StoppedRow(now.text, p.warnText) { Icon(Icons.Filled.Close, null, tint = p.warn, modifier = Modifier.size(20.dp)) } }
    if (plan.left > 0) StoppedRow(trn(plan.left, "{n} step not started", "{n} steps not started"), p.faint) {
        Canvas(Modifier.size(13.dp)) { drawCircle(Color(0xFF5F5F5F), style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3f, 3f)))) }
    }
    Box(
        Modifier.padding(start = Space.s12, bottom = Space.s8).heightIn(min = 48.dp).clip(CircleShape).clickable(onClickLabel = tr("Dismiss the plan"), role = Role.Button, onClick = onDismiss).padding(horizontal = Space.s12),
        contentAlignment = Alignment.Center,
    ) { Text(tr("Dismiss"), color = p.text, fontWeight = FontWeight.Medium, fontSize = Type.s14) }
}

@Composable
private fun StoppedRow(text: String, tint: Color, mark: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s8), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(Space.s16)) {
        Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) { mark() }
        Text(text, color = tint, fontSize = Type.s14, modifier = Modifier.weight(1f))
    }
}

/** The thin bar of a folded plan: how much of it is done. */
@Composable
private fun Bar(plan: Plan, accent: Color) {
    val p = LocalPaper.current
    val part = if (plan.total == 0) 0f else plan.done.toFloat() / plan.total
    Canvas(Modifier.fillMaxWidth().height(3.dp).semantics { contentDescription = tr("{done} of {total} done", "done" to plan.done, "total" to plan.total) }) {
        drawRect(p.sunk)
        drawRect(accent, size = Size(size.width * part, size.height))
    }
}

/** The ring of an open plan: how much of it is done. */
@Composable
private fun Ring(plan: Plan, accent: Color) {
    val p = LocalPaper.current
    val part = if (plan.total == 0) 0f else plan.done.toFloat() / plan.total
    Canvas(Modifier.size(28.dp).semantics { contentDescription = tr("{done} of {total} done", "done" to plan.done, "total" to plan.total) }) {
        val w = 4.dp.toPx()
        val box = Size(size.width - w, size.height - w)
        val at = Offset(w / 2, w / 2)
        drawArc(p.line2, 0f, 360f, false, at, box, style = Stroke(w))
        drawArc(accent, -90f, 360f * part, false, at, box, style = Stroke(w))
    }
}

/** The plan under a reply that is done: one line, "Plan · 5 of 5 done", that opens to its steps. */
@Composable
fun PlanFold(plan: Plan?) {
    if (plan == null) return
    val p = LocalPaper.current
    var open by remember(plan) { mutableStateOf(false) }
    Column(Modifier.padding(top = Space.s8)) {
        Row(
            Modifier.heightIn(min = 40.dp).clip(Radius.small).clickable(onClickLabel = if (open) tr("Fold the plan") else tr("Show the plan"), role = Role.Button) { open = !open },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8),
        ) {
            if (plan.finished) Icon(Icons.Filled.Check, null, tint = p.ok, modifier = Modifier.size(16.dp))
            Text(tr("Plan · {done} of {total} done", "done" to plan.done, "total" to plan.total) + if (open) " ⌄" else " ›", color = p.muted, fontSize = Type.s14)
        }
        Unfold(open) { Column { plan.steps.forEachIndexed { i, s ->
            Text("${i + 1}. ${s.text}", color = p.faint, fontSize = Type.s14, lineHeight = Type.line20, textDecoration = if (s.status == Plan.DONE) TextDecoration.LineThrough else null, modifier = Modifier.padding(start = Space.s4, top = Space.s4))
        } } }
    }
}
