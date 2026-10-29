package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Bot
import dev.botdot.app.data.CalendarItem
import dev.botdot.app.data.Company
import dev.botdot.app.data.I18n
import dev.botdot.app.data.ProjectCalendar
import dev.botdot.app.data.tr
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle

private const val CHECKIN_COLOR = "#f5c542"
private const val PROJECT_COLOR = "#8e7cff"

/** The colour of an item's dot: its bot's, a check-in's gold, else the project's accent. */
private fun colorOf(x: CalendarItem, bots: List<Bot>): String {
    val id = if (x.kind == "event") x.by else x.bot
    return bots.firstOrNull { it.id == id }?.color ?: if (x.kind == "checkin") CHECKIN_COLOR else PROJECT_COLOR
}

private fun titleOf(x: CalendarItem): String = if (x.kind == "checkin") tr("Day {n} check-in", "n" to (x.n ?: 0)) else x.title

private fun short(d: LocalDate, pattern: String): String = d.format(DateTimeFormatter.ofPattern(pattern, I18n.locale))

/** Who an item is: the head of who added an event, the bot of a job or to-do, the owner's, or a flag for a check-in. */
@Composable
private fun WhoHead(x: CalendarItem, bots: List<Bot>) {
    val p = LocalPaper.current
    val who = ProjectCalendar.whoOf(x)
    val bot = bots.firstOrNull { it.id == who }
    val chief = chiefNamed()
    when {
        who == null -> Box(Modifier.size(24.dp).clip(CircleShape).border(1.dp, p.line2, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Flag, null, tint = parseColor(CHECKIN_COLOR, p.muted), modifier = Modifier.size(14.dp))
        }
        who == "chief" -> BotFigure(chief.color, "idle", 24, chief.outfit)
        bot != null -> BotFigure(bot.color, "idle", 24, bot.outfit)
        else -> YouHead()
    }
}

@Composable
private fun ItemRow(x: CalendarItem, bots: List<Bot>, whenText: String, onEdit: (() -> Unit)? = null, onDelete: (() -> Unit)? = null, picked: Boolean = false) {
    val p = LocalPaper.current
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(Radius.small).background(if (picked) p.sunk else p.panel.copy(alpha = 0f))
        .then(if (onEdit != null) Modifier.clickable(onClickLabel = x.title, onClick = onEdit) else Modifier), verticalAlignment = Alignment.CenterVertically) {
        Text(whenText, color = p.faint, fontSize = Type.s12, fontFamily = GeistMono, maxLines = 1, modifier = Modifier.width(72.dp))
        WhoHead(x, bots)
        Text(titleOf(x), color = if (x.done) p.faint else p.text, fontSize = Type.s14, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = Space.s12))
        if (x.repeat != null || (x.runs ?: 0) > 1) Icon(Icons.Filled.Repeat, null, tint = p.faint, modifier = Modifier.size(16.dp))
        if (onDelete != null) RoundButton(Icons.Filled.Close, tr("Delete"), size = 32.dp, onClick = onDelete)
    }
}

/**
 * The Calendar tile at the floor's end (#695; web: public/company-calendar-view.js): this week's days, today lit, a dot
 * under a day with something on it, and the next few items. A tap opens the month on that day. What it shows is asked
 * of GET /api/company/calendar again whenever the project, its bots' jobs or the day change.
 */
@Composable
internal fun CalendarTile(ui: CompanyUi, c: Company, bots: List<Bot>) {
    val p = LocalPaper.current
    val today = LocalDate.now()
    val key = ProjectCalendar.sourceKey(c, bots, today.toString())
    var items by remember { mutableStateOf<List<CalendarItem>>(emptyList()) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(key) {
        val from = ProjectCalendar.monday(today)
        runCatching { ui.api?.projectCalendar(from.toString(), from.plusDays(13).toString()) }.getOrNull()?.let { items = it }
    }
    val days = ProjectCalendar.byDay(items)
    val shape = Radius.card
    Column(Modifier.fillMaxWidth().clip(shape).background(p.bg).border(1.dp, p.line2, shape).clickable(onClickLabel = tr("Calendar")) { open = today.toString() }.padding(Space.s12),
        verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(PROJECT_COLOR)
            Text(tr("Calendar"), color = p.text, fontSize = Type.s14, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = Space.s8))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
            ProjectCalendar.week(today).forEach { d ->
                val on = days[d.toString()].orEmpty()
                val isToday = d == today
                Column(Modifier.weight(1f).clip(Radius.small).background(if (isToday) p.ink else p.sunk).clickable(onClickLabel = short(d, "EEE d")) { open = d.toString() }
                    .padding(vertical = Space.s8), horizontalAlignment = Alignment.CenterHorizontally) {
                    val ink = if (isToday) p.inkText else if (d.isBefore(today)) p.faint else p.text
                    Text(d.dayOfWeek.getDisplayName(TextStyle.SHORT, I18n.locale), color = if (isToday) p.inkText else p.faint, fontSize = Type.s12, maxLines = 1)
                    Text(d.dayOfMonth.toString(), color = ink, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
                    Box(Modifier.padding(top = Space.s4).size(5.dp).clip(CircleShape).background(if (on.isEmpty()) p.panel.copy(alpha = 0f) else parseColor(colorOf(on.first(), bots), p.muted)))
                }
            }
        }
        val now = today.toString()
        ProjectCalendar.next(items, now).forEach { x ->
            val whenText = when (x.day) {
                now -> x.time ?: tr("Today")
                today.plusDays(1).toString() -> tr("Tomorrow")
                else -> short(LocalDate.parse(x.day), "EEE d")
            }
            ItemRow(x, bots, whenText)
        }
    }
    open?.let { day -> MonthSheet(ui, c, bots, LocalDate.parse(day), key) { open = null } }
}

/**
 * The month (#695), as the phone's mockup has it: its days in whole weeks with a dot per item, the picked day's list
 * under it, where the owner adds an event (a title and a time) and changes, moves or deletes one. Only events change
 * here: a to-do, a check-in and a job have their own places.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MonthSheet(ui: CompanyUi, c: Company, bots: List<Bot>, start: LocalDate, key: List<Any?>, onClose: () -> Unit) {
    val p = LocalPaper.current
    val today = LocalDate.now()
    var ym by rememberSaveable { mutableStateOf(YearMonth.from(start).toString()) }
    var picked by rememberSaveable { mutableStateOf(start.toString()) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var items by remember { mutableStateOf<List<CalendarItem>>(emptyList()) }
    val month = YearMonth.parse(ym)
    val cells = ProjectCalendar.month(month)
    LaunchedEffect(ym, key) {
        runCatching { ui.api?.projectCalendar(cells.first().toString(), cells.last().toString()) }.onSuccess { it?.let { got -> items = got } }.onFailure { ui.tell(it.message) }
    }
    val days = ProjectCalendar.byDay(items)
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = p.bg, dragHandle = null) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s8, top = Space.s12, bottom = Space.s8), verticalAlignment = Alignment.CenterVertically) {
                Text(month.atDay(1).format(DateTimeFormatter.ofPattern("LLLL yyyy", I18n.locale)).replaceFirstChar { it.uppercase() }, color = p.text, fontSize = Type.s20, fontWeight = FontWeight.SemiBold)
                RoundButton(Icons.AutoMirrored.Filled.KeyboardArrowLeft, tr("Previous month"), size = 36.dp, modifier = Modifier.padding(start = Space.s12)) { ym = month.minusMonths(1).toString(); picked = month.minusMonths(1).atDay(1).toString(); editing = null }
                RoundButton(Icons.AutoMirrored.Filled.KeyboardArrowRight, tr("Next month"), size = 36.dp, modifier = Modifier.padding(start = Space.s8)) { ym = month.plusMonths(1).toString(); picked = month.plusMonths(1).atDay(1).toString(); editing = null }
                Spacer(Modifier.weight(1f))
                RoundButton(Icons.Filled.Close, tr("Close"), size = 36.dp, onClick = onClose)
            }
            Row(Modifier.fillMaxWidth()) {
                ProjectCalendar.week(today).forEach { d ->
                    Text(d.dayOfWeek.getDisplayName(TextStyle.SHORT, I18n.locale), color = p.faint, fontSize = Type.s12, fontFamily = GeistMono, textAlign = TextAlign.Center, modifier = Modifier.weight(1f).padding(vertical = Space.s8))
                }
            }
            cells.chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth()) {
                    week.forEach { d ->
                        val out = YearMonth.from(d) != month
                        val sel = d.toString() == picked
                        val on = days[d.toString()].orEmpty()
                        Column(Modifier.weight(1f).aspectRatio(1f).border(0.5.dp, if (sel) p.muted else p.line, RoundedCornerShape(0.dp)).background(if (out) p.panel else p.bg)
                            .clickable(onClickLabel = short(d, "EEE d MMM")) {
                                picked = d.toString(); editing = null
                                if (out) ym = YearMonth.from(d).toString()
                            }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                            val isToday = d == today
                            Box(Modifier.size(28.dp).clip(CircleShape).background(if (isToday) p.ink else p.bg.copy(alpha = 0f)), contentAlignment = Alignment.Center) {
                                Text(d.dayOfMonth.toString(), color = if (isToday) p.inkText else if (out) p.faint else p.text, fontSize = Type.s14, fontWeight = if (isToday) FontWeight.SemiBold else FontWeight.Normal)
                            }
                            Row(Modifier.padding(top = Space.s4).heightIn(min = 5.dp), horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
                                on.take(ProjectCalendar.IN_DAY).forEach { x -> Box(Modifier.size(5.dp).clip(CircleShape).background(parseColor(colorOf(x, bots), p.muted))) }
                            }
                        }
                    }
                }
            }
            val day = LocalDate.parse(picked)
            val list = days[picked].orEmpty()
            Column(Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                Text(short(day, "EEE, d MMM").replaceFirstChar { it.uppercase() }, color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold)
                list.forEach { x ->
                    if (ProjectCalendar.editable(x) && x.id != null) ItemRow(x, bots, x.time.orEmpty(), picked = editing == x.id,
                        onEdit = { editing = if (editing == x.id) null else x.id }, onDelete = { ui.call({ it.deleteEvent(x.id) }) { ok -> if (ok && editing == x.id) editing = null } })
                    else ItemRow(x, bots, x.time.orEmpty())
                }
                val event = editing?.let { id -> list.firstOrNull { it.kind == "event" && it.id == id } }
                EventForm(ui, day, event) { editing = null }
            }
        }
    }
}

/** Add an event on the picked day (a title and an optional time), or, with [event], change its title, time and day. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EventForm(ui: CompanyUi, day: LocalDate, event: CalendarItem?, onSaved: () -> Unit) {
    val p = LocalPaper.current
    var title by remember(event?.id) { mutableStateOf(event?.title.orEmpty()) }
    var time by remember(event?.id) { mutableStateOf(event?.time.orEmpty()) }
    var moveTo by remember(event?.id) { mutableStateOf(event?.day) }
    var busy by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    val hhmm = ProjectCalendar.time(time)
    val ready = title.isNotBlank() && hhmm != null && !busy
    fun go() {
        if (!ready) return
        busy = true
        val t = title.trim()
        ui.call({ a -> if (event?.id != null) a.changeEvent(event.id, t, moveTo ?: day.toString(), hhmm.orEmpty()) else a.addEvent(t, day.toString(), hhmm.orEmpty()) }) { ok ->
            busy = false
            if (ok) { title = ""; time = ""; onSaved() }
        }
    }
    Column(Modifier.fillMaxWidth().clip(Radius.card).border(1.dp, p.line2, Radius.card).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            YouHead(28)
            Field(title, { title = it.take(200) }, singleLine = true, enabled = !busy, placeholder = { Text(tr("Add an event")) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { go() }),
                modifier = Modifier.weight(1f).semantics { contentDescription = tr("Add an event") })
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
            Field(time, { time = it.take(5) }, singleLine = true, enabled = !busy, isError = hhmm == null, placeholder = { Text("--:--") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { go() }),
                modifier = Modifier.widthIn(max = 110.dp).semantics { contentDescription = tr("Time") })
            if (event != null) Text(dueLabel(moveTo ?: day.toString()), color = p.text, fontSize = Type.s14,
                modifier = Modifier.clip(Radius.pill).background(p.sunk).clickable(onClickLabel = tr("Day")) { picking = true }.padding(horizontal = Space.s12, vertical = Space.s12))
            Spacer(Modifier.weight(1f))
            GoButton(if (event != null) tr("Save") else tr("Add"), enabled = ready, busy = busy) { go() }
        }
    }
    if (picking) {
        val from = moveTo?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: day
        val state = rememberDatePickerState(initialSelectedDateMillis = from.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { picking = false },
            confirmButton = { TextButton({ state.selectedDateMillis?.let { ms -> moveTo = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString() }; picking = false }) { Text(tr("Save")) } },
            dismissButton = { TextButton({ picking = false }) { Text(tr("Cancel")) } }) { DatePicker(state) }
    }
}
