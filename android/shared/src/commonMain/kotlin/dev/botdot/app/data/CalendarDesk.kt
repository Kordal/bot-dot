package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.YearMonth
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.plus
import kotlinx.datetime.minus
import kotlinx.datetime.todayIn
import kotlinx.datetime.yearMonth
import kotlin.time.Clock

/** A day as the calendar draws it: its date, its number, its weekday (0 Sunday), and the dots of what is on it. */
class CalendarDay(val day: String, val number: Int, val weekday: Int, val today: Boolean, val past: Boolean, val out: Boolean, val dots: List<String>)

/**
 * The project's calendar at one moment (#695): the tile's week ([week], today lit, a dot under a day with something
 * on it) and what is still to come ([next]); with the month open ([month], "2026-11"), its days in whole weeks
 * ([cells]), the picked day and its items, and the event being changed ([editing]).
 */
class CalendarState(
    val week: List<CalendarDay> = emptyList(),
    val next: List<CalendarItem> = emptyList(),
    val today: String = "",
    val month: String? = null,
    val cells: List<CalendarDay> = emptyList(),
    val picked: String? = null,
    val pickedItems: List<CalendarItem> = emptyList(),
    val editing: CalendarItem? = null,
    val busy: Boolean = false,
    val notice: String? = null,
    val noticeCount: Int = 0,
)

/**
 * The project's calendar for both phones (#695; Android's CalendarTile and MonthSheet): what it shows is asked of
 * `GET /api/company/calendar` again whenever the project, its bots' jobs or the day change ([ProjectCalendar.sourceKey]);
 * the month adds, changes, moves and deletes the owner's events. [close] stops it.
 */
class CalendarDesk(private val store: Store, private val api: Api, private val scope: CoroutineScope, private val now: () -> LocalDate = { Clock.System.todayIn(TimeZone.currentSystemDefault()) }) {
    private class Local(val tile: List<CalendarItem> = emptyList(), val month: YearMonth? = null, val monthItems: List<CalendarItem> = emptyList(),
                        val picked: String? = null, val editing: String? = null, val busy: Boolean = false, val notice: String? = null, val noticeCount: Int = 0) {
        fun copy(tile: List<CalendarItem> = this.tile, month: YearMonth? = this.month, monthItems: List<CalendarItem> = this.monthItems, picked: String? = this.picked,
                 editing: String? = this.editing, busy: Boolean = this.busy, notice: String? = this.notice, noticeCount: Int = this.noticeCount) =
            Local(tile, month, monthItems, picked, editing, busy, notice, noticeCount)
    }
    private val local = MutableStateFlow(Local())
    private val _state = MutableStateFlow(CalendarState())
    val state: StateFlow<CalendarState> = _state
    private val jobs = mutableListOf<Job>()

    init {
        jobs += scope.launch {
            combine(store.company.value, store.bots.value) { c, b -> c?.company?.let { it to b.orEmpty() } }
                .distinctUntilChanged { a, b -> a?.let { (c, bots) -> ProjectCalendar.sourceKey(c, bots, now().toString()) } == b?.let { (c, bots) -> ProjectCalendar.sourceKey(c, bots, now().toString()) } }
                .collect { if (it != null) { readTile(); readMonth() } }
        }
        jobs += scope.launch { combine(local, store.bots.value) { l, b -> l to b.orEmpty() }.collect { (l, b) -> _state.value = stateOf(l, b) } }
    }

    /** Calls [onChange] with the calendar now and after every change, until the returned job is cancelled. */
    fun watch(onChange: (CalendarState) -> Unit): Job = scope.launch { state.collect { onChange(it) } }

    fun close() { jobs.forEach { it.cancel() } }

    private fun stateOf(l: Local, bots: List<Bot>): CalendarState {
        val today = now()
        val t = today.toString()
        fun cell(d: LocalDate, items: Map<String, List<CalendarItem>>, out: Boolean) = CalendarDay(d.toString(), d.day, d.dayOfWeek.isoDayNumber % 7, d == today, d < today, out,
            items[d.toString()].orEmpty().take(ProjectCalendar.IN_DAY).map { ProjectCalendar.colorOf(it, bots) })
        val tileDays = ProjectCalendar.byDay(l.tile)
        val monthDays = ProjectCalendar.byDay(l.monthItems)
        val picked = l.picked?.let { monthDays[it].orEmpty() }.orEmpty()
        return CalendarState(
            week = ProjectCalendar.week(today).map { cell(it, tileDays, false) },
            next = ProjectCalendar.next(l.tile, t),
            today = t,
            month = l.month?.toString(),
            cells = l.month?.let { m -> ProjectCalendar.month(m).map { cell(it, monthDays, it.yearMonth != m) } }.orEmpty(),
            picked = l.picked,
            pickedItems = picked,
            editing = l.editing?.let { id -> picked.firstOrNull { it.kind == "event" && it.id == id } },
            busy = l.busy, notice = l.notice, noticeCount = l.noticeCount,
        )
    }

    private suspend fun readTile() {
        val from = ProjectCalendar.monday(now())
        try { local.update { it.copy(tile = api.projectCalendar(from.toString(), from.plus(13, DateTimeUnit.DAY).toString())) } } catch (e: CancellationException) { throw e } catch (_: Exception) {}
    }

    private suspend fun readMonth() {
        val m = local.value.month ?: return
        val cells = ProjectCalendar.month(m)
        try {
            val items = api.projectCalendar(cells.first().toString(), cells.last().toString())
            local.update { if (it.month == m) it.copy(monthItems = items) else it }
        } catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message) }
    }

    private fun say(text: String?) = local.update { it.copy(notice = text ?: tr("That didn't work"), noticeCount = it.noticeCount + 1) }

    /** The tile or one of its days tapped: the month on [day]. */
    fun open(day: String) {
        val d = runCatching { LocalDate.parse(day) }.getOrNull() ?: now()
        local.update { it.copy(month = d.yearMonth, monthItems = emptyList(), picked = d.toString(), editing = null) }
        scope.launch { readMonth() }
    }

    /** The month closed. */
    fun shut() = local.update { it.copy(month = null, monthItems = emptyList(), picked = null, editing = null) }

    /** The previous (-1) or next (1) month, on its first day. */
    fun turn(by: Int) {
        val m = local.value.month ?: return
        val to = if (by < 0) m.firstDay.minus(1, DateTimeUnit.MONTH).yearMonth else m.firstDay.plus(1, DateTimeUnit.MONTH).yearMonth
        local.update { it.copy(month = to, monthItems = emptyList(), picked = to.firstDay.toString(), editing = null) }
        scope.launch { readMonth() }
    }

    /** A day of the month picked; one of another month turns to it. */
    fun pick(day: String) {
        val d = runCatching { LocalDate.parse(day) }.getOrNull() ?: return
        if (d.yearMonth != local.value.month) {
            local.update { it.copy(month = d.yearMonth, monthItems = emptyList(), picked = day, editing = null) }
            scope.launch { readMonth() }
        } else local.update { it.copy(picked = day, editing = null) }
    }

    /** An event of the picked day tapped: changed in the form under the day; tapped again, the form adds again. */
    fun edit(id: String) = local.update { it.copy(editing = if (it.editing == id) null else id) }

    /**
     * The form's Add or Save: [title] and [typedTime] ([ProjectCalendar.time]) on the picked day, or the event being
     * changed moved to [moveTo]. False when it isn't ready or botdot refused (said).
     */
    @Throws(Exception::class)
    suspend fun save(title: String, typedTime: String, moveTo: String?): Boolean {
        val l = local.value
        val day = l.picked ?: return false
        val t = title.trim()
        val hhmm = ProjectCalendar.time(typedTime) ?: return false
        if (t.isEmpty() || l.busy) return false
        local.update { it.copy(busy = true) }
        val id = _state.value.editing?.id
        return try {
            store.tookProject(if (id != null) api.changeEvent(id, t, moveTo ?: day, hhmm) else api.addEvent(t, day, hhmm))
            local.update { it.copy(editing = null) }
            readTile(); readMonth()
            true
        } catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message); false } finally { local.update { it.copy(busy = false) } }
    }

    /** An event's Delete. */
    @Throws(Exception::class)
    suspend fun delete(id: String) {
        try {
            store.tookProject(api.deleteEvent(id))
            local.update { if (it.editing == id) it.copy(editing = null) else it }
            readTile(); readMonth()
        } catch (e: CancellationException) { throw e } catch (e: Exception) { say(e.message) }
    }
}
