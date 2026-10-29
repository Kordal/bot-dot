package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.Company
import dev.botdot.app.data.CompanyFloor
import dev.botdot.app.data.Decision
import dev.botdot.app.data.I18n
import dev.botdot.app.data.ProjectDecisions
import dev.botdot.app.data.ProjectStandup
import dev.botdot.app.data.ProjectTodo
import dev.botdot.app.data.Repeat
import dev.botdot.app.data.Todo
import dev.botdot.app.data.Waiting
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.TextStyle

/** A weekday's short name in the interface's language, 0 Sunday. */
internal fun weekdayName(d: Int): String = java.time.DayOfWeek.of(if (d == 0) 7 else d).getDisplayName(TextStyle.SHORT, I18n.locale)

/** A day as the To-do and the calendar say it: Today, Tomorrow, else "3 Nov". */
internal fun dueLabel(due: String): String = when (ProjectTodo.dueKind(due)) {
    ProjectTodo.Due.TODAY -> tr("Today")
    ProjectTodo.Due.TOMORROW -> tr("Tomorrow")
    else -> runCatching { LocalDate.parse(due).format(java.time.format.DateTimeFormatter.ofPattern("d MMM", I18n.locale)) }.getOrDefault(due)
}

/** The owner's own head: a person in a ring. */
@Composable
internal fun YouHead(size: Int = 24) {
    val p = LocalPaper.current
    Box(Modifier.size(size.dp).clip(CircleShape).border(1.dp, p.line2, CircleShape), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.Person, null, tint = p.text, modifier = Modifier.size((size * 0.6f).dp))
    }
}

/**
 * The To-do panel under the floor (#692, #694, #698; web: todoPanelHTML in public/company-home.js): All, You, Bots and
 * Done; in All and You the week's plan, the standup, what waits for the owner and the bots that ask; the project's
 * items, each with whom it is for, its chip (how it repeats, that its bot works, its due day), its tick and Delete;
 * Add a task with who and when; then the decisions. A server without `project-todos` gets the owner's tasks as before.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TodoPanel(ui: CompanyUi, c: Company, bots: List<Bot>, waiting: List<Waiting>, ways: CompanyWays, features: Collection<String>) {
    val p = LocalPaper.current
    val full = ProjectTodo.FEATURE in features
    var filter by rememberSaveable { mutableStateOf("all") }
    val asks = !full || filter == "all" || filter == "you"
    val waits = if (asks) waiting else emptyList()
    val asking = if (asks) bots.filter { question(it) != null } else emptyList()
    val items = if (full) ProjectTodo.shown(c.todos, filter) else CompanyFloor.todos(c.todos)
    val standupAsks = if (asks && ProjectStandup.FEATURE in features) ProjectStandup.asks(c, bots).size else 0
    val n = if (filter == "done") 0 else waits.size + asking.size + items.count { !it.done } + standupAsks
    val chief = chiefNamed()
    @Composable fun head(color: String?, outfit: kotlinx.serialization.json.JsonElement?) = BotFigure(color ?: chief.color, "idle", 28, if (color == null) chief.outfit else outfit)
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(p.panel).border(1.dp, p.line, RoundedCornerShape(20.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (full) tr("To-do") else tr("You"), color = p.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (n > 0) Text(n.toString(), color = p.inkText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(CircleShape).background(p.ink).padding(horizontal = 8.dp, vertical = 2.dp))
        }
        if (full) Filters(filter) { filter = it }
        if (asks) {
            PlanCard(ui, c)
            if (ProjectStandup.FEATURE in features) StandupCard(c, bots, ways)
            waits.forEach { w ->
                YouRow({ head(w.color, w.outfit) }, w.text) {
                    val id = w.permission
                    if (id != null) SmallButton(tr("Approve")) {
                        ui.scope.launch { runCatching { (ui.api ?: throw dev.botdot.app.data.ApiException(tr("Can't reach botdot."))).answerAsk(id, true) }.onFailure { ui.tell(it.message) }; ui.app.store.needs.refresh() }
                    } else SmallButton(tr("Review"), onClick = ways.onNeeds)
                }
            }
            asking.forEach { b -> YouRow({ head(b.color, b.outfit) }, question(b).orEmpty()) { SmallButton(tr("Reply")) { ways.onBot(b.id) } } }
        }
        items.forEach { t -> TodoRow(ui, t, bots.firstOrNull { it.id == t.bot }, full) }
        if (full) AddTodo(ui, c, bots) else AddTask(ui, bots)
        if (ProjectDecisions.FEATURE in features) Decisions(ui, c)
    }
}

@Composable
private fun Filters(on: String, onPick: (String) -> Unit) {
    val p = LocalPaper.current
    val words = mapOf("all" to tr("All"), "you" to tr("You"), "bots" to tr("Bots"), "done" to tr("Done"))
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, p.line2, RoundedCornerShape(12.dp)).padding(3.dp)) {
        ProjectTodo.FILTERS.forEach { k ->
            Box(Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (k == on) p.sunk else p.panel).clickable(onClickLabel = words[k]) { onPick(k) }
                .heightIn(min = 36.dp).semantics { contentDescription = words[k].orEmpty() }, contentAlignment = Alignment.Center) {
                Text(words[k].orEmpty(), color = if (k == on) p.text else p.muted, fontSize = 13.sp, fontWeight = if (k == on) FontWeight.Medium else FontWeight.Normal)
            }
        }
    }
}

/** An item: whom it is for, its text, its chip, its tick, and Delete (the owner's alone) on a server with the full To-do. */
@Composable
private fun TodoRow(ui: CompanyUi, t: Todo, bot: Bot?, full: Boolean) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        if (bot != null) BotFigure(bot.color, "idle", 24, bot.outfit) else YouHead()
        Text(t.text, color = if (t.done) p.faint else p.text, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = 10.dp))
        if (full) TodoChip(t, bot)
        Checkbox(t.done, { ui.call({ a -> a.tickTodo(t.id, it) }) }, colors = CheckboxDefaults.colors(checkedColor = p.ink, checkmarkColor = p.inkText, uncheckedColor = p.line2),
            modifier = Modifier.semantics { contentDescription = tr("Done") })
        if (full) RoundButton(Icons.Filled.Close, tr("Delete"), size = 32.dp) { ui.call({ it.deleteTodo(t.id) }) }
    }
}

/** How it repeats, else that its bot works now, else its due day (late in the warning colour). */
@Composable
private fun TodoChip(t: Todo, bot: Bot?) {
    val p = LocalPaper.current
    val repeat = t.repeat
    val (text, color) = when {
        repeat != null -> ProjectTodo.rhythmLabel(repeat, ::weekdayName) to p.muted
        !t.done && bot?.running == true -> tr("Working") to p.okText
        t.due != null -> dueLabel(t.due) to if (!t.done && ProjectTodo.dueKind(t.due) == ProjectTodo.Due.LATE) p.warnText else p.muted
        else -> return
    }
    Text(text, color = color, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.widthIn(max = 110.dp).clip(RoundedCornerShape(99.dp)).background(p.sunk).padding(horizontal = 8.dp, vertical = 3.dp))
}

/** Add a task: whom it is for (a head that opens the project's bots), the text, when (a day and how it repeats), Add. "@Bot text" still gives it to that bot. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddTodo(ui: CompanyUi, c: Company, bots: List<Bot>) {
    val p = LocalPaper.current
    var typed by rememberSaveable { mutableStateOf("") }
    var who by rememberSaveable { mutableStateOf<String?>(null) }
    var due by rememberSaveable { mutableStateOf<String?>(null) }
    var repeat by remember { mutableStateOf<Repeat?>(null) }
    var whoOpen by remember { mutableStateOf(false) }
    var whenOpen by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    val bot = who?.let { id -> bots.firstOrNull { it.id == id } }
    fun go() {
        val t = CompanyFloor.task(typed, bots)
        if (t.text.isEmpty() || adding) return
        adding = true
        ui.call({ it.addTodo(t.text, t.bot ?: bot?.id, due, repeat) }) { ok -> adding = false; if (ok) { typed = ""; who = null; due = null; repeat = null } }
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box {
            Box(Modifier.size(40.dp).clip(CircleShape).clickable(onClickLabel = bot?.name ?: tr("You")) { whoOpen = true }, contentAlignment = Alignment.Center) {
                if (bot != null) BotFigure(bot.color, "idle", 28, bot.outfit) else YouHead(28)
            }
            DropdownMenu(whoOpen, { whoOpen = false }, containerColor = p.panel) {
                DropdownMenuItem({ Text(tr("You"), color = p.text) }, { who = null; whoOpen = false }, leadingIcon = { YouHead() })
                ProjectTodo.projectBots(c, bots).forEach { b ->
                    DropdownMenuItem({ Text(b.name, color = p.text) }, { who = b.id; whoOpen = false }, leadingIcon = { BotFigure(b.color, "idle", 24, b.outfit) })
                }
            }
        }
        OutlinedTextField(typed, { typed = it.take(300) }, singleLine = true, enabled = !adding, placeholder = { Text(tr("Add a task")) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (typed.isNotBlank()) go() }),
            modifier = Modifier.weight(1f).semantics { contentDescription = tr("Add a task") })
        val r = repeat
        val whenWords = if (r != null) ProjectTodo.rhythmLabel(r, ::weekdayName) else due?.let(::dueLabel)
        if (whenWords != null) Text(whenWords, color = p.text, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 90.dp).clip(RoundedCornerShape(99.dp)).background(p.sunk).clickable(onClickLabel = tr("Due")) { whenOpen = true }.padding(horizontal = 10.dp, vertical = 8.dp))
        else RoundButton(Icons.Outlined.CalendarMonth, tr("Due"), size = 40.dp) { whenOpen = true }
        GoButton(tr("Add"), enabled = typed.isNotBlank(), busy = adding) { go() }
    }
    if (whenOpen) ModalBottomSheet(onDismissRequest = { whenOpen = false }, containerColor = p.panel) {
        WhenSheet(due, repeat) { d, rr -> due = d; repeat = rr }
    }
}

/** When: a day (picked on a calendar, or none) and how it repeats; a weekly one on its weekdays, a custom one every N days. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun WhenSheet(due: String?, repeat: Repeat?, onChange: (String?, Repeat?) -> Unit) {
    val p = LocalPaper.current
    var picking by remember { mutableStateOf(false) }
    val words = mapOf("" to tr("None"), "day" to tr("Daily"), "week" to tr("Weekly"), "month" to tr("Monthly"), "days" to tr("Custom"))
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(due?.let(::dueLabel) ?: tr("Due"), color = if (due != null) p.text else p.muted, fontSize = 16.sp,
                modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).border(1.dp, p.line2, RoundedCornerShape(12.dp)).clickable { picking = true }.padding(horizontal = 14.dp, vertical = 12.dp))
            if (due != null) RoundButton(Icons.Filled.Close, tr("Remove"), size = 40.dp, modifier = Modifier.padding(start = 8.dp)) { onChange(null, repeat) }
        }
        Chips(ProjectTodo.RHYTHMS.map { it to words[it].orEmpty() }, repeat?.every ?: "") { onChange(due, ProjectTodo.rhythm(it, due)) }
        val r = repeat
        if (r?.every == "week") FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(1, 2, 3, 4, 5, 6, 0).forEach { d ->
                val on = d in r.days.orEmpty()
                Text(weekdayName(d), color = if (on) p.inkText else p.text, fontSize = 13.sp,
                    modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(if (on) p.ink else p.sunk).clickable { onChange(due, ProjectTodo.flipDay(r, d)) }.padding(horizontal = 12.dp, vertical = 8.dp))
            }
        }
        if (r?.every == "days") {
            var n by remember(r.n) { mutableStateOf((r.n ?: 2).toString()) }
            OutlinedTextField(n, { v -> n = v.filter(Char::isDigit).take(3); n.toIntOrNull()?.let { onChange(due, ProjectTodo.everyN(r, it)) } }, singleLine = true,
                label = { Text(tr("Days")) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.widthIn(max = 160.dp))
        }
    }
    if (picking) {
        val start = due?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
        val state = rememberDatePickerState(initialSelectedDateMillis = start.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { picking = false },
            confirmButton = { TextButton({ state.selectedDateMillis?.let { ms -> onChange(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString(), repeat) }; picking = false }) { Text(tr("Save")) } },
            dismissButton = { TextButton({ picking = false }) { Text(tr("Cancel")) } }) { DatePicker(state) }
    }
}

/** Add a task as before #692: "@Bot text" is that bot's, anything else the owner's. */
@Composable
private fun AddTask(ui: CompanyUi, bots: List<Bot>) {
    var typed by rememberSaveable { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }
    AskField(typed, { typed = it.take(300) }, label = tr("Add a task"), placeholder = tr("Add a task"), button = tr("Add"), busy = adding) {
        val t = CompanyFloor.task(typed, bots)
        if (t.text.isEmpty() || adding) return@AskField
        adding = true
        ui.call({ it.addTodo(t.text, t.bot) }) { ok -> adding = false; if (ok) typed = "" }
    }
}

/** The morning standup (#698): per team, in its colour, what got done, what is next and what blocks it; a block that waits for the owner has Reply, into the lead's chat. */
@Composable
private fun StandupCard(c: Company, bots: List<Bot>, ways: CompanyWays) {
    val p = LocalPaper.current
    val leads = ProjectStandup.leads(c)
    if (leads.isEmpty()) return
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.sunk).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tr("Standup"), color = p.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            ByChief()
        }
        leads.forEach { l ->
            val team = c.teams.first { it.id == l.team }
            val color = parseColor(team.color, p.muted)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Dot(team.color)
                    Text(team.name, color = p.text, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
                }
                @Composable fun line(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String?, tint: androidx.compose.ui.graphics.Color, action: (@Composable () -> Unit)? = null) {
                    if (text.isNullOrBlank()) return
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp))
                        Text(text, color = p.text, fontSize = 13.5.sp, lineHeight = 18.sp, modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
                        action?.invoke()
                    }
                }
                line(Icons.Filled.Check, l.done, color)
                line(Icons.AutoMirrored.Filled.ArrowForward, l.next, p.muted)
                val reply: (@Composable () -> Unit)? = if (l.asks && bots.any { it.id == l.bot }) {
                    { SmallButton(tr("Reply")) { ways.onBotSay(l.bot, tr("Standup: {text}", "text" to l.blocked.orEmpty()) + "\n") } }
                } else null
                line(Icons.Outlined.ErrorOutline, l.blocked, if (l.asks) p.warnText else p.muted, reply)
            }
        }
    }
}

/** The owner's decisions (#694): the last five, newest first, with the reason under each and its day; Add a decision under them. */
@Composable
private fun Decisions(ui: CompanyUi, c: Company) {
    val p = LocalPaper.current
    var typed by rememberSaveable { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(tr("Decisions"), color = p.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        ProjectDecisions.shown(c.decisions).forEach { d -> DecisionRow(ui, d) }
        AskField(typed, { typed = it.take(600) }, label = tr("Add a decision"), placeholder = tr("Add a decision"), button = tr("Add"), busy = adding) {
            val d = ProjectDecisions.split(typed)
            if (d.text.isEmpty() || adding) return@AskField
            adding = true
            ui.call({ it.addDecision(d) }) { ok -> adding = false; if (ok) typed = "" }
        }
    }
}

@Composable
private fun DecisionRow(ui: CompanyUi, d: Decision) {
    val p = LocalPaper.current
    val words = mapOf("keep" to tr("Keep going"), "change" to tr("Change direction"), "stop" to tr("Stop"))
    val text = if (d.by == "checkin" && d.day != null && words[d.decision] != null) "${tr("Day {n} check-in", "n" to d.day)}: ${words[d.decision]}" else d.text
    val day = d.at?.let { runCatching { Instant.parse(it).atZone(java.time.ZoneId.systemDefault()).toLocalDate().toString() }.getOrNull() }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
            Text(text, color = p.text, fontSize = 14.sp, lineHeight = 19.sp)
            if (!d.why.isNullOrBlank()) Text(d.why, color = p.muted, fontSize = 12.5.sp, lineHeight = 17.sp)
        }
        if (day != null) Text(dueLabel(day), color = p.faint, fontSize = 12.sp, fontFamily = GeistMono, modifier = Modifier.padding(start = 8.dp, top = 2.dp))
        RoundButton(Icons.Filled.Close, tr("Remove"), size = 32.dp, modifier = Modifier.padding(start = 6.dp)) { ui.call({ it.deleteDecision(d.id) }) }
    }
}
