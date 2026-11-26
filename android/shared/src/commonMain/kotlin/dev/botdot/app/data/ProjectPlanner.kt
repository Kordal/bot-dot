package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.time.Clock
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.YearMonth
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.todayIn
import kotlinx.datetime.toLocalDateTime

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

    fun today(now: LocalDate = Clock.System.todayIn(TimeZone.currentSystemDefault())): String = now.toString()

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
        due == LocalDate.parse(now).plus(1, DateTimeUnit.DAY).toString() -> Due.TOMORROW
        else -> Due.LATER
    }

    /** The rhythms the When picker offers: none, daily, weekly, monthly, every N days. */
    val RHYTHMS = listOf("", "day", "week", "month", "days")

    /** The repeat a rhythm picked in When gives: weekly on [due]'s weekday (today's without one), every 2 days to start. */
    fun rhythm(every: String, due: String?, now: LocalDate = Clock.System.todayIn(TimeZone.currentSystemDefault())): Repeat? = when (every) {
        "" -> null
        "week" -> Repeat("week", days = listOf(weekday(due?.let(LocalDate::parse) ?: now)))
        "days" -> Repeat("days", n = 2)
        else -> Repeat(every)
    }

    /** A weekday as the server counts it: 0 is Sunday. */
    fun weekday(d: LocalDate): Int = d.dayOfWeek.isoDayNumber % 7

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

    /** [due]'s kind as of today, and the repeat a rhythm gives as of today: for a phone that has no LocalDate to pass. */
    fun dueToday(due: String?): Due? = dueKind(due)
    fun rhythmToday(every: String, due: String?): Repeat? = rhythm(every, due)

    /** What an item's chip says, first that applies: how it repeats, that its bot works now, its due day. */
    enum class Chip { REPEAT, WORKING, DUE }

    fun chip(t: Todo, bot: Bot?): Chip? = when {
        t.repeat != null -> Chip.REPEAT
        !t.done && bot?.running == true -> Chip.WORKING
        t.due != null -> Chip.DUE
        else -> null
    }

    /** Its due day has passed and it is still open: its chip in the warning colour. */
    fun late(t: Todo): Boolean = !t.done && dueKind(t.due) == Due.LATE

    /** One item as the panel draws it: the item, whom it is for (null: the owner), its chip and whether it is late. */
    class Row(val todo: Todo, val bot: Bot?, val chip: Chip?, val late: Boolean)

    /**
     * The To-do panel (#692; Android's TodoPanel) under [filter]: its title, the asks that wait for the owner here
     * ([waiting], what waits in this project only, and the team bots' questions, on All and You), its items, and the
     * number by its title. Before [FEATURE] it is the older "You" list: every open task and the last five done.
     */
    class Panel(
        val full: Boolean,
        val title: String,
        val filter: String,
        /** The asks shown above the items: what waits, and the bots asking a question. */
        val asks: Boolean,
        val waits: List<Waiting>,
        val asking: List<Bot>,
        val rows: List<Row>,
        val count: Int,
        /** Whom an item may be for, beside the owner. */
        val forBots: List<Bot>,
        /** The week's plan above the asks (on All and You): its rows, whether it waits for Approve; null for none. */
        val plan: WeekPlan? = null,
        val planRows: List<ProjectPlan.Row> = emptyList(),
        /** The morning standup (#698, project-standup), on All and You. */
        val standup: List<ProjectStandup.Line> = emptyList(),
        /** The owner's decisions (#694, company-decisions): the last five, newest first; null: no section. */
        val decisions: List<Decision>? = null,
        /** An ongoing project: a check-in's decision is its monthly review. */
        val ongoing: Boolean = false,
    )

    fun panel(c: Company, bots: List<Bot>, waiting: List<Waiting>, filter: String, features: Collection<String>?): Panel {
        val f = features.orEmpty()
        val full = FEATURE in f
        val asks = !full || filter == "all" || filter == "you"
        val waits = if (asks) waiting else emptyList()
        val asking = if (asks) Spaces.askingIn(c, bots) { ProjectRules.question(it) != null } else emptyList()
        val items = if (full) shown(c.todos, filter) else CompanyFloor.todos(c.todos)
        val standupAsks = if (asks && ProjectStandup.FEATURE in f) ProjectStandup.asks(c, bots).size else 0
        val rows = items.map { t -> bots.firstOrNull { it.id == t.bot }.let { b -> Row(t, b, if (full) chip(t, b) else null, late(t)) } }
        return Panel(
            full = full, title = if (full) tr("To-do") else tr("You"), filter = filter, asks = asks, waits = waits, asking = asking, rows = rows,
            count = if (filter == "done") 0 else waits.size + asking.size + items.count { !it.done } + standupAsks,
            forBots = projectBots(c, bots),
            plan = if (asks) ProjectPlan.of(c) else null,
            planRows = if (asks) ProjectPlan.rows(c) else emptyList(),
            standup = if (asks && ProjectStandup.FEATURE in f) ProjectStandup.lines(c, bots) else emptyList(),
            decisions = if (ProjectDecisions.FEATURE in f) ProjectDecisions.shown(c.decisions) else null,
            ongoing = c.ongoing,
        )
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
    /** A check-in that is an ongoing project's monthly review (#925). */
    val monthly: Boolean = false,
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

    fun monday(day: LocalDate): LocalDate = day.minus(day.dayOfWeek.isoDayNumber - 1, DateTimeUnit.DAY)

    /** The seven days of a day's week, Monday first. */
    fun week(day: LocalDate): List<LocalDate> = (0..6).map { monday(day).plus(it, DateTimeUnit.DAY) }

    /** A month's days in whole weeks, from the Monday on or before its 1st to the Sunday on or after its last day. */
    fun month(ym: YearMonth): List<LocalDate> {
        val first = monday(ym.firstDay)
        val last = ym.lastDay.let { it.plus(7 - it.dayOfWeek.isoDayNumber, DateTimeUnit.DAY) }
        return generateSequence(first) { it.plus(1, DateTimeUnit.DAY) }.takeWhile { it <= last }.toList()
    }

    fun byDay(items: List<CalendarItem>): Map<String, List<CalendarItem>> = items.groupBy { it.day }

    /** What is still to come from [now]: open items only, today's first, in the server's order. */
    fun next(items: List<CalendarItem>, now: String, n: Int = NEXT): List<CalendarItem> = items.filter { it.day >= now && !it.done }.take(n)

    /** A check-in's dot is gold, the project's own accent otherwise. */
    const val CHECKIN_COLOR = "#f5c542"
    const val PROJECT_COLOR = "#8e7cff"

    /** The colour of an item's dot: its bot's, a check-in's gold, else the project's accent. */
    fun colorOf(x: CalendarItem, bots: List<Bot>): String {
        val id = if (x.kind == "event") x.by else x.bot
        return bots.firstOrNull { it.id == id }?.color ?: if (x.kind == "checkin") CHECKIN_COLOR else PROJECT_COLOR
    }

    /** What an item is called: a check-in by its day (an ongoing project's is its monthly review), anything else by its title. */
    fun titleOf(x: CalendarItem): String = if (x.kind == "checkin") (if (x.monthly) tr("Monthly review") else tr("Day {n} check-in", "n" to (x.n ?: 0))) else x.title

    /** Its line in the tile's list, as the owner reads it: its time today, Tomorrow; null for a later day (the phone names it). */
    fun whenOf(x: CalendarItem, today: String): String? = when (x.day) {
        today -> x.time ?: tr("Today")
        runCatching { LocalDate.parse(today).plus(1, DateTimeUnit.DAY).toString() }.getOrNull() -> tr("Tomorrow")
        else -> null
    }

    /** It repeats, or it is a job that runs more than once that day: a repeat mark beside it. */
    fun repeats(x: CalendarItem): Boolean = x.repeat != null || (x.runs ?: 0) > 1

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
        val jobs = bots.filter { it.id in ids }.map { b -> b.id to b.jobs.map { listOf(it.id, it.name, it.words, it.nextRunAt, it.enabled, it.approved) } }
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
        return formatIn("", "%02d:%02d", h, min)
    }
}

object ProjectDecisions {
    const val FEATURE = "company-decisions"
    /** The panel shows the last five, newest first. */
    const val SHOWN = 5

    fun shown(all: List<Decision>): List<Decision> = all.takeLast(SHOWN).reversed()

    data class Typed(val text: String, val why: String)

    private const val REGEX_MARKS = ".*+?^$()[]{}|\\"

    /**
     * "Launch in Polish first because most users are Polish": the decision, and its reason after the first "because" or
     * dash, or another offered language's word for it ([because]: its phrases' `because`, ADR 280, which come with the
     * dictionary; Polish "bo", "ponieważ").
     */
    fun split(input: String, because: List<String> = I18n.phrases("because")): Typed {
        val typed = input.replace(Regex("\\s+"), " ").trim()
        val words = (listOf("because") + because.filter { it.isNotBlank() }.map { w ->
            w.trim().split(Regex("\\s+")).joinToString("\\s+") { part -> part.map { c -> if (c in REGEX_MARKS) "\\$c" else c.toString() }.joinToString("") }
        }).joinToString("|")
        val m = Regex("""^(.+?)\s+(?:$words|[—–-])\s+(.+)$""", RegexOption.IGNORE_CASE).matchEntire(typed)
            ?: return Typed(typed, "")
        return Typed(m.groupValues[1].replace(Regex("[,;:]$"), "").trim(), m.groupValues[2])
    }

    fun addBody(t: Typed): JsonObject = buildJsonObject { put("text", t.text); if (t.why.isNotEmpty()) put("why", t.why) }

    /** A decision's line: a check-in's in words ("Day 30 check-in: Keep going"; an ongoing project's "Monthly review: …"), else its text. */
    fun textOf(d: Decision, ongoing: Boolean): String {
        val word = when (d.decision) { "keep" -> tr("Keep going"); "change" -> tr("Change direction"); "stop" -> tr("Stop"); else -> null }
        if (d.by != "checkin" || d.day == null || word == null) return d.text
        return "${if (ongoing) tr("Monthly review") else tr("Day {n} check-in", "n" to d.day)}: $word"
    }

    /** The day it was made ("2026-11-16") in the phone's time zone; null without a time botdot can read. */
    fun dayOf(d: Decision): String? = d.at?.let { runCatching { kotlin.time.Instant.parse(it).toLocalDateTime(TimeZone.currentSystemDefault()).date.toString() }.getOrNull() }
}

object ProjectStandup {
    const val FEATURE = "company-standup"

    /** The leads that answered today, of teams the project still has. */
    fun leads(c: Company): List<StandupLead> = c.standupToday?.leads.orEmpty().filter { l -> l.at != null && c.teams.any { it.id == l.team } }

    /** The leads whose team waits for the owner, of bots that are still there: counted in what waits, with Reply. */
    fun asks(c: Company, bots: List<Bot>): List<StandupLead> = leads(c).filter { l -> l.asks && bots.any { it.id == l.bot } }

    /** A lead's line in the standup: its team, what got done, what is next, what blocks it and whether that waits for the owner (Reply). */
    class Line(val team: CompanyTeam, val done: String?, val next: String?, val blocked: String?, val asks: Boolean, val bot: String)

    fun lines(c: Company, bots: List<Bot>): List<Line> = leads(c).mapNotNull { l ->
        val team = c.teams.firstOrNull { it.id == l.team } ?: return@mapNotNull null
        Line(team, l.done?.takeIf { it.isNotBlank() }, l.next?.takeIf { it.isNotBlank() }, l.blocked?.takeIf { it.isNotBlank() }, l.asks && bots.any { it.id == l.bot }, l.bot)
    }

    /** What Reply puts in the lead's chat. */
    fun reply(l: Line): String = tr("Standup: {text}", "text" to l.blocked.orEmpty()) + "\n"
}

/** The week's plan the Chief drafts (#673) as the To-do shows it: its items, each with its team and the colour of the objective it moves. */
object ProjectPlan {
    class Row(val text: String, val team: CompanyTeam?, val color: String?)

    /** The plan to show: one with items; null for none. */
    fun of(c: Company): WeekPlan? = c.plan?.takeIf { it.items.isNotEmpty() }

    fun rows(c: Company): List<Row> = of(c)?.items.orEmpty().map { x ->
        Row(x.text, c.teams.firstOrNull { it.id == x.team }, c.objectives.firstOrNull { it.id == x.objective }?.color)
    }
}
