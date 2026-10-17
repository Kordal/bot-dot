package dev.botdot.app.feed

import dev.botdot.app.data.Api
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** What the botdot server says is new, as the notifier asks it after a restart (docs/api.md "New replies"). */
class NewChatsTest {
    private lateinit var server: MockWebServer
    private val asked = mutableListOf<String>()
    private val answers = mapOf(
        "/api/bots" to """[
            {"id":"news","name":"News","color":"#3b82f6","outfit":{"hat":"cap"},"unread":2,"firstUnread":"r7"},
            {"id":"mail","name":"Mail","color":"#16a34a","unread":0,"firstUnread":null},
            {"id":"todo","name":"Todo","unread":1,"firstUnread":"r9"}]""",
        "/api/chief" to """{"chats":[
            {"id":"c1","title":"Plans","unread":1,"firstUnread":4},
            {"id":"c2","title":"Read","unread":0,"firstUnread":null},
            {"id":"c3","title":"Reports","unread":1,"firstUnread":2}],"unread":2}""",
        "/api/runs/r7" to """{"id":"r7","botId":"news","status":"success","result":"Found 3 articles.","jobName":"Morning paper","endedAt":"2026-10-02T07:00:05.000Z"}""",
        "/api/runs/r9" to """{"id":"r9","botId":"todo","status":"error","error":"boom","problem":"It ran out of time."}""",
        "/api/chief/chats/c1?offset=4&limit=1" to """{"id":"c1","title":"Plans","offset":4,"total":5,"messages":[{"role":"chief","text":"I set that up.","endedAt":"2026-10-02T08:00:00.000Z"}]}""",
        "/api/chief/chats/c3?offset=2&limit=1" to """{"id":"c3","title":"Reports","offset":2,"total":3,"messages":[{"role":"report","text":"Here is the paper.","from":{"id":"news","name":"News","color":"#111111"},"at":"2026-10-02T09:00:00.000Z"}]}""",
    )

    @Before fun start() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath + (request.url.encodedQuery?.let { "?$it" } ?: "")
                synchronized(asked) { asked += path }
                val body = answers[path] ?: return MockResponse.Builder().code(404).body("""{"error":"Not found"}""").build()
                return MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build()
            }
        }
        server.start()
    }

    @After fun stop() = server.close()

    @Test fun `the chats with new replies are those the server counts, each with the reply it names first`() = runBlocking {
        val chats = newChats(Api(server.url("/").toString().trimEnd('/')))
        assertEquals(listOf("bot:news", "bot:todo", "chief:c1", "chief:c3"), chats.map { it.chat })
        assertEquals("nothing is fetched for a chat until its notification is made again", setOf("/api/bots", "/api/chief"), synchronized(asked) { asked.toSet() })

        val news = chats[0].first()!!
        assertEquals(listOf("news", "News", "#3b82f6", "Morning paper\nFound 3 articles."), listOf(news.botId, news.name, news.color, news.text))
        assertEquals("""{"hat":"cap"}""", news.outfit.toString())
        assertEquals(java.time.Instant.parse("2026-10-02T07:00:05.000Z").toEpochMilli(), news.at)

        val todo = chats[1].first()!!
        assertEquals("a run that didn't finish says why", "It ran out of time.", todo.text)
        assertNull("no hat: a bare head", todo.outfit)

        val chief = chats[2].first()!!
        assertEquals(listOf("chief", "Chief of Staff", "I set that up.", "Plans"), listOf(chief.botId, chief.name, chief.text, chief.title))

        val report = chats[3].first()!!
        assertEquals("a bot's reply posted in a Chief chat is the bot's, as it looks now", listOf("news", "News", "#3b82f6", "Here is the paper.", "Reports"), listOf(report.botId, report.name, report.color, report.text, report.title))
        assertEquals("""{"hat":"cap"}""", report.outfit.toString())
    }
}
