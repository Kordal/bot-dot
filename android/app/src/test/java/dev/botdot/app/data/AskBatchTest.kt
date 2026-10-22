package dev.botdot.app.data

import dev.botdot.app.feed.askNotices
import dev.botdot.app.ui.batchOwnLine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** One card per run (#277, docs/api.md "One card per run"): the asks that share a `batch` are one card and one notification. */
class AskBatchTest {
    private val batch = """{"id":"run-r1","title":"Coder wants 2 things for “Fix the build”","count":2}"""
    private val asks = """[
        {"id":"p2","kind":"permission","permission":"web"},
        {"id":"p1","kind":"permission","permission":"web","batch":$batch},
        {"id":"o1","kind":"override","title":"Let Coder do this?","batch":$batch},
        {"id":"s1","kind":"vault-switch","title":"Let Coder use “Bridge” in its computer?","batch":{"id":"run-r1","title":"t","own":true}}
    ]"""

    @Test fun theAsksOfOneRunAreOneCardWhereTheFirstStood() {
        val cards = askCards(Ask.list(asks))
        assertEquals(listOf("a:p2", "b:run-r1"), cards.map { it.key })
        val several = cards[1] as AskCard.Several
        assertEquals("Coder wants 2 things for “Fix the build”", several.title)
        assertEquals(listOf("p1", "o1", "s1"), several.asks.map { it.id })
        assertTrue(several.asks.last().batch!!.own)
    }

    @Test fun oneAskLeftOfABatchIsItsOwnCardAgain() {
        val one = Ask.list("""[{"id":"p1","kind":"permission","batch":$batch}]""")
        assertEquals(listOf("a:p1"), askCards(one).map { it.key })
    }

    @Test fun aBatchOfAnotherKindIsNone() {
        for (odd in listOf("null", "true", "\"run-r1\"", "{}", """{"id":""}""", """{"id":7}""")) {
            assertNull(odd, Ask.list("""[{"id":"p1","batch":$odd}]""").single().batch)
        }
    }

    @Test fun aVaultSecretIsNamedAsOneAllowAllLeaves() {
        assertEquals("Allow all leaves “Let Coder use “Bridge” in its computer?” to its own Allow.", batchOwnLine(Ask.list(asks)))
        assertNull(batchOwnLine(Ask.list(asks).take(3)))
    }

    @Test fun theServersAnswerToAllowAllIsReadPerAsk() {
        val r = BatchAnswered.of("""{"ok":true,"answers":[{"id":"p1","ok":true,"carriesOn":{"text":"it carries on"}},{"id":"o1","ok":false,"status":409,"error":"Too many."}],"left":["s1"]}""")
        assertEquals(listOf("p1", "o1"), r.done.map { it.id })
        assertEquals("it carries on", r.done[0].answered?.carriesOn?.text)
        assertEquals("Too many.", r.done[1].error)
    }

    @Test fun oneNotificationPerCardWithItsTitle() {
        val list = Json.parseToJsonElement(asks).let { it as kotlinx.serialization.json.JsonArray }.map { it.jsonObject }
        val notices = askNotices(list)
        assertEquals(2, notices.size)
        assertNull(notices[0].batch)
        assertEquals("Coder wants 2 things for “Fix the build”", notices[1].batch?.title)
        assertEquals(listOf("ask:p1", "ask:o1", "ask:s1"), notices[1].asks)
    }
}
