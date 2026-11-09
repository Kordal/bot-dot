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
// docs/adr/003-one-figure-definition-for-all-apps.md): a tile in the bot's colour with its icon, and a ring or a dot
// for its state (the definition's `tile`, docs/adr/169-a-bot-is-an-icon-on-a-tile-in-its-colour.md). A definition
// without `tile` is drawn as ADR 003's head: the face of its state and its hat.
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

/** What a state adds to the tile: a turning ring or a dot, each in its colour (0xRRGGBB). */
data class Signal(val ring: Int?, val dot: Int?)

/**
 * The tile (ADR 169), in the definition's units: [rect] (x, y, width, height, corner radius) filled with the bot's colour
 * muted towards [toward] by [by], the icon placed at [iconX], [iconY] and drawn [iconScale] times as large in [ink], a
 * ring of radius [ringR] with an arc of [ringArc] of it turning once every [ringSeconds], and a dot at [dot] (x, y,
 * radius, the gap cut out around it).
 */
class FigureTile internal constructor(
    val rect: FloatArray,
    val toward: Int,
    val by: Float,
    val ink: Int,
    val ringR: Float,
    val ringWidth: Float,
    val ringArc: Float,
    val ringSeconds: Double,
    val dot: FloatArray,
    internal val iconX: Double,
    internal val iconY: Double,
    internal val iconScale: Double,
    internal val byHat: Map<String, String>,
    internal val fallback: String,
    internal val signals: Map<String, Signal>,
    internal val small: FloatArray?,
    val motion: TileMotion? = null,
) {
    /** A bot's colour (0xRRGGBB) as the tile shows it: mixed [by] of the way towards [toward], channel by channel, as on the web page. */
    fun muted(rgb: Int): Int {
        fun ch(v: Int, shift: Int) = (v shr shift) and 0xff
        fun mix(shift: Int) = Math.round(ch(rgb, shift) + (ch(toward, shift) - ch(rgb, shift)) * by.toDouble()).toInt().coerceIn(0, 255) shl shift
        return mix(16) or mix(8) or mix(0)
    }
}

/**
 * How a tile moves once when its bot's state changes (ADR 169, the definition's tile.motion), times in seconds. The
 * easings are cubic-bezier points ([x1, y1, x2, y2]); the done fractions are of [doneSeconds].
 */
class TileMotion internal constructor(
    internal val out: FloatArray,
    internal val inn: FloatArray,
    internal val settle: FloatArray,
    internal val ringIn: Double,
    internal val ringOut: Double,
    internal val dotIn: Double,
    internal val dotOut: Double,
    internal val pulseStates: Set<String>,
    internal val pulseAfter: Double,
    internal val pulseSeconds: Double,
    val pulseGrow: Float,
    val pulseWidth: Float,
    internal val doneFrom: String,
    internal val doneTo: String,
    internal val doneSeconds: Double,
    internal val doneIcon: FloatArray,
    internal val doneDraw: FloatArray,
    internal val doneHold: FloatArray,
    val doneWidth: Float,
    /** The check of a run that ended well: points in the box's units, joined by straight lines. */
    val check: List<Pair<Float, Float>>,
    internal val fade: Double,
    internal val still: Double,
    val press: Float,
) {
    /** The longest any move lasts: after it a change shows nothing more. */
    internal val longest: Double = maxOf(ringIn, ringOut, dotIn, dotOut, pulseAfter + pulseSeconds, doneSeconds, fade)
}

/**
 * What a tile shows part of the way through a move, as the web page's CSS does: [ring] and [ringWas] the strength of
 * the new and the old state's ring, [dot] and [dotWas] the size of the new and the old dot (or their strength when
 * [dotFades], under reduced motion), [pulse] how far the pulse has gone (null: none), [icon] the icon's strength,
 * [check] how much of the check is drawn and [checkAlpha] its strength, [opacity] the tile's while it changes. The old
 * state's colours are [ringWasColor] and [dotWasColor] (0xRRGGBB).
 */
data class Moment(
    val ring: Float = 1f,
    val ringWas: Float = 0f,
    val ringWasColor: Int? = null,
    val dot: Float = 1f,
    val dotWas: Float = 0f,
    val dotWasColor: Int? = null,
    val dotFades: Boolean = false,
    val pulse: Float? = null,
    val icon: Float = 1f,
    val check: Float = 0f,
    val checkAlpha: Float = 0f,
    val opacity: Float? = null,
)

/** A cubic-bezier easing ([p]: x1, y1, x2, y2) at [x] from 0 to 1, as CSS draws it. */
internal fun eased(p: FloatArray, x: Double): Float {
    val t0 = x.coerceIn(0.0, 1.0)
    fun bez(a: Float, b: Float, t: Double) = 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t
    var lo = 0.0
    var hi = 1.0
    var t = t0
    repeat(40) { // the t whose x is x, found by halves: x grows with t for every easing a definition may give
        if (bez(p[0], p[2], t) < t0) lo = t else hi = t
        t = (lo + hi) / 2
    }
    return bez(p[1], p[3], t).toFloat()
}

/** A value along straight lines through [stops] (fraction, value), held before the first and after the last. */
private fun along(f: Double, vararg stops: Pair<Double, Float>): Float {
    if (f <= stops.first().first) return stops.first().second
    for (i in 1 until stops.size) {
        val (a, va) = stops[i - 1]
        val (b, vb) = stops[i]
        if (f <= b) return if (b <= a) vb else va + (vb - va) * ((f - a) / (b - a)).toFloat()
    }
    return stops.last().second
}

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
    private val headSmall: FloatArray,
    /** The tile, when the definition has one: then a bot is drawn as it, not as the head. */
    val tile: FigureTile? = null,
    private val icons: Map<String, JsonElement> = emptyMap(),
    private val iconOrigin: Pair<Double, Double> = 0.0 to 0.0,
) {
    /** The part of the box (x, y, width, height) that fills the small mark: the tile's, the head's, or the whole box. */
    val small: FloatArray get() = tile?.small ?: headSmall

    /** What an outfit puts on the figure: its icon when the definition has a tile, else its hat. */
    fun wears(outfit: JsonElement?): List<Mark> = if (tile != null) icon(outfit) else hat(outfit)

    /** What the state adds to the tile (null: nothing, or no tile). */
    fun signal(state: String?): Signal? = tile?.signals?.get(stateName(state))

    /**
     * What the tile shows [ago] seconds after the bot's state changed from [from] to [to] ([still]: animations off,
     * so what appears or goes only fades), or null when nothing moves any more (or the definition has no motion).
     */
    fun moment(from: String, to: String, ago: Double, still: Boolean): Moment? {
        val m = tile?.motion ?: return null
        val a = stateName(from)
        val b = stateName(to)
        if (a == b || ago < 0 || ago >= m.longest) return null
        val was = signal(a)
        val now = signal(b)
        var out = Moment()
        var moves = false
        fun part(seconds: Double) = ago / (if (still) m.still else seconds)
        if (now?.ring != null && was?.ring == null && part(m.ringIn) < 1) { out = out.copy(ring = eased(m.out, part(m.ringIn))); moves = true }
        if (was?.ring != null && now?.ring == null && part(m.ringOut) < 1) { out = out.copy(ringWas = 1 - eased(m.inn, part(m.ringOut)), ringWasColor = was.ring); moves = true }
        if (now?.dot != null && was?.dot == null && part(m.dotIn) < 1) { out = out.copy(dot = if (still) eased(m.out, part(m.dotIn)) else eased(m.settle, part(m.dotIn)), dotFades = still); moves = true }
        if (was?.dot != null && now?.dot == null && part(m.dotOut) < 1) { out = out.copy(dotWas = 1 - eased(m.inn, part(m.dotOut)), dotWasColor = was.dot, dotFades = still); moves = true }
        if (!still && now?.dot != null && b in m.pulseStates && ago < m.pulseAfter + m.pulseSeconds) {
            out = out.copy(pulse = if (ago < m.pulseAfter) 0f else eased(m.out, (ago - m.pulseAfter) / m.pulseSeconds))
            moves = true
        }
        if (a == m.doneFrom && b == m.doneTo && ago < m.doneSeconds) {
            val f = ago / m.doneSeconds
            val (d0, d1) = m.doneDraw[0].toDouble() to m.doneDraw[1].toDouble()
            val (h0, h1) = m.doneHold[0].toDouble() to m.doneHold[1].toDouble()
            val lit = if (still) minOf(d0 + m.still / m.doneSeconds, h0) else d0
            out = out.copy(
                icon = along(f, 0.0 to 1f, m.doneIcon[0].toDouble() to 0f, m.doneIcon[1].toDouble() to 0f, 1.0 to 1f),
                check = if (still) 1f else if (f < d0) 0f else eased(m.out, (f - d0) / (d1 - d0)),
                checkAlpha = if (still) along(f, d0 to 0f, lit to 1f, h0 to 1f, h1 to 0f) else along(f, 0.0 to 0f, d0 to 1f, h0 to 1f, h1 to 0f),
            )
            moves = true
        }
        val oa = opacity(a)
        val ob = opacity(b)
        if (oa != ob && ago < m.fade) { out = out.copy(opacity = oa + (ob - oa) * eased(m.out, ago / m.fade)); moves = true }
        return out.takeIf { moves }
    }

    /**
     * The icon on the tile for an outfit ({ icon, hat }, or [CHIEF]): the one it names, or the one its hat stands for, or
     * the default; placed on the tile. One this app can't draw gives no marks, and the tile is drawn without it.
     */
    fun icon(outfit: JsonElement?): List<Mark> {
        val t = tile ?: return emptyList()
        val o = (if (outfit == CHIEF) chief else outfit) as? JsonObject
        fun named(key: String) = (o?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content
        val name = listOf(named("icon"), named("hat")?.let { t.byHat[it] }, t.fallback).firstOrNull { it != null && icons.containsKey(it) } ?: return emptyList()
        val shapes = ((icons[name] as? JsonObject)?.get("shapes") as? JsonArray) ?: return emptyList()
        val put = Put(t.iconX - t.iconScale * iconOrigin.first, t.iconY - t.iconScale * iconOrigin.second, t.iconScale)
        return runCatching { shapes.map { markOf(it, HAT_TONES, put) } }.getOrDefault(emptyList())
    }

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
        if (tile != null) return floatArrayOf(0f, 0f, box.first, box.second) // the tile's corners lie inside the circle the box holds
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
            val iconKit = (d["kit"] as? JsonObject)?.get("icon") as? JsonObject
            val tile = d["tile"]?.let { tileOf(it, states.keys) }
            return FigureDef(box.first.toFloat() to box.second.toFloat(), head, white, ink, pivotHead, pivotEyes, states, default, hats, chief, FloatArray(4) { small[it].toFloat() },
                tile, (iconKit?.get("pieces") as? JsonObject).orEmpty(), iconKit?.pair("origin") ?: (0.0 to 0.0))
        }

        /** The tile, checked whole as the web page checks it: one this app can't draw is refused, and the definition with it. */
        private fun tileOf(el: JsonElement, states: Set<String>): FigureTile {
            val t = el as? JsonObject ?: fail("tile: rect must be { x, y, w, h, r }")
            fun hex(v: String?) = v?.takeIf { HEX.matches(it) }?.drop(1)?.toInt(16)
            val r = t["rect"] as? JsonObject
            val rect = listOf("x", "y", "w", "h", "r").map { r?.num(it) }
            if (rect.any { it == null } || rect[2]!! <= 0 || rect[3]!! <= 0 || rect[4]!! < 0) fail("tile: rect must be { x, y, w, h, r }")
            val mute = t["mute"] as? JsonObject
            val toward = hex(mute?.text("toward")) ?: fail("tile: mute must be { toward, by }")
            val by = mute?.num("by")?.takeIf { it in 0.0..1.0 } ?: fail("tile: mute must be { toward, by }")
            val icon = t["icon"] as? JsonObject
            val at = icon?.pair("at") ?: fail("tile: icon must be { at, scale }")
            val scale = icon.num("scale")?.takeIf { it > 0 } ?: fail("tile: icon must be { at, scale }")
            val ink = hex(t.text("ink")) ?: fail("tile: ink must be #rrggbb")
            val ring = t["ring"] as? JsonObject
            val ringV = listOf("r", "width", "arc", "seconds").map { ring?.num(it) }
            if (ringV.any { it == null } || ringV[0]!! <= 0 || ringV[3]!! <= 0 || ringV[2]!! <= 0 || ringV[2]!! > 1) fail("tile: ring must be { r, width, arc, seconds }")
            val dotO = t["dot"] as? JsonObject
            val dot = listOf("cx", "cy", "r", "gap").map { dotO?.num(it) }
            if (dot.any { it == null } || dot[2]!! <= 0) fail("tile: dot must be { cx, cy, r, gap }")
            val signals = (t["states"] as? JsonObject).orEmpty().mapValues { (name, v) ->
                val o = v as? JsonObject
                if (o == null || o.keys.any { it != "ring" && it != "dot" }) fail("tile: the state $name is { ring } or { dot }, a #rrggbb")
                val ringC = o["ring"]?.let { hex((it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content) ?: fail("tile: the state $name is { ring } or { dot }, a #rrggbb") }
                val dotC = o["dot"]?.let { hex((it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content) ?: fail("tile: the state $name is { ring } or { dot }, a #rrggbb") }
                Signal(ringC, dotC)
            }
            val small = t["small"]?.let { s ->
                ((s as? JsonObject)?.get("view") as? JsonArray)?.takeIf { it.size == 4 }?.map { (it as? JsonPrimitive)?.number() ?: fail("tile: small.view must be [x, y, width, height]") }
                    ?.takeIf { it[2] > 0 && it[3] > 0 }?.let { v -> FloatArray(4) { v[it].toFloat() } } ?: fail("tile: small.view must be [x, y, width, height]")
            }
            val byHat = (t["byHat"] as? JsonObject).orEmpty().mapNotNull { (k, v) -> (v as? JsonPrimitive)?.takeIf { it.isString }?.let { k to it.content } }.toMap()
            val motion = t["motion"]?.let { motionOf(it, states) }
            return FigureTile(FloatArray(5) { rect[it]!!.toFloat() }, toward, by.toFloat(), ink, ringV[0]!!.toFloat(), ringV[1]!!.toFloat(), ringV[2]!!.toFloat(), ringV[3]!!,
                FloatArray(4) { dot[it]!!.toFloat() }, at.first, at.second, scale, byHat, t.text("default").orEmpty(), signals, small, motion)
        }

        /** The tile's motion, checked as the web page checks it ([states]: the definition's state names). */
        private fun motionOf(el: JsonElement, states: Set<String>): TileMotion {
            val m = el as? JsonObject ?: fail("tile: motion.easing must be { out, in, settle }, each [x1, y1, x2, y2]")
            fun nums(o: JsonObject?, key: String, n: Int) = ((o?.get(key)) as? JsonArray)?.takeIf { it.size == n }?.map { (it as? JsonPrimitive)?.number() }?.takeIf { l -> l.all { it != null } }?.map { it!! }
            val easing = m["easing"] as? JsonObject
            val curves = listOf("out", "in", "settle").map { k -> nums(easing, k, 4)?.takeIf { it[0] in 0.0..1.0 && it[2] in 0.0..1.0 } ?: fail("tile: motion.easing must be { out, in, settle }, each [x1, y1, x2, y2]") }
            fun secs(v: Double?) = v?.takeIf { it > 0 && it <= 5 }
            val ring = m["ring"] as? JsonObject
            val dotM = m["dot"] as? JsonObject
            val times = listOf(ring?.num("in"), ring?.num("out"), dotM?.num("in"), dotM?.num("out"), m.num("fade"), m.num("still")).map { secs(it) ?: fail("tile: motion must give ring { in, out }, dot { in, out }, fade and still in seconds") }
            val p = m["pulse"] as? JsonObject
            val pulseStates = (p?.get("states") as? JsonArray)?.map { (it as? JsonPrimitive)?.takeIf { s -> s.isString }?.content ?: fail("tile: motion.pulse must be { states, after, seconds, grow, width }") }
            val after = p?.num("after")?.takeIf { it >= 0 }
            val pSecs = secs(p?.num("seconds"))
            val grow = p?.num("grow")?.takeIf { it > 1 }
            val pWidth = p?.num("width")?.takeIf { it > 0 }
            if (pulseStates == null || after == null || pSecs == null || grow == null || pWidth == null) fail("tile: motion.pulse must be { states, after, seconds, grow, width }")
            val d = m["done"] as? JsonObject
            fun part(key: String) = nums(d, key, 2)?.takeIf { it[0] >= 0 && it[0] <= it[1] && it[1] <= 1 }
            val from = d?.text("from")?.takeIf { it in states }
            val to = d?.text("to")?.takeIf { it in states }
            val dSecs = secs(d?.num("seconds"))
            val icon = part("icon")
            val draw = part("draw")
            val hold = part("hold")
            val dWidth = d?.num("width")?.takeIf { it > 0 }
            if (from == null || to == null || dSecs == null || icon == null || draw == null || hold == null || dWidth == null) fail("tile: motion.done must be { from, to (two states), seconds, icon, draw, hold, width, check }")
            val check = (d?.get("check") as? JsonArray)?.map { c ->
                val a = c as? JsonArray
                val op = (a?.getOrNull(0) as? JsonPrimitive)?.takeIf { it.isString }?.content
                val x = (a?.getOrNull(1) as? JsonPrimitive)?.number()
                val y = (a?.getOrNull(2) as? JsonPrimitive)?.number()
                if (a == null || a.size != 3 || (op != "M" && op != "L") || x == null || y == null) fail("tile: motion.done.check is a path of M and L")
                op to (x.toFloat() to y.toFloat())
            }
            if (check == null || check.size < 2 || check[0].first != "M") fail("tile: motion.done.check is a path of M and L")
            val press = m.num("press")?.takeIf { it > 0.5 && it <= 1 } ?: fail("tile: motion.press is how large a pressed tile is drawn, 0.5 to 1")
            fun floats(l: List<Double>) = FloatArray(l.size) { l[it].toFloat() }
            return TileMotion(floats(curves[0]), floats(curves[1]), floats(curves[2]), times[0], times[1], times[2], times[3], pulseStates.toSet(), after, pSecs, grow.toFloat(), pWidth.toFloat(),
                from, to, dSecs, floats(icon), floats(draw), floats(hold), dWidth.toFloat(), check.map { it.second }, times[4], times[5], press.toFloat())
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
