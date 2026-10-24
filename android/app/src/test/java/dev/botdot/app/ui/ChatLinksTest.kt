package dev.botdot.app.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import kotlinx.serialization.json.contentOrNull
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

    // The host a link's site icon is asked for (#530), as the web page's linkHost has it (test/fixtures/site-hosts.json).
    @Test fun everySiteOfTheSharedFixture() {
        val hosts = Json.parseToJsonElement(File(System.getProperty("siteHosts") ?: "../../test/fixtures/site-hosts.json").readText())
            .jsonObject.getValue("cases").jsonArray.map { it.jsonArray }
        hosts.forEach { (url, host) -> assertEquals(url.jsonPrimitive.content, host.jsonPrimitive.contentOrNull, siteHostOf(url.jsonPrimitive.content)) }
    }

    // With site icons, each link has one placeholder before it and still opens its own address over its own text.
    @Test fun aLinkWithItsSiteIconKeepsItsText() {
        val text = "See news.example.com/a and https://127.0.0.1/x."
        val s = linkedChatText(AnnotatedString(text), Color.White, sites = true)
        val links = s.getLinkAnnotations(0, s.length).map { s.text.substring(it.start, it.end) to (it.item as LinkAnnotation.Url).url }
        assertEquals(listOf("news.example.com/a" to "https://news.example.com/a", "https://127.0.0.1/x" to "https://127.0.0.1/x"), links)
        assertEquals(listOf("news.example.com", ""), s.getStringAnnotations("site", 0, s.length).map { it.item })
        assertEquals(setOf("site:news.example.com", "site:"), siteIconsIn(listOf(s)).keys)
        assertEquals(text, linkedChatText(AnnotatedString(text), Color.White).text)
    }
}
