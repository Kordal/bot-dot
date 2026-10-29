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
import java.time.ZoneOffset

/**
 * The goals, the plan's teams and the leads' reports on Android (#704): the rules as the web page has them
 * (public/company-floor.js, the same numbers as its test), the fields as the server sends them, and the calls on
 * the web page's routes and bodies (docs/api.md "Objectives", "The leads' reports").
 */
class CompanyGoalsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private val running = """{"id":"c1","name":"Fernhill","phase":"running","day":31,"startedAt":"2026-10-01T10:00:00Z",
        "objectives":[{"id":"o1","name":"Paying teams","target":50,"current":23,"color":"#45C78E","display":"bar","history":[{"day":10,"value":5},{"day":20,"value":15}]},
          {"id":"o2","name":"Launch","target":0,"current":0,"steps":[{"text":"Landing page","done":true},{"text":"Pricing"}]},
          {"id":"o3","name":"Hire","done":true}],
        "teams":[{"id":"t1","name":"Sales","color":"#45c78e","bots":["a","b"],"lead":"b","report":"twice-weekly","lastReport":{"text":"Done: 3 demos\nNext: trial","at":"2026-10-28T17:00:00Z","bot":"b"}},
          {"id":"t2","name":"Support","bots":["c"],"lead":"c"}],
        "plan":{"items":[{"text":"Ship the trial","objective":"o1","team":"t1"},{"text":"Write the FAQ"}],"approved":false}}"""

    @Test fun readsTheGoalsTheTeamsAndThePlan() {
        val c = CompanySetup.of(running)
        assertEquals("2026-10-01T10:00:00Z", c.startedAt)
        val (o1, o2, o3) = c.objectives
        assertEquals("bar", o1.display)
        assertEquals(listOf(DayValue(10, 5.0), DayValue(20, 15.0)), o1.history)
        assertEquals(listOf(ObjectiveStep("Landing page", true), ObjectiveStep("Pricing", false)), o2.steps)
        assertEquals(1, CompanyFloor.stepsDone(o2))
        assertTrue(o3.done)
        assertEquals("twice-weekly", c.teams[0].report)
        assertEquals("Done: 3 demos\nNext: trial", c.teams[0].lastReport!!.text)
        assertEquals("b", c.teams[0].lastReport!!.bot)
        assertNull(c.teams[1].report); assertNull(c.teams[1].lastReport)
        assertEquals("t1", c.plan!!.items[0].team)
        assertNull(c.plan!!.items[1].team)
        // A server before #690 and #696: none of it.
        val older = CompanySetup.of("""{"id":"c1","objectives":[{"id":"o","name":"N","target":5,"current":1}],"teams":[{"id":"t","name":"T","bots":["a"]}]}""")
        assertNull(older.objectives[0].display); assertTrue(older.objectives[0].history.isEmpty()); assertNull(older.teams[0].report)
    }

    @Test fun anObjectiveIsShownAsPickedElseAChartWithANumberAndItsStatusWithout() {
        assertEquals("pace", CompanyFloor.displayOf(Objective(target = 5.0)))
        assertEquals("status", CompanyFloor.displayOf(Objective(target = 0.0)))
        assertEquals("bar", CompanyFloor.displayOf(Objective(target = 5.0, display = "bar")))
        assertEquals("pace", CompanyFloor.displayOf(Objective(target = 5.0, display = "pie"))) // one this app does not know
    }

    @Test fun aheadOnTrackOrBehindTheLineToTheTarget() {
        assertEquals(CompanyFloor.Pace.AHEAD, CompanyFloor.pace(Objective(target = 50.0, current = 23.0), 31)) // the line is at 16.85
        assertEquals(CompanyFloor.Pace.ON, CompanyFloor.pace(Objective(target = 50.0, current = 0.0), 1))
        assertEquals(CompanyFloor.Pace.AHEAD, CompanyFloor.pace(Objective(target = 50.0, current = 1.0), 1))
        assertEquals(CompanyFloor.Pace.ON, CompanyFloor.pace(Objective(target = 90.0, current = 50.0), 45)) // 44.49, a tenth is 9
        assertEquals(CompanyFloor.Pace.BEHIND, CompanyFloor.pace(Objective(target = 90.0, current = 39.0), 45))
        assertNull(CompanyFloor.pace(Objective(target = 0.0, current = 3.0), 10))
        assertNull(CompanyFloor.pace(Objective(target = 5.0), null))
    }

    @Test fun theChartDrawsTheDaysBeforeTodayAndTodaysValue() {
        val o = CompanySetup.of(running).objectives[0]
        val k = CompanyFloor.chart(o, 31)
        assertEquals(CompanyFloor.Point(0f, 1f) to CompanyFloor.Point(1f, 0f), k.line)
        assertEquals(3, k.actual.size)
        assertEquals(0.10112f, k.actual[0].x, 0.0001f); assertEquals(0.9f, k.actual[0].y, 0.0001f)
        assertEquals(0.33708f, k.actual[2].x, 0.0001f); assertEquals(0.54f, k.actual[2].y, 0.0001f)
        assertEquals(listOf(30, 60, 90), k.ticks.map { it.first })
        assertEquals(0.32584f, k.ticks[0].second, 0.0001f)
        // A value of today in the history is today's current; a value above the target raises the top.
        val over = CompanyFloor.chart(Objective(target = 10.0, current = 20.0, history = listOf(DayValue(5, 4.0))), 5)
        assertEquals(1, over.actual.size)
        assertEquals(0f, over.actual[0].y, 0f)
        assertEquals(0.5f, over.line.second.y, 0f)
    }

    @Test fun dayOneShowsWhereItStartsAndTheFirstCheckIn() {
        assertTrue(CompanyFloor.firstDay(Company("c", phase = "running", day = 1)))
        assertFalse(CompanyFloor.firstDay(Company("c", phase = "running", day = 2)))
        assertFalse(CompanyFloor.firstDay(Company("c", phase = "setup")))
        assertEquals(LocalDate.of(2026, 10, 30), CompanyFloor.checkinDate("2026-10-01T10:00:00Z", ZoneOffset.UTC))
        assertNull(CompanyFloor.checkinDate(null)); assertNull(CompanyFloor.checkinDate("soon"))
    }

    @Test fun theGoalsAndReportsCallsGoWhereTheWebSendsThem() = runBlocking {
        repeat(5) { server.enqueue(json(running)) }
        val o2 = CompanySetup.of(running).objectives[1]
        api.setObjective("o1", display = "status")
        api.setObjective("o 2", steps = CompanyFloor.ticked(o2, 1, true))
        api.setObjective("o3", done = false)
        api.setReportRhythm("t1", "weekly")
        api.setReportRhythm("t1", "")
        val sent = (1..5).map { server.takeRequest().let { r -> Triple(r.method, r.target, r.body?.utf8().orEmpty()) } }
        assertEquals(Triple("PUT", "/api/company/objectives/o1", """{"display":"status"}"""), sent[0])
        assertEquals(Triple("PUT", "/api/company/objectives/o%202", """{"steps":[{"text":"Landing page","done":true},{"text":"Pricing","done":true}]}"""), sent[1])
        assertEquals(Triple("PUT", "/api/company/objectives/o3", """{"done":false}"""), sent[2])
        assertEquals(Triple("PUT", "/api/company/teams/t1", """{"report":"weekly"}"""), sent[3])
        assertEquals(Triple("PUT", "/api/company/teams/t1", """{"report":null}"""), sent[4])
    }
}
