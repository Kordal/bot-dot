package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.Test
import kotlin.test.assertTrue

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
        fixture("quoteCases"),
    )

    @Test fun blocks() {
        assertTrue(table.blocks.isNotEmpty())
        table.blocks.forEach { c -> assertEquals(c.quote, Quote.block(c.selected), c.name) }
    }

    @Test fun adds() {
        assertTrue(table.adds.isNotEmpty())
        table.adds.forEach { c ->
            val done = Quote.add(c.draft, c.selected)
            if (c.text == null) assertNull(done, c.name)
            else assertEquals(Quote.Added(c.text, c.text.length), done, c.name)
        }
    }
}
