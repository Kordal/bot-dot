package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A bot's name in a message is a link to its chat, as on the web page (test/fixtures/bot-names.json), with Polish's endings (ADR 280). */
class BotNamesTest {
    @Test fun everyCaseOfTheSharedFixtureFindsItsNames() {
        val cases = Json.parseToJsonElement(fixture("botNames")).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 10)
        for (c in cases) {
            val bots = c.getValue("bots").jsonArray.map { it.jsonObject }.map { BotNames.Bot(it.getValue("id").jsonPrimitive.content, it.getValue("name").jsonPrimitive.content) }
            val want = c.getValue("links").jsonArray.map { it.jsonArray }.map { Triple(it[0].jsonPrimitive.int, it[1].jsonPrimitive.content, it[2].jsonPrimitive.content) }
            val got = BotNames.find(c.getValue("text").jsonPrimitive.content, bots, polishPhrases("nameEndings")).map { Triple(it.start, it.text, it.id) }
            assertEquals(want, got, c.getValue("name").jsonPrimitive.content)
        }
    }
}
