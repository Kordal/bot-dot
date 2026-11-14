package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.Test

/** The order of a bot's chat, from the table the web page is checked against too (test/fixtures/chat-order.json). */
class ChatOrderTest {
    @Serializable
    data class Case(val name: String, val runs: List<JsonObject>, val pieces: List<String>, val last: String)

    @Serializable
    data class Table(val cases: List<Case>, val about: JsonElement? = null)

    private val table: Table = Json { ignoreUnknownKeys = true }.decodeFromString(
        Table.serializer(),
        fixture("chatOrder"),
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
            assertEquals(c.pieces, pieces.map(::name), c.name)
            assertEquals(c.last, ChatOrder.lastReply(pieces)?.id, c.name)
            assertEquals(pieces.size, pieces.map { it.key }.toSet().size, c.name)
            // A run's block stands where its reply stands (#625).
            assertEquals(c.pieces.filter { it.startsWith("r:") }.map { it.drop(2) }, ChatOrder.blocks(runs).map { it.id }, c.name)
        }
    }

    @Test fun aReplyIsARoundOfTheBlockItRepliesTo() {
        fun r(id: String, start: String, end: String, replyTo: String? = null) = Api.JSON.decodeFromString(Run.serializer(),
            """{"id":"$id","botId":"b","prompt":"$id","status":"success","startedAt":"2026-10-27T$start:00Z","endedAt":"2026-10-27T$end:00Z"${replyTo?.let { ",\"replyTo\":\"$it\"" } ?: ""}}""")
        val runs = listOf(r("first", "10:00", "10:05"), r("other", "10:10", "10:11"), r("again", "10:20", "10:25", "first"))
        assertEquals(listOf(listOf("other"), listOf("first", "again")), ChatOrder.rounds(runs).map { b -> b.map { it.id } })
        assertEquals(listOf(listOf("other"), listOf("again")), ChatOrder.rounds(runs.drop(1)).map { b -> b.map { it.id } }, "the run it replies to is not in the chat")
    }

    @Test fun none() = assertEquals(emptyList<ChatOrder.Piece>(), ChatOrder.pieces(emptyList()))
}
