package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

/**
 * The project's To-do (#692), calendar (#695), standup (#698) and decisions (#694) on Android, with the rules the web
 * page has (public/company-todo.js, company-calendar.js, company-floor.js). This file draws nothing (ui/CompanyTodo.kt
 * and ui/CompanyCalendar.kt do). Days are "YYYY-MM-DD" strings, as the server sends them (docs/api.md "The Company").
 */
object ProjectTodo {
    const val FEATURE = "project-todos"
    val FILTERS = listOf("all", "you", "bots", "done")
    /** The Done filter shows this many. */
    const val DONE = 30

    fun today(now: LocalDate = LocalDate.now()): String = now.toString()

    /**
     * What a filter shows. All: every open item; You: the owner's open items; Bots: the bots' open items; Done: the
     * done ones, newest first. Open items by their due day, the earliest first, those without one after them in the
     * order they were added.
     */
    fun shown(todos: List<Todo>, filter: String): List<Todo> {
        if (filter == "done") return todos.filter { it.done }.sortedByDescending { it.doneAt ?: it.at ?: "" }.take(DONE)
        return todos.filter { !it.done && when (filter) { "you" -> it.bot == null; "bots" -> it.bot != null; else -> true } }
            .withIndex().sortedWith(compareBy<IndexedValue<Todo>>({ it.value.due ?: "9999-99-99" }, { it.index })).map { it.value }
    }

    enum class Due { TODAY, TOMORROW, LATE, LATER }

    fun dueKind(due: String?, now: String = today()): Due? = when {
        due.isNullOrEmpty() -> null
        due == now -> Due.TODAY
        due < now -> Due.LATE
        due == LocalDate.parse(now).plusDays(1).toString() -> Due.TOMORROW
        else -> Due.LATER
    }

    /** The rhythms the When picker offers: none, daily, weekly, monthly, every N days. */
    val RHYTHMS = listOf("", "day", "week", "month", "days")

    /** The repeat a rhythm picked in When gives: weekly on [due]'s weekday (today's without one), every 2 days to start. */
    fun rhythm(every: String, due: String?, now: LocalDate = LocalDate.now()): Repeat? = when (every) {
        "" -> null
        "week" -> Repeat("week", days = listOf(weekday(due?.let(LocalDate::parse) ?: now)))
        "days" -> Repeat("days", n = 2)
        else -> Repeat(every)
    }

    /** A weekday as the server counts it: 0 is Sunday. */
    fun weekday(d: LocalDate): Int = d.dayOfWeek.value % 7

    /** A weekday flipped in a weekly repeat; the last one stays. */
    fun flipDay(r: Repeat, day: Int): Repeat {
        val days = r.days.orEmpty()
        val now = if (day in days) days - day else days + day
        return if (now.isEmpty()) r else r.copy(days = now)
    }

    fun everyN(r: Repeat, n: Int): Repeat = r.copy(n = n.coerceIn(2, 365))

    /** Daily, Weekly on days, Monthly, Every N days: [names] gives a weekday's short name (0 Sunday). */
    fun rhythmLabel(r: Repeat, names: (Int) -> String): String = when {
        r.every == "day" || (r.every == "week" && r.days?.size == 7) -> tr("Daily")
        r.every == "week" -> r.days.orEmpty().joinToString(", ") { names(it) }
        r.every == "month" -> tr("Monthly")
        else -> tr("Every {n} days", "n" to (r.n ?: 2))
    }

    /** `POST /api/company/todos`: the text, and whom it is for, its due day and how it repeats when they are set. */
    fun addBody(text: String, bot: String?, due: String?, repeat: Repeat?): JsonObject = buildJsonObject {
        put("text", text)
        if (bot != null) put("bot", bot)
        if (!due.isNullOrEmpty()) put("due", due)
        if (repeat != null) put("repeat", repeatJson(repeat))
    }

    private fun repeatJson(r: Repeat): JsonObject = buildJsonObject {
        put("every", r.every)
        r.days?.let { put("days", JsonArray(it.map { d -> JsonPrimitive(d) })) }
        r.day?.let { put("day", it) }
        r.n?.let { put("n", it) }
    }

    /** The bots an item may be for: the project's, or every bot while it has no team. */
    fun projectBots(c: Company, bots: List<Bot>): List<Bot> {
        val ids = c.teams.flatMap { it.bots }.toSet()
        return bots.filter { it.id in ids }.ifEmpty { bots }
    }
}

/** One thing on a day of the calendar (#695): an event, a check-in, a to-do item or a job's run. */
@Serializable
data class CalendarItem(
    val kind: String = "event",
    val id: String? = null,
    val day: String = "",
    val time: String? = null,
    val title: String = "",
    val by: String? = null,
    val bot: String? = null,
    val n: Int? = null,
    val decision: String? = null,
    val done: Boolean = false,
    val repeat: Repeat? = null,
    val ahead: Boolean = false,
    val runs: Int? = null,
)

@Serializable
data class CalendarAnswer(val from: String = "", val to: String = "", val items: List<CalendarItem> = emptyList())

object ProjectCalendar {
    const val FEATURE = "project-calendar"
    /** The tile lists this many items to come. */
    const val NEXT = 5
    /** A day of the month shows this many dots. */
    const val IN_DAY = 3

    fun monday(day: LocalDate): LocalDate = day.minusDays((day.dayOfWeek.value - DayOfWeek.MONDAY.value).toLong())

    /** The seven days of a day's week, Monday first. */
    fun week(day: LocalDate): List<LocalDate> = (0L..6L).map { monday(day).plusDays(it) }

    /** A month's days in whole weeks, from the Monday on or before its 1st to the Sunday on or after its last day. */
    fun month(ym: YearMonth): List<LocalDate> {
        val first = monday(ym.atDay(1))
        val last = ym.atEndOfMonth().let { it.plusDays((7 - it.dayOfWeek.value).toLong()) }
        return generateSequence(first) { it.plusDays(1) }.takeWhile { !it.isAfter(last) }.toList()
    }

    fun byDay(items: List<CalendarItem>): Map<String, List<CalendarItem>> = items.groupBy { it.day }

    /** What is still to come from [now]: open items only, today's first, in the server's order. */
    fun next(items: List<CalendarItem>, now: String, n: Int = NEXT): List<CalendarItem> = items.filter { it.day >= now && !it.done }.take(n)

    /** Only events are the owner's to change here: a to-do, a check-in and a job have their own places. */
    fun editable(x: CalendarItem): Boolean = x.kind == "event"

    /** Who an item belongs to: who added an event, the bot of a job or to-do ("you" for the owner's), null for a check-in. */
    fun whoOf(x: CalendarItem): String? = when (x.kind) {
        "event" -> x.by ?: "you"
        "job" -> x.bot
        "todo" -> x.bot ?: "you"
        else -> null
    }

    /** What the tile, the month and the feed's changes are made of: asked again when it changes. */
    fun sourceKey(c: Company, bots: List<Bot>, today: String): List<Any?> {
        val ids = c.teams.flatMap { it.bots }.toSet()
        val jobs = bots.filter { it.id in ids }.map { b -> b.id to b.jobs.map { listOf(it.id, it.name, it.cron, it.enabled, it.approved) } }
        return listOf(c.id, c.day, c.events, c.todos, c.checkins, c.teams, jobs, today)
    }

    /** `POST /api/company/events` and `PUT …/:id`: the title, the day, and the time ("" makes it whole-day on a change). */
    fun eventBody(title: String, day: String?, time: String?): JsonObject = buildJsonObject {
        put("title", title)
        if (day != null) put("day", day)
        if (time != null) put("time", time)
    }

    /** A time typed as "9:30", "0930" or "18": "09:30", or null when it is no time; "" is none. */
    fun time(typed: String): String? {
        val t = typed.trim()
        if (t.isEmpty()) return ""
        val m = Regex("""^(\d{1,2})(?:[:.]?(\d{2}))?$""").matchEntire(t) ?: return null
        val h = m.groupValues[1].toInt()
        val min = m.groupValues[2].ifEmpty { "0" }.toInt()
        if (h > 23 || min > 59) return null
        return String.format(java.util.Locale.ROOT, "%02d:%02d", h, min)
    }
}

object ProjectDecisions {
    const val FEATURE = "company-decisions"
    /** The panel shows the last five, newest first. */
    const val SHOWN = 5

    fun shown(all: List<Decision>): List<Decision> = all.takeLast(SHOWN).reversed()

    data class Typed(val text: String, val why: String)

    /** "Launch in Polish first because most users are Polish": the decision, and its reason after the first "because" (Polish "bo", "ponieważ") or dash. */
    fun split(input: String): Typed {
        val typed = input.replace(Regex("\\s+"), " ").trim()
        val m = Regex("""^(.+?)\s+(?:because|bo|ponieważ|[—–-])\s+(.+)$""", RegexOption.IGNORE_CASE).matchEntire(typed)
            ?: return Typed(typed, "")
        return Typed(m.groupValues[1].replace(Regex("[,;:]$"), "").trim(), m.groupValues[2])
    }

    fun addBody(t: Typed): JsonObject = buildJsonObject { put("text", t.text); if (t.why.isNotEmpty()) put("why", t.why) }
}

object ProjectStandup {
    const val FEATURE = "company-standup"

    /** The leads that answered today, of teams the project still has. */
    fun leads(c: Company): List<StandupLead> = c.standupToday?.leads.orEmpty().filter { l -> l.at != null && c.teams.any { it.id == l.team } }

    /** The leads whose team waits for the owner, of bots that are still there: counted in what waits, with Reply. */
    fun asks(c: Company, bots: List<Bot>): List<StandupLead> = leads(c).filter { l -> l.asks && bots.any { it.id == l.bot } }
}
