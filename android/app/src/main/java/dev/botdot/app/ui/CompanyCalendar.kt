package dev.botdot.app.ui

import dev.botdot.app.data.locale
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
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
import kotlinx.coroutines.launch
import dev.botdot.app.data.CalendarDesk
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

private val CHECKIN_COLOR = ProjectCalendar.CHECKIN_COLOR
private val PROJECT_COLOR = ProjectCalendar.PROJECT_COLOR

private fun colorOf(x: CalendarItem, bots: List<Bot>): String = ProjectCalendar.colorOf(x, bots)

private fun titleOf(x: CalendarItem): String = ProjectCalendar.titleOf(x)

private fun short(d: LocalDate, pattern: String): String = d.format(DateTimeFormatter.ofPattern(pattern, I18n.locale))

/** Who an item is: the head of who added an event, the bot of a job or to-do, the owner's, or a flag for a check-in. */
@Composable
private fun WhoHead(x: CalendarItem, bots: List<Bot>) {
    val p = LocalPaper.current
    val who = ProjectCalendar.whoOf(x)
    val bot = bots.firstOrNull { it.id == who }
    val chief = chiefNamed()
    when {
        who == null -> Box(Modifier.size(24.dp).clip(CircleShape).background(p.fill), contentAlignment = Alignment.Center) {
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
        if (ProjectCalendar.repeats(x)) Icon(Icons.Filled.Repeat, null, tint = p.faint, modifier = Modifier.size(16.dp))
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
    // What it shows, when it is read again, and the month's days and events are the shared CalendarDesk (both phones).
    val api = ui.api ?: return
    // The open month's day and the event being changed outlive a rotation and the app's process (the desk is made anew).
    var keptDay by rememberSaveable { mutableStateOf<String?>(null) }
    var keptEdit by rememberSaveable { mutableStateOf<String?>(null) }
    val desk = remember(api) { CalendarDesk(ui.app.store, api, ui.app.scope).also { it.restore(keptDay, keptEdit) } }
    DisposableEffect(desk) { onDispose { desk.close() } }
    val s by desk.state.collectAsState()
    LaunchedEffect(s.month, s.picked, s.editing?.id) {
        // The desk's first state comes before its restore shows: keep what was kept until the month is open.
        if (s.month != null) { keptDay = s.picked; keptEdit = s.editing?.id } else if (s.week.isNotEmpty()) { keptDay = null; keptEdit = null }
    }
    LaunchedEffect(s.noticeCount) { if (s.noticeCount > 0) ui.tell(s.notice) }
    val shape = Radius.card
    Column(Modifier.fillMaxWidth().cardRing("calendar").raised(shape).clickable(onClickLabel = tr("Calendar")) { desk.open(s.today) }.padding(Space.s12),
        verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(PROJECT_COLOR)
            Text(tr("Calendar"), color = p.text, fontSize = Type.s14, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f).padding(start = Space.s8))
            CardPencil("calendar", tr("Calendar"))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
            s.week.forEach { d ->
                val day = LocalDate.parse(d.day)
                Column(Modifier.weight(1f).clip(Radius.small).background(if (d.today) p.ink else p.sunk).clickable(onClickLabel = short(day, "EEE d")) { desk.open(d.day) }
                    .padding(vertical = Space.s8), horizontalAlignment = Alignment.CenterHorizontally) {
                    val ink = if (d.today) p.inkText else if (d.past) p.faint else p.text
                    Text(day.dayOfWeek.getDisplayName(TextStyle.SHORT, I18n.locale), color = if (d.today) p.inkText else p.faint, fontSize = Type.s12, maxLines = 1)
                    Text(d.number.toString(), color = ink, fontSize = Type.s14, fontWeight = FontWeight.SemiBold)
                    Box(Modifier.padding(top = Space.s4).size(5.dp).clip(CircleShape).background(d.dots.firstOrNull()?.let { parseColor(it, p.muted) } ?: p.panel.copy(alpha = 0f)))
                }
            }
        }
        s.next.forEach { x -> ItemRow(x, bots, ProjectCalendar.whenOf(x, s.today) ?: short(LocalDate.parse(x.day), "EEE d")) }
    }
    if (s.month != null) MonthSheet(desk, s, bots) { desk.shut() }
}

/**
 * The month (#695), as the phone's mockup has it: its days in whole weeks with a dot per item, the picked day's list
 * under it, where the owner adds an event (a title and a time) and changes, moves or deletes one. Only events change
 * here: a to-do, a check-in and a job have their own places.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MonthSheet(desk: CalendarDesk, s: dev.botdot.app.data.CalendarState, bots: List<Bot>, onClose: () -> Unit) {
    val p = LocalPaper.current
    val month = YearMonth.parse(s.month!!)
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = p.bg, dragHandle = null) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s8, top = Space.s12, bottom = Space.s8), verticalAlignment = Alignment.CenterVertically) {
                Text(month.atDay(1).format(DateTimeFormatter.ofPattern("LLLL yyyy", I18n.locale)).let { I18n.upperFirst(it) }, color = p.text, fontSize = Type.s20, fontWeight = FontWeight.SemiBold)
                RoundButton(Icons.AutoMirrored.Filled.KeyboardArrowLeft, tr("Previous month"), size = 36.dp, modifier = Modifier.padding(start = Space.s12)) { desk.turn(-1) }
                RoundButton(Icons.AutoMirrored.Filled.KeyboardArrowRight, tr("Next month"), size = 36.dp, modifier = Modifier.padding(start = Space.s8)) { desk.turn(1) }
                Spacer(Modifier.weight(1f))
                RoundButton(Icons.Filled.Close, tr("Close"), size = 36.dp, onClick = onClose)
            }
            Row(Modifier.fillMaxWidth()) {
                s.week.forEach { d ->
                    Text(LocalDate.parse(d.day).dayOfWeek.getDisplayName(TextStyle.SHORT, I18n.locale), color = p.faint, fontSize = Type.s12, fontFamily = GeistMono, textAlign = TextAlign.Center, modifier = Modifier.weight(1f).padding(vertical = Space.s8))
                }
            }
            s.cells.chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth()) {
                    week.forEach { d ->
                        val sel = d.day == s.picked
                        Column(Modifier.weight(1f).aspectRatio(1f).border(0.5.dp, if (sel) p.muted else p.line, RoundedCornerShape(0.dp)).background(if (d.out) p.panel else p.bg)
                            .clickable(onClickLabel = short(LocalDate.parse(d.day), "EEE d MMM")) { desk.pick(d.day) },
                            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                            Box(Modifier.size(28.dp).clip(CircleShape).background(if (d.today) p.ink else p.bg.copy(alpha = 0f)), contentAlignment = Alignment.Center) {
                                Text(d.number.toString(), color = if (d.today) p.inkText else if (d.out) p.faint else p.text, fontSize = Type.s14, fontWeight = if (d.today) FontWeight.SemiBold else FontWeight.Normal)
                            }
                            Row(Modifier.padding(top = Space.s4).heightIn(min = 5.dp), horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
                                d.dots.forEach { c -> Box(Modifier.size(5.dp).clip(CircleShape).background(parseColor(c, p.muted))) }
                            }
                        }
                    }
                }
            }
            val day = LocalDate.parse(s.picked ?: s.today)
            Column(Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
                Text(I18n.upperFirst(short(day, "EEE, d MMM")), color = p.text, fontSize = Type.s16, fontWeight = FontWeight.SemiBold)
                s.pickedItems.forEach { x ->
                    if (ProjectCalendar.editable(x) && x.id != null) ItemRow(x, bots, x.time.orEmpty(), picked = s.editing?.id == x.id,
                        onEdit = { desk.edit(x.id!!) }, onDelete = { scope.launch { desk.delete(x.id!!) } })
                    else ItemRow(x, bots, x.time.orEmpty())
                }
                EventForm(desk, day, s.editing, s.busy)
            }
        }
    }
}

/** Add an event on the picked day (a title and an optional time), or, with [event], change its title, time and day: CalendarDesk.save. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EventForm(desk: CalendarDesk, day: LocalDate, event: CalendarItem?, busy: Boolean) {
    val p = LocalPaper.current
    var title by rememberSaveable(event?.id) { mutableStateOf(event?.title.orEmpty()) }
    var time by rememberSaveable(event?.id) { mutableStateOf(event?.time.orEmpty()) }
    var moveTo by rememberSaveable(event?.id) { mutableStateOf(event?.day) }
    var picking by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val hhmm = ProjectCalendar.time(time)
    val ready = title.isNotBlank() && hhmm != null && !busy
    fun go() {
        if (!ready) return
        scope.launch { if (desk.save(title, time, moveTo)) { title = ""; time = "" } }
    }
    Column(Modifier.fillMaxWidth().raised(Radius.card).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
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
