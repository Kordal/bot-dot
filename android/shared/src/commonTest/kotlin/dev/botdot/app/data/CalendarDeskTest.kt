package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** The project's calendar for both phones (CalendarDesk, #695): the tile's week and what comes, the month and its events. */
class CalendarDeskTest {
    private class Asked(val method: String, val path: String, val query: String, val body: String)
    private class FakeBotdot(answer: suspend (Asked) -> Pair<Int, String>) {
        private val lock = Mutex()
        private val took = mutableListOf<Asked>()
        val api = Api("https://botdot.test", MockEngine { req ->
            val asked = Asked(req.method.value, req.url.encodedPath.removePrefix("/api"), req.url.encodedQuery, (req.body as? TextContent)?.text.orEmpty())
            lock.withLock { took += asked }
            val (status, body) = answer(asked)
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        suspend fun asked(): List<Asked> = lock.withLock { took.toList() }
    }

    private var today = LocalDate(2026, 11, 18) // a Wednesday
    private val project = """{"id":"p1","name":"Kitchen","phase":"running","teams":[{"id":"t1","name":"Crew","bots":["b1"]}]}"""
    private val items = """{"items":[{"kind":"event","id":"e1","day":"2026-11-18","time":"09:00","title":"Standup"},
        {"kind":"job","day":"2026-11-19","title":"Digest","bot":"b1","runs":2},{"kind":"checkin","day":"2026-11-20","n":30},
        {"kind":"todo","day":"2026-11-17","title":"Old","done":true}]}"""

    private fun TestScope.desk(fake: FakeBotdot): Pair<Store, CalendarDesk> {
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.bots.set(listOf(Bot("b1", "Ada", color = "#336699")))
        store.company.set(CompanyHeld(CompanySetup.of(project)))
        return store to CalendarDesk(store, fake.api, backgroundScope) { today }
    }

    private suspend fun TestScope.until(what: String, done: suspend () -> Boolean) {
        repeat(400) {
            if (done()) return
            advanceTimeBy(50)
            runCurrent()
            withContext(Dispatchers.Default) { delay(5) }
        }
        fail("never: $what")
    }

    @Test fun theTilesWeekLightsTodayAndListsWhatComes() = runTest {
        val fake = FakeBotdot { a -> if (a.path == "/company/calendar") 200 to items else 200 to project }
        val (_, desk) = desk(fake)
        until("the tile read") { desk.state.value.next.isNotEmpty() }
        val s = desk.state.value
        assertEquals((16..22).toList(), s.week.map { it.number }, "Monday to Sunday")
        assertTrue(s.week[2].today); assertTrue(s.week[0].past)
        assertEquals(listOf("#336699"), s.week[3].dots, "the job's dot is its bot's colour")
        assertEquals(listOf(ProjectCalendar.CHECKIN_COLOR), s.week[4].dots)
        assertEquals(listOf("Standup", "Digest", "Day 30 check-in"), s.next.map(ProjectCalendar::titleOf), "open items from today")
        assertEquals("09:00", ProjectCalendar.whenOf(s.next[0], s.today))
        assertEquals("Tomorrow", ProjectCalendar.whenOf(s.next[1], s.today))
        assertTrue(ProjectCalendar.repeats(s.next[1]))
        val asked = fake.asked().first { it.path == "/company/calendar" }
        assertTrue(asked.query.contains("from=2026-11-16") && asked.query.contains("to=2026-11-29"), asked.query)
    }

    @Test fun theMonthAddsChangesAndDeletesTheOwnersEvents() = runTest {
        var refuse = false
        val fake = FakeBotdot { a ->
            when {
                a.path == "/company/calendar" -> 200 to items
                refuse && a.method != "GET" -> 409 to """{"error":"Not that day"}"""
                else -> 200 to project
            }
        }
        val (_, desk) = desk(fake)
        desk.open("2026-11-18")
        until("the month") { desk.state.value.pickedItems.isNotEmpty() }
        with(desk.state.value) {
            assertEquals("2026-11", month)
            assertEquals(42, cells.size, "whole weeks: Monday 26 October to Sunday 6 December")
            assertTrue(cells.first().out, "the Monday before the 1st is October's")
        }
        assertFalse(desk.save("Lunch", "25:00", null), "no such time")
        assertTrue(desk.save("Lunch", "1230", null))
        val added = fake.asked().last { it.path == "/company/events" }
        assertEquals("""{"title":"Lunch","day":"2026-11-18","time":"12:30"}""", added.body)
        desk.edit("e1")
        until("editing") { desk.state.value.editing?.id == "e1" }
        assertTrue(desk.save("Standup", "", "2026-11-19"))
        assertEquals("""{"title":"Standup","day":"2026-11-19","time":""}""", fake.asked().last { it.path == "/company/events/e1" }.body)
        refuse = true
        assertFalse(desk.save("Again", "", null))
        until("the refusal said") { desk.state.value.notice == "Not that day" }
        refuse = false
        desk.delete("e1")
        assertEquals("DELETE", fake.asked().last { it.path == "/company/events/e1" }.method)
        desk.turn(1)
        until("December") { desk.state.value.month == "2026-12" }
        assertEquals("2026-12-01", desk.state.value.picked)
        desk.shut()
        until("shut") { desk.state.value.month == null }
        assertNull(desk.state.value.picked)
    }

    @Test fun pastMidnightTheTileReadsAgainAndLightsTheNewDay() = runTest {
        val fake = FakeBotdot { a -> if (a.path == "/company/calendar") 200 to items else 200 to project }
        val (_, desk) = desk(fake)
        until("the tile read") { desk.state.value.next.isNotEmpty() }
        val reads = fake.asked().count { it.path == "/company/calendar" }
        assertTrue(desk.state.value.week[2].today)
        today = LocalDate(2026, 11, 19)
        advanceTimeBy(CalendarDesk.TICK_MS + 1)
        until("the new day") { desk.state.value.today == "2026-11-19" }
        assertTrue(desk.state.value.week[3].today, "Thursday lit now")
        assertTrue(desk.state.value.week[2].past)
        until("read again") { fake.asked().count { it.path == "/company/calendar" } > reads }
        assertEquals(listOf("Digest", "Day 30 check-in"), desk.state.value.next.map(ProjectCalendar::titleOf), "yesterday's event is past")
    }

    @Test fun anEventGoneWhileItWasBeingChangedIsAddedNotChanged() = runTest {
        var gone = false
        val fake = FakeBotdot { a ->
            when {
                a.path == "/company/calendar" -> 200 to if (gone) """{"items":[]}""" else items
                else -> 200 to project
            }
        }
        val (store, desk) = desk(fake)
        desk.open("2026-11-18")
        until("the month") { desk.state.value.pickedItems.isNotEmpty() }
        desk.edit("e1")
        until("editing") { desk.state.value.editing?.id == "e1" }
        // Deleted elsewhere: the project changes, the month is read again without it.
        gone = true
        store.company.set(CompanyHeld(CompanySetup.of(project.dropLast(1) + ""","day":13}""")))
        until("it went") { desk.state.value.pickedItems.isEmpty() }
        assertNull(desk.state.value.editing, "the form adds again")
        assertTrue(desk.save("Standup", "0900", null))
        assertTrue(fake.asked().none { it.path == "/company/events/e1" }, "nothing changed on an event that is gone")
        assertEquals("POST", fake.asked().last { it.path == "/company/events" }.method)
    }
}
