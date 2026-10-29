package dev.botdot.app.data

/**
 * The Company's home as an office floor (#672, #675; web: public/company-floor.js): the rules of who sits where. This
 * file draws nothing (ui/CompanyHome.kt does):
 *   - a room per team: its lead at the head, the team's asks as one count on the lead, the members that work or ask
 *     at a desk (asks first), the idle ones as heads on a bench.
 *   - the bots in no team, each on its own on the floor.
 *   - a team's objective: the objective of the team's colour.
 *   - "@Bot text" in Add a task: that bot's task.
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

    data class Floor(val rooms: List<Room>, val loose: List<Sat>)

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

    /** One room per team, in the company's order, and the bots in no team. */
    fun floor(c: Company, bots: List<Bot>, info: Info): Floor {
        val inTeam = c.teams.flatMap { it.bots }.toSet()
        return Floor(c.teams.mapNotNull { room(it, bots, info) }, bots.filter { it.id !in inTeam }.map { Sat(it, seatOf(it, info)) })
    }

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

    /** The owner's tasks as You lists them: those not done, then the last five done. */
    fun todos(all: List<Todo>): List<Todo> = all.filter { !it.done } + all.filter { it.done }.takeLast(5)
}
