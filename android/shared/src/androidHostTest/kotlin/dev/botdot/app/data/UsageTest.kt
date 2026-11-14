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

/**
 * Settings → Usage (#301), against a stand-in botdot: shown only from a server that announces it, the ranges count
 * back from the account's today, a custom range never runs backwards, and the answer reads into totals, bots and days.
 */
class UsageTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    @Test fun shownOnlyFromAServerThatAnnouncesIt() {
        assertTrue(Usage.shows(listOf("whats-new", "token-usage")))
        assertFalse(Usage.shows(listOf("whats-new")))
        assertFalse(Usage.shows(null))
    }

    @Test fun rangesCountBackFromTheAccountsToday() {
        assertEquals("2026-10-22" to "2026-10-22", Usage.rangeOf(Usage.Preset.TODAY, "2026-10-22"))
        assertEquals("2026-02-24" to "2026-03-02", Usage.rangeOf(Usage.Preset.WEEK, "2026-03-02"))
        assertEquals("2026-09-23" to "2026-10-22", Usage.rangeOf(Usage.Preset.MONTH, "2026-10-22"))
        assertNull(Usage.rangeOf(Usage.Preset.WEEK, "not a day"))
    }

    @Test fun aCustomRangeNeverRunsBackwards() {
        assertEquals("2026-10-01" to "2026-10-22", Usage.custom("2026-10-01", "2026-10-22", "from"))
        assertEquals("2026-10-22" to "2026-10-22", Usage.custom("2026-10-22", "2026-10-01", "from"))
        assertEquals("2026-10-01" to "2026-10-01", Usage.custom("2026-10-22", "2026-10-01", "to"))
        assertNull(Usage.custom("2026-02-30", "2026-03-01", "from"))
        assertNull(Usage.custom("2026-10-1", "2026-10-22", "from"))
    }

    @Test fun numbersReadShort() {
        assertEquals(listOf("0", "9,999", "12.3k", "123k", "1.2M", "12M"), listOf(0L, 9_999L, 12_345L, 123_456L, 1_234_567L, 12_345_678L).map { Usage.tokens(it) })
        assertEquals(listOf(0f, 1f, 0.5f), Usage.bars(listOf(Usage.Day("a", 0), Usage.Day("b", 200), Usage.Day("c", 100))))
        assertEquals(listOf(0.03f, 1f), Usage.bars(listOf(Usage.Day("a", 1), Usage.Day("b", 1000))))
        assertEquals("16 Oct", Usage.dayLabel("2026-10-16"))
    }

    @Test fun readsTheRangeItAskedFor() = runBlocking {
        server.enqueue(json("""{"from":"2026-10-16","to":"2026-10-22","today":"2026-10-22","timeZone":"Europe/Warsaw","keepDays":400,
            "totals":{"inputTokens":1234,"outputTokens":56789,"cacheReadTokens":2500000,"cacheWriteTokens":0,"totalTokens":2558023,"runs":4},
            "bots":[{"id":"b1","name":"News","totalTokens":2000,"runs":2,"later":true},{"id":null,"chief":true,"name":"Chief of Staff","totalTokens":1000,"runs":1},
                    {"id":"old","name":"Gone","gone":true,"totalTokens":5,"runs":1}],
            "days":[{"day":"2026-10-16","totalTokens":1000},{"day":"2026-10-22","totalTokens":2000}]}"""))
        val a = api.usage("2026-10-16", "2026-10-22")
        val r = server.takeRequest()
        assertEquals("GET" to "/api/usage?from=2026-10-16&to=2026-10-22", r.method to r.target)
        assertEquals("2026-10-22", a.today)
        assertEquals(2_500_000L, a.totals.cacheReadTokens)
        assertEquals(2_558_023L, a.totals.totalTokens)
        assertEquals(listOf("b1", null, "old"), a.bots.map { it.id })
        assertTrue(a.bots[1].chief)
        assertTrue(a.bots[2].gone)
        assertEquals(2, a.days.size)
    }

    @Test fun withoutDaysItAsksForToday() = runBlocking {
        server.enqueue(json("""{"from":"2026-10-22","to":"2026-10-22","today":"2026-10-22"}"""))
        assertEquals("2026-10-22", api.usage().today)
        assertEquals("/api/usage", server.takeRequest().target)
    }
}
