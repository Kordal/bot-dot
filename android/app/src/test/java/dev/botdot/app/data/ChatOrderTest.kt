package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The order of a bot's chat, from the table the web page is checked against too (test/fixtures/chat-order.json). */
class ChatOrderTest {
    @Serializable
    data class Case(val name: String, val runs: List<JsonObject>, val pieces: List<String>, val last: String)

    @Serializable
    data class Table(val cases: List<Case>, val about: JsonElement? = null)

    private val table: Table = Json { ignoreUnknownKeys = true }.decodeFromString(
        Table.serializer(),
        File(System.getProperty("chatOrder") ?: "../../test/fixtures/chat-order.json").readText(),
    )

    private fun name(p: ChatOrder.Piece) = when (p) {
        is ChatOrder.Piece.Asked -> "a:${p.run.id}"
        is ChatOrder.Piece.Steered -> "s:${p.run.id}:${p.i}"
        is ChatOrder.Piece.Reply -> "r:${p.run.id}"
    }

    @Test fun table() {
        assertTrue(table.cases.isNotEmpty())
        for (c in table.cases) {
            val runs = c.runs.map { Api.JSON.decodeFromJsonElement(Run.serializer(), it) }
            val pieces = ChatOrder.pieces(runs)
            assertEquals(c.name, c.pieces, pieces.map(::name))
            assertEquals(c.name, c.last, ChatOrder.lastReply(pieces)?.id)
            assertEquals(c.name, pieces.size, pieces.map { it.key }.toSet().size)
            // A run's block stands where its reply stands (#625).
            assertEquals(c.name, c.pieces.filter { it.startsWith("r:") }.map { it.drop(2) }, ChatOrder.blocks(runs).map { it.id })
        }
    }

    @Test fun none() = assertEquals(emptyList<ChatOrder.Piece>(), ChatOrder.pieces(emptyList()))
}
