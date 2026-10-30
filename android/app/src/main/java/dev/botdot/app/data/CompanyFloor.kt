package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * The Company's home as an office floor (#672, #675; web: public/company-floor.js): the rules of who sits where. This
 * file draws nothing (ui/CompanyHome.kt does):
 *   - a room per team: its lead at the head, the team's asks as one count on the lead, the members that work or ask
 *     at a desk (asks first), the idle ones as heads on a bench.
 *   - the bots in no team, each on its own on the floor.
 *   - a team's objective: the objective of the team's colour.
 *   - "@Bot text" in Add a task: that bot's task.
 *   - how each objective is shown (#690): its display, its pace against the line to the target, its chart, day 1.
 */
object CompanyFloor {
    /** Days 30, 60 and 90: the check-ins on the line under the header. */
    val DAYS = listOf(30, 60, 90)
    const val DAYS_ALL = 90

    enum class Seat { ASKS, WORKING, IDLE }

    /** What the app knows of each bot: how many things of it wait for the owner, and whether a run of it goes. */
    class Info(val asks: (String) -> Int, val working: (String) -> Boolean)

    data class Sat(val bot: Bot, val seat: Seat)

    /** One team's room: [count] what the team's bots wait on, shown on the lead; [desks] the others that ask or work, those that ask first; [bench] the idle ones. */
    data class Room(val team: CompanyTeam, val lead: Sat, val count: Int, val desks: List<Sat>, val bench: List<Sat>) {
        val size: Int get() = 1 + desks.size + bench.size
        /** A team of one: its bot leads without a crown. */
        val solo: Boolean get() = size == 1
    }

    data class Floor(val rooms: List<Room>)

    fun seatOf(b: Bot, info: Info): Seat = if (info.asks(b.id) > 0) Seat.ASKS else if (info.working(b.id)) Seat.WORKING else Seat.IDLE

    /** Bots the team names that are gone are left out; a team left with none has no room. */
    fun room(team: CompanyTeam, bots: List<Bot>, info: Info): Room? {
        val byId = bots.associateBy { it.id }
        val members = team.bots.mapNotNull { byId[it] }.map { Sat(it, seatOf(it, info)) }
        if (members.isEmpty()) return null
        val lead = members.firstOrNull { it.bot.id == team.lead } ?: members.first()
        val others = members.filter { it !== lead }
        return Room(
            team, lead, members.sumOf { info.asks(it.bot.id) },
            others.filter { it.seat == Seat.ASKS } + others.filter { it.seat == Seat.WORKING },
            others.filter { it.seat == Seat.IDLE },
        )
    }

    /** One room per team, in the company's order. The account's bots in no team stay in Bots, on no project's floor (#816). */
    fun floor(c: Company, bots: List<Bot>, info: Info): Floor = Floor(c.teams.mapNotNull { room(it, bots, info) })

    /** A team's objective: the one of its colour, or null. */
    fun objectiveOf(team: CompanyTeam?, objectives: List<Objective>): Objective? {
        val color = team?.color?.lowercase() ?: return null
        return objectives.firstOrNull { it.color?.lowercase() == color }
    }

    /** How far an objective is, 0 to 1. */
    fun ratio(o: Objective): Float = if (o.target > 0) (o.current / o.target).toFloat().coerceIn(0f, 1f) else 0f

    /** A number as the board writes it: 23, 6.1. */
    fun num(d: Double): String = if (d == Math.floor(d) && !d.isInfinite() && kotlin.math.abs(d) < 1e15) d.toLong().toString() else d.toString()

    /** How much of the line under the header is filled on [day]: the days gone. */
    fun gone(day: Int): Float = ((day - 1).coerceIn(0, DAYS_ALL)).toFloat() / DAYS_ALL

    /** "@Bot text": the bot whose name follows the @ (the longest that fits, any case) and the rest as the task. Anything else is the owner's own task. */
    data class Task(val text: String, val bot: String?)

    fun task(input: String, bots: List<Bot>): Task {
        val text = input.trim()
        if (!text.startsWith("@")) return Task(text, null)
        val after = text.substring(1)
        val fits = bots.filter { b ->
            b.name.isNotEmpty() && after.startsWith(b.name, ignoreCase = true) && (after.length == b.name.length || after[b.name.length].isWhitespace())
        }.maxByOrNull { it.name.length } ?: return Task(text, null)
        val rest = after.substring(fits.name.length).trim()
        return if (rest.isNotEmpty()) Task(rest, fits.id) else Task(text, null)
    }

    // ---------- how an objective is shown (#690; web: the same names in public/company-floor.js) ----------

    /** The features that the goal cards (#690) and the leads' plan items and reports (#696) need. */
    const val DISPLAY = "company-display"
    const val LEADS = "company-leads"
    val DISPLAYS = listOf("pace", "bar", "status")
    /** How often a lead reports: "" none. */
    val RHYTHMS = listOf("", "daily", "twice-weekly", "weekly")

    /** The owner's or the Chief's pick, else a pace chart for an objective with a target and its status for one without. */
    fun displayOf(o: Objective): String = o.display?.takeIf { it in DISPLAYS } ?: if (o.target > 0) "pace" else "status"

    enum class Pace { AHEAD, ON, BEHIND }

    /**
     * Where an objective with a target stands against the straight line from 0 on day 1 to its target on day 90: ahead
     * once it is a tenth of the target past the line (or past it at all on day 1, when the line is at 0), on track at or
     * past the line, else behind. Null without a target or a day.
     */
    fun pace(o: Objective, day: Int?): Pace? {
        if (o.target <= 0 || day == null || day <= 0) return null
        val expected = o.target * (minOf(day, DAYS_ALL) - 1) / (DAYS_ALL - 1)
        return when {
            o.current >= expected + o.target / 10 || (expected == 0.0 && o.current > 0) -> Pace.AHEAD
            o.current >= expected -> Pace.ON
            else -> Pace.BEHIND
        }
    }

    /** A point of the pace chart, both ways 0 to 1 (y down, as a canvas draws it). */
    data class Point(val x: Float, val y: Float)

    /**
     * The pace chart: [line] from 0 on day 1 to the target on day 90; [actual] the objective's history before today and
     * its current value today; [ticks] the x of days 30, 60 and 90. The top is the target or the highest value.
     */
    data class Chart(val line: Pair<Point, Point>, val actual: List<Point>, val ticks: List<Pair<Int, Float>>)

    fun chart(o: Objective, day: Int?): Chart {
        val today = (day ?: 1).coerceIn(1, DAYS_ALL)
        val points = o.history.filter { it.day < today } + DayValue(today, o.current)
        val top = maxOf(o.target, points.maxOf { it.value }).takeIf { it > 0 } ?: 1.0
        fun x(d: Int) = (d - 1).toFloat() / (DAYS_ALL - 1)
        fun y(v: Double) = (1 - maxOf(0.0, v) / top).toFloat()
        return Chart(Point(x(1), y(0.0)) to Point(x(DAYS_ALL), y(o.target)), points.map { Point(x(it.day), y(it.value)) }, DAYS.map { it to x(it) })
    }

    /** Day 1 of a running company, when a chart would be a flat line: the home shows where it starts instead. */
    fun firstDay(c: Company): Boolean = c.running && (c.day ?: 0) <= 1

    /** The day of the first check-in (day 30), from the day the company started. */
    fun checkinDate(startedAt: String?, zone: ZoneId = ZoneId.systemDefault()): LocalDate? = startedAt?.let {
        runCatching { Instant.parse(it).plusSeconds(29L * 86_400).atZone(zone).toLocalDate() }.getOrNull()
    }

    /** Where its number comes from (#699): the app and when it last gave a number, that its last read failed, or that the first read waits. Null without a source. */
    fun sourceLine(o: Objective, now: Instant = Instant.now()): String? {
        val s = o.source?.takeIf { it.app.isNotEmpty() } ?: return null
        val at = s.readAt?.let { NotesWake.ago(it, now) }?.takeIf { it.isNotEmpty() }
        val whenWords = if (s.failed != null) tr("Couldn't update") else at ?: tr("Updating…")
        return "${CompanySetup.appName(s.app)} · $whenWords"
    }

    /** How many of an objective's steps are done. */
    fun stepsDone(o: Objective): Int = o.steps.count { it.done }

    /** The steps with the [i]th ticked or not: sent whole, as the server keeps them. */
    fun ticked(o: Objective, i: Int, done: Boolean): List<ObjectiveStep> = o.steps.mapIndexed { x, s -> if (x == i) s.copy(done = done) else s }

    /** `PUT /api/company/objectives/:id`: the fields given, the steps whole. */
    fun objectiveBody(display: String? = null, steps: List<ObjectiveStep>? = null, done: Boolean? = null): JsonObject = buildJsonObject {
        if (display != null) put("display", display)
        if (steps != null) put("steps", JsonArray(steps.map { s -> buildJsonObject { put("text", s.text); put("done", s.done) } }))
        if (done != null) put("done", done)
    }

    /** The owner's tasks as You lists them: those not done, then the last five done. */
    fun todos(all: List<Todo>): List<Todo> = all.filter { !it.done } + all.filter { it.done }.takeLast(5)
}
