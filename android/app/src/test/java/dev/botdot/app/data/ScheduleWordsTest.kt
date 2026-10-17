package dev.botdot.app.data

import dev.botdot.app.ui.describeCron
import dev.botdot.app.ui.scheduleWords
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * A job's schedule in words. The server says them (`when`, docs/api.md); `describeCron` is the app's own words for a
 * server that sends none. It knows fewer shapes than the server and is checked against the server's table
 * (test/fixtures/cron-words.json; see its "about"): the table's words, or "Custom schedule", never anything else.
 */
class ScheduleWordsTest {
    @Serializable
    data class Row(val cron: String, val words: String)

    @Serializable
    data class Table(val rows: List<Row>)

    private val table: Table = Json { ignoreUnknownKeys = true }.decodeFromString(
        Table.serializer(),
        File(System.getProperty("cronWords") ?: "../../test/fixtures/cron-words.json").readText(),
    )

    private fun job(json: String) = Api.JSON.decodeFromString(Job.serializer(), json)

    @Test fun theTablesWordsOrCustomSchedule() {
        assertTrue(table.rows.size >= 45)
        table.rows.forEach { r ->
            val said = describeCron(r.cron)
            assertTrue("${r.cron}: \"$said\" is neither \"${r.words}\" nor \"Custom schedule\"", said == r.words || said == "Custom schedule")
        }
    }

    @Test fun neverTheExpression() = table.rows.forEach { r ->
        val said = describeCron(r.cron)
        assertFalse("${r.cron}: \"$said\"", r.cron in said)
        assertTrue(r.cron, said.isNotBlank())
    }

    /** The shapes the app says itself: for these it gives the table's words, not "Custom schedule". */
    @Test fun theShapesItKnows() {
        val known = listOf(
            "*/30 * * * *", "0 * * * *", "5 * * * *", "15 * * * *", "0 */2 * * *", "30 */2 * * *",
            "0 9 * * *", "0 3 * * *", "0 2 * * *", "0 9 * * 1-5", "0 18 * * 1-5", "0 9 * * 0,6",
            "0 10 * * 1", "0 10 * * 6", "0 9 * * 7", "0 10 5 * *", "0 7 28 9 *", "0 0 31 2 *", "foo",
        )
        val words = table.rows.associate { it.cron to it.words }
        known.forEach { assertEquals(it, words.getValue(it), describeCron(it)) }
    }

    /** A job that takes calls: the server's words say so, and the app shows them as they came. */
    @Test fun aCallableJobsWordsAreTheServers() {
        assertEquals("Daily at 08:00, and when called", scheduleWords(job("""{"id":"j1","cron":"0 8 * * *","when":"Daily at 08:00, and when called","call":true}""")))
        assertEquals("When called", scheduleWords(job("""{"id":"j2","cron":"0 4 31 2 *","when":"When called","call":true}""")))
    }

    @Test fun theLabelsOfTheListedTimes() {
        assertEquals("Hourly", describeCron("0 * * * *"))
        assertEquals("Nightly at 02:00", describeCron("0 2 * * *"))
        assertEquals("Hourly, at minute 15", describeCron("15 * * * *"))
        // By the values, as the server reads them.
        assertEquals("Nightly at 02:00", describeCron("00 02 * * *"))
        assertEquals("Daily at 02:30", describeCron(" 30  2 * * * "))
    }

    @Test fun everyHoursOnlyForAllDaysAndAllMonths() {
        assertEquals("Every 2 hours, at minute 30", describeCron("30 */2 * * *"))
        assertEquals("Custom schedule", describeCron("0 */2 * * 1"))
        assertEquals("Custom schedule", describeCron("0 */2 * 6 *"))
        assertEquals("Custom schedule", describeCron("0 */2 1 * *"))
    }

    /** What the server says otherwise, or refuses, is not said with the nearest words. */
    @Test fun stepsAndNumbersTheServerReadsOtherwise() {
        listOf(
            "*/7 * * * *", // not an even part of the hour
            "*/1 * * * *", "*/60 * * * *", "*/0 * * * *", "*/x * * * *",
            "0 */5 * * *", "0 */1 * * *", "0 */24 * * *", "0 */x * * *",
            "60 * * * *", "0 24 * * *", "0 9 * * 8", "0 9 32 * *", "0 9 0 * *", "0 9 5 13 *", "0 9 5 0 *",
            "99999999999 * * * *", "0 99999999999 * * *", "a b c d e",
        ).forEach { assertEquals(it, "Custom schedule", describeCron(it)) }
    }

    /** Each of its shapes holds only where the other fields leave it alone: with days or months the server says more. */
    @Test fun aShapeWithDaysOrMonthsTheAppCannotSay() {
        listOf(
            "*/15 * * * 1", "*/15 * 1 * *", "*/15 * * 6 *", // server: "Every 15 min, Monday", …
            "0 * * * 1", "5 * * * 1", "0 * 1 * *", "0 * * 6 *", // "Hourly, Monday", …
            "0 9 * 6 *", "0 2 * 6 *", // "Daily at 09:00, in June"
            "0 9 * 6 1-5", "0 9 1 * 1-5", "0 9 * 6 0,6", "0 9 1 * 0,6", // "Weekdays at 09:00, in June", …
            "0 9 * 6 1", "0 9 5 * 1", // "Mondays at 09:00, in June", "Monthly on day 5, only if it is a Monday, at 09:00"
            "0 9 5 6 1", "0 9 31 2 1", // not one day of the year: "Monthly on day 5, only if it is a Monday, at 09:00, in June"
            "0 9 * * 1,3", "0 9 1,15 * *", "0 9 5 1,7 *",
        ).forEach { assertEquals(it, "Custom schedule", describeCron(it)) }
        // 02:00 is "Nightly" only when it is every day.
        assertEquals("Mondays at 02:00", describeCron("0 2 * * 1"))
        assertEquals("Monthly on day 1 at 02:00", describeCron("0 2 1 * *"))
    }

    /** The fields are parted as the server parts them. */
    @Test fun whiteSpaceAsTheServerReadsIt() {
        assertEquals("Daily at 09:00", describeCron("\t0\u00A09  *\u2003*\n*\uFEFF"))
        assertEquals("Daily at 09:00", describeCron("\u30000 9 * * *\u3000"))
        // Not white space to the server, which refuses it: not said as a time.
        assertEquals("Custom schedule", describeCron("0 9 * * *\u001F"))
        assertEquals("Invalid schedule", describeCron("0 9 * * 1\u20031"))
    }

    /** No screen says a schedule on its own: the cron is read, and `describeCron` called, by `scheduleWords` alone. */
    @Test fun everyScreenAsksScheduleWords() {
        val lines = File("src/main/java/dev/botdot/app").walkTopDown().filter { it.extension == "kt" }
            .flatMap { f -> f.readLines().map { f.name to it.trim() } }.toList()
        assertTrue(lines.size > 1000)
        val one = "fun scheduleWords(j: Job): String = j.words?.takeIf { it.isNotBlank() } ?: describeCron(j.cron)"
        assertEquals(listOf("NeedsYouScreen.kt" to one), lines.filter { (_, l) -> ".cron" in l })
        assertEquals(listOf("NeedsYouScreen.kt" to one), lines.filter { (_, l) -> "describeCron(" in l && !l.startsWith("fun describeCron(") })
        assertEquals(listOf("BotSettingsScreen.kt", "JobsScreen.kt", "NeedsYouScreen.kt"),
            lines.filter { (_, l) -> "scheduleWords(j)" in l && l != one }.map { it.first }.sorted())
    }

    @Test fun aDayNoYearHasNeverRuns() {
        assertEquals("Never runs", describeCron("0 0 31 2 *"))
        assertEquals("Never runs", describeCron("0 0 30 2 *"))
        assertEquals("Never runs", describeCron("0 0 31 4 *"))
        assertEquals("29 Feb at 00:00", describeCron("0 0 29 2 *"))
        assertEquals("31 Dec at 23:59", describeCron("59 23 31 12 *"))
    }

    @Test fun notFiveFieldsIsInvalid() =
        listOf("", "   ", "foo", "0 9 * *", "0 9 * * * *").forEach { assertEquals(it, "Invalid schedule", describeCron(it)) }

    @Test fun aJobWithWhenShowsTheServersWords() {
        val j = job("""{"id":"j1","name":"Check","cron":"0 8-21 * * *","when":"Every hour, 08:00 to 21:00"}""")
        assertEquals("Every hour, 08:00 to 21:00", j.words)
        assertEquals("Every hour, 08:00 to 21:00", scheduleWords(j))
        // The server's words also where the app has its own.
        assertEquals("Hourly", scheduleWords(job("""{"id":"j2","cron":"*/30 * * * *","when":"Hourly"}""")))
    }

    @Test fun aJobWithoutWhenShowsTheAppsWords() {
        // A server older than `when`.
        assertEquals("Weekdays at 07:30", scheduleWords(job("""{"id":"j1","cron":"30 7 * * 1-5"}""")))
        assertEquals("Custom schedule", scheduleWords(job("""{"id":"j2","cron":"0 8-21 * * *"}""")))
        assertEquals("Weekdays at 07:30", scheduleWords(job("""{"id":"j3","cron":"30 7 * * 1-5","when":null}""")))
        assertEquals("Weekdays at 07:30", scheduleWords(job("""{"id":"j4","cron":"30 7 * * 1-5","when":""}""")))
    }
}
