package dev.botdot.app.answerview

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.abs
import kotlin.math.floor

// Answer views (#1626, ADR 264): a bot draws charts, tables and more in its reply with a ```ui fence, a JSON tree of the
// components of the catalog the server hands out (lib/ui-catalog.json, GET /api/ui-catalog). This reads such a fence by
// the rules every app shares (test/fixtures/ui-cases.json, AnswerViewTest): one generic validator driven by the catalog,
// with no code of its own for any component, the same as public/answer-view.js on the web page. It is written for both
// phones (ADR 242): Android draws what it returns in Compose, and the iOS app in SwiftUI. It draws nothing itself.
// Nothing a bot writes is trusted as markup (rule 6): only the catalog's props are read, each cut to its length and
// kept to its kind, and a bot sets no colour, size or style, only a tone.

/** What a fence was read as, why a part of it was left out, and where (`at` is the node's path, `prop` the prop in it). */
data class Problem(val at: String, val code: String, val prop: String? = null, val name: String? = null)

/**
 * One component of a view as it is drawn: its [type], the props that were read (in the catalog's own form: texts cut,
 * numbers kept in their range, a media prop as `{ kind: "file", path }` or `{ kind: "https", url }`), its [children]
 * (null for a component that holds none, or whose `children` couldn't be read), and [noSource] for a chart, table or KPI
 * that says nowhere where its numbers came from. A component this app can't draw is `unknown`, with nothing else.
 */
class ViewNode(val type: String, val props: JsonObject = JsonObject(emptyMap()), val children: List<ViewNode>? = null, val noSource: Boolean = false) {
    val isUnknown get() = type == UNKNOWN

    fun text(name: String): String? = props.text(name)
    fun number(name: String): Double? = props.number(name)
    fun flag(name: String): Boolean? = props.flag(name)
    fun media(name: String): ViewMedia? = props.media(name)
    fun items(name: String): List<JsonElement> = (props[name] as? JsonArray) ?: emptyList()
    fun objects(name: String): List<JsonObject> = items(name).mapNotNull { it as? JsonObject }
    fun strings(name: String): List<String> = items(name).mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
    fun numbers(name: String): List<Double?> = items(name).map { it.asNumber() }

    /** The tree as the shared fixture writes it. */
    fun toJson(): JsonObject = JsonObject(buildMap {
        put("type", JsonPrimitive(type))
        putAll(props)
        children?.let { kids -> put("children", JsonArray(kids.map { it.toJson() })) }
        if (noSource) put("noSource", JsonPrimitive(true))
    })

    // Two nodes that draw the same are equal, so what a screen remembers of one (a tab, a panel, a Data toggle) survives
    // the reply being read again while it streams.
    override fun equals(other: Any?): Boolean =
        this === other || (other is ViewNode && type == other.type && props == other.props && children == other.children && noSource == other.noSource)
    override fun hashCode(): Int = ((type.hashCode() * 31 + props.hashCode()) * 31 + (children?.hashCode() ?: 0)) * 31 + noSource.hashCode()

    companion object { const val UNKNOWN = "unknown" }
}

/** A picture, video, sound or file the view names: a path among the bot's files (`kind` "file") or an https address (`kind` "https"). */
data class ViewMedia(val kind: String, val value: String) { val isFile get() = kind == "file" }

// What a prop or an item of a list holds, as the validator has kept it.
fun JsonElement.asNumber(): Double? = (this as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.content?.toDoubleOrNull()
fun JsonObject.text(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content
fun JsonObject.number(name: String): Double? = this[name]?.asNumber()
fun JsonObject.flag(name: String): Boolean? = (this[name] as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.content?.let { if (it == "true") true else if (it == "false") false else null }
fun JsonObject.media(name: String): ViewMedia? = (this[name] as? JsonObject)?.let { m ->
    val kind = m.text("kind") ?: return null
    ViewMedia(kind, (if (kind == "file") m.text("path") else m.text("url")) ?: return null)
}

/** A fence read: [Drawn], or [Code], which is drawn as code with its `alt` above it ([refused] says why). */
sealed interface ViewResult {
    val alt: String
    val problems: List<Problem>
    data class Drawn(override val alt: String, val root: ViewNode, override val problems: List<Problem>) : ViewResult
    data class Code(val refused: String, override val alt: String, override val problems: List<Problem>) : ViewResult
}

/** A reply's Markdown in its parts, in order. */
sealed interface ReplyPart {
    /** Markdown between the fences. */
    data class Text(val text: String) : ReplyPart
    /** A view to draw. */
    data class View(val alt: String, val root: ViewNode) : ReplyPart
    /** A `ui` fence drawn as code: why ([refused]: a limit, no alt, not JSON, past the third fence, never closed), with its [alt]. */
    data class Code(val code: String, val alt: String, val refused: String) : ReplyPart
    /** A fence still being written: the reply shows a quiet "Drawing a view…" and waits. */
    data object Drawing : ReplyPart
}

/** The limits the catalog sets (lib/ui-catalog.json), enforced the same everywhere. */
data class ViewLimits(val fences: Int, val nodes: Int, val depth: Int, val bytes: Int, val points: Int, val alt: Int)

/** A prop of a component, as the catalog gives it. */
internal class PropSpec(
    val type: String, val max: Int?, val min: Double?, val maxValue: Double?, val required: Boolean, val multiline: Boolean,
    val empty: Boolean, val nullable: Boolean, val values: List<String>, val from: List<String>, val exts: List<String>?,
    val counts: String?, val minItems: Int?, val of: PropSpec?, val props: Map<String, PropSpec>?, val noReserved: Boolean = false, val indexes: String? = null,
)

internal class ChildrenSpec(val max: Int, val only: List<String>?)

internal class ComponentSpec(val since: Int, val props: Map<String, PropSpec>, val children: ChildrenSpec?, val parents: List<String>?, val sourced: Boolean)

/**
 * The generic validator, driven by the [catalog] the server hands out. [known]: the newest catalog version this app
 * draws (the catalog's own by default): a component that came later is one quiet `unknown` node.
 */
class AnswerViews private constructor(val version: Int, val limits: ViewLimits, private val tones: List<String>, private val components: Map<String, ComponentSpec>, private val known: Int, private val reserved: Set<String> = emptySet()) {

    /** What one prop holds, or [No] (can't be read) or [Empty] (a text with nothing in it). */
    private sealed interface Read {
        data object No : Read
        data object Empty : Read
        class Got(val v: JsonElement) : Read
    }

    private class Ctx {
        var nodes = 0; var points = 0; val problems = mutableListOf<Problem>()
        /** Where each kept item of a list stood in the list the bot wrote, by the node's path and the list's own, for a prop that names a place in it. */
        val kept = HashMap<String, List<Int>>()
    }

    /** A fence limit that was passed: the fence is drawn as code. */
    private class Refusal(val why: String) : Exception()

    private fun got(s: String) = Read.Got(JsonPrimitive(s))

    private fun read(v: JsonElement, spec: PropSpec, at: String, where: String, ctx: Ctx): Read {
        if (v is JsonNull) return if (spec.nullable) Read.Got(JsonNull) else if (spec.empty) got("") else Read.No
        when (spec.type) {
            "string" -> {
                val s = text(v, spec.multiline, spec.max ?: Int.MAX_VALUE) ?: return Read.No
                if (spec.noReserved && phraseKey(s) in reserved) return Read.No // the owner's words the server reads as an answer (ADR 265)
                return if (s.isEmpty() && !spec.empty) Read.Empty else got(s)
            }
            "number", "int" -> {
                var n = numberOf(v) ?: return Read.No
                if (spec.type == "int") n = floor(n + 0.5)
                if (spec.indexes != null) {
                    // A place in a sibling list (`indexes` names it), as the bot counted it in the list it wrote: where that item stands
                    // among the ones kept. An item that was left out, or a number past the list, names nothing: no clamping to the nearest one.
                    val kept = ctx.kept["$at|${where.substring(0, where.lastIndexOf('/') + 1)}${spec.indexes}"]
                    val place = if (kept != null && abs(n) < 1e9) kept.indexOf(n.toInt()) else -1
                    return if (place < 0) Read.No else Read.Got(number(place.toDouble()))
                }
                spec.min?.let { n = maxOf(n, it) }
                spec.maxValue?.let { n = minOf(n, it) }
                return Read.Got(number(if (n == 0.0) 0.0 else n))
            }
            "boolean" -> return if (v is JsonPrimitive && !v.isString && (v.content == "true" || v.content == "false")) Read.Got(v) else Read.No
            "enum" -> return if (v is JsonPrimitive && v.isString && v.content in spec.values) Read.Got(v) else Read.No
            "tone" -> return if (v is JsonPrimitive && v.isString && v.content in tones) Read.Got(v) else Read.No
            "https" -> {
                if (v !is JsonPrimitive || !v.isString) return Read.No
                val s = v.content.jsTrim()
                if (s.isEmpty()) return Read.Empty
                return if (isHttps(s)) got(s) else Read.No
            }
            "media" -> return media(v, spec)
            "list" -> {
                if (v !is JsonArray) return Read.No
                if (spec.counts == "points") {
                    ctx.points += v.size
                    if (ctx.points > limits.points) throw Refusal("too-many-points")
                }
                val out = ArrayList<JsonElement>()
                val kept = ArrayList<Int>() // where each kept item stood in the list the bot wrote, for a prop that names a place in it
                val of = spec.of ?: return Read.No
                var i = 0
                while (i < v.size && (spec.max == null || out.size < spec.max)) {
                    val item = read(v[i], of, at, "$where/$i", ctx)
                    if (item is Read.Got) { out += item.v; kept += i } else ctx.problems += Problem(at, "bad-item", "$where/$i")
                    i++
                }
                if (spec.minItems != null && spec.minItems > 0 && out.size < spec.minItems) return Read.No
                ctx.kept["$at|$where"] = kept
                return Read.Got(JsonArray(out))
            }
            "object" -> {
                if (v !is JsonObject) return Read.No
                val out = LinkedHashMap<String, JsonElement>()
                return if (props(v, spec.props.orEmpty(), at, where, ctx, out, emptyList())) Read.Got(JsonObject(out)) else Read.No
            }
        }
        return Read.No
    }

    /** A media prop: `{ kind: "file", path }` for a bot's file, `{ kind: "https", url }` for an https address, when the prop allows it. */
    private fun media(v: JsonElement, spec: PropSpec): Read {
        if (v !is JsonPrimitive || !v.isString) return Read.No
        val s = v.content.jsTrim()
        if (s.isEmpty()) return Read.Empty
        if (s.startsWith("https://")) {
            if ("https" !in spec.from || !isHttps(s)) return Read.No
            return Read.Got(JsonObject(mapOf("kind" to JsonPrimitive("https"), "url" to JsonPrimitive(s))))
        }
        if ("file" !in spec.from) return Read.No
        val path = filePath(s, spec.exts) ?: return Read.No
        return Read.Got(JsonObject(mapOf("kind" to JsonPrimitive("file"), "path" to JsonPrimitive(path))))
    }

    /**
     * The props of a node, or of an object inside one, in the catalog's order, then what the catalog doesn't have.
     * false: a required prop is missing or can't be read. Inside an object that only drops its item; at a node, the
     * problem is told.
     */
    private fun props(raw: JsonObject, defs: Map<String, PropSpec>, at: String, base: String, ctx: Ctx, out: MutableMap<String, JsonElement>, skip: List<String>): Boolean {
        val prefix = if (base.isEmpty()) "" else "$base/"
        for ((name, spec) in defs) {
            val v = raw[name]
            val r = if (v == null || v is JsonNull) Read.Empty else read(v, spec, at, prefix + name, ctx)
            if (r !is Read.Got) {
                if (spec.required) {
                    if (base.isEmpty()) ctx.problems += Problem(at, if (v == null || v is JsonNull || r is Read.Empty) "missing-prop" else "bad-prop", name)
                    return false
                }
                if (r is Read.No) ctx.problems += Problem(at, "bad-prop", prefix + name)
                continue
            }
            out[name] = r.v
        }
        for (name in raw.keys) if (name !in defs && name !in skip) ctx.problems += Problem(at, "unknown-prop", prefix + name)
        return true
    }

    /** One node of the tree, or null when its parent doesn't take it. */
    private fun node(raw: JsonObject, at: String, depth: Int, parent: String?, ctx: Ctx): ViewNode? {
        if (depth > limits.depth) throw Refusal("too-deep")
        if (++ctx.nodes > limits.nodes) throw Refusal("too-many-nodes")
        val type = (raw["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val spec = type?.let { components[it] }?.takeIf { it.since <= known }
        if (type == null || spec == null) {
            ctx.problems += Problem(at, "unknown-component", name = type?.let { cap(it, 40) })
            return ViewNode(ViewNode.UNKNOWN)
        }
        if (spec.parents != null && !(parent != null && parent in spec.parents)) {
            ctx.problems += Problem(at, "not-allowed-here")
            return null
        }
        ctx.points = 0
        val out = LinkedHashMap<String, JsonElement>()
        if (!props(raw, spec.props, at, "", ctx, out, if (spec.children != null) listOf("type", "children") else listOf("type"))) return ViewNode(ViewNode.UNKNOWN)
        var kids: List<ViewNode>? = null
        val ch = spec.children
        val rawKids = raw["children"]
        if (ch != null && rawKids != null && rawKids !is JsonNull) {
            if (rawKids !is JsonArray) ctx.problems += Problem(at, "bad-prop", "children")
            else {
                val list = ArrayList<ViewNode>()
                var i = 0
                while (i < rawKids.size && list.size < ch.max) {
                    val child = rawKids[i]
                    val here = "$at/children/$i"
                    i++
                    if (child !is JsonObject) { ctx.problems += Problem(here, "not-a-component"); continue }
                    val childType = (child["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                    if (ch.only != null && !(childType != null && childType in ch.only)) { ctx.problems += Problem(here, "not-allowed-here"); continue }
                    node(child, here, depth + 1, type, ctx)?.let { list += it }
                }
                kids = list
            }
        }
        return ViewNode(type, JsonObject(out), kids, noSource = spec.sourced && out["source"] == null)
    }

    /** One fence's text: the view it draws, or why it is drawn as code. */
    fun validate(source: String): ViewResult {
        val ctx = Ctx()
        fun refuse(why: String, alt: String) = ViewResult.Code(why, alt, ctx.problems)
        if (source.length > limits.bytes || utf8Bytes(source) > limits.bytes) return refuse("too-big", altFrom(source))
        val json = StrictJson.parse(source) ?: return refuse("not-json", altFrom(source))
        if (json !is JsonObject) return refuse("not-object", "")
        val alt = (json["alt"] as? JsonPrimitive)?.takeIf { it.isString }?.let { text(it, false, limits.alt) }.orEmpty()
        if (alt.isEmpty()) return refuse("no-alt", "")
        val root = json["root"] as? JsonObject ?: return refuse("no-root", alt)
        return try {
            ViewResult.Drawn(alt, node(root, "root", 1, null, ctx) ?: ViewNode(ViewNode.UNKNOWN), ctx.problems)
        } catch (e: Refusal) {
            refuse(e.why, alt)
        }
    }

    private fun altFrom(source: String) = altFromText(source, limits.alt)
    private fun altOf(src: String) = altOfFence(src, limits.alt)

    /**
     * A reply's Markdown in its parts, in order: the text between the fences, each ```ui fence as a view, or as the code
     * it stays (with its alt and why: a refused fence, one past the third, one never closed), or, while the reply is
     * still being written ([done] false), a fence not closed yet, which waits whole ("Drawing a view…"). Other code
     * blocks are text, whole.
     */
    fun split(reply: String, done: Boolean = true): List<ReplyPart> {
        val lines = reply.replace("\r\n", "\n").replace('\r', '\n').split("\n")
        val parts = ArrayList<ReplyPart>()
        var md = ArrayList<String>()
        var fences = 0
        fun flush() {
            while (md.isNotEmpty() && md.first().jsTrim().isEmpty()) md.removeAt(0)
            while (md.isNotEmpty() && md.last().jsTrim().isEmpty()) md.removeAt(md.lastIndex)
            if (md.isNotEmpty()) parts += ReplyPart.Text(md.joinToString("\n"))
            md = ArrayList()
        }
        var i = 0
        while (i < lines.size) {
            if (isUiOpen(lines[i])) {
                val body = ArrayList<String>()
                var j = i + 1
                while (j < lines.size && !isUiClose(lines[j])) body += lines[j++]
                val closed = j < lines.size
                val src = body.joinToString("\n")
                flush()
                if (!closed) parts += if (done) ReplyPart.Code(src, altOf(src), "unclosed") else ReplyPart.Drawing
                else if (++fences > limits.fences) parts += ReplyPart.Code(src, altOf(src), "too-many-fences")
                else when (val r = validate(src)) {
                    is ViewResult.Drawn -> parts += ReplyPart.View(r.alt, r.root)
                    is ViewResult.Code -> parts += ReplyPart.Code(src, r.alt, r.refused)
                }
                i = j + 1
                continue
            }
            md += lines[i]
            val mark = otherFence(lines[i])
            if (mark != null) {
                // Another code block: text, up to its own closing line (a fence of at least as many marks).
                i++
                while (i < lines.size) { md += lines[i]; if (closesFence(lines[i], mark.first, mark.second)) break; i++ }
            }
            i++
        }
        flush()
        return parts
    }

    companion object {
        /** The catalog the server handed out (its JSON text), or null when it can't be read as one. */
        fun of(catalogJson: String, known: Int? = null): AnswerViews? {
            val root = StrictJson.parse(catalogJson) as? JsonObject ?: return null
            return runCatching { build(root, known) }.getOrNull()
        }

        private fun obj(e: JsonElement?) = e as? JsonObject
        private fun int(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()?.toInt()
        private fun dbl(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()
        private fun bool(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { !it.isString }?.content == "true"
        private fun strings(e: JsonElement?) = (e as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }

        private fun spec(o: JsonObject): PropSpec = PropSpec(
            type = (o["type"] as? JsonPrimitive)?.content.orEmpty(), max = int(o["max"]), min = dbl(o["min"]), maxValue = dbl(o["max"]),
            required = bool(o["required"]), multiline = bool(o["multiline"]), empty = bool(o["empty"]), nullable = bool(o["nullable"]),
            values = strings(o["values"]).orEmpty(), from = strings(o["from"]).orEmpty(), exts = strings(o["exts"]),
            counts = (o["counts"] as? JsonPrimitive)?.takeIf { it.isString }?.content, minItems = int(o["min"]),
            of = obj(o["of"])?.let { spec(it) }, props = obj(o["props"])?.let { props(it) }, noReserved = bool(o["noReserved"]),
            indexes = (o["indexes"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
        )
        private fun props(o: Map<String, JsonElement>): Map<String, PropSpec> = LinkedHashMap<String, PropSpec>().also { m -> for ((k, v) in o) obj(v)?.let { m[k] = spec(it) } }

        private fun build(root: JsonObject, known: Int?): AnswerViews {
            val l = obj(root["limits"]) ?: error("no limits")
            val limits = ViewLimits(int(l["fences"])!!, int(l["nodes"])!!, int(l["depth"])!!, int(l["bytes"])!!, int(l["points"])!!, int(l["alt"])!!)
            val version = int(root["version"]) ?: 1
            val comps = LinkedHashMap<String, ComponentSpec>()
            for ((name, v) in obj(root["components"]).orEmpty()) {
                val c = obj(v) ?: continue
                val ch = obj(c["children"])?.let { ChildrenSpec(int(it["max"]) ?: 0, strings(it["only"])) }
                comps[name] = ComponentSpec(int(c["since"]) ?: 1, props(obj(c["props"]).orEmpty()), ch, strings(c["in"]), bool(c["sourced"]))
            }
            return AnswerViews(version, limits, strings(root["tones"]).orEmpty(), comps, known ?: version, strings(root["reserved"]).orEmpty().map { phraseKey(it) }.toSet())
        }
    }
}

// ---- text and numbers, the way JavaScript reads them (public/answer-view.js), so that every app reads a fence alike ----

/** JavaScript's whitespace (what `\s` and `trim()` mean there), which is not Kotlin's. */
internal fun Char.isJsSpace(): Boolean = when (this) {
    '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
    else -> this in ' '..' '
}
private fun Char.isLineEnd() = this == '\n' || this == '\r' || this == ' ' || this == ' '
internal fun String.jsTrim(): String {
    var a = 0
    var b = length
    while (a < b && this[a].isJsSpace()) a++
    while (b > a && this[b - 1].isJsSpace()) b--
    return substring(a, b)
}

/** What a text is compared by to tell a reserved phrase: lower case with everything but letters and digits left out, so its case, spacing and punctuation change nothing. */
internal fun phraseKey(s: String): String = s.lowercase().filter { it.isLetterOrDigit() }

/** A text cut to [n] characters, not in the middle of a pair. */
private fun cap(s: String, n: Int): String {
    if (s.length <= n) return s
    val t = s.substring(0, n)
    return if (t.last().isHighSurrogate()) t.dropLast(1) else t
}

private fun isControl(c: Char) = c < '\u0009' || c == '\u000B' || c == '\u000C' || c in '\u000E'..'\u001F' || c == '\u007F'

/**
 * What a string prop holds: the text, control characters removed, its whitespace collapsed (a multiline one keeps its
 * lines), cut to its length; a number is its digits. null: it is neither.
 */
private fun text(v: JsonElement, multiline: Boolean, max: Int): String? {
    val p = v as? JsonPrimitive ?: return null
    if (p is JsonNull) return null
    val raw = if (p.isString) p.content else numberOf(p)?.let { jsNumberText(it) } ?: return null
    val clean = raw.filterNot { isControl(it) }
    val s = if (multiline) clean.replace("\r\n", "\n").replace('\r', '\n').jsTrim() else collapse(clean)
    return cap(s, max)
}

/** Runs of whitespace as one space, and none at either end. */
private fun collapse(s: String): String {
    val out = StringBuilder(s.length)
    var space = false
    for (c in s) {
        if (c.isJsSpace()) space = true
        else { if (space && out.isNotEmpty()) out.append(' '); space = false; out.append(c) }
    }
    return out.toString()
}

private val DECIMAL = Regex("""^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$""")

/** A number, or a text that is one (as JavaScript's Number() reads it); null when it is neither, or not finite. */
private fun numberOf(v: JsonElement): Double? {
    val p = v as? JsonPrimitive ?: return null
    if (p is JsonNull) return null
    val n = if (!p.isString) p.content.toDoubleOrNull() else {
        val s = p.content.jsTrim()
        when {
            s.isEmpty() -> null
            DECIMAL.matches(s) -> s.toDoubleOrNull()
            s.length > 2 && s[0] == '0' && s[1] in "xXbBoO" -> s.substring(2).toLongOrNull(when (s[1]) { 'x', 'X' -> 16; 'b', 'B' -> 2; else -> 8 })?.toDouble()
            else -> null
        }
    }
    return n?.takeIf { !it.isNaN() && !it.isInfinite() }
}

/** A number as it is kept: a whole one as an integer, so it reads as it was written. */
private fun number(n: Double): JsonPrimitive = if (n == floor(n) && abs(n) < 1e15) JsonPrimitive(n.toLong()) else JsonPrimitive(n)

/** A number as JavaScript writes it as text (12, 1.5, 1e+21), which Kotlin's toString does not. */
internal fun jsNumberText(d: Double): String {
    if (d == 0.0) return "0"
    val sign = if (d < 0) "-" else ""
    val s = abs(d).toString()
    val e = s.indexOf('E')
    val mantissa = if (e < 0) s else s.substring(0, e)
    val exp = if (e < 0) 0 else s.substring(e + 1).toInt()
    val dot = mantissa.indexOf('.')
    val all = mantissa.replace(".", "")
    val lead = all.length - all.trimStart('0').length
    val digits = all.trimStart('0').trimEnd('0').ifEmpty { "0" }
    val k = digits.length
    val n = (if (dot < 0) mantissa.length else dot) + exp - lead // the decimal point's place, from the first digit
    val body = when {
        n in k..21 -> digits + "0".repeat(n - k)
        n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
        n in -5..0 -> "0." + "0".repeat(-n) + digits
        else -> {
            val x = n - 1
            digits.substring(0, 1) + (if (k > 1) "." + digits.substring(1) else "") + "e" + (if (x < 0) "-" else "+") + abs(x)
        }
    }
    return sign + body
}

/** The bytes of a text in UTF-8, as a fence is measured. */
internal fun utf8Bytes(s: String): Int {
    var n = 0
    var i = 0
    while (i < s.length) {
        val c = s[i]
        when {
            c.code < 0x80 -> n += 1
            c.code < 0x800 -> n += 2
            c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate() -> { n += 4; i++ }
            else -> n += 3
        }
        i++
    }
    return n
}

/** An https address that opens: no user or password, no spaces. (botdot fetches a picture itself and checks its host.) */
private fun isHttps(s: String): Boolean {
    if (s.length > 2000 || !s.startsWith("https://")) return false
    var i = 8
    while (i < s.length && s[i] != '/' && s[i] != '?' && s[i] != '#' && s[i] != '@' && !s[i].isJsSpace()) i++
    if (i == 8) return false
    if (i == s.length) return true
    if (s[i] != '/' && s[i] != '?' && s[i] != '#') return false
    return s.substring(i).none { it.isJsSpace() }
}

/** A path among the bot's files ("./" and "/workspace/" are that folder): no way out of it, no web address, no drive, no query; with the extensions a kind of media allows, if the prop names them. */
private fun filePath(s: String, exts: List<String>?): String? {
    var p = s
    if (p.startsWith("/workspace/")) p = p.removePrefix("/workspace/") else if (p.startsWith("./")) p = p.removePrefix("./")
    if (p.isEmpty() || p.length > 500 || p[0] == '~' || p.any { it == '\\' || it == ':' || it == '?' || it == '#' || it < ' ' || it == '\u007F' }) return null
    if (p.split("/").any { it.isEmpty() || it == "." || it == ".." }) return null
    if (exts != null) {
        val dot = p.lastIndexOf('.')
        val ext = if (dot < 0) "" else p.substring(dot + 1)
        if (ext.isEmpty() || ext.length > 8 || !ext.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' } || ext.lowercase() !in exts) return null
    }
    return p
}

/** A fence's alt as far as it can be read from a text that is no JSON (a fence cut short, or too long to read). */
internal fun altFromText(source: String, max: Int): String {
    val s = source.take(20000)
    var from = 0
    while (true) {
        val at = s.indexOf("\"alt\"", from)
        if (at < 0) return ""
        from = at + 1
        var i = at + 5
        while (i < s.length && s[i].isJsSpace()) i++
        if (i >= s.length || s[i] != ':') continue
        i++
        while (i < s.length && s[i].isJsSpace()) i++
        if (i >= s.length || s[i] != '"') continue
        i++
        val start = i
        var closed = false
        while (i < s.length) {
            val c = s[i]
            if (c == '"') { closed = true; break }
            if (c == '\\') { if (i + 1 >= s.length || s[i + 1].isLineEnd()) break; i += 2 } else i++
        }
        if (!closed) continue
        val raw = StrictJson.unescape(s.substring(start, i)) ?: return ""
        return text(JsonPrimitive(raw), false, max).orEmpty()
    }
}

/** What a ```ui fence says in one line: its `alt`, read without the catalog (a notification, a preview and a copy have none). */
fun altOfFence(src: String, max: Int = 200): String {
    val j = StrictJson.parse(src)
    if (j is JsonObject) { val a = j["alt"]; if (a is JsonPrimitive && a.isString) return text(a, false, max).orEmpty() }
    return altFromText(src, max)
}

/** A reply's Markdown with each ```ui fence, drawn or not, as its `alt` line: what a notification, a preview or a list line reads. */
fun answerViewAlts(md: String): String {
    if (!md.contains("```ui")) return md
    val lines = md.replace("\r\n", "\n").replace('\r', '\n').split("\n")
    val out = ArrayList<String>()
    var i = 0
    while (i < lines.size) {
        if (isUiOpen(lines[i])) {
            val body = ArrayList<String>()
            var j = i + 1
            while (j < lines.size && !isUiClose(lines[j])) body += lines[j++]
            altOfFence(body.joinToString("\n")).takeIf { it.isNotEmpty() }?.let { out += it }
            i = j + 1
            continue
        }
        out += lines[i]
        val mark = otherFence(lines[i])
        if (mark != null) { i++; while (i < lines.size) { out += lines[i]; if (closesFence(lines[i], mark.first, mark.second)) break; i++ } }
        i++
    }
    return out.joinToString("\n")
}

// ---- the fences of a reply ----

private fun isUiOpen(line: String): Boolean {
    val t = line.jsTrim()
    return t == "```ui"
}
private fun isUiClose(line: String): Boolean {
    val t = line.jsTrim()
    return t == "```"
}

/** A line that opens another code block: its mark (` or ~) and how many. */
private fun otherFence(line: String): Pair<Char, Int>? {
    val t = line.trimStart { it.isJsSpace() }
    val c = t.firstOrNull() ?: return null
    if (c != '`' && c != '~') return null
    val n = t.takeWhile { it == c }.length
    return if (n >= 3) c to n else null
}
private fun closesFence(line: String, mark: Char, size: Int): Boolean {
    val t = line.jsTrim()
    return t.length >= size && t.all { it == mark }
}

// ---- JSON, read as JavaScript's JSON.parse reads it, so that a fence is the same text to every app ----

/** A strict JSON reader: what JSON.parse accepts and nothing else (no trailing comma, no single quotes, no leading zero). */
internal object StrictJson {
    private class Bad : Exception()
    private const val DEEP = 1000

    fun parse(s: String): JsonElement? = try {
        val r = Reader(s)
        r.ws()
        val v = r.value(0)
        r.ws()
        if (r.i == s.length) v else null
    } catch (_: Bad) { null }

    /** The text a JSON string holds, from what is between its quotes; null when that is not a JSON string. */
    fun unescape(raw: String): String? = try { Reader("\"$raw\"").string() } catch (_: Bad) { null }

    private class Reader(val s: String) {
        var i = 0
        fun ws() { while (i < s.length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++ }
        private fun peek() = if (i < s.length) s[i] else throw Bad()
        private fun expect(c: Char) { if (peek() != c) throw Bad(); i++ }

        fun value(depth: Int): JsonElement {
            if (depth > DEEP) throw Bad()
            return when (val c = peek()) {
                '{' -> obj(depth)
                '[' -> arr(depth)
                '"' -> JsonPrimitive(string())
                't' -> word("true", JsonPrimitive(true))
                'f' -> word("false", JsonPrimitive(false))
                'n' -> word("null", JsonNull)
                else -> if (c == '-' || c in '0'..'9') numberValue() else throw Bad()
            }
        }

        private fun obj(depth: Int): JsonElement {
            i++
            val m = LinkedHashMap<String, JsonElement>()
            ws()
            if (peek() == '}') { i++; return JsonObject(m) }
            while (true) {
                ws()
                val k = string()
                ws(); expect(':'); ws()
                m[k] = value(depth + 1)
                ws()
                if (peek() == ',') { i++; continue }
                expect('}')
                return JsonObject(m)
            }
        }

        private fun arr(depth: Int): JsonElement {
            i++
            val l = ArrayList<JsonElement>()
            ws()
            if (peek() == ']') { i++; return JsonArray(l) }
            while (true) {
                ws()
                l += value(depth + 1)
                ws()
                if (peek() == ',') { i++; continue }
                expect(']')
                return JsonArray(l)
            }
        }

        private fun word(w: String, v: JsonElement): JsonElement { if (!s.startsWith(w, i)) throw Bad(); i += w.length; return v }

        private fun numberValue(): JsonElement {
            val start = i
            if (peek() == '-') i++
            if (peek() == '0') i++ else if (peek() in '1'..'9') { while (i < s.length && s[i] in '0'..'9') i++ } else throw Bad()
            if (i < s.length && s[i] == '.') { i++; digits() }
            if (i < s.length && (s[i] == 'e' || s[i] == 'E')) { i++; if (i < s.length && (s[i] == '+' || s[i] == '-')) i++; digits() }
            return JsonPrimitive(s.substring(start, i).toDouble())
        }
        private fun digits() { if (i >= s.length || s[i] !in '0'..'9') throw Bad(); while (i < s.length && s[i] in '0'..'9') i++ }

        fun string(): String {
            expect('"')
            val sb = StringBuilder()
            while (true) {
                if (i >= s.length) throw Bad()
                val c = s[i++]
                when {
                    c == '"' -> return sb.toString()
                    c < ' ' -> throw Bad()
                    c == '\\' -> {
                        if (i >= s.length) throw Bad()
                        when (s[i++]) {
                            '"' -> sb.append('"'); '\\' -> sb.append('\\'); '/' -> sb.append('/')
                            'b' -> sb.append('\b'); 'f' -> sb.append('\u000C'); 'n' -> sb.append('\n'); 'r' -> sb.append('\r'); 't' -> sb.append('\t')
                            'u' -> {
                                if (i + 4 > s.length) throw Bad()
                                val h = s.substring(i, i + 4)
                                if (!h.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) throw Bad()
                                sb.append(h.toInt(16).toChar()); i += 4
                            }
                            else -> throw Bad()
                        }
                    }
                    else -> sb.append(c)
                }
            }
        }
    }
}
