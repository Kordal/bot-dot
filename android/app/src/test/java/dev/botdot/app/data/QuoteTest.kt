package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** Quote's rules, from the table every app is checked against (test/fixtures/quote-cases.json; see its "about"). */
class QuoteTest {
    @Serializable
    data class Block(val name: String, val selected: String, val quote: String)

    @Serializable
    data class Add(val name: String, val draft: String, val selected: String, val text: String?)

    @Serializable
    data class Table(val blocks: List<Block>, val adds: List<Add>, val about: JsonElement? = null)

    private val table: Table = Json { ignoreUnknownKeys = true }.decodeFromString(
        Table.serializer(),
        File(System.getProperty("quoteCases") ?: "../../test/fixtures/quote-cases.json").readText(),
    )

    @Test fun blocks() {
        assert(table.blocks.isNotEmpty())
        table.blocks.forEach { c -> assertEquals(c.name, c.quote, Quote.block(c.selected)) }
    }

    @Test fun adds() {
        assert(table.adds.isNotEmpty())
        table.adds.forEach { c ->
            val done = Quote.add(c.draft, c.selected)
            if (c.text == null) assertNull(c.name, done)
            else assertEquals(c.name, Quote.Added(c.text, c.text.length), done)
        }
    }
}
