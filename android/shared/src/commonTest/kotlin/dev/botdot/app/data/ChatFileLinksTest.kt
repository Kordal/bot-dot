package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A file link in a bot's reply, by the table every app is checked against (test/fixtures/file-paths.json; see its
 * "about"): the paths it links, and what the viewer opens for each, on Android and the iPhone (#1368). The web
 * addresses a chat links first are the chat's (chatLinks), so the cases with one are left to the chat's own test.
 */
class ChatFileLinksTest {
    private val fixture = Json.parseToJsonElement(fixture("filePaths")).jsonObject
    private val cases = fixture.getValue("cases").jsonArray.map { it.jsonObject }
        .map { it.getValue("text").jsonPrimitive.content to it.getValue("paths").jsonArray.map { p -> p.jsonPrimitive.content } }

    @Test fun everyPathTheTableLinksOpensThatFileOfTheBot() {
        val paths = cases.flatMap { it.second }
        assertTrue(paths.size >= 10)
        paths.forEach { p ->
            val o = DocumentView.ofPath("news", p, "News")
            assertEquals("/bots/news/path?path=${Api.enc(p)}", o.src, p)
            assertEquals(p.substringAfterLast('/'), o.name, p)
            assertEquals("News", o.from)
            assertEquals("news", o.botId, "a file on the computer can start it")
            assertEquals(p, o.path)
        }
    }

    @Test fun eachCaseWithoutAWebAddressLinksItsPaths() {
        val plain = cases.filter { (text, _) -> "://" !in text && ".com/" !in text }
        assertTrue(plain.size >= cases.size - 2)
        plain.forEach { (text, want) ->
            val found = FilePaths.find(text)
            assertEquals(want, found.map { it.text }, text)
            found.forEach { assertEquals(it.text, text.substring(it.start, it.start + it.text.length)) }
        }
    }

    @Test fun aCodeSpanIsAPathOnlyWhenItIsExactlyOne() {
        fixture.getValue("code").jsonArray.forEach { c ->
            val (text, yes) = c.jsonArray
            assertEquals(yes.jsonPrimitive.boolean, FilePaths.isPath(text.jsonPrimitive.content), text.jsonPrimitive.content)
        }
    }
}
