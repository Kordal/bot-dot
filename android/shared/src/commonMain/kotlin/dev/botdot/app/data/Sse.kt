package dev.botdot.app.data

import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.LineEnding
import io.ktor.utils.io.readLine

/**
 * A stream of server-sent events read as okhttp-sse read it before the data layer was shared (ADR 242): `data:`
 * lines joined by newlines, one space after the colon dropped, an event without data never handed on, and the last
 * `id` kept for the events after it until another one comes. Comments (`:`), `retry` and other fields are skipped.
 */
internal object Sse {
    suspend fun read(from: ByteReadChannel, event: suspend (id: String?, type: String?, data: String) -> Unit) {
        var lastId: String? = null
        var id: String? = null
        var type: String? = null
        val data = StringBuilder()
        while (true) {
            val line = from.readLine(LineEnding.Lenient) ?: return // a line ends at CRLF, LF or CR, as the spec says
            when {
                line.isEmpty() -> {
                    if (data.isNotEmpty()) { lastId = id; event(id, type, data.substring(1)) }
                    id = lastId; type = null; data.setLength(0)
                }
                line == "data" -> data.append('\n')
                line.startsWith("data:") -> data.append('\n').append(field(line, 5))
                line == "id" -> id = null
                line.startsWith("id:") -> id = field(line, 3).ifEmpty { null }
                line == "event" -> type = null
                line.startsWith("event:") -> type = field(line, 6).ifEmpty { null }
            }
        }
    }

    /** A field's value: what follows its colon, less one space. */
    private fun field(line: String, colon: Int) = line.substring(if (line.length > colon && line[colon] == ' ') colon + 1 else colon)
}
