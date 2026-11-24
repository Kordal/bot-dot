package dev.botdot.app.answerview

import dev.botdot.app.data.tr
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.floor

// What an answer view sends back (#1628, ADR 265), for both phones: the owner's input as one plain message of their own.
// The rules are the web page's (public/answer-text.js: form, press, start, ends) and their cases are `sends` in
// test/fixtures/ui-cases.json, which AnswerViewTest runs here: what a phone posts equals what the web page posts. A view
// sends nothing else, and nothing in it approves, runs or changes anything: this only reads the tree and builds a text.

/** What an input holds as the screen shows it and the form posts it (what the owner set, else what the bot set, kept to what the input allows). */
sealed interface Held {
    /** A text; for a choice, a date or a time, '' for none. */
    data class Text(val v: String) : Held
    /** A number; null for none (a number box left empty). */
    data class Num(val v: Double?) : Held
    /** The two ends of a range, low first. */
    data class Span(val low: Double, val high: Double) : Held
    /** The picks of a multi-select, in the options' order. */
    data class Picks(val v: List<String>) : Held
    data class Flag(val v: Boolean) : Held
    /** A grade, 0 for none. */
    data class Grade(val v: Int) : Held
}

/** A node of a view with the path the page counts it by: the root is "0", its children "0.0", "0.1", …. */
data class ViewFound(val path: String, val node: ViewNode)

/** One message of a chat as the views read it: a bot's (with its id) or the owner's text. */
class ViewBubble private constructor(val fromBot: Boolean, val id: String?, val text: String?, val working: Boolean, val problem: Boolean, val folded: Boolean) {
    companion object {
        /** A bot's message. [working]: still being written; [problem]: it failed; [folded]: a message between bots. */
        fun bot(id: String, working: Boolean = false, problem: Boolean = false, folded: Boolean = false) = ViewBubble(true, id, null, working, problem, folded)
        fun owner(text: String) = ViewBubble(false, null, text, false, false, false)
    }
}

/** Whether a view can be sent: [Open], [Closed] (an older one, read-only: "Not sent"), or [Sent] with what it sent. */
sealed interface ViewState {
    data object Open : ViewState
    data object Closed : ViewState
    data class Sent(val said: String) : ViewState
}

object ViewForm {
    /** A button posts its `send` up to this many characters (the catalog's own limit). */
    const val SEND_MAX = 200

    val INPUTS = setOf("text-input", "textarea", "number", "slider", "range", "select", "multi-select", "radio", "checkbox", "toggle", "date", "time", "rating", "segmented")

    private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val TIME = Regex("^\\d{2}:\\d{2}$")

    private fun walk(root: ViewNode, wanted: (ViewNode) -> Boolean): List<ViewFound> {
        val out = ArrayList<ViewFound>()
        fun go(n: ViewNode, path: String) {
            if (wanted(n)) out += ViewFound(path, n)
            n.children.orEmpty().forEachIndexed { i, c -> go(c, "$path.$i") }
        }
        go(root, "0")
        return out
    }

    /** The inputs of a view, in the order of the tree. */
    fun fields(root: ViewNode): List<ViewFound> = walk(root) { it.type in INPUTS }

    /** The buttons of a view, in the order of the tree. */
    fun buttons(root: ViewNode): List<ViewFound> = walk(root) { it.type == "button" }

    // ---- numbers and text, the way JavaScript reads them ----

    private fun String?.jsNumber(): Double? {
        val s = this?.jsTrim()?.takeIf { it.isNotEmpty() } ?: return null
        if (s.last() in "fFdD") return null // Kotlin reads "1.5f" as a number; JavaScript does not
        return s.toDoubleOrNull()?.takeIf { it.isFinite() }
    }

    private fun finite(e: JsonElement?): Double? = when {
        e == null || e is JsonNull -> null
        e is JsonPrimitive && e.isString -> e.content.jsNumber()
        e is JsonPrimitive -> e.content.toDoubleOrNull()?.takeIf { it.isFinite() }
        else -> null
    }

    private fun within(v: Double, lo: Double, hi: Double) = minOf(maxOf(v, lo), hi)
    private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** The ends of a slider or a range: the bot's, else 0 and 100. */
    fun ends(n: ViewNode): Pair<Double, Double> {
        val lo = n.number("min") ?: 0.0
        val hi = n.number("max") ?: 100.0
        return if (hi > lo) lo to hi else 0.0 to 100.0
    }

    /** The stars of a rating: 3 to 10, 5 unless it says. */
    fun stars(n: ViewNode): Int = floor(within(n.number("max") ?: 5.0, 3.0, 10.0) + 0.5).toInt()

    /** A text of one line: its lines are joined with " / ", its spaces collapsed. */
    private fun oneLine(v: String): String = v.split(Regex("\r\n?|\n")).map { l ->
        val sb = StringBuilder()
        var space = false
        for (c in l) { if (c.isJsSpace()) space = true else { if (space && sb.isNotEmpty()) sb.append(' '); space = false; sb.append(c) } }
        sb.toString()
    }.filter { it.isNotEmpty() }.joinToString(" / ")

    /**
     * What one input holds: what the owner set ([raw], as the screen reads it from the input: a text, a number or the text
     * of one, a pair for a range, a list for a multi-select, a boolean), else what the bot set, kept to what the input allows.
     */
    fun start(n: ViewNode, raw: JsonElement?): Held {
        val set = raw != null && raw !is JsonNull
        val options = n.strings("options")
        fun option(v: String?) = v != null && v in options
        return when (n.type) {
            "text-input", "textarea" -> Held.Text(if (set) rawText(raw) else n.text("value").orEmpty())
            "number" -> {
                var v = finite(if (set) raw else n.props["value"]) ?: return Held.Num(null)
                n.number("min")?.let { v = maxOf(v, it) }
                n.number("max")?.let { v = minOf(v, it) }
                Held.Num(v)
            }
            "slider" -> { val (lo, hi) = ends(n); Held.Num(within(finite(if (set) raw else n.props["value"]) ?: lo, lo, hi)) }
            "range" -> {
                val (lo, hi) = ends(n)
                val pair = (raw as? JsonArray) ?: JsonArray(listOf(n.props["low"] ?: JsonNull, n.props["high"] ?: JsonNull))
                val a = within(finite(pair.getOrNull(0)) ?: lo, lo, hi)
                val b = within(finite(pair.getOrNull(1)) ?: hi, lo, hi)
                Held.Span(minOf(a, b), maxOf(a, b))
            }
            "select", "radio", "segmented" -> {
                val r = raw.str()
                Held.Text(if (r == "") "" else if (option(r)) r!! else if (option(n.text("value"))) n.text("value")!! else "")
            }
            "multi-select" -> {
                val picked = if (raw is JsonArray) raw.mapNotNull { it.str() } else n.strings("values")
                Held.Picks(options.filterIndexed { i, o -> o in picked && options.indexOf(o) == i })
            }
            "checkbox", "toggle" -> Held.Flag(if (raw is JsonPrimitive && !raw.isString && (raw.content == "true" || raw.content == "false")) raw.content == "true" else n.flag(if (n.type == "checkbox") "checked" else "on") == true)
            "date" -> {
                val v = raw.str() ?: n.text("value")
                if (v == null || !DATE.matches(v)) Held.Text("")
                else {
                    val lo = n.text("min")?.takeIf { DATE.matches(it) }
                    val hi = n.text("max")?.takeIf { DATE.matches(it) }
                    Held.Text(if (lo != null && v < lo) lo else if (hi != null && v > hi) hi else v)
                }
            }
            "time" -> { val v = raw.str() ?: n.text("value"); Held.Text(if (v != null && TIME.matches(v)) v else "") }
            "rating" -> Held.Grade(floor(within(finite(if (set) raw else n.props["value"]) ?: 0.0, 0.0, stars(n).toDouble()) + 0.5).toInt())
            else -> Held.Text("")
        }
    }

    private fun rawText(raw: JsonElement?): String = (raw as? JsonPrimitive)?.content.orEmpty()

    /** An input's value as the form's line says it; '' for an input with nothing. */
    fun valueOf(n: ViewNode, raw: JsonElement? = null): String {
        val unit = n.text("unit")?.takeIf { it.isNotEmpty() }?.let { " $it" }.orEmpty()
        return when (val v = start(n, raw)) {
            is Held.Text -> if (n.type == "text-input" || n.type == "textarea") oneLine(v.v) else v.v
            is Held.Num -> v.v?.let { viewNumber(it) + unit }.orEmpty()
            is Held.Span -> tr("{from} to {to}", "from" to viewNumber(v.low), "to" to viewNumber(v.high)) + unit
            is Held.Picks -> v.v.joinToString(", ")
            is Held.Flag -> if (v.v) tr("yes") else tr("no")
            is Held.Grade -> if (v.v > 0) "${v.v}/${stars(n)}" else ""
        }
    }

    /** A form's message: "Budget: 500", one input to a line, a dash for what is empty. '' for a view with no input. [values]: path -> what the owner set. */
    fun form(root: ViewNode, values: Map<String, JsonElement> = emptyMap()): String =
        fields(root).joinToString("\n") { (path, node) -> "${node.text("label").orEmpty()}: ${valueOf(node, values[path]).ifEmpty { "–" }}" }

    /** What a button posts: its `send` (200 characters at most), else its label. */
    fun press(n: ViewNode): String = cutText(n.text("send")?.jsTrim()?.takeIf { it.isNotEmpty() } ?: n.text("label").orEmpty(), SEND_MAX)

    /** What the owner reads on a button before pressing it: what it posts when that is not its label, else ''. Never a tooltip alone: the owner sees exactly what is sent. */
    fun shows(n: ViewNode): String = press(n).let { if (it == n.text("label")) "" else it }

    private fun cutText(s: String, n: Int): String {
        if (s.length <= n) return s
        val t = s.substring(0, n)
        return if (t.last().isHighSurrogate()) t.dropLast(1) else t
    }

    // ---- who may send, and what was sent ----

    private fun lineOf(s: String) = s.replace("\r\n", "\n").replace('\r', '\n').jsTrim()

    /**
     * What a view said it sent, read from the owner's message that follows it ([next], null: none follows): the message when
     * it is one of the buttons' texts ([says]) or has a line "Label: …" for every input ([labels]); else null. A view stays
     * "Sent" when the chat is drawn again or opened later, with nothing kept but the chat's own messages.
     */
    fun sentFrom(next: String?, says: List<String>, labels: List<String>): String? {
        if (next == null) return null
        val t = lineOf(next)
        if (t.isEmpty()) return null
        if (says.any { lineOf(it) == t }) return t
        val lines = t.split('\n')
        return if (labels.isNotEmpty() && labels.all { l -> lines.any { it.startsWith("$l: ") } }) t else null
    }

    /** What a view has sent, and what is still on its way: see [sendOf]. */
    data class SendRead(val sent: String?, val pending: String?)

    /**
     * What a view has sent, from the chat first: [mine] are the owner's messages after the view (up to the next bot message,
     * a waiting one included), [pending] what this phone posted that the chat may not show yet. The chat is the truth: once it
     * shows the message the post is forgotten, so a message the owner takes back opens the view again.
     */
    fun sendOf(mine: List<String>, says: List<String>, labels: List<String>, pending: String?): SendRead {
        val shown = mine.firstNotNullOfOrNull { sentFrom(it, says, labels) }
        return if (shown != null) SendRead(shown, null) else SendRead(pending, pending)
    }

    /** The id of the newest bot message a chat's views answer: the last one that is whole, from a bot to the owner. */
    fun newest(bubbles: List<ViewBubble>): String? =
        bubbles.lastOrNull { it.fromBot && !it.working && !it.problem && !it.folded }?.id

    /** Every message of the owner after the bot message [id], up to the next bot message: the owner may write something else first and press a button after. */
    fun ownersAfter(bubbles: List<ViewBubble>, id: String): List<String> {
        val at = bubbles.indexOfFirst { it.fromBot && it.id == id }
        if (at < 0) return emptyList()
        return bubbles.drop(at + 1).takeWhile { !it.fromBot }.mapNotNull { it.text }
    }

    fun state(newest: Boolean, sent: String?): ViewState = when {
        sent != null -> ViewState.Sent(sent)
        newest -> ViewState.Open
        else -> ViewState.Closed
    }
}
