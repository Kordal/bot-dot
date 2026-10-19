package dev.botdot.app.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class ChatLinksTest {
    // The cases the web page shares (test/fixtures/chat-links.json): a text and each address linked in it.
    private val cases = Json.parseToJsonElement(
        File(System.getProperty("chatLinks") ?: "../../test/fixtures/chat-links.json").readText(),
    ).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }

    @Test fun everyCaseOfTheSharedFixtureLinksItsAddresses() {
        cases.forEach { c ->
            val text = c.getValue("text").jsonPrimitive.content
            val want = c.getValue("links").jsonArray.map { l -> l.jsonArray.map { it.jsonPrimitive.content } }
            val links = chatLinks(text)
            assertEquals(text, want, links.map { listOf(it.text, it.url) })
            links.forEach { assertEquals(it.text, text.substring(it.start, it.start + it.text.length)) }
        }
    }
}
