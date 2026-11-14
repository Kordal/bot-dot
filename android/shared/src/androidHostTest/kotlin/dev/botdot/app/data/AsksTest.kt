package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A bot's open question to the owner (`asks-you`, "The contract" of SURE-001, docs/api.md): `asks` on a bot, the
 * feed's `asks` event that sets and ends it, and `asks: true` on the run that asked.
 */
class AsksTest {
    private fun bots(json: String): List<Bot> = Api.JSON.decodeFromString(json)
    private fun event(json: String) = FeedEvent("b.7", "asks", Json.parseToJsonElement(json).jsonObject)
    private val question = "Two mailboxes have unread invoices. Which one shall I sort first?"
    private val list = """[{"id":"mail","name":"Mail Sorter","state":"needs_you","asks":{"text":"$question","runId":"r9","at":"2026-10-06T09:40:00Z"}},{"id":"news","name":"News Watcher"}]"""

    @Test fun aBotCarriesItsOpenQuestion() {
        val (mail, news) = bots(list)
        assertEquals(Asks(question, "r9", "2026-10-06T09:40:00Z"), mail.asks)
        assertNull(news.asks)
    }

    @Test fun aServerWithoutAsksYouAndAFieldOfAnotherKindAskNothing() {
        assertNull(bots("""[{"id":"mail","name":"Mail Sorter"}]""").single().asks)
        for (odd in listOf("null", "true", "\"Which one?\"", "[]", "{}", """{"text":""}""", """{"text":7}""", """{"runId":"r9"}""")) {
            val b = bots("""[{"id":"mail","name":"Mail Sorter","asks":$odd}]""").single()
            assertEquals(odd, "Mail Sorter", b.name)
            assertNull(odd, b.asks)
        }
    }

    @Test fun theFeedSetsReplacesAndEndsIt() {
        val before = bots("""[{"id":"mail","name":"Mail Sorter"},{"id":"news","name":"News Watcher"}]""")
        val asked = Asks.on(before, event("""{"botId":"mail","asks":{"text":"$question","runId":"r9"}}"""))
        assertEquals(question, asked[0].asks?.text)
        assertNull("the other bots are as they were", asked[1].asks)
        val again = Asks.on(asked, event("""{"botId":"mail","asks":{"text":"And the private one?","runId":"r10"}}"""))
        assertEquals("And the private one?", again[0].asks?.text)
        val ended = Asks.on(again, event("""{"botId":"mail","asks":null}"""))
        assertNull("the owner answered, here or in another app", ended[0].asks)
    }

    @Test fun otherEventsChangeNothing() {
        val asked = bots(list)
        // The event of the same name about what waits for the owner's OK names no bot.
        assertSame(asked, Asks.on(asked, event("""{"waiting":1,"list":[{"id":"a1","kind":"permission","botId":"mail"}]}""")))
        assertSame(asked, Asks.on(asked, event("""{"botId":"mail"}""")))
        assertSame(asked, Asks.on(asked, event("""{"asks":null}""")))
        assertSame(asked, Asks.on(asked, FeedEvent("b.8", "bots", Json.parseToJsonElement("""{"botId":"mail","asks":null}""").jsonObject)))
        assertEquals("a bot this app does not have", asked, Asks.on(asked, event("""{"botId":"gone","asks":null}""")))
    }

    @Test fun aRunSaysThatItsReplyAsks() {
        val run: Run = Api.JSON.decodeFromString("""{"id":"r9","botId":"mail","status":"success","result":"A long reply. $question","asks":true,"title":"Mail Sorter asks","question":"$question"}""")
        assertTrue(run.asks)
        assertEquals("Mail Sorter asks", run.title)
        assertEquals("the question in one line, apart from the reply", question, run.question)
        assertNull("a server that sends none", Api.JSON.decodeFromString<Run>("""{"id":"r9","asks":true,"title":"Mail Sorter asks"}""").question)
        for (odd in listOf("7", "null", "{}", "[]")) assertNull(odd, Api.JSON.decodeFromString<Run>("""{"id":"r9","asks":true,"question":$odd}""").question)
        val plain: Run = Api.JSON.decodeFromString("""{"id":"r8","botId":"mail","status":"success","result":"Done."}""")
        assertFalse(plain.asks)
        assertNull(plain.title)
        assertNull(plain.question)
        for (odd in listOf("\"true\"", "1", "null", "{}")) assertFalse(odd, Api.JSON.decodeFromString<Run>("""{"id":"r8","asks":$odd,"title":$odd}""").asks)
    }
}
