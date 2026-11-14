package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 👍 and 👎 under unasked Chief messages in the Android app (docs/api.md "The Chief writes first"): what the server
 * sends is read, what a tap makes of a rating, the call, and the feed event. `test/ratings-web.test.js` holds the web
 * page's side.
 */
class RatingsTest {
    private fun chat(json: String) = Api.JSON.decodeFromString(ChiefChat.serializer(), json)
    private fun obj(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

    private val withRatings = listOf("chief", "unread", "ratings")
    private val unasked = """{"id":"c1","offset":10,"total":13,"messages":[
        {"role":"user","text":"Hi"},
        {"role":"chief","text":"Hello"},
        {"role":"chief","text":"A tip for you","unasked":true,"rating":"up","at":"2026-10-03T09:00:00Z"}]}"""

    @Test fun theFieldsAreReadWhenTheyAreThereAndLeftOutWhenNot() {
        val c = chat(unasked)
        assertEquals(listOf(false, false, true), c.messages.map { it.unasked })
        assertEquals(listOf(null, null, "up"), c.messages.map { it.rating })

        // An unasked message never rated, and a botdot from before ratings: no fields at all.
        val plain = chat("""{"id":"c1","messages":[{"role":"chief","text":"Fresh","unasked":true},{"role":"chief","text":"Old"}]}""")
        assertEquals(listOf(true, false), plain.messages.map { it.unasked })
        assertEquals(listOf<String?>(null, null), plain.messages.map { it.rating })
    }

    @Test fun aMessageWithFieldsThisAppDoesNotKnowStillLoads() {
        val c = chat("""{"id":"c1","messages":[{"role":"chief","text":"Hm","unasked":true,"rating":"meh","mood":{"x":1},"later":[1,2]}],"newThing":true}""")
        assertEquals("Hm", c.messages.single().text)
        assertNull(Ratings.value(c.messages.single().rating)) // a rating it doesn't know shows nothing filled
    }

    @Test fun aTapFillsClearsAndMoves() {
        assertEquals("up", Ratings.next(null, "up"))
        assertEquals("down", Ratings.next(null, "down"))
        assertNull(Ratings.next("up", "up")) // the filled one clears
        assertNull(Ratings.next("down", "down"))
        assertEquals("down", Ratings.next("up", "down")) // the other one moves it
        assertEquals("up", Ratings.next("down", "up"))
        assertEquals("up", Ratings.next("up", "sideways")) // not a thumb: nothing changes
        assertEquals("up", Ratings.next("meh", "up"))
    }

    @Test fun onlyAnUnaskedFinishedChiefMessageGetsTheThumbsAndOnlyFromAServerThatRates() {
        val c = chat(unasked)
        val (user, chief, tip) = c.messages
        assertTrue(Ratings.shows(tip, withRatings, 12))
        assertFalse(Ratings.shows(chief, withRatings, 11)) // a reply the owner asked for
        assertFalse(Ratings.shows(user, withRatings, 10))
        assertFalse(Ratings.shows(tip.copy(pending = true), withRatings, 12))
        assertFalse(Ratings.shows(tip.copy(role = "report"), withRatings, 12))
        assertFalse(Ratings.shows(tip, withRatings, -1))
        // A botdot without ratings, or one whose features aren't known yet: no icons.
        assertFalse(Ratings.shows(tip, listOf("chief", "unread"), 12))
        assertFalse(Ratings.shows(tip, emptyList(), 12))
        assertFalse(Ratings.shows(tip, null, 12))
    }

    @Test fun aRatingGoesOnTheMessageAtItsPlaceInTheWholeChat() {
        val c = chat(unasked) // its messages are 10 to 12 of the whole chat
        assertEquals("up", Ratings.of(c, 12))
        val down = Ratings.set(c, 12, "down")
        assertEquals("down", Ratings.of(down, 12))
        assertEquals(listOf(null, null, "down"), down.messages.map { it.rating })
        assertNull(Ratings.of(Ratings.set(c, 12, null), 12))
        // A message that isn't loaded (older, or past the end): the chat as it was.
        assertSame(c, Ratings.set(c, 9, "up"))
        assertSame(c, Ratings.set(c, 13, "up"))
        assertNull(Ratings.of(c, 3))
    }

    @Test fun aRatingThatWasNotSavedGoesBackUnlessItChangedSince() {
        val before = chat(unasked) // rated up
        val tapped = Ratings.set(before, 12, Ratings.next("up", "down")) // moved to down, then refused
        assertEquals("up", Ratings.of(Ratings.undo(tapped, 12, "down", "up"), 12))
        // Cleared, then refused: up again.
        assertEquals("up", Ratings.of(Ratings.undo(Ratings.set(before, 12, null), 12, null, "up"), 12))
        // The feed or a later tap changed it meanwhile: that stays.
        val later = Ratings.set(tapped, 12, null)
        assertSame(later, Ratings.undo(later, 12, "down", "up"))
    }

    @Test fun theFeedEventIsRead() {
        assertEquals(Ratings.Rated("c1", 12, "down"), Ratings.event(obj("""{"chatId":"c1","index":12,"rating":"down","at":"2026-10-03T09:01:00Z"}""")))
        assertEquals(Ratings.Rated("c1", 12, null), Ratings.event(obj("""{"chatId":"c1","index":12,"rating":null}""")))
        assertEquals(Ratings.Rated("c1", 0, null), Ratings.event(obj("""{"chatId":"c1","index":0}""")))
        assertNull(Ratings.event(obj("""{"index":12,"rating":"up"}""")))
        assertNull(Ratings.event(obj("""{"chatId":"c1","index":-1,"rating":"up"}""")))
        assertNull(Ratings.event(obj("""{"chatId":"c1","index":"twelve","rating":"up"}""")))
        assertNull(Ratings.event(obj("""{"chatId":{"id":"c1"},"index":12}""")))

        // The event put into the chat on screen.
        val c = chat(unasked)
        val r = Ratings.event(obj("""{"chatId":"c1","index":12,"rating":null}"""))!!
        assertNull(Ratings.of(Ratings.set(c, r.index, r.rating), 12))
    }

    @Test fun aTapIsSentAndARefusalIsAnError() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            val ok = { body: String -> MockResponse.Builder().addHeader("Content-Type", "application/json").body(body).build() }
            server.enqueue(ok("""{"ok":true,"chatId":"c 1","index":12,"rating":"up"}"""))
            api.rate("c 1", 12, "up")
            val up = server.takeRequest()
            assertEquals("PUT", up.method)
            assertEquals("/api/chief/chats/c%201/messages/12/rating", up.target)
            assertEquals("""{"rating":"up"}""", up.body?.utf8())

            server.enqueue(ok("""{"ok":true,"chatId":"c 1","index":12,"rating":null}"""))
            api.rate("c 1", 12, null)
            assertEquals("""{"rating":null}""", server.takeRequest().body?.utf8())

            server.enqueue(MockResponse.Builder().code(400).addHeader("Content-Type", "application/json").body("""{"error":"Only an unasked message can be rated."}""").build())
            val refused = runCatching { api.rate("c 1", 11, "down") }.exceptionOrNull()
            assertTrue(refused is ApiException)
            assertEquals(400, (refused as ApiException).status)
        } finally {
            server.close()
        }
    }
}
