package dev.botdot.app.data

/**
 * A bot's mark as a list of things to paint, in the definition's own units, for a phone that paints them as they
 * come (the iOS app's Canvas, ADR 242): what Android's ui/BotFigure.kt drawFigure draws, still (no movement yet).
 * The tile in the bot's muted colour with its icon and the ring or dot of its state; without a tile, the head with
 * its face and hat, each layer in its place. public/figure.js is the reference.
 */
object FigurePaint {
    /** One thing to paint. [color] is 0xRRGGBB; [stroke] null fills it, else it is a line that wide. */
    sealed interface Op {
        /** A circle; [cut]: it clears what was painted under it (the gap around a tile's dot). */
        data class Circle(val x: Float, val y: Float, val r: Float, val color: Int, val stroke: Float? = null, val cut: Boolean = false) : Op
        /** A path of [steps] (M, L, Q, C, Z with their points), filled or stroked with round ends. */
        class Shape(val steps: List<Step>, val color: Int, val stroke: Float? = null) : Op
        class RoundRect(val x: Float, val y: Float, val width: Float, val height: Float, val radius: Float, val color: Int) : Op
        /** An arc of the circle at ([x], [y]) of radius [r], from [start] degrees for [sweep] degrees (0 is right, clockwise). */
        class Arc(val x: Float, val y: Float, val r: Float, val start: Float, val sweep: Float, val color: Int, val width: Float) : Op
        /** What follows until [Pop] is moved: a point (x, y) goes to (a·x + c·y + e, b·x + d·y + f). */
        class Push(val a: Float, val b: Float, val c: Float, val d: Float, val e: Float, val f: Float) : Op
        data object Pop : Op
    }

    /** What to paint: the part [view] (x, y, width, height) of the definition fills the canvas, faded to [opacity]. */
    class Drawing(val view: List<Float>, val opacity: Float, val ops: List<Op>)

    /** A bot's mark in its [state] (null: the default), as on Home. [dark]: drawn on a dark background. */
    fun figure(def: FigureDef, color: String?, state: String?, outfit: kotlinx.serialization.json.JsonElement?, dark: Boolean = true): Drawing {
        val tones = tones(def, color, dark)
        val hat = def.wears(outfit)
        val ops = mutableListOf<Op>()
        val tile = def.tile
        if (tile != null) tile(tile, hat, tones, def.signal(state), def.box, ops)
        else head(def, def.face(state), def.layers(state), hat, tones, ops)
        return Drawing(listOf(0f, 0f, def.box.first, def.box.second), def.opacity(state), ops)
    }

    /** The small mark beside a name and in Needs you: the head and its hat (or the tile and its icon), no face, no state. */
    fun small(def: FigureDef, color: String?, outfit: kotlinx.serialization.json.JsonElement?, dark: Boolean = true): Drawing {
        val tones = tones(def, color, dark)
        val hat = def.wears(outfit)
        val ops = mutableListOf<Op>()
        val tile = def.tile
        if (tile != null) tile(tile, hat, tones, null, def.box, ops) else head(def, null, null, hat, tones, ops)
        return Drawing(def.small.toList(), 1f, ops)
    }

    /** A colour as the apps take it: "#RRGGBB" (or "#AARRGGBB", its alpha left out) as 0xRRGGBB; null for anything else. */
    fun colorOf(hex: String?): Int? {
        val h = hex?.trim()?.removePrefix("#") ?: return null
        if (h.length != 6 && h.length != 8) return null
        return h.takeLast(6).toIntOrNull(16)
    }

    /** A bot's tones: its colour (grey without one), its deep tone on this background, and the definition's white and ink. */
    private class Tones(val main: Int, val deep: Int, val white: Int, val ink: Int) {
        fun of(t: Tone) = when (t) { Tone.MAIN -> main; Tone.DEEP -> deep; Tone.WHITE -> white; Tone.INK -> ink }
    }

    private fun tones(def: FigureDef, color: String?, dark: Boolean): Tones {
        val main = colorOf(color) ?: FigureDef.GREY
        return Tones(main, FigureDef.deep(main, dark), def.white, def.ink)
    }

    private fun tile(t: FigureTile, icon: List<Mark>, tones: Tones, signal: Signal?, box: Pair<Float, Float>, ops: MutableList<Op>) {
        val r = t.rect
        ops += Op.RoundRect(r[0], r[1], r[2], r[3], r[4], t.muted(tones.main))
        marks(icon, Tones(t.ink, t.ink, t.ink, t.ink), ops)
        val d = t.dot
        signal?.dot?.let { dot ->
            ops += Op.Circle(d[0], d[1], d[2] + d[3], 0, cut = true) // the gap: what is behind shows through
            ops += Op.Circle(d[0], d[1], d[2], dot)
        }
        signal?.ring?.let { ring ->
            // Still: the arc starts at the top, as the web page draws it before it turns.
            ops += Op.Arc(box.first / 2, box.second / 2, t.ringR, -90f, t.ringArc * 360f, ring, t.ringWidth)
        }
    }

    private fun head(def: FigureDef, face: Face?, layers: Layers?, hat: List<Mark>, tones: Tones, ops: MutableList<Op>) {
        layer(layers?.head, def.pivotHead, ops) {
            marks(listOf(def.head), tones, ops)
            if (face != null) layer(layers?.eyes, def.pivotEyes, ops) {
                marks(face.eyes, tones, ops)
                layer(layers?.pupils, 0.0 to 0.0, ops) { marks(face.pupils, tones, ops) }
            }
            marks(hat, tones, ops) // last: over the head and the face
        }
    }

    private val REST = Place()

    private inline fun layer(place: Place?, pivot: Pair<Double, Double>, ops: MutableList<Op>, draw: () -> Unit) {
        if (place == null || place == REST) return draw()
        val m = place.matrix(pivot.first, pivot.second)
        ops += Op.Push(m[0], m[1], m[2], m[3], m[4], m[5])
        draw()
        ops += Op.Pop
    }

    private fun marks(marks: List<Mark>, tones: Tones, ops: MutableList<Op>) {
        for (m in marks) when (m) {
            is Mark.Disc -> {
                m.fill?.let { ops += Op.Circle(m.x, m.y, m.r, tones.of(it)) }
                m.stroke?.let { ops += Op.Circle(m.x, m.y, m.r, tones.of(it), stroke = m.width) }
            }
            is Mark.Outline -> {
                m.fill?.let { ops += Op.Shape(m.steps, tones.of(it)) }
                m.stroke?.let { ops += Op.Shape(m.steps, tones.of(it), stroke = m.width) }
            }
        }
    }
}
