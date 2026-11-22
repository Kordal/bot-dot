package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlin.io.encoding.Base64
import kotlin.time.Instant

/**
 * Feedback (#216, ADR 048): beside Settings, the owner reports a bug or asks for a feature. It goes to the front door,
 * never to botdot, and the admin of this machine reads it on the admin page. It holds only what the owner typed and,
 * since #223 (ADR 048), up to [SHOTS_MAX] screenshots they added, when the front door says it takes them.
 */
object Feedback {
    enum class Kind(val wire: String) { BUG("bug"), FEATURE("feature"); val label: String get() = when (this) { BUG -> tr("Bug"); FEATURE -> tr("Feature request") } }

    /** At most this many screenshots in one report, each at most [SHOT_BYTES], as PNG, JPEG or WebP (the front door's limits). */
    const val SHOTS_MAX = 3
    const val SHOT_BYTES = 5 * 1024 * 1024

    /** The form's own words: its title, what it says of who reads it ([shotsOn]: and the screenshots), its field's placeholder. */
    val TITLE: String get() = tr("Feedback")
    fun intro(shotsOn: Boolean): String = intro(shotsOn, developers = false)

    /** The same, when the front door sends Feedback to botdot's developers ([developers], #1566). No default: the iPhone calls these. */
    fun intro(shotsOn: Boolean, developers: Boolean): String = if (developers) tr("botdot's developers read it. Its text may be published without personal details; screenshots never are. Only what you write and add here is sent.")
        else if (shotsOn) tr("The admin of this machine reads it and sees each screenshot whole, as it is. Only what you write and add here is sent.")
        else tr("The admin of this machine reads it. Only what you write here is sent.")
    val PLACEHOLDER: String get() = tr("What happened, or what you would like")
    /** Picked past [SHOTS_MAX]. */
    val TOO_MANY: String get() = tr("At most {max} screenshots go in one report.", "max" to SHOTS_MAX)

    /** Whether to show Feedback: behind a front door (`accounts`) that says it goes to an admin page or to the developers. */
    fun on(features: List<String>?, session: JsonObject?): Boolean =
        features?.contains("accounts") == true && flag(session, "feedback")

    /**
     * Whether the front door sends Feedback to botdot's developers (ADR 259, #1566), its session's `feedbackTo`: then the
     * form says they read it. An older front door leaves the field out, and the form says what it said before.
     */
    fun toDevelopers(session: JsonObject?): Boolean =
        (session?.get("feedbackTo") as? JsonPrimitive)?.let { it.isString && it.content == "developers" } == true

    /**
     * Whether the front door lists this owner's reports, My reports (#1568, ADR 259), its session's `feedbackReports`.
     * An older front door leaves the field out, and the form has no My reports.
     */
    fun reportsOn(session: JsonObject?): Boolean = flag(session, "feedbackReports")

    /** Where a report stands, as the relay last said it (`GET /front-door/feedback`, `status`). */
    enum class Status(val wire: String) {
        SENT("sent"), SEEN("seen"), FIXED("fixed"), WONT_FIX("wontfix");
        val label: String get() = when (this) { SENT -> tr("Sent"); SEEN -> tr("Seen"); FIXED -> tr("Fixed"); WONT_FIX -> tr("Won't fix") }
    }

    /**
     * One of the owner's reports sent to the developers: its [status], and when fixed the public [issue] (its number, only
     * for a botdot issue address) and the developers' [note], which is drawn as text and never as markup.
     */
    data class Report(val id: String, val created: String, val kind: Kind, val text: String, val status: Status, val issue: Int?, val note: String?, val fixed: Boolean = false, val fixedSeen: Boolean = false) {
        /** The public issue's address, built from its number: only ever botdot's own repository. */
        val issueLink: String? get() = issue?.let { "https://github.com/Kordal/bot-dot/issues/$it" }
        val issueLabel: String? get() = issue?.let { tr("Public issue #{n}", "n" to it) }
        /** The day it was sent, as a row shows it ("3 Nov"), in the account's language. */
        val day: String get() = runCatching { formatDate(Instant.parse(created), "d MMM", I18n.language) }.getOrDefault("")
        /** The notice that this report was fixed (#1569): shown once the account runs the fix and until it is closed. */
        val notice: String get() = tr("Fixed: your report from {date}", "date" to day)
        /** The first words of what the owner wrote, as the notice shows them: at most 80 characters, cut at a word. */
        val excerpt: String get() {
            val t = text.trim().replace(Regex("\\s+"), " ")
            if (t.length <= 80) return t
            val cut = t.substring(0, 80)
            return cut.substring(0, maxOf(cut.lastIndexOf(' '), 40)) + "…"
        }
        /** The kind and the day, as the row's second line. */
        val sub: String get() = listOf(kind.label, day).filter { it.isNotEmpty() }.joinToString(" · ")
    }

    private val ISSUE = Regex("^https://github\\.com/Kordal/bot-dot/issues/([1-9][0-9]{0,8})$")

    /** The reports `GET /front-door/feedback` answered, newest first; one that has no id, text or kind is left out. An unknown status is Sent. */
    fun reports(answer: JsonObject?): List<Report> = (answer?.get("reports") as? JsonArray).orEmpty().mapNotNull { e ->
        val o = e as? JsonObject ?: return@mapNotNull null
        fun str(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val kind = Kind.entries.firstOrNull { it.wire == str("kind") } ?: return@mapNotNull null
        val id = str("id")?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        val text = str("text") ?: return@mapNotNull null
        Report(id, str("created").orEmpty(), kind, text, Status.entries.firstOrNull { it.wire == str("status") } ?: Status.SENT,
            str("issue")?.let { ISSUE.matchEntire(it)?.groupValues?.get(1)?.toIntOrNull() }, str("note")?.trim()?.takeIf { it.isNotEmpty() },
            (o["fixed"] as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true, (o["fixedSeen"] as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true)
    }

    /** The reports to tell the owner are fixed (#1569): the account runs the fix, and no app of it closed the notice yet. */
    fun due(reports: List<Report>): List<Report> = reports.filter { it.fixed && !it.fixedSeen }

    /** What My reports shows: the reports, or [said], why they couldn't be loaded. */
    data class MyReports(val reports: List<Report>, val said: String?)

    /** Whether the form offers "Add screenshot": the front door says it takes them. An older one leaves the field out. */
    fun shotsOn(session: JsonObject?): Boolean = flag(session, "feedbackScreenshots")

    private fun flag(session: JsonObject?, name: String) =
        (session?.get(name) as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true

    /** What the form says when a send failed: the front door's own sentence, or that it wasn't reached; the text stays. */
    fun failed(e: Throwable, shots: Int = 0): String =
        if (e is ApiException && e.said) e.message.orEmpty()
        else if (shots > 0) tr("Couldn't send: {why}. Your text and screenshots are still here.", "why" to (e.message ?: tr("can't reach botdot"))) else tr("Couldn't send: {why}. Your text is still here.", "why" to (e.message ?: tr("can't reach botdot")))

    /** The picture's type from its first bytes (`image/png`, `image/jpeg` or `image/webp`), or null for anything else. */
    fun pictureType(b: ByteArray): String? = when {
        b.size >= 8 && b.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) -> "image/png"
        b.size >= 3 && b[0] == 0xff.toByte() && b[1] == 0xd8.toByte() && b[2] == 0xff.toByte() -> "image/jpeg"
        b.size >= 12 && latin1(b, 0, 4) == "RIFF" && latin1(b, 8, 4) == "WEBP" -> "image/webp"
        else -> null
    }

    /**
     * The name a picked screenshot goes by in the form's sentences: numbered after the [existing] ones the form holds
     * from before this pick, then by its place ([index]) among the pictures picked at once.
     */
    fun shotName(existing: Int, index: Int): String = tr("Screenshot {n}", "n" to (existing + index + 1).toString())

    /** Why a picked file can't go in, in a sentence the form shows, or null when it can. [name]: the file's name. */
    fun refusal(name: String, bytes: ByteArray?): String? = when {
        bytes == null -> tr("Couldn't read {name}.", "name" to name)
        pictureType(bytes) == null -> tr("{name} isn't a PNG, JPEG or WebP picture.", "name" to name)
        bytes.size > SHOT_BYTES -> tr("{name} is {size} MB: each screenshot can be at most 5 MB.", "name" to name, "size" to formatIn("", "%.1f", bytes.size / 1024.0 / 1024.0))
        else -> null
    }

    private fun latin1(b: ByteArray, from: Int, n: Int) = CharArray(n) { (b[from + it].toInt() and 0xff).toChar() }.concatToString()

    fun body(kind: Kind, text: String, shots: List<ByteArray> = emptyList()): JsonObject = buildJsonObject {
        put("kind", kind.wire)
        put("text", text)
        if (shots.isNotEmpty()) putJsonArray("screenshots") { for (s in shots) addJsonObject { put("data", Base64.encode(s)) } }
    }
}
