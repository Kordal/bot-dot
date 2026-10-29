package dev.botdot.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.CheckinDue
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanyFloor
import dev.botdot.app.data.CompanyTeam
import dev.botdot.app.data.Objective
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.Suggested
import dev.botdot.app.data.Waiting
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.launch

/** Where the Company's home leads: a bot's chat, the Chief's, Needs you, and a new Chief chat with words started. */
internal class CompanyWays(val onBot: (String) -> Unit = {}, val onChief: () -> Unit = {}, val onNeeds: () -> Unit = {}, val onChiefSay: (String) -> Unit = {})

private val GOLD = Color(0xFFE8B44A)

/**
 * The Company's home on Android (#675; web: public/company-home.js): the office floor in one column, as the phone's
 * "Big teams" mockup has it. The header (its name, "Day N of 90") and the days 30, 60 and 90 on a line; the check-in
 * that waits; the floor (the whiteboard of objectives, the Chief's glass office, a room per team with the lead's crown
 * and the team's count, desks for those that work or ask, a bench for the idle ones, the bots in no team, the bot
 * the Chief suggests, New team); then the You panel (the week's plan, what waits, the owner's tasks, Add a task). A
 * room opens its team as a sheet, with Make lead. The rules of who sits where are [CompanyFloor]'s.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CompanyHome(ui: CompanyUi, c: Company, ways: CompanyWays) {
    val p = LocalPaper.current
    val bots = ui.bots.collectAsState().value.orEmpty()
    val waiting by ui.app.store.waiting.collectAsState(initial = emptyList())
    val lines by ui.app.store.lines.lines.collectAsState()
    val chief by ui.app.store.chief.value.collectAsState()
    val info = remember(bots, waiting) {
        val waits = waiting.mapNotNull { it.bot }.groupingBy { it }.eachCount()
        val byId = bots.associateBy { it.id }
        CompanyFloor.Info(
            asks = { id -> (waits[id] ?: 0) + if (byId[id]?.let(::question) != null) 1 else 0 },
            working = { id -> byId[id]?.running == true },
        )
    }
    val floor = remember(c, bots, info) { CompanyFloor.floor(c, bots, info) }
    fun lineOf(b: Bot): String = question(b) ?: if (b.running) OpeningLine.status(lines["bot:${b.id}"], working = true) else b.description
    var teamOpen by rememberSaveable { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(c.name.ifEmpty { c.start }, color = p.text, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            c.day?.let { Text(tr("Day {n} of 90", "n" to it), color = p.muted, fontSize = 12.sp, fontFamily = GeistMono,
                modifier = Modifier.padding(start = 12.dp).border(1.dp, p.line2, RoundedCornerShape(99.dp)).padding(horizontal = 10.dp, vertical = 4.dp)) }
        }
        c.day?.let { DaysLine(c, it) }
        c.checkin?.let { CheckinCard(ui, it, ways) }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(p.panel).border(1.dp, p.line, RoundedCornerShape(20.dp)).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Board(c)
            ChiefOffice(busy = chief?.busy == true, line = lines.entries.firstOrNull { it.key.startsWith("chief") }?.value.takeIf { chief?.busy == true }, onClick = ways.onChief)
            floor.rooms.forEach { r -> TeamRoom(r, here = teamOpen == r.team.id, line = { lineOf(it) }, onBot = ways.onBot) { teamOpen = r.team.id } }
            if (floor.loose.isNotEmpty()) FlowRowCentered { floor.loose.forEach { s -> Desk(s.bot, s.seat, count = info.asks(s.bot.id), line = lineOf(s.bot), onClick = { ways.onBot(s.bot.id) }) } }
            c.suggestion?.let { SuggestedCard(ui, c, it) }
            NewTeam(ui, c)
        }
        YouPanel(ui, c, bots, waiting, ways)
    }
    val team = teamOpen?.let { id -> c.teams.firstOrNull { it.id == id } }
    if (team != null) ModalBottomSheet(onDismissRequest = { teamOpen = null }, containerColor = p.panel) {
        TeamSheet(ui, c, team, bots, line = { lineOf(it) }, onBot = { teamOpen = null; ways.onBot(it) })
    }
}

/** A bot's open question, while it is not working: what its desk and its row say. */
private fun question(b: Bot): String? = b.asks?.text?.takeIf { !b.running }?.replace('\n', ' ')?.take(120)

// ---------- the 90 days (#673) ----------

/** Days 30, 60 and 90 on a thin line, filled up to today; an answered day in the colour of its answer, the one that waits marked. */
@Composable
private fun DaysLine(c: Company, day: Int) {
    val p = LocalPaper.current
    BoxWithConstraints(Modifier.fillMaxWidth().height(34.dp)) {
        val w = maxWidth
        Box(Modifier.fillMaxWidth().padding(top = 6.dp).height(2.dp).clip(RoundedCornerShape(1.dp)).background(p.line2))
        Box(Modifier.width(w * CompanyFloor.gone(day)).padding(top = 6.dp).height(2.dp).background(p.muted))
        CompanyFloor.DAYS.forEach { d ->
            val k = c.checkins.firstOrNull { it.day == d }
            val due = c.checkin?.day == d
            val color = when { k?.decision == "keep" -> p.ok; k?.decision == "stop" -> p.err; k != null -> p.warn; due -> p.warn; d <= day -> p.muted; else -> p.line2 }
            val x = w * (d.toFloat() / CompanyFloor.DAYS_ALL)
            val label = tr("Day {n}", "n" to d)
            Box(Modifier.offset(x = x - 5.dp, y = 2.dp).size(10.dp).clip(CircleShape).background(color))
            Text(label, color = if (due) p.warnText else p.faint, fontSize = 11.sp, textAlign = TextAlign.End, maxLines = 1,
                modifier = Modifier.offset(x = (x - 60.dp).coerceAtLeast(0.dp), y = 16.dp).width(60.dp))
        }
    }
}

@Composable
private fun CheckinCard(ui: CompanyUi, k: CheckinDue, ways: CompanyWays) {
    val p = LocalPaper.current
    var busy by remember(k.day) { mutableStateOf(false) }
    fun answer(decision: String) {
        if (busy) return
        busy = true
        ui.scope.launch {
            val a = ui.api ?: run { ui.tell(tr("Can't reach botdot.")); busy = false; return@launch }
            runCatching { a.answerCheckin(k.day, decision) }.onSuccess { d ->
                ui.took(d.company)
                if (decision == "stop") ui.tell(trn(d.paused, "Switched off {n} job of the company's bots.", "Switched off {n} jobs of the company's bots."))
                if (decision == "change") ways.onChiefSay(tr("Day {n} check-in: I want to change direction.", "n" to k.day) + " ")
            }.onFailure { ui.tell(it.message) }
            busy = false
        }
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(p.panel).border(1.dp, p.warn.copy(alpha = 0.35f), RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tr("Day {n} check-in", "n" to k.day), color = p.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            ByChief()
        }
        k.objectives.forEach { o ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(o.color)
                Text(o.name, color = p.text, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
                Text("${CompanyFloor.num(o.current)} / ${CompanyFloor.num(o.target)}", color = p.muted, fontSize = 13.sp, fontFamily = GeistMono)
                Text(if (o.onTrack) tr("On track") else tr("Behind"), color = if (o.onTrack) p.okText else p.warnText, fontSize = 12.sp, modifier = Modifier.padding(start = 10.dp))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            WordsButton(tr("Stop"), enabled = !busy) { answer("stop") }
            Spacer(Modifier.weight(1f))
            WordsButton(tr("Change direction"), enabled = !busy) { answer("change") }
            GoButton(tr("Keep going"), busy = busy) { answer("keep") }
        }
    }
}

@Composable
private fun ByChief() {
    val p = LocalPaper.current
    val chief = chiefNamed()
    Row(verticalAlignment = Alignment.CenterVertically) {
        BotFigure(chief.color, "idle", 20, chief.outfit)
        Text(chief.name, color = p.muted, fontSize = 12.sp, modifier = Modifier.padding(start = 6.dp))
    }
}

/** The week's plan at the top of You: its items, each in its objective's colour, with Change and Approve until approved. */
@Composable
private fun PlanCard(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    val plan = c.plan?.takeIf { it.items.isNotEmpty() } ?: return
    var changing by rememberSaveable { mutableStateOf(false) }
    var typed by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.sunk).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tr("This week"), color = p.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            ByChief()
        }
        plan.items.forEachIndexed { i, x ->
            val color = c.objectives.firstOrNull { it.id == x.objective }?.color
            Row(verticalAlignment = Alignment.Top) {
                Text("${i + 1}.", color = p.faint, fontSize = 14.sp, modifier = Modifier.width(22.dp))
                Text(x.text, color = if (plan.approved) p.muted else p.text, fontSize = 14.sp, lineHeight = 19.sp, modifier = Modifier.weight(1f))
                if (color != null) Box(Modifier.padding(start = 8.dp, top = 5.dp)) { Dot(color) }
            }
        }
        if (!plan.approved) {
            if (changing) AskField(typed, { typed = it.take(1000) }, label = tr("Change"), button = tr("Send"), busy = busy, focus = true) {
                val text = typed.trim()
                if (text.isEmpty()) return@AskField
                busy = true
                ui.call({ it.changePlan(text) }) { ok -> busy = false; if (ok) { typed = ""; changing = false } }
            } else Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.weight(1f))
                WordsButton(tr("Change")) { changing = true }
                GoButton(tr("Approve"), busy = busy) { busy = true; ui.call({ it.approvePlan() }) { busy = false } }
            }
        }
    }
}

// ---------- the floor ----------

/** The whiteboard: each objective, its number and the one aimed at, and a bar in its colour. */
@Composable
private fun Board(c: Company) {
    val p = LocalPaper.current
    val shape = RoundedCornerShape(14.dp)
    Row(Modifier.fillMaxWidth().clip(shape).background(p.sunk).border(1.dp, p.line2, shape).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (c.objectives.isEmpty()) Text(c.goal, color = p.muted, fontSize = 14.sp)
        c.objectives.forEach { o -> Kpi(o, Modifier.weight(1f)) }
    }
}

@Composable
private fun Kpi(o: Objective, modifier: Modifier) {
    val p = LocalPaper.current
    val color = parseColor(o.color, p.muted)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.padding(top = 4.dp)) { Dot(o.color) }
            Text(o.name, color = p.muted, fontSize = 11.5.sp, lineHeight = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 5.dp))
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Text(CompanyFloor.num(o.current), color = p.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            Text(" / ${CompanyFloor.num(o.target)}", color = p.faint, fontSize = 11.sp, modifier = Modifier.padding(bottom = 2.dp))
        }
        Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(p.line2)) {
            Box(Modifier.fillMaxWidth(CompanyFloor.ratio(o)).height(3.dp).background(color))
        }
    }
}

/** The Chief of Staff in a small glass office: its desk, its line while it replies. */
@Composable
private fun ChiefOffice(busy: Boolean, line: String?, onClick: () -> Unit) {
    val p = LocalPaper.current
    val glass = Color(0xFF378ADD)
    val chief = chiefNamed()
    val shape = RoundedCornerShape(14.dp)
    Box(Modifier.fillMaxWidth().clip(shape).background(glass.copy(alpha = 0.08f)).border(1.dp, glass.copy(alpha = 0.45f), shape).clickable(onClickLabel = chief.name, onClick = onClick).padding(vertical = 10.dp),
        contentAlignment = Alignment.Center) {
        DeskFigure(chief.color, if (busy) "working" else "idle", chief.outfit, on = busy, lead = false, crown = false, over = if (busy) OpeningLine.status(line, working = true) else null, name = chief.name)
    }
}

/** A team's room: its name and size, the lead at the head with the crown and the team's count, desks, the bench. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TeamRoom(r: CompanyFloor.Room, here: Boolean, line: (Bot) -> String, onBot: (String) -> Unit, onOpen: () -> Unit) {
    val p = LocalPaper.current
    val color = parseColor(r.team.color, p.muted)
    val shape = RoundedCornerShape(14.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(p.bg).border(1.dp, if (here) color.copy(alpha = 0.7f) else p.line2, shape).clickable(onClickLabel = r.team.name, onClick = onOpen).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Dot(r.team.color)
            Text(r.team.name, color = p.text, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 8.dp).weight(1f, fill = false))
            Text(r.size.toString(), color = p.faint, fontSize = 13.sp, modifier = Modifier.padding(start = 8.dp))
        }
        Desk(r.lead.bot, r.lead.seat, count = r.count, line = line(r.lead.bot), lead = true, crown = !r.solo) { onBot(r.lead.bot.id) }
        if (r.desks.isNotEmpty()) FlowRowCentered { r.desks.forEach { s -> Desk(s.bot, s.seat, line = line(s.bot)) { onBot(s.bot.id) } } }
        if (r.bench.isNotEmpty()) FlowRow(Modifier.clip(RoundedCornerShape(99.dp)).background(p.sunk).padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            r.bench.forEach { s ->
                Box(Modifier.clip(CircleShape).clickable(onClickLabel = s.bot.name) { onBot(s.bot.id) }.semantics { contentDescription = "${s.bot.name}, ${line(s.bot)}" }) {
                    BotFigure(s.bot.color, s.bot.state, 28, s.bot.outfit)
                }
            }
        }
    }
}

/** A bot's desk: what is over it (the team's count, "!" while it asks, its line while it works), its table lit while it works or asks, its head and name. */
@Composable
private fun Desk(b: Bot, seat: CompanyFloor.Seat, count: Int = 0, line: String, lead: Boolean = false, crown: Boolean = false, onClick: () -> Unit) {
    val over = when {
        count > 0 -> count.toString()
        seat == CompanyFloor.Seat.ASKS -> "!"
        b.running -> line.ifBlank { "…" }
        else -> null
    }
    Box(Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClickLabel = b.name, onClick = onClick).semantics { contentDescription = "${b.name}, $line" }) {
        DeskFigure(b.color, b.state, b.outfit, on = seat != CompanyFloor.Seat.IDLE, lead = lead, crown = crown, over = over, strong = count > 0 || seat == CompanyFloor.Seat.ASKS, name = b.name)
    }
}

@Composable
private fun DeskFigure(color: String?, state: String, outfit: kotlinx.serialization.json.JsonElement?, on: Boolean, lead: Boolean, crown: Boolean, over: String?, strong: Boolean = false, name: String) {
    val p = LocalPaper.current
    val c = parseColor(color, p.muted)
    val table: Dp = if (lead) 104.dp else 76.dp
    val head = if (lead) 44 else 36
    Column(Modifier.width(table + 16.dp).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.height(26.dp), contentAlignment = Alignment.BottomCenter) { if (over != null) Bubble(over, strong) }
        Box(Modifier.padding(top = 4.dp).width(table).height(if (lead) 30.dp else 26.dp).clip(RoundedCornerShape(7.dp)).background(p.sunk).border(1.dp, p.line2, RoundedCornerShape(7.dp)),
            contentAlignment = Alignment.TopCenter) {
            Box(Modifier.padding(top = 6.dp).width(table * 0.55f).height(4.dp).clip(RoundedCornerShape(2.dp)).background(if (on) c else p.line2))
        }
        Box(Modifier.offset(y = (-10).dp)) {
            BotFigure(color, state, head, outfit)
            if (crown) Crown(Modifier.align(Alignment.TopEnd).offset(x = 10.dp, y = (-4).dp))
        }
        Text(name, color = if (on) p.text else p.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.offset(y = (-6).dp))
    }
}

/** The lead's crown: the web page's shape, in gold. */
@Composable
private fun Crown(modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    Box(modifier.size(18.dp).clip(CircleShape).background(p.sunk), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(12.dp)) {
            val s = size.width / 24f
            val path = Path().apply {
                moveTo(4 * s, 17 * s); lineTo(3 * s, 7 * s); lineTo(8 * s, 11 * s); lineTo(12 * s, 5 * s); lineTo(16 * s, 11 * s); lineTo(21 * s, 7 * s); lineTo(20 * s, 17 * s); close()
            }
            drawPath(path, GOLD)
        }
    }
}

/** What is over a desk: a count or "!" in white, or a working line in a quiet pill. */
@Composable
private fun Bubble(text: String, strong: Boolean = false) {
    val p = LocalPaper.current
    Text(text, color = if (strong) p.inkText else p.muted, fontSize = 11.sp, fontWeight = if (strong) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.widthIn(max = 150.dp).clip(RoundedCornerShape(99.dp)).background(if (strong) p.ink else p.sunk).border(1.dp, if (strong) p.ink else p.line2, RoundedCornerShape(99.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp))
}

@Composable
private fun Dot(color: String?) = Box(Modifier.size(8.dp).clip(CircleShape).background(parseColor(color, LocalPaper.current.muted)))

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FlowRowCentered(content: @Composable () -> Unit) =
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }

/** The bot the Chief suggests: a dashed card in the colour of the team it would join, Add and dismiss. */
@Composable
private fun SuggestedCard(ui: CompanyUi, c: Company, s: Suggested) {
    val p = LocalPaper.current
    val color = c.teams.firstOrNull { it.id == s.team }?.color ?: "#8e7cff"
    var busy by remember(s.name) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().dashedBox(parseColor(color, p.line2)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        BotFigure(color, "idle", 40)
        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            Text(s.name, color = p.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            if (s.why.isNotBlank()) Text(s.why, color = p.muted, fontSize = 12.5.sp, lineHeight = 17.sp)
        }
        RoundButton(Icons.Filled.Close, tr("Dismiss"), size = 36.dp) { if (!busy) { busy = true; ui.call({ it.dismissSuggested() }) { busy = false } } }
        GoButton(tr("Add"), busy = busy) { busy = true; ui.call({ it.addSuggested() }) { busy = false } }
    }
}

/** A dashed "New team": a name and its bots, the first picked its lead; the bots in no team are offered first. */
@Composable
private fun NewTeam(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    var picking by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).dashedBox(p.line2).clickable(onClickLabel = tr("New team")) { picking = true }.padding(12.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Add, null, tint = p.muted, modifier = Modifier.size(18.dp))
        Text(tr("New team"), color = p.muted, fontSize = 14.sp, modifier = Modifier.padding(start = 8.dp))
    }
    if (picking) {
        val inTeam = c.teams.flatMap { it.bots }.toSet()
        val bots = ui.bots.collectAsState().value.orEmpty().sortedBy { it.id in inTeam }
        BotPicker(tr("New team"), bots, max = 40, action = tr("Create"), hint = { "" }, name = "", onDismiss = { picking = false }) { picked, name ->
            val a = ui.api ?: throw dev.botdot.app.data.ApiException(tr("Can't reach botdot."))
            ui.took(a.newCompanyTeam(name, picked))
        }
    }
}

private fun Modifier.dashedBox(color: Color): Modifier = clip(RoundedCornerShape(14.dp)).drawBehind {
    drawRoundRect(color, cornerRadius = CornerRadius(14.dp.toPx()), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))))
}

// ---------- You, and a team ----------

/** You: the week's plan, what waits for the owner (Approve in place for a permission, else Review), the bots that ask, the owner's tasks, Add a task. */
@Composable
private fun YouPanel(ui: CompanyUi, c: Company, bots: List<Bot>, waiting: List<Waiting>, ways: CompanyWays) {
    val p = LocalPaper.current
    val asking = bots.filter { question(it) != null }
    val chief = chiefNamed()
    val n = waiting.size + asking.size
    var typed by rememberSaveable { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }
    @Composable fun head(color: String?, outfit: kotlinx.serialization.json.JsonElement?) = BotFigure(color ?: chief.color, "idle", 28, if (color == null) chief.outfit else outfit)
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(p.panel).border(1.dp, p.line, RoundedCornerShape(20.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(36.dp).clip(CircleShape).border(1.dp, p.line2, CircleShape), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Person, null, tint = p.text, modifier = Modifier.size(20.dp)) }
            Text(tr("You"), color = p.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 12.dp).weight(1f))
            if (n > 0) Text(n.toString(), color = p.inkText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(CircleShape).background(p.ink).padding(horizontal = 8.dp, vertical = 2.dp))
        }
        PlanCard(ui, c)
        waiting.forEach { w ->
            YouRow({ head(w.color, w.outfit) }, w.text) {
                val id = w.permission
                if (id != null) SmallButton(tr("Approve")) {
                    ui.scope.launch { runCatching { (ui.api ?: throw dev.botdot.app.data.ApiException(tr("Can't reach botdot."))).answerAsk(id, true) }.onFailure { ui.tell(it.message) }; ui.app.store.needs.refresh() }
                } else SmallButton(tr("Review"), onClick = ways.onNeeds)
            }
        }
        asking.forEach { b -> YouRow({ head(b.color, b.outfit) }, question(b).orEmpty()) { SmallButton(tr("Reply")) { ways.onBot(b.id) } } }
        CompanyFloor.todos(c.todos).forEach { t ->
            val bot = t.bot?.let { id -> bots.firstOrNull { it.id == id } }
            Row(Modifier.fillMaxWidth().clickable { ui.call({ it.tickTodo(t.id, !t.done) }) }, verticalAlignment = Alignment.CenterVertically) {
                Checkbox(t.done, null, colors = CheckboxDefaults.colors(checkedColor = p.ink, checkmarkColor = p.inkText, uncheckedColor = p.line2))
                if (bot != null) Box(Modifier.padding(start = 4.dp)) { BotFigure(bot.color, "idle", 24, bot.outfit) }
                Text(t.text, color = if (t.done) p.faint else p.text, fontSize = 14.sp, modifier = Modifier.padding(start = 8.dp).weight(1f))
            }
        }
        AskField(typed, { typed = it.take(300) }, label = tr("Add a task"), placeholder = tr("Add a task"), button = tr("Add"), busy = adding) {
            val t = CompanyFloor.task(typed, bots)
            if (t.text.isEmpty() || adding) return@AskField
            adding = true
            ui.call({ it.addTodo(t.text, t.bot) }) { ok -> adding = false; if (ok) typed = "" }
        }
    }
}

@Composable
private fun YouRow(head: @Composable () -> Unit, text: String, action: @Composable () -> Unit) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        head()
        Text(text, color = p.text, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = 10.dp))
        action()
    }
}

@Composable
private fun SmallButton(label: String, onClick: () -> Unit) {
    val p = LocalPaper.current
    Text(label, color = p.text, fontSize = 13.sp, fontWeight = FontWeight.Medium,
        modifier = Modifier.clip(RoundedCornerShape(99.dp)).border(1.dp, p.line2, RoundedCornerShape(99.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp))
}

/** A team, opened from its room: its objective, its bots with what each does, the lead's chip, Make lead on the others. */
@Composable
private fun TeamSheet(ui: CompanyUi, c: Company, team: CompanyTeam, bots: List<Bot>, line: (Bot) -> String, onBot: (String) -> Unit) {
    val p = LocalPaper.current
    val o = CompanyFloor.objectiveOf(team, c.objectives)
    val members = team.bots.mapNotNull { id -> bots.firstOrNull { it.id == id } }
    var moving by remember(team.id) { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(team.color)
            Text(team.name, color = p.text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 10.dp))
        }
        if (o != null) Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.sunk).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(o.name, color = p.muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
            Text("${CompanyFloor.num(o.current)} / ${CompanyFloor.num(o.target)}", color = p.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
        members.forEach { b ->
            val lead = b.id == team.lead || (team.lead == null && b == members.first())
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable(onClickLabel = b.name) { onBot(b.id) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        BotFigure(b.color, b.state, 36, b.outfit)
                        if (lead && members.size > 1) Crown(Modifier.align(Alignment.TopEnd).offset(x = 8.dp, y = (-4).dp))
                    }
                    Column(Modifier.padding(start = 12.dp)) {
                        Text(b.name, color = p.text, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        Text(line(b), color = p.muted, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (lead) Text(tr("Lead"), color = GOLD, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
                else if (moving == null) SmallButton(tr("Make lead")) { moving = b.id; ui.call({ it.makeLead(team.id, b.id) }) { moving = null } }
            }
        }
    }
}
