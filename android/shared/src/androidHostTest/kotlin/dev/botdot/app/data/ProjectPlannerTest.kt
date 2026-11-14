package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth

/**
 * The project's To-do, calendar, standup and decisions on Android (#706): the rules the web page has
 * (public/company-todo.js, company-calendar.js, company-floor.js), the project as the server sends it, and the calls
 * on the same routes and bodies as the web page (docs/api.md "The Company").
 */
class ProjectPlannerTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private val project = """{"id":"c1","name":"Fernhill","phase":"running","day":5,
        "teams":[{"id":"t1","name":"Growth","color":"#45c78e","bots":["a","b"],"lead":"a"}],
        "todos":[{"id":"x1","text":"Count users","bot":"a","due":"2026-11-02","repeat":{"every":"week","days":[1]},"done":false,"at":"2026-10-01T00:00:00Z","by":"you"},
                 {"id":"x2","text":"Share the link","done":true,"at":"2026-10-02T00:00:00Z","doneAt":"2026-10-28T10:00:00Z"}],
        "events":[{"id":"e1","title":"Launch","day":"2026-10-29","time":"18:00","by":"b","at":"2026-10-20T00:00:00Z"}],
        "decisions":[{"id":"d1","text":"Polish first","why":"most users are Polish","at":"2026-10-20T00:00:00Z","by":"you"},
                     {"id":"d2","text":"Day 30 check-in: Keep going","at":"2026-10-21T00:00:00Z","by":"checkin","day":30,"decision":"keep"}],
        "standup":{"on":true,"time":"09:00"},
        "standupToday":{"day":"2026-10-29","leads":[{"team":"t1","bot":"a","done":"Drafted invites","next":"Send them","blocked":"Needs the list","asks":true,"at":"2026-10-29T09:00:00Z"},
                                                    {"team":"gone","bot":"b","done":"x","at":"2026-10-29T09:00:00Z"}]}}"""

    @Test fun readsTheProjectsToDoCalendarStandupAndDecisions() {
        val c = CompanySetup.of(project)
        assertEquals(Repeat("week", days = listOf(1)), c.todos[0].repeat)
        assertEquals("2026-11-02", c.todos[0].due)
        assertEquals("18:00", c.events[0].time)
        assertEquals("most users are Polish", c.decisions[0].why)
        assertEquals("09:00", c.standup!!.time)
        assertEquals(listOf("t1"), ProjectStandup.leads(c).map { it.team }) // a team that is gone is left out
        assertEquals(1, ProjectStandup.asks(c, listOf(Bot("a", "A"))).size)
        assertEquals(0, ProjectStandup.asks(c, listOf(Bot("b", "B"))).size) // its lead is gone
        // A project from a server before #692-#698: none of it.
        val older = CompanySetup.of("""{"id":"c1","phase":"running","todos":[{"id":"x","text":"t","done":false}]}""")
        assertNull(older.todos[0].due); assertNull(older.standupToday); assertTrue(older.decisions.isEmpty()); assertTrue(older.events.isEmpty())
    }

    @Test fun eachFilterShowsWhatTheWebShows() {
        val all = listOf(
            Todo("late", due = "2026-10-01"), Todo("none1"), Todo("bot", bot = "a", due = "2026-10-05"), Todo("none2"),
            Todo("d1", done = true, doneAt = "2026-10-01T00:00:00Z"), Todo("d2", done = true, doneAt = "2026-10-03T00:00:00Z"),
        )
        assertEquals(listOf("late", "bot", "none1", "none2"), ProjectTodo.shown(all, "all").map { it.id })
        assertEquals(listOf("late", "none1", "none2"), ProjectTodo.shown(all, "you").map { it.id })
        assertEquals(listOf("bot"), ProjectTodo.shown(all, "bots").map { it.id })
        assertEquals(listOf("d2", "d1"), ProjectTodo.shown(all, "done").map { it.id })
        assertEquals(30, ProjectTodo.shown((1..40).map { Todo("d$it", done = true) }, "done").size)
    }

    @Test fun aDueDayIsTodayTomorrowLateOrLater() {
        assertEquals(ProjectTodo.Due.TODAY, ProjectTodo.dueKind("2026-10-29", "2026-10-29"))
        assertEquals(ProjectTodo.Due.TOMORROW, ProjectTodo.dueKind("2026-10-30", "2026-10-29"))
        assertEquals(ProjectTodo.Due.TOMORROW, ProjectTodo.dueKind("2027-01-01", "2026-12-31"))
        assertEquals(ProjectTodo.Due.LATE, ProjectTodo.dueKind("2026-10-28", "2026-10-29"))
        assertEquals(ProjectTodo.Due.LATER, ProjectTodo.dueKind("2026-11-05", "2026-10-29"))
        assertNull(ProjectTodo.dueKind(null, "2026-10-29"))
    }

    @Test fun whenRepeatsAsTheWebPicksIt() {
        val thursday = LocalDate.parse("2026-10-29")
        assertEquals(Repeat("week", days = listOf(1)), ProjectTodo.rhythm("week", "2026-11-02", thursday)) // on the due day's weekday
        assertEquals(Repeat("week", days = listOf(4)), ProjectTodo.rhythm("week", null, thursday))
        assertEquals(Repeat("days", n = 2), ProjectTodo.rhythm("days", null, thursday))
        assertEquals(Repeat("day"), ProjectTodo.rhythm("day", null, thursday))
        assertNull(ProjectTodo.rhythm("", null, thursday))
        val r = Repeat("week", days = listOf(1))
        assertEquals(listOf(1, 3), ProjectTodo.flipDay(r, 3).days)
        assertEquals(r, ProjectTodo.flipDay(r, 1)) // the last day stays
        assertEquals(365, ProjectTodo.everyN(Repeat("days", n = 2), 900).n)
        assertEquals(2, ProjectTodo.everyN(Repeat("days", n = 5), 0).n)
        val name = { d: Int -> listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")[d] }
        assertEquals("Daily", ProjectTodo.rhythmLabel(Repeat("week", days = (0..6).toList()), name))
        assertEquals("Mon, Wed", ProjectTodo.rhythmLabel(Repeat("week", days = listOf(1, 3)), name))
        assertEquals("Every 3 days", ProjectTodo.rhythmLabel(Repeat("days", n = 3), name))
        assertEquals("Monthly", ProjectTodo.rhythmLabel(Repeat("month"), name))
    }

    @Test fun anItemIsForTheProjectsBotsOrAnyWhileItHasNoTeam() {
        val c = CompanySetup.of(project)
        val bots = listOf(Bot("a", "A"), Bot("z", "Z"))
        assertEquals(listOf("a"), ProjectTodo.projectBots(c, bots).map { it.id })
        assertEquals(listOf("a", "z"), ProjectTodo.projectBots(c.copy(teams = emptyList()), bots).map { it.id })
    }

    @Test fun theCalendarsWeekAndMonthAreWholeWeeksFromMonday() {
        val thursday = LocalDate.parse("2026-10-29")
        assertEquals(LocalDate.parse("2026-10-26"), ProjectCalendar.monday(thursday))
        assertEquals(LocalDate.parse("2026-10-26"), ProjectCalendar.monday(LocalDate.parse("2026-10-26")))
        assertEquals(LocalDate.parse("2026-10-26"), ProjectCalendar.monday(LocalDate.parse("2026-11-01"))) // a Sunday
        assertEquals(listOf("2026-10-26", "2026-11-01"), ProjectCalendar.week(thursday).let { listOf(it.first().toString(), it.last().toString()) })
        val oct = ProjectCalendar.month(YearMonth.parse("2026-10"))
        assertEquals(LocalDate.parse("2026-09-28"), oct.first())
        assertEquals(LocalDate.parse("2026-11-01"), oct.last())
        assertEquals(35, oct.size)
        assertEquals(0, ProjectCalendar.month(YearMonth.parse("2027-02")).size % 7)
    }

    @Test fun whatComesNextIsOpenAndFromToday() {
        val items = listOf(
            CalendarItem("event", "e0", "2026-10-28", title = "past"),
            CalendarItem("todo", "t1", "2026-10-29", title = "done", done = true),
            CalendarItem("event", "e1", "2026-10-29", "18:00", "Launch", by = "b"),
            CalendarItem("job", "j1", "2026-10-30", "09:00", "Count", bot = "a", runs = 3),
            CalendarItem("checkin", day = "2026-11-25", n = 30),
        )
        assertEquals(listOf("e1", "j1", null), ProjectCalendar.next(items, "2026-10-29").map { it.id })
        assertEquals(listOf("e1"), ProjectCalendar.next(items, "2026-10-29", 1).map { it.id })
        assertTrue(ProjectCalendar.editable(items[2]))
        assertFalse(ProjectCalendar.editable(items[3]))
        assertEquals("b", ProjectCalendar.whoOf(items[2]))
        assertEquals("a", ProjectCalendar.whoOf(items[3]))
        assertEquals("you", ProjectCalendar.whoOf(items[1]))
        assertNull(ProjectCalendar.whoOf(items[4]))
        assertEquals(2, ProjectCalendar.byDay(items)["2026-10-29"]!!.size)
    }

    @Test fun aTimeIsTypedLooselyAndSentAsHHMM() {
        assertEquals("09:30", ProjectCalendar.time("9:30"))
        assertEquals("09:30", ProjectCalendar.time("0930"))
        assertEquals("18:00", ProjectCalendar.time("18"))
        assertEquals("", ProjectCalendar.time(" "))
        assertNull(ProjectCalendar.time("25:00"))
        assertNull(ProjectCalendar.time("9:75"))
        assertNull(ProjectCalendar.time("soon"))
    }

    @Test fun aDecisionIsSplitAtItsFirstBecause() {
        assertEquals(ProjectDecisions.Typed("Launch in Polish first", "most users are Polish"), ProjectDecisions.split("Launch in Polish first because most users are Polish"))
        assertEquals(ProjectDecisions.Typed("Start w Polsce", "tu są klienci"), ProjectDecisions.split("Start w Polsce, bo tu są klienci"))
        assertEquals(ProjectDecisions.Typed("No ads", "too early"), ProjectDecisions.split("No  ads — too early"))
        assertEquals(ProjectDecisions.Typed("Ship Friday", ""), ProjectDecisions.split(" Ship Friday "))
        val c = CompanySetup.of(project)
        assertEquals(listOf("d2", "d1"), ProjectDecisions.shown(c.decisions).map { it.id })
        assertEquals(5, ProjectDecisions.shown((1..8).map { Decision("d$it") }).size)
    }

    @Test fun theCallsGoWhereTheWebSendsThem() = runBlocking {
        repeat(8) { server.enqueue(json(project)) }
        server.enqueue(json("""{"from":"2026-10-26","to":"2026-11-08","items":[{"kind":"event","id":"e1","day":"2026-10-29","time":"18:00","title":"Launch","by":"b"},{"kind":"checkin","day":"2026-11-25","n":30}]}"""))
        api.addTodo("Count users", "a", "2026-11-02", Repeat("week", days = listOf(1)))
        api.addTodo("Call", null, null, null)
        api.deleteTodo("x 1")
        api.addEvent("Launch", "2026-10-29", "18:00")
        api.addEvent("All day", "2026-10-30", "")
        api.changeEvent("e1", "Launch", "2026-10-31", "")
        api.addDecision(ProjectDecisions.split("Polish first because most users are Polish"))
        api.deleteDecision("d1")
        val items = api.projectCalendar("2026-10-26", "2026-11-08")
        assertEquals(2, items.size)
        assertEquals(30, items[1].n)
        val sent = (1..9).map { server.takeRequest().let { r -> Triple(r.method, r.target, r.body?.utf8().orEmpty()) } }
        assertEquals(Triple("POST", "/api/company/todos", """{"text":"Count users","bot":"a","due":"2026-11-02","repeat":{"every":"week","days":[1]}}"""), sent[0])
        assertEquals(Triple("POST", "/api/company/todos", """{"text":"Call"}"""), sent[1])
        assertEquals("DELETE" to "/api/company/todos/x%201", sent[2].first to sent[2].second)
        assertEquals(Triple("POST", "/api/company/events", """{"title":"Launch","day":"2026-10-29","time":"18:00"}"""), sent[3])
        assertEquals(Triple("POST", "/api/company/events", """{"title":"All day","day":"2026-10-30"}"""), sent[4])
        assertEquals(Triple("PUT", "/api/company/events/e1", """{"title":"Launch","day":"2026-10-31","time":""}"""), sent[5])
        assertEquals(Triple("POST", "/api/company/decisions", """{"text":"Polish first","why":"most users are Polish"}"""), sent[6])
        assertEquals("DELETE" to "/api/company/decisions/d1", sent[7].first to sent[7].second)
        assertEquals("GET" to "/api/company/calendar?from=2026-10-26&to=2026-11-08", sent[8].first to sent[8].second)
    }
}
