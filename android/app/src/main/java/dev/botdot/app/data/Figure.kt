package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin

// A bot's mark, from the one definition the botdot server hands out (GET /api/figure, lib/figure.json;
// docs/adr/003-one-figure-definition-for-all-apps.md): a head in the bot's colour, the face of its state and its hat.
// The app bundles that file and prefers the server's copy. This file holds no face or kit data of its own beyond one
// built-in bare head: it reads the definition and says what to draw, as plain marks in the definition's own units,
// and where the three layers (head, eyes, pupils) are at a moment. ui/BotFigure.kt puts them on a canvas.
// public/figure.js is the reference: this must draw what it draws.

/**
 * A tone of a mark: the bot's colour, that colour mixed towards the text colour (ADR 004), or the white of an eye and
 * the ink of a pupil, which the definition gives.
 */
enum class Tone { MAIN, DEEP, WHITE, INK }

/** One step of an outline: M, L, Q, C or Z with its points (x, y, x, y, …). */
class Step(val op: Char, val at: FloatArray)

/** One thing to draw, in the definition's units: a circle or an outline, filled and/or stroked (round caps and joins). */
sealed interface Mark {
    val fill: Tone?
    val stroke: Tone?
    val width: Float

    data class Disc(val x: Float, val y: Float, val r: Float, override val fill: Tone?, override val stroke: Tone?, override val width: Float) : Mark
    class Outline(val steps: List<Step>, override val fill: Tone?, override val stroke: Tone?, override val width: Float) : Mark
}

/** Where one layer is: moved, and turned (degrees, clockwise on screen) and scaled about its pivot. */
data class Place(val moveX: Double = 0.0, val moveY: Double = 0.0, val turn: Double = 0.0, val scaleX: Double = 1.0, val scaleY: Double = 1.0) {
    /**
     * The layer's transform about its pivot, as [a, b, c, d, e, f]: a point (x, y) of its content goes to
     * (a·x + c·y + e, b·x + d·y + f), which is move + pivot + R(turn) · S(scale) · (p − pivot).
     */
    fun matrix(pivotX: Double, pivotY: Double): FloatArray {
        val r = Math.toRadians(turn)
        val (co, si) = cos(r) to sin(r)
        val (a, b, c, d) = listOf(co * scaleX, si * scaleX, -si * scaleY, co * scaleY)
        return floatArrayOf(a.toFloat(), b.toFloat(), c.toFloat(), d.toFloat(),
            (moveX + pivotX - a * pivotX - c * pivotY).toFloat(), (moveY + pivotY - b * pivotX - d * pivotY).toFloat())
    }
}

/** The three layers at one moment, one inside the other: the head (everything), the eyes (the face) and the pupils. */
class Layers(val head: Place, val eyes: Place, val pupils: Place)

/** The face of a state: what doesn't look around (whites, brows, crosses, closed lids) and what does. */
class Face(val eyes: List<Mark>, val pupils: List<Mark>)

class FigureDef private constructor(
    val box: Pair<Float, Float>,
    /** The head's circle, in the bot's colour. */
    val head: Mark.Disc,
    /** The white of an eye and the ink of a pupil, as 0xRRGGBB: the same on a light and a dark background. */
    val white: Int,
    val ink: Int,
    /** The points the head turns about and the eyes close about. */
    val pivotHead: Pair<Double, Double>,
    val pivotEyes: Pair<Double, Double>,
    private val states: Map<String, State>,
    private val default: String,
    private val hats: Hats?,
    private val chief: JsonElement?,
    /** The part of the box (x, y, width, height) that fills the small mark: the definition's, or the whole box. */
    val small: FloatArray,
) {
    private class Key(val at: Double, val values: DoubleArray)
    private class Move(val seconds: Double, val eased: Boolean, val keys: List<Key>)
    private class State(val face: Face, val pose: DoubleArray, val opacity: Float, val move: Move?)
    /** Where a hat goes (the origin of its box at [atX], [atY], drawn [scale] times as large) and the kit's hats by name. */
    private class Hats(val atX: Double, val atY: Double, val scale: Double, val originX: Double, val originY: Double, val pieces: Map<String, JsonElement>)

    /** How wide the small mark is for its height. */
    val smallAspect: Float get() = small[2] / small[3]

    /** The state to draw: the one asked for, or the default for one this definition doesn't know. */
    fun stateName(state: String?): String = if (state != null && states.containsKey(state)) state else default

    fun opacity(state: String?): Float = states.getValue(stateName(state)).opacity

    fun face(state: String?): Face = states.getValue(stateName(state)).face

    /**
     * Where the layers are in a state: its still pose ([seconds] null: reduced motion, or a state that doesn't move),
     * or where its movement is at that time on the clock. Between two keys every number goes from one to the other
     * on its own with the movement's easing, as CSS keyframes do on the web page.
     */
    fun layers(state: String?, seconds: Double? = null): Layers {
        val s = states.getValue(stateName(state))
        val move = s.move
        if (seconds == null || move == null) return layersOf(s.pose)
        val q = phase(move, seconds)
        val i = stretch(move, q)
        val (from, to) = move.keys[i] to move.keys[i + 1]
        val local = ((q - from.at) / (to.at - from.at)).coerceIn(0.0, 1.0)
        val k = if (move.eased) easeInOut(local) else local
        return layersOf(DoubleArray(REST.size) { from.values[it] + (to.values[it] - from.values[it]) * k })
    }

    /**
     * When a state next moves, from [seconds] on the clock: how long until then (0: it is moving now) and how long
     * that stretch of its movement lasts, both in seconds. Null for a state that never moves. Between two equal
     * keys (a hold) nothing moves, so nothing needs drawing again: an idle head asks for frames only while it blinks.
     */
    fun nextMove(state: String?, seconds: Double): Pair<Double, Double>? {
        val move = states.getValue(stateName(state)).move ?: return null
        val q = phase(move, seconds)
        val n = move.keys.size - 1
        val first = stretch(move, q)
        for (j in 0 until n) {
            val i = (first + j) % n
            if (move.keys[i].values.contentEquals(move.keys[i + 1].values)) continue
            val wrap = if (first + j >= n) 1.0 else 0.0 // a stretch of the next loop
            val from = if (j == 0) q else move.keys[i].at + wrap
            return (from - q) * move.seconds to (move.keys[i + 1].at + wrap - from) * move.seconds
        }
        return null
    }

    private fun phase(move: Move, seconds: Double) = ((seconds % move.seconds) + move.seconds) % move.seconds / move.seconds
    private fun stretch(move: Move, q: Double) = move.keys.indexOfLast { it.at <= q }.coerceIn(0, move.keys.size - 2)

    /**
     * The hat of an outfit ({ hat }: a kit name, or a hat given inline as { shapes }; [CHIEF] for the Chief of Staff's),
     * placed on the head, when this app can draw it. A hat is drawn whole or not at all: a name the kit lacks, or a
     * shape or tone this app doesn't know, gives no marks, and the head is drawn without a hat. Anything else an
     * outfit carries is ignored. The limits of a hat are checked on the server, not here.
     */
    fun hat(outfit: JsonElement?): List<Mark> {
        val h = hats ?: return emptyList()
        val o = (if (outfit == CHIEF) chief else outfit) as? JsonObject ?: return emptyList()
        val piece = when (val wanted = o["hat"]) {
            is JsonPrimitive -> if (wanted.isString && wanted.content.isNotEmpty()) h.pieces[wanted.content] else null
            is JsonObject -> wanted
            else -> null
        }
        val shapes = ((piece as? JsonObject)?.get("shapes") as? JsonArray) ?: return emptyList()
        // A point q of the hat lands at at + scale × (q − origin); its stroke widths grow with it.
        val put = Put(h.atX - h.scale * h.originX, h.atY - h.scale * h.originY, h.scale)
        return runCatching { shapes.map { markOf(it, HAT_TONES, put) } }.getOrDefault(emptyList())
    }

    /**
     * The part of the box (x, y, width, height) a still picture of a bot is cut from, where the picture may be cropped
     * to a circle (the sender of a notification): the square around the smallest circle, about the middle of the head
     * and its [hat], that holds both. A bare head fills its picture; a hat makes the head a little smaller and is
     * never cut.
     */
    fun portrait(hat: List<Mark>): FloatArray {
        val marks = listOf<Mark>(head) + hat
        // Each mark as points with the room its stroke takes around them (a disc: its middle, with its radius as room).
        val points = marks.flatMap { m ->
            when (m) {
                is Mark.Disc -> listOf(Triple(m.x, m.y, m.r + m.width / 2))
                is Mark.Outline -> m.steps.flatMap { s -> (0 until s.at.size / 2).map { Triple(s.at[2 * it], s.at[2 * it + 1], m.width / 2) } }
            }
        }
        val cx = (points.minOf { it.first - it.third } + points.maxOf { it.first + it.third }) / 2
        val cy = (points.minOf { it.second - it.third } + points.maxOf { it.second + it.third }) / 2
        val r = points.maxOf { hypot(it.first - cx, it.second - cy) + it.third }
        return floatArrayOf(cx - r, cy - r, 2 * r, 2 * r)
    }

    /** Where a shape's numbers land: x at [dx] + [k]·x, y at [dy] + [k]·y, and every length [k] times as long. */
    private class Put(val dx: Double, val dy: Double, val k: Double) {
        fun x(v: Double) = (dx + k * v).toFloat()
        fun y(v: Double) = (dy + k * v).toFloat()
        fun len(v: Double) = (k * v).toFloat()
    }

    companion object {
        /** The format this renderer knows. */
        const val VERSION = 2
        /** The colour of a bot that has none. */
        const val GREY = 0x888780
        /** In place of an outfit: the one the definition gives the Chief of Staff. */
        val CHIEF: JsonElement = JsonPrimitive("chief")

        private val NAME = Regex("^[a-z][a-z0-9_]*$", RegexOption.IGNORE_CASE)
        private val HEX = Regex("^#[0-9a-f]{6}$", RegexOption.IGNORE_CASE)
        private val STEPS = mapOf("M" to 2, "L" to 2, "Q" to 4, "C" to 6, "Z" to 0)
        private val JSON = Json { ignoreUnknownKeys = true }
        private val HAT_TONES = mapOf("main" to Tone.MAIN, "deep" to Tone.DEEP) // a hat is in two tones of the bot's colour
        private val FACE_TONES = HAT_TONES + mapOf("white" to Tone.WHITE, "ink" to Tone.INK)
        private val AS_GIVEN = Put(0.0, 0.0, 1.0)

        // A pose as nine numbers: the head's move and turn, the eyes' move and scale, the pupils' move. REST is what a
        // pose leaves out. SAYS is what a pose may say of each layer, and where those numbers are.
        private val REST = doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0)
        private val SAYS = mapOf(
            "head" to mapOf("move" to 0, "turn" to 2),
            "eyes" to mapOf("move" to 3, "scale" to 5),
            "pupils" to mapOf("move" to 7),
        )
        private fun layersOf(v: DoubleArray) = Layers(Place(v[0], v[1], turn = v[2]), Place(v[3], v[4], scaleX = v[5], scaleY = v[6]), Place(v[7], v[8]))

        /**
         * No definition can be used: one bare head looking ahead, with no states, no movement and no hat. Its numbers
         * are those ADR 003 fixes for every app.
         */
        val BARE: FigureDef by lazy {
            parse("""{"version":2,"box":[24,24],"head":{"cx":12,"cy":16.5,"r":7.5},"tones":{"white":"#ffffff","ink":"#24231f"},
                "pivot":{"head":[12,16.5],"eyes":[12,17.1]},"default":"plain","states":{"plain":{
                "eyes":[{"shape":"circle","cx":8.8,"cy":17.1,"r":2.2,"fill":"white"},{"shape":"circle","cx":15.2,"cy":17.1,"r":2.2,"fill":"white"}],
                "pupils":[{"shape":"circle","cx":8.8,"cy":17.1,"r":1.2,"fill":"ink"},{"shape":"circle","cx":15.2,"cy":17.1,"r":1.2,"fill":"ink"}]}}}""")
        }

        /**
         * Reads a definition. Throws when it is not one this app can draw from (another version of the format, a face
         * with a shape or tone it doesn't know, or broken): the app then keeps the copy it has. Keys it doesn't know
         * are ignored.
         */
        fun parse(text: String): FigureDef {
            val d = JSON.parseToJsonElement(text) as? JsonObject ?: fail("not an object")
            if (d.num("version") != VERSION.toDouble()) fail("version ${d["version"]} is not one this app knows")
            val box = d.pair("box")?.takeIf { it.first > 0 && it.second > 0 } ?: fail("box must be [width, height]")
            val head = (d["head"] as? JsonObject)?.let { h ->
                val (cx, cy, r) = listOf(h.num("cx"), h.num("cy"), h.num("r")?.takeIf { it > 0 })
                if (cx == null || cy == null || r == null) null else Mark.Disc(cx.toFloat(), cy.toFloat(), r.toFloat(), Tone.MAIN, null, 0f)
            } ?: fail("head must be { cx, cy, r }")
            val tones = d["tones"] as? JsonObject
            fun tone(name: String) = tones?.text(name)?.takeIf { HEX.matches(it) }?.drop(1)?.toInt(16) ?: fail("tones must give white and ink as #rrggbb")
            val (white, ink) = tone("white") to tone("ink")
            val pivot = d["pivot"] as? JsonObject
            val pivotHead = pivot?.pair("head") ?: fail("pivot must give head and eyes as [x, y]")
            val pivotEyes = pivot.pair("eyes") ?: fail("pivot must give head and eyes as [x, y]")

            // A pose, or a key over one: what it says of each layer replaces that number of [under].
            fun pose(el: JsonElement?, under: DoubleArray, what: String): DoubleArray {
                if (el == null) return under
                if (el is JsonArray && el.isEmpty()) return under // an empty list says nothing of any layer, as on the web page
                val p = el as? JsonObject ?: fail("$what is not a pose")
                val out = under.copyOf()
                for ((layer, may) in SAYS) {
                    val v = (p[layer] ?: continue) as? JsonObject ?: fail("$what: $layer says move, turn or scale")
                    for (k in listOf("move", "turn", "scale")) {
                        if (v[k] == null) continue
                        val at = may[k] ?: fail("$what: $layer has no $k")
                        if (k == "turn") out[at] = v.num(k) ?: fail("$what: $layer's turn must be a number")
                        else (v.pair(k) ?: fail("$what: $layer's $k must be [x, y]")).let { out[at] = it.first; out[at + 1] = it.second }
                    }
                }
                return out
            }

            val states = (d["states"] as? JsonObject)?.mapValues { (name, el) ->
                if (!NAME.matches(name)) fail("\"$name\" can't be a state's name")
                val s = el as? JsonObject ?: fail("$name has no face")
                fun shapes(key: String) = (s[key] as? JsonArray ?: fail("$name has no face")).let { list ->
                    runCatching { list.map { markOf(it, FACE_TONES, AS_GIVEN) } }.getOrElse { fail("$name: its face has a shape this app can't draw (${it.message})") }
                }
                val face = Face(shapes("eyes"), shapes("pupils"))
                val still = pose(s["pose"], REST, name)
                val opacity = if (s["opacity"] == null) 1.0 else s.num("opacity")?.takeIf { it in 0.0..1.0 } ?: fail("$name: opacity is 0 to 1")
                // No movement: none given, or what the web page takes for none (null, false, 0 or "").
                val moving = s["move"]?.takeIf { m ->
                    !(m is JsonNull || (m is JsonPrimitive && (if (m.isString) m.content.isEmpty() else m.content == "false" || m.content.toDoubleOrNull() == 0.0)))
                }
                val move = moving?.let { el ->
                    val m = el as? JsonObject ?: fail("$name: seconds must be more than 0")
                    val seconds = m.num("seconds")?.takeIf { it > 0 } ?: fail("$name: seconds must be more than 0")
                    val eased = when (m.text("easing")) { "ease-in-out" -> true; "linear" -> false; else -> fail("$name: the easing is linear or ease-in-out") }
                    val said = (m["keys"] as? JsonArray)?.takeIf { it.size >= 2 } ?: fail("$name: a movement has two keys or more")
                    val keys = said.mapIndexed { i, k -> Key((k as? JsonObject)?.num("at") ?: fail("$name: keys start at 0 and go up"), pose(k, still, "$name, key $i")) }
                    keys.forEachIndexed { i, k -> if (if (i > 0) k.at <= keys[i - 1].at else k.at != 0.0) fail("$name: keys start at 0 and go up") }
                    if (keys.last().at != 1.0) fail("$name: the last key is at 1")
                    // What the two keys say, not only where they put the layers: the web page refuses the same.
                    // Numbers are compared as numbers, as there: [0, 1] and [0.0, 1.0] say the same.
                    fun says(k: JsonElement) = SAYS.keys.map { layer -> ((k as JsonObject)[layer] as JsonObject?)?.let(::said) ?: emptyMap<String, Any?>() }
                    if (says(said.first()) != says(said.last())) fail("$name: the last key must equal the first, or the loop jumps")
                    Move(seconds, eased, keys)
                }
                State(face, still, opacity.toFloat(), move)
            } ?: fail("default must name one of the states")
            val default = d.text("default")?.takeIf { states.containsKey(it) } ?: fail("default must name one of the states")

            // Where the hat goes, and the kit. A kit that is missing or wrong leaves hats out; the head is still drawn.
            val at = (d["attach"] as? JsonObject)?.get("hat")
            val hats = if (at == null) null else {
                val a = at as? JsonObject
                val to = a?.pair("at")
                val scale = a?.num("scale")?.takeIf { it > 0 }
                if (to == null || scale == null) fail("attach.hat must be { at, scale }")
                val k = (d["kit"] as? JsonObject)?.get("hat") as? JsonObject
                k?.pair("origin")?.let { o -> Hats(to.first, to.second, scale, o.first, o.second, (k["pieces"] as? JsonObject).orEmpty()) }
            }
            val chief = ((d["chief"] as? JsonObject)?.get("outfit") as? JsonObject)
            val small = if (d["small"] == null) listOf(0.0, 0.0, box.first, box.second) else {
                ((d["small"] as? JsonObject)?.get("view") as? JsonArray)?.takeIf { it.size == 4 }?.map { (it as? JsonPrimitive)?.number() ?: fail("small: view must be [x, y, width, height]") }
                    ?.takeIf { it[2] > 0 && it[3] > 0 } ?: fail("small: view must be [x, y, width, height]")
            }
            return FigureDef(box.first.toFloat() to box.second.toFloat(), head, white, ink, pivotHead, pivotEyes, states, default, hats, chief, FloatArray(4) { small[it].toFloat() })
        }

        private fun fail(why: String): Nothing = throw IllegalArgumentException("Figure definition: $why")

        /** What a piece of JSON says, whatever way it is written: a number as a number, an object whatever the order of its keys. */
        private fun said(el: JsonElement): Any? = when (el) {
            is JsonObject -> el.mapValues { said(it.value) }
            is JsonArray -> el.map(::said)
            is JsonNull -> null
            is JsonPrimitive -> if (el.isString) el.content else el.content.toDoubleOrNull()?.plus(0.0) ?: el.content // + 0.0: -0 is 0
        }

        private fun JsonPrimitive.number(): Double? = if (isString) null else content.toDoubleOrNull()?.takeIf { it.isFinite() }
        private fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.number()
        private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        private fun JsonObject.pair(key: String): Pair<Double, Double>? = (this[key] as? JsonArray)?.takeIf { it.size == 2 }?.let { a ->
            val x = (a[0] as? JsonPrimitive)?.number() ?: return null
            val y = (a[1] as? JsonPrimitive)?.number() ?: return null
            x to y
        }

        /**
         * One shape as a mark: filled, stroked or both, each in one of [tones]. A fill or stroke that is not one of
         * them stops the shape's piece, like a shape that is not one: a piece is drawn whole or not at all.
         */
        private fun markOf(el: JsonElement, tones: Map<String, Tone>, put: Put): Mark {
            val s = el as? JsonObject ?: throw IllegalArgumentException("not a shape")
            fun n(key: String) = s.num(key) ?: throw IllegalArgumentException("not a number")
            fun tone(key: String) = if (s[key] == null) null else tones[s.text(key)] ?: throw IllegalArgumentException("not a tone")
            val fill = tone("fill")
            val stroke = tone("stroke")
            if (fill == null && stroke == null) throw IllegalArgumentException("no tone")
            val width = if (stroke == null) 0f else put.len(n("width"))
            fun outline(steps: List<Pair<Char, DoubleArray>>) = Mark.Outline(
                steps.map { (op, at) -> Step(op, FloatArray(at.size) { i -> if (i % 2 == 0) put.x(at[i]) else put.y(at[i]) }) }, fill, stroke, width)
            return when (s.text("shape")) {
                "circle" -> Mark.Disc(put.x(n("cx")), put.y(n("cy")), put.len(n("r")), fill, stroke, width)
                "line" -> outline(listOf('M' to doubleArrayOf(n("x1"), n("y1")), 'L' to doubleArrayOf(n("x2"), n("y2"))))
                "rect" -> outline(rect(n("x"), n("y"), n("w"), n("h"), if (s["r"] == null) 0.0 else n("r")))
                "path" -> {
                    val d = s["d"] as? JsonArray ?: throw IllegalArgumentException("not a path")
                    val steps = d.map { c ->
                        val step = c as? JsonArray ?: throw IllegalArgumentException("not a path command")
                        val op = (step.firstOrNull() as? JsonPrimitive)?.takeIf { it.isString }?.content
                        if (STEPS[op] != step.size - 1) throw IllegalArgumentException("not a path command")
                        op!![0] to DoubleArray(step.size - 1) { i -> (step[i + 1] as? JsonPrimitive)?.number() ?: throw IllegalArgumentException("not a number") }
                    }
                    // One that doesn't start with a move shows nothing on the web page, and nothing here.
                    outline(if (steps.firstOrNull()?.first == 'M') steps else emptyList())
                }
                else -> throw IllegalArgumentException("not a shape")
            }
        }

        /** A rectangle as an outline; with a corner radius its corners are rounded as SVG's rx does: by at most half of each side. */
        private fun rect(x: Double, y: Double, w: Double, h: Double, radius: Double): List<Pair<Char, DoubleArray>> {
            if (w <= 0 || h <= 0 || radius < 0) return emptyList() // nothing to see, as on the web page
            val (rx, ry) = min(radius, w / 2) to min(radius, h / 2)
            if (rx <= 0) return listOf('M' to doubleArrayOf(x, y), 'L' to doubleArrayOf(x + w, y), 'L' to doubleArrayOf(x + w, y + h), 'L' to doubleArrayOf(x, y + h), 'Z' to doubleArrayOf())
            val (cx, cy) = rx * 0.5522847498 to ry * 0.5522847498 // how far a cubic's control points lie along a quarter circle
            val (x2, y2) = (x + w) to (y + h)
            return listOf(
                'M' to doubleArrayOf(x + rx, y),
                'L' to doubleArrayOf(x2 - rx, y), 'C' to doubleArrayOf(x2 - rx + cx, y, x2, y + ry - cy, x2, y + ry),
                'L' to doubleArrayOf(x2, y2 - ry), 'C' to doubleArrayOf(x2, y2 - ry + cy, x2 - rx + cx, y2, x2 - rx, y2),
                'L' to doubleArrayOf(x + rx, y2), 'C' to doubleArrayOf(x + rx - cx, y2, x, y2 - ry + cy, x, y2 - ry),
                'L' to doubleArrayOf(x, y + ry), 'C' to doubleArrayOf(x, y + ry - cy, x + rx - cx, y, x + rx, y),
                'Z' to doubleArrayOf(),
            )
        }

        /** CSS ease-in-out, the cubic bezier (0.42, 0, 0.58, 1): how far a movement is at [t] of the way in time. */
        fun easeInOut(t: Double): Double {
            if (t <= 0) return 0.0
            if (t >= 1) return 1.0
            fun bezier(u: Double, p1: Double, p2: Double) = 3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u
            var (lo, hi) = 0.0 to 1.0
            var u = t
            repeat(40) {
                val x = bezier(u, 0.42, 0.58)
                if (abs(x - t) < 1e-7) return bezier(u, 0.0, 1.0)
                if (x < t) lo = u else hi = u
                u = (lo + hi) / 2
            }
            return bezier(u, 0.0, 1.0)
        }

        /**
         * The deep tone of a colour (0xRRGGBB): mixed 45% towards black on a light background and towards white on a
         * dark one, channel by channel in sRGB.
         */
        fun deep(rgb: Int, dark: Boolean): Int {
            val ink = if (dark) 255 else 0
            fun mix(shift: Int) = Math.round(((rgb shr shift) and 0xff) * 0.55 + ink * 0.45).toInt().coerceIn(0, 255) shl shift
            return mix(16) or mix(8) or mix(0)
        }
    }
}
