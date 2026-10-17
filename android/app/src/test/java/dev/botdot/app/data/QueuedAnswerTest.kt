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
 * What the server answers once a message can wait (`message-waits`; "The contract" of BUSY-001, BUSY-002 and
 * BUSY-004): a send in both shapes, "Take back", "Run now", and a tile that asks a busy bot. Neither shape of a send
 * is an error, and neither is read as sent by way of a failed parse: also from a notification's Reply, which sends
 * with these same calls.
 */
class QueuedAnswerTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String, code: Int = 200) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    @Test fun aSendToABotIsReadAsARunAndAsAMessageThatWaits() = runBlocking {
        server.enqueue(json("""{"id":"r1","botId":"doctor","status":"running","prompt":"Check the backup","startedAt":"2026-10-06T09:00:00.000Z"}""", 201))
        val run = api.runBot("doctor", "Check the backup", emptyList(), "k1")
        assertEquals("r1" to true, run.id to run.isRunning)
        assertFalse(run.isQueued)
        // To a busy bot: the id its run will have, at the top of the answer as a run has it.
        server.enqueue(json("""{"id":"r2","botId":"doctor","status":"queued","prompt":"Also tonight's","attachments":[{"name":"log.txt","file":"u1/log.txt","size":10}],"queuedAt":"2026-10-06T09:01:00.000Z"}""", 201))
        val waits = api.runBot("doctor", "Also tonight's", emptyList(), "k2")
        assertEquals("r2" to true, waits.id to waits.isQueued)
        assertFalse(waits.isRunning)
        assertEquals(listOf("log.txt"), waits.attachments?.map { it.name })
        // The same key sent again answers that waiting run.
        server.enqueue(json("""{"id":"r2","botId":"doctor","status":"queued","prompt":"Also tonight's","attachments":[],"queuedAt":"2026-10-06T09:01:00.000Z","again":true}"""))
        assertTrue(api.runBot("doctor", "Also tonight's", emptyList(), "k2").isQueued)
    }

    @Test fun aSendToTheChiefIsReadAsTheChatWithWhatWaits() = runBlocking {
        server.enqueue(json("""{"id":"c1","busy":true,"messages":[{"role":"user","text":"Find a flight"},{"role":"chief","pending":true}],"queued":[{"id":"q1","text":"And a hotel","attachments":[],"at":"2026-10-06T09:01:00.000Z"}]}""", 201))
        val chat = api.sendToChief("c1", "And a hotel", emptyList(), "k1")!!
        assertTrue(chat.busy)
        assertEquals(listOf(Queued("q1", "And a hotel", emptyList(), "2026-10-06T09:01:00.000Z")), chat.queued)
        assertEquals(2, chat.messages.size)
        // To a Chief that rests, and from a server of Milestone 6: the chat, nothing waiting.
        server.enqueue(json("""{"id":"c1","busy":true,"messages":[{"role":"user","text":"Find a flight"},{"role":"chief","pending":true}]}""", 201))
        assertEquals(emptyList<Queued>(), api.sendToChief("c1", "Find a flight", emptyList())!!.queued)
        // An answer this app cannot read as a chat is still a message that went: no error to catch.
        server.enqueue(json("""{"ok":true}""", 201))
        assertNull(api.sendToChief("c1", "hi", emptyList()))
        server.enqueue(json("", 201))
        assertNull(api.sendToChief("c1", "hi", emptyList()))
    }

    @Test fun theEleventhMessageIsARefusalInTheServersWords() = runBlocking {
        server.enqueue(json("""{"error":"Fleet Doctor already has 10 of your messages waiting. Take one back, or wait."}""", 429))
        val bot = runCatching { api.runBot("doctor", "one more", emptyList()) }.exceptionOrNull() as ApiException
        assertEquals(Triple("Fleet Doctor already has 10 of your messages waiting. Take one back, or wait.", 429, true), Triple(bot.message, bot.status, bot.said))
        server.enqueue(json("""{"error":"The Chief already has 10 of your messages waiting here. Take one back, or wait."}""", 429))
        val chief = runCatching { api.sendToChief("c1", "one more", emptyList()) }.exceptionOrNull() as ApiException
        assertEquals(429 to true, chief.status to chief.said)
    }

    @Test fun takeBackAnswersTheTextAndFilesOrThatItHasStarted() = runBlocking {
        server.enqueue(json("""{"text":"Also tonight's","attachments":[{"name":"log.txt","file":"u1/log.txt","size":10}]}"""))
        assertEquals(TakenBack("Also tonight's", listOf(Attachment("log.txt", "u1/log.txt", 10))), api.takeBack("fleet doctor", "q 1"))
        server.takeRequest().let { assertEquals("DELETE" to "/api/bots/fleet%20doctor/queued/q%201", it.method to it.target) }

        server.enqueue(json("""{"text":"And a hotel","attachments":[]}"""))
        assertEquals(TakenBack("And a hotel", emptyList()), api.takeBackFromChief("c1", "q2"))
        server.takeRequest().let { assertEquals("DELETE" to "/api/chief/chats/c1/queued/q2", it.method to it.target) }

        server.enqueue(json("""{"error":"It has already started.","runId":"r2"}""", 409))
        val late = runCatching { api.takeBack("doctor", "q1") }.exceptionOrNull() as ApiException
        assertEquals(Triple("It has already started.", 409, true), Triple(late.message, late.status, late.said))
        server.enqueue(json("""{"error":"It has already started."}""", 409))
        assertEquals(409, (runCatching { api.takeBackFromChief("c1", "q2") }.exceptionOrNull() as ApiException).status)
        server.enqueue(json("""{"error":"Not found"}""", 404))
        assertEquals(404, (runCatching { api.takeBack("doctor", "gone") }.exceptionOrNull() as ApiException).status)
        // Taken back, and the answer broke: the message is gone from the server, and what could be read comes back.
        assertEquals(TakenBack("", emptyList()), TakenBack.of("not json"))
        assertEquals(TakenBack("kept", emptyList()), TakenBack.of("""{"text":"kept","attachments":"none"}"""))
    }

    @Test fun runNowAnswersStartedQueuedOrSkipped() = runBlocking {
        server.enqueue(json("""{"started":"ai","run":{"id":"r1"}}"""))
        assertEquals(RunNow.Started, api.runJob("doctor", "j1"))
        server.takeRequest().let { assertEquals("POST" to "/api/bots/doctor/jobs/j1/run", it.method to it.target) }
        server.enqueue(json("""{"queued":true}"""))
        assertEquals(RunNow.Queued, api.runJob("doctor", "j1"))
        server.enqueue(json("""{"skipped":"its last run was still going."}"""))
        assertEquals(RunNow.Skipped("its last run was still going."), api.runJob("doctor", "j1"))
    }

    @Test fun aTileThatAsksABusyBotAnswersThatItWaits() = runBlocking {
        // Today's answer: the tile as it is now, with the run it started.
        server.enqueue(json("""{"id":"t1","kind":"button","title":"Tidy up","bot":"keeper","asks":true,"runId":"r1"}"""))
        api.tapTile("t1").let { assertEquals("t1" to false, it.tile?.id to it.queued) }
        // Its bot was busy.
        server.enqueue(json("""{"runId":"r2","queued":true}"""))
        api.tapTile("t1").let { assertEquals(null to true, it.tile to it.queued) }
        // With the tile beside it, and through one of its controls.
        server.enqueue(json("""{"id":"t1","kind":"custom","title":"Tidy up","runId":"r3","queued":true}"""))
        api.actTile("t1", "p1", null).let { assertEquals("t1" to true, it.tile?.id to it.queued) }
        assertEquals(TileTap(null, false), TileTap.of("not json"))
    }
}
