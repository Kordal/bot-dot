package dev.botdot.app.ui

import dev.botdot.app.data.FilePaths
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class FilePathsTest {
    // The cases the web page shares (test/fixtures/file-paths.json): a text and each path linked in it.
    private val fixture = Json.parseToJsonElement(
        File(System.getProperty("filePaths") ?: "../../test/fixtures/file-paths.json").readText(),
    ).jsonObject

    @Test fun everyCaseOfTheSharedFixtureLinksItsPaths() {
        fixture.getValue("cases").jsonArray.map { it.jsonObject }.forEach { c ->
            val text = c.getValue("text").jsonPrimitive.content
            val want = c.getValue("paths").jsonArray.map { it.jsonPrimitive.content }
            val found = filePathsIn(text)
            assertEquals(text, want, found.map { it.text })
            found.forEach { assertEquals(it.text, text.substring(it.start, it.start + it.text.length)) }
        }
    }

    @Test fun aCodeSpanIsAPathOnlyWhenItIsExactlyOne() {
        fixture.getValue("code").jsonArray.forEach { c ->
            val (text, yes) = c.jsonArray
            assertEquals(text.jsonPrimitive.content, yes.jsonPrimitive.boolean, FilePaths.isPath(text.jsonPrimitive.content))
        }
    }
}
