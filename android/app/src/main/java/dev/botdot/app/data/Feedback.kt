package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.util.Base64

/**
 * Feedback (#216, ADR 048): beside Settings, the owner reports a bug or asks for a feature. It goes to the front door,
 * never to botdot, and the admin of this machine reads it on the admin page. It holds only what the owner typed and,
 * since #223 (ADR 048), up to [SHOTS_MAX] screenshots they added, when the front door says it takes them.
 */
object Feedback {
    enum class Kind(val wire: String, val label: String) { BUG("bug", "Bug"), FEATURE("feature", "Feature request") }

    /** At most this many screenshots in one report, each at most [SHOT_BYTES], as PNG, JPEG or WebP (the front door's limits). */
    const val SHOTS_MAX = 3
    const val SHOT_BYTES = 5 * 1024 * 1024

    /** Whether to show Feedback: behind a front door (`accounts`) that says it goes to an admin page. */
    fun on(features: List<String>?, session: JsonObject?): Boolean =
        features?.contains("accounts") == true && flag(session, "feedback")

    /** Whether the form offers "Add screenshot": the front door says it takes them. An older one leaves the field out. */
    fun shotsOn(session: JsonObject?): Boolean = flag(session, "feedbackScreenshots")

    private fun flag(session: JsonObject?, name: String) =
        (session?.get(name) as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true

    /** What the form says when a send failed: the front door's own sentence, or that it wasn't reached; the text stays. */
    fun failed(e: Throwable, shots: Int = 0): String =
        if (e is ApiException && e.said) e.message.orEmpty()
        else "Couldn't send: ${e.message ?: "can't reach botdot"}. ${if (shots > 0) "Your text and screenshots are" else "Your text is"} still here."

    /** The picture's type from its first bytes (`image/png`, `image/jpeg` or `image/webp`), or null for anything else. */
    fun pictureType(b: ByteArray): String? = when {
        b.size >= 8 && b.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) -> "image/png"
        b.size >= 3 && b[0] == 0xff.toByte() && b[1] == 0xd8.toByte() && b[2] == 0xff.toByte() -> "image/jpeg"
        b.size >= 12 && String(b, 0, 4, Charsets.ISO_8859_1) == "RIFF" && String(b, 8, 4, Charsets.ISO_8859_1) == "WEBP" -> "image/webp"
        else -> null
    }

    /** Why a picked file can't go in, in a sentence the form shows, or null when it can. [name]: the file's name. */
    fun refusal(name: String, bytes: ByteArray?): String? = when {
        bytes == null -> "Couldn't read $name."
        pictureType(bytes) == null -> "$name isn't a PNG, JPEG or WebP picture."
        bytes.size > SHOT_BYTES -> "$name is ${"%.1f".format(java.util.Locale.ROOT, bytes.size / 1024.0 / 1024.0)} MB: each screenshot can be at most 5 MB."
        else -> null
    }

    fun body(kind: Kind, text: String, shots: List<ByteArray> = emptyList()): JsonObject = buildJsonObject {
        put("kind", kind.wire)
        put("text", text)
        if (shots.isNotEmpty()) putJsonArray("screenshots") { for (s in shots) addJsonObject { put("data", Base64.getEncoder().encodeToString(s)) } }
    }
}
