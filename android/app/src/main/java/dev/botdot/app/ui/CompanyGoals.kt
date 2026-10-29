package dev.botdot.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanyFloor
import dev.botdot.app.data.I18n
import dev.botdot.app.data.Objective
import dev.botdot.app.data.tr
import java.time.format.DateTimeFormatter

/**
 * The objectives above the floor (#690, #704; web: goalsHTML in public/company-home.js): a card each, drawn as the owner
 * picked under "Show as": a pace chart against the line to its target by default, a bar with the number, or its status
 * (an objective with no number shows its steps as a checklist, or one tick). On day 1 a numeric one shows where it
 * starts in place of a chart, and one read from a connected app (#699) says when it last updated. The rules are
 * [CompanyFloor]'s.
 */
@Composable
internal fun Goals(ui: CompanyUi, c: Company) {
    if (c.objectives.isEmpty()) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        c.objectives.forEach { GoalCard(ui, c, it) }
    }
}

private fun displayName(k: String): String = when (k) { "pace" -> tr("Pace chart"); "bar" -> tr("Bar"); else -> tr("Status") }

@Composable
private fun GoalCard(ui: CompanyUi, c: Company, o: Objective) {
    val p = LocalPaper.current
    val show = CompanyFloor.displayOf(o)
    val numeric = o.target > 0
    val pace = CompanyFloor.pace(o, c.day)
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().raised(Radius.card).padding(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(o.color)
            Text(o.name, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(horizontal = Space.s8))
            CompanyFloor.sourceLine(o)?.let { Text(it, color = if (o.source?.failed != null) p.warnText else p.faint, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(end = Space.s8).widthIn(max = 140.dp)) }
            if (o.steps.isNotEmpty()) Text("${CompanyFloor.stepsDone(o)}/${o.steps.size}", color = p.faint, fontSize = Type.s12, fontFamily = GeistMono,
                modifier = Modifier.padding(end = Space.s8))
            Box {
                RoundButton(Icons.Outlined.BarChart, tr("Show as"), size = 36.dp) { menu = true }
                DropdownMenu(menu, { menu = false }, containerColor = p.panel) {
                    CompanyFloor.DISPLAYS.forEach { k ->
                        DropdownMenuItem({ Text(displayName(k), color = p.text) }, {
                            menu = false
                            if (k != show) ui.call({ it.setObjective(o.id, display = k) })
                        }, trailingIcon = { if (k == show) Icon(Icons.Filled.Check, null, tint = p.text) })
                    }
                }
            }
        }
        when {
            show == "status" && !numeric -> Steps(ui, o)
            show == "status" -> Row(verticalAlignment = Alignment.CenterVertically) {
                PaceChip(pace ?: CompanyFloor.Pace.ON)
                Text("${CompanyFloor.num(o.current)} / ${CompanyFloor.num(o.target)}", color = p.muted, fontSize = Type.s14, fontFamily = GeistMono,
                    modifier = Modifier.padding(start = Space.s12))
            }
            !numeric -> Steps(ui, o)
            CompanyFloor.firstDay(c) -> Start(c, o)
            else -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Num(o)
                    pace?.let { Box(Modifier.padding(start = Space.s12)) { PaceChip(it) } }
                }
                if (show == "bar") Box(Modifier.fillMaxWidth().height(Space.s8).clip(Radius.pill).background(p.line2)) {
                    Box(Modifier.fillMaxWidth(CompanyFloor.ratio(o)).height(Space.s8).clip(Radius.pill).background(parseColor(o.color, p.muted)))
                } else PaceChart(c, o)
            }
        }
    }
}

/** The number now, and the one aimed at. */
@Composable
private fun Num(o: Objective) {
    val p = LocalPaper.current
    Row(verticalAlignment = Alignment.Bottom) {
        Text(CompanyFloor.num(o.current), color = p.text, fontSize = Type.s32, fontWeight = FontWeight.SemiBold, lineHeight = Type.line40)
        Text(" / ${CompanyFloor.num(o.target)}", color = p.faint, fontSize = Type.s14, modifier = Modifier.padding(bottom = Space.s8))
    }
}

/** Ahead, On track or Behind, in a pill. */
@Composable
private fun PaceChip(pace: CompanyFloor.Pace) {
    val p = LocalPaper.current
    val behind = pace == CompanyFloor.Pace.BEHIND
    val words = when (pace) { CompanyFloor.Pace.AHEAD -> tr("Ahead"); CompanyFloor.Pace.ON -> tr("On track"); CompanyFloor.Pace.BEHIND -> tr("Behind") }
    Text(words, color = if (behind) p.warnText else p.okText, fontSize = Type.s12, fontWeight = FontWeight.Medium,
        modifier = Modifier.clip(Radius.pill).background(if (behind) p.warnSoft else p.okSoft).padding(horizontal = Space.s12, vertical = Space.s4))
}

/** Day 1: no chart yet, but where it starts: the number to reach, the day, the date of the first check-in. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Start(c: Company, o: Objective) {
    val p = LocalPaper.current
    val at = CompanyFloor.checkinDate(c.startedAt)
    Num(o)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s8), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        val facts = listOfNotNull(tr("Day {n} of 90", "n" to (c.day ?: 1)), at?.let { tr("Check-in {date}", "date" to it.format(DateTimeFormatter.ofPattern("d MMM", I18n.locale))) })
        facts.forEach { Text(it, color = p.muted, fontSize = Type.s12, fontFamily = GeistMono, modifier = Modifier.clip(Radius.pill).background(p.fill).padding(horizontal = Space.s12, vertical = Space.s4)) }
    }
}

/** The pace chart: the dashed line from 0 on day 1 to the target on day 90, the objective's days, a dot for today, and days 1, 30, 60, 90 under it. */
@Composable
private fun PaceChart(c: Company, o: Objective) {
    val p = LocalPaper.current
    val k = CompanyFloor.chart(o, c.day)
    val color = parseColor(o.color, p.muted)
    Column(Modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(96.dp)) {
            val w = size.width
            val h = size.height
            fun at(pt: CompanyFloor.Point) = Offset(pt.x * w, pt.y * h)
            k.ticks.take(2).forEach { (_, x) -> drawLine(p.line, Offset(x * w, 0f), Offset(x * w, h), 1.dp.toPx()) }
            drawLine(p.line2, Offset(0f, h), Offset(w, h), 1.dp.toPx())
            drawLine(p.faint, at(k.line.first), at(k.line.second), 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx())))
            if (k.actual.size > 1) drawPath(Path().apply {
                k.actual.forEachIndexed { i, pt -> if (i == 0) moveTo(pt.x * w, pt.y * h) else lineTo(pt.x * w, pt.y * h) }
            }, color, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            val now = at(k.actual.last())
            drawCircle(color.copy(alpha = 0.3f), 9.dp.toPx(), now)
            drawCircle(p.raise2, 6.dp.toPx(), now)
            drawCircle(color, 3.dp.toPx(), now)
        }
        BoxWithConstraints(Modifier.fillMaxWidth().padding(top = Space.s8).heightIn(min = 18.dp)) {
            val w = maxWidth
            val label = 64.dp
            Text(tr("Day {n}", "n" to 1), color = p.text, fontSize = Type.s12, fontFamily = GeistMono, maxLines = 1)
            k.ticks.forEach { (d, x) ->
                val last = d == CompanyFloor.DAYS_ALL
                Text(tr("Day {n}", "n" to d), color = p.faint, fontSize = Type.s12, fontFamily = GeistMono, maxLines = 1, textAlign = if (last) TextAlign.End else TextAlign.Center,
                    modifier = Modifier.width(label).offset(x = if (last) w - label else w * x - label / 2))
            }
        }
    }
}

/** An objective with no number: its steps to tick, or one tick, Done, without steps. A tick sends the steps whole. */
@Composable
private fun Steps(ui: CompanyUi, o: Objective) {
    if (o.steps.isEmpty()) GoalStep(o, tr("Done"), o.done) { ui.call({ a -> a.setObjective(o.id, done = it) }) }
    else Column {
        o.steps.forEachIndexed { i, s -> GoalStep(o, s.text, s.done) { ui.call({ a -> a.setObjective(o.id, steps = CompanyFloor.ticked(o, i, it)) }) } }
    }
}

@Composable
private fun GoalStep(o: Objective, text: String, done: Boolean, onTick: (Boolean) -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(Radius.small).clickable { onTick(!done) }, verticalAlignment = Alignment.CenterVertically) {
        Checkbox(done, onTick, colors = CheckboxDefaults.colors(checkedColor = parseColor(o.color, p.ink), checkmarkColor = p.inkText, uncheckedColor = p.line2))
        Text(text, color = if (done) p.faint else p.text, fontSize = Type.s14, textDecoration = if (done) TextDecoration.LineThrough else null, modifier = Modifier.weight(1f))
    }
}
