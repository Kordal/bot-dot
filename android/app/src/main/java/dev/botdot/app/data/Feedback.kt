package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Feedback (#216, ADR 048): beside Settings, the owner reports a bug or asks for a feature. It goes to the front door,
 * never to botdot, and the admin of this machine reads it on the admin page. It holds only what the owner typed.
 */
object Feedback {
    enum class Kind(val wire: String, val label: String) { BUG("bug", "Bug"), FEATURE("feature", "Feature request") }

    /** Whether to show Feedback: behind a front door (`accounts`) that says it goes to an admin page. */
    fun on(features: List<String>?, session: JsonObject?): Boolean =
        features?.contains("accounts") == true && (session?.get("feedback") as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true

    /** What the form says when a send failed: the front door's own sentence, or that it wasn't reached; the text stays. */
    fun failed(e: Throwable): String =
        if (e is ApiException && e.said) e.message.orEmpty() else "Couldn't send: ${e.message ?: "can't reach botdot"}. Your text is still here."

    fun body(kind: Kind, text: String): JsonObject = buildJsonObject { put("kind", kind.wire); put("text", text) }
}
