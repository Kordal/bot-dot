package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** A bot's head, drawn from the definition the app bundles: the server's own lib/figure.json (ADR 003, ADR 004). */
class FigureTest {
    private val text = File(System.getProperty("figureDefinition") ?: "../../lib/figure.json").readText()
    private val raw = Json.parseToJsonElement(text).jsonObject
    private val def = FigureDef.parse(text)
    private val six = listOf("idle", "working", "waiting", "needs_you", "failed", "paused")

    private fun json(s: String): JsonElement = Json.parseToJsonElement(s)
    private fun changed(change: (MutableMap<String, JsonElement>) -> Unit) = JsonObject(raw.toMutableMap().also(change)).toString()
    private fun same(a: Float, b: Double) = assertEquals(b, a.toDouble(), 0.001)
    private fun discs(marks: List<Mark>) = marks.filterIsInstance<Mark.Disc>()
    private fun ops(m: Mark) = (m as? Mark.Outline)?.steps?.joinToString("") { it.op.toString() }
    private fun state(name: String) = raw["states"]!!.jsonObject[name]!!.jsonObject
    private fun hats() = raw["kit"]!!.jsonObject["hat"]!!.jsonObject["pieces"]!!.jsonObject
    /** Where a point of a pupil ends up: through the pupils' layer, then the eyes', then the head's. */
    private fun through(l: Layers, x: Double, y: Double): Pair<Double, Double> {
        var p = x to y
        for ((place, pivot) in listOf(l.pupils to (0.0 to 0.0), l.eyes to def.pivotEyes, l.head to def.pivotHead)) {
            val m = place.matrix(pivot.first, pivot.second)
            p = (m[0] * p.first + m[2] * p.second + m[4]) to (m[1] * p.first + m[3] * p.second + m[5])
        }
        return p
    }

    @Test fun `a bot's picture holds its head, and its hat whole, inside the circle a notification crops it to`() {
        // Each point of a mark, with the room its stroke takes.
        fun reach(marks: List<Mark>) = marks.flatMap { m ->
            when (m) {
                is Mark.Disc -> listOf(Triple(m.x, m.y, m.r + m.width / 2))
                is Mark.Outline -> m.steps.flatMap { s -> (0 until s.at.size / 2).map { Triple(s.at[2 * it], s.at[2 * it + 1], m.width / 2) } }
            }
        }
        fun holds(view: FloatArray, marks: List<Mark>) {
            assertEquals("a square", view[2], view[3], 0.001f)
            val (cx, cy, r) = Triple(view[0] + view[2] / 2, view[1] + view[3] / 2, view[2] / 2)
            for ((x, y, room) in reach(marks)) assertTrue("($x, $y) is inside", kotlin.math.hypot(x - cx, y - cy) + room <= r + 0.001f)
        }
        // Without a hat (never given one, taken off, or one this app can't draw): the bare head fills the picture.
        for (outfit in listOf(null, json("""{"hat":""}"""), json("""{"hat":"no-such-hat"}"""))) {
            assertArrayEquals(floatArrayOf(4.5f, 9f, 15f, 15f), def.portrait(def.hat(outfit)), 0.001f)
        }
        // With a hat: the head and every shape of the hat, the head no larger than bare.
        for (name in hats().keys) {
            val hat = def.hat(json("""{"hat":"$name"}"""))
            val view = def.portrait(hat)
            holds(view, listOf<Mark>(def.head) + hat)
            assertTrue(name, view[2] >= 15f)
        }
        val chief = def.portrait(def.hat(FigureDef.CHIEF))
        holds(chief, listOf<Mark>(def.head) + def.hat(FigureDef.CHIEF))
        assertTrue("the top hat reaches above the head", chief[1] < 9f && chief[2] > 15f)
        // A hat the Chief drew, and the built-in bare head.
        val drawn = def.hat(json("""{"hat":{"shapes":[{"shape":"line","x1":1,"y1":1,"x2":9,"y2":1,"stroke":"deep","width":2}]}}"""))
        holds(def.portrait(drawn), listOf<Mark>(def.head) + drawn)
        assertArrayEquals(floatArrayOf(4.5f, 9f, 15f, 15f), FigureDef.BARE.portrait(emptyList()), 0.001f)
    }

    @Test fun `the bundled definition parses - the head, the tones, the six states, every kit hat and the Chief's`() {
        assertEquals(24f to 24f, def.box)
        assertEquals(Mark.Disc(12f, 16.5f, 7.5f, Tone.MAIN, null, 0f), def.head)
        assertEquals(0xffffff, def.white)
        assertEquals(0x24231f, def.ink)
        assertEquals(12.0 to 16.5, def.pivotHead)
        assertEquals(12.0 to 17.1, def.pivotEyes)
        for (s in six) assertEquals(s, def.stateName(s))
        // Every kit hat can be drawn by this app, shape for shape.
        assertTrue(hats().size >= 20)
        for ((name, piece) in hats()) assertEquals(name, piece.jsonObject["shapes"]!!.jsonArray.size, def.hat(json("""{"hat":"$name"}""")).size)
        // The Chief of Staff wears the hat the definition gives it.
        val chief = raw["chief"]!!.jsonObject["outfit"]!!
        assertTrue(def.hat(FigureDef.CHIEF).isNotEmpty())
        assertEquals(def.hat(chief).size, def.hat(FigureDef.CHIEF).size)
    }

    @Test fun `each state's face is the definition's, shape for shape`() {
        for (s in six) {
            val face = def.face(s)
            assertEquals(s, state(s)["eyes"]!!.jsonArray.size, face.eyes.size)
            assertEquals(s, state(s)["pupils"]!!.jsonArray.size, face.pupils.size)
        }
        // Idle: two white eyes, two ink pupils in their middle.
        assertEquals(listOf(Mark.Disc(8.8f, 17.1f, 2.2f, Tone.WHITE, null, 0f), Mark.Disc(15.2f, 17.1f, 2.2f, Tone.WHITE, null, 0f)), def.face("idle").eyes)
        assertEquals(listOf(Mark.Disc(8.8f, 17.1f, 1.2f, Tone.INK, null, 0f), Mark.Disc(15.2f, 17.1f, 1.2f, Tone.INK, null, 0f)), def.face("idle").pupils)
        // Working: eyes flat on top under two ink brows. Needs you: wide eyes. They differ in shape and in size.
        assertEquals(listOf("MLQQZ", "MLQQZ", "ML", "ML"), def.face("working").eyes.map(::ops))
        assertEquals(listOf(Tone.WHITE, Tone.WHITE, null, null), def.face("working").eyes.map { it.fill })
        assertEquals(listOf(null, null, Tone.INK, Tone.INK), def.face("working").eyes.map { it.stroke })
        assertEquals(1.4f, def.face("working").eyes[2].width)
        assertEquals(listOf(3.5f, 3.5f), discs(def.face("needs_you").eyes).map { it.r })
        // Failed: ink crosses and no pupils. Paused: two closed lids, and the whole mark faded.
        assertEquals(listOf("ML", "ML", "ML", "ML"), def.face("failed").eyes.map(::ops))
        assertTrue(def.face("failed").pupils.isEmpty())
        assertEquals(listOf("MQ", "MQ"), def.face("paused").eyes.map(::ops))
        assertEquals(0.4f, def.opacity("paused"))
        assertEquals(1f, def.opacity("idle"))
        // No two states share a face.
        fun key(m: Mark) = if (m is Mark.Disc) m.toString() else ops(m) + (m as Mark.Outline).steps.joinToString { it.at.joinToString() }
        assertEquals(6, six.map { s -> (def.face(s).eyes + def.face(s).pupils).joinToString(transform = ::key) }.toSet().size)
    }

    @Test fun `the still pose of each state is the definition's, and what a pose leaves out rests`() {
        val rest = Place()
        assertEquals(Place(0.0, 0.0, 0.0, 1.0, 1.0), rest)
        for (s in listOf("idle", "needs_you", "paused")) def.layers(s).let { l -> assertEquals(s, listOf(rest, rest, rest), listOf(l.head, l.eyes, l.pupils)) }
        def.layers("working").let { l -> assertEquals(listOf(rest, rest, Place(moveX = -1.1)), listOf(l.head, l.eyes, l.pupils)) }
        def.layers("waiting").let { l -> assertEquals(listOf(Place(turn = -6.0), Place(2.0, -0.5), Place(1.0, -0.5)), listOf(l.head, l.eyes, l.pupils)) }
        def.layers("failed").let { l -> assertEquals(listOf(Place(turn = 12.0), rest, rest), listOf(l.head, l.eyes, l.pupils)) }
    }

    @Test fun `a layer puts a point at move + pivot + R(turn) S(scale) (p - pivot)`() {
        assertArrayEquals(floatArrayOf(1f, 0f, 0f, 1f, 0f, 0f), Place().matrix(12.0, 16.5), 0f)
        assertArrayEquals(floatArrayOf(1f, 0f, 0f, 1f, 3f, -2f), Place(3.0, -2.0).matrix(12.0, 16.5), 0f)
        // A blink: the eyes close to a tenth of their height about the middle between them.
        val blink = Place(scaleY = 0.1).matrix(12.0, 17.1)
        assertArrayEquals(floatArrayOf(1f, 0f, 0f, 0.1f, 0f, 15.39f), blink, 1e-5f)
        assertEquals(17.1 - 0.22, blink[3] * (17.1 - 2.2) + blink[5], 1e-5) // the top of an eye, now 0.22 above the middle
        // A quarter turn clockwise on screen (y goes down): what was to the right of the pivot is now below it.
        val m = Place(1.0, 2.0, turn = 90.0).matrix(12.0, 16.5)
        assertEquals(12.0 + 1.0, m[0] * 15.0 + m[2] * 16.5 + m[4], 1e-5)
        assertEquals(16.5 + 2.0 + 3.0, m[1] * 15.0 + m[3] * 16.5 + m[5], 1e-5)
        // A pupil goes through all three: waiting moves it with the pupils, then with the eyes, then the head leans.
        val (x, y) = through(def.layers("waiting"), 8.7, 17.1)
        val lean = Math.toRadians(-6.0)
        val (dx, dy) = (8.7 + 1 + 2 - 12) to (17.1 - 0.5 - 0.5 - 16.5)
        assertEquals(12 + dx * Math.cos(lean) - dy * Math.sin(lean), x, 1e-5)
        assertEquals(16.5 + dx * Math.sin(lean) + dy * Math.cos(lean), y, 1e-5)
    }

    @Test fun `a movement goes from key to key with the web page's easing, each number on its own, and loops`() {
        assertEquals(0.0, FigureDef.easeInOut(0.0), 0.0)
        assertEquals(0.5, FigureDef.easeInOut(0.5), 1e-6)
        assertEquals(1.0, FigureDef.easeInOut(1.0), 0.0)
        assertEquals(0.1292, FigureDef.easeInOut(0.25), 0.0005) // cubic-bezier(.42, 0, .58, 1) in a browser
        assertEquals(0.8708, FigureDef.easeInOut(0.75), 0.0005)
        // Working, 1.4 s a loop: the pupils go from -1.1 to 1.1 and back; a quarter of the way in time between two
        // keys they are 0.1292 of the way.
        assertEquals(-1.1, def.layers("working", 0.0).pupils.moveX, 1e-9)
        assertEquals(0.0, def.layers("working", 0.35).pupils.moveX, 1e-6)
        assertEquals(-1.1 + 2.2 * FigureDef.easeInOut(0.25), def.layers("working", 0.175).pupils.moveX, 1e-9)
        assertEquals(1.1, def.layers("working", 0.7).pupils.moveX, 1e-9)
        assertEquals(def.layers("working", 0.3).pupils.moveX, def.layers("working", 0.3 + 7 * 1.4).pupils.moveX, 1e-6) // seven loops on
        // Idle, 5 s: open until 4.5 s, closed to a tenth at 4.7 s, open again at 5 s. Only the eyes' height changes.
        for (t in listOf(0.0, 2.0, 4.5)) assertEquals(Place(), def.layers("idle", t).eyes)
        assertEquals(0.1, def.layers("idle", 4.7).eyes.scaleY, 1e-9)
        assertEquals(1.0, def.layers("idle", 4.7).eyes.scaleX, 0.0)
        assertEquals(1 - 0.9 * FigureDef.easeInOut(0.5), def.layers("idle", 4.6).eyes.scaleY, 1e-9)
        // Needs you bobs its head up 1.4 and holds from 0.63 s; failed sways from 12 to 16 degrees.
        assertEquals(-1.4, def.layers("needs_you", 0.315).head.moveY, 1e-9)
        assertEquals(0.0, def.layers("needs_you", 0.8).head.moveY, 1e-9)
        assertEquals(16.0, def.layers("failed", 2.0).head.turn, 1e-9)
        assertEquals(14.0, def.layers("failed", 1.0).head.turn, 1e-6)
        // Waiting keeps its pose's look to the side through its glance down: a key overrides only what it names.
        val glance = def.layers("waiting", 0.88 * 6)
        assertEquals(1.0, glance.pupils.moveX, 0.0)
        assertEquals(0.7, glance.pupils.moveY, 1e-6)
        assertEquals(Place(2.0, -0.5), glance.eyes)
        assertEquals(-6.0, glance.head.turn, 0.0)
        // Paused never moves.
        assertEquals(def.layers("paused").eyes, def.layers("paused", 3.3).eyes)
    }

    @Test fun `an idle head asks for frames only while it blinks, a paused one for none`() {
        assertNull(def.nextMove("paused", 12.0))
        // Idle holds from 0 to 4.5 s of its 5 s, then closes its eyes (0.2 s) and opens them (0.3 s).
        fun near(wait: Double, run: Double, at: Double) = def.nextMove("idle", at)!!.let { (w, r) -> assertEquals("wait at $at", wait, w, 1e-9); assertEquals("run at $at", run, r, 1e-9) }
        near(4.5, 0.2, 0.0)
        near(1.5, 0.2, 3.0)
        near(1.5, 0.2, 103.0) // twenty loops on
        near(0.0, 0.1, 4.6)
        near(0.0, 0.25, 4.75)
        near(0.0, 0.1, 4.9)
        // Working never holds: it is moving now, until its next key.
        def.nextMove("working", 0.0)!!.let { (w, r) -> assertEquals(0.0, w, 0.0); assertEquals(0.7, r, 1e-9) }
        assertEquals(0.0, def.nextMove("working", 1.0)!!.first, 0.0)
        // Needs you holds from 0.63 s to the loop's end, then moves again from the start of the next loop.
        def.nextMove("needs_you", 0.7)!!.let { (w, r) -> assertEquals(0.2, w, 1e-9); assertEquals(0.315, r, 1e-9) }
        // A state the definition doesn't know is idle; a movement of holds only never moves.
        assertEquals(def.nextMove("idle", 3.0), def.nextMove("dancing", 3.0))
        val held = FigureDef.parse(changed { it["states"] = JsonObject(raw["states"]!!.jsonObject + ("dozing" to json("""{"eyes":[],"pupils":[],"move":{"seconds":2,"easing":"linear","keys":[{"at":0},{"at":0.5},{"at":1}]}}"""))) })
        assertNull(held.nextMove("dozing", 0.3))
    }

    @Test fun `a state the definition doesn't know is drawn as idle`() {
        assertEquals("idle", def.stateName("dancing"))
        assertEquals("idle", def.stateName(null))
        assertEquals(def.face("idle"), def.face("dancing"))
        assertEquals(def.layers("idle", 4.7).eyes, def.layers("dancing", 4.7).eyes)
        assertEquals(1f, def.opacity("dancing"))
    }

    @Test fun `a hat sits with its origin on the top of the head, drawn as large as the definition says`() {
        // A point q of a hat lands at at + scale × (q − origin): at (12, 9), 2.6 times, origin (5, 3.5).
        val hat = def.hat(json("""{"hat":"top-hat"}"""))
        assertEquals(listOf(Tone.DEEP, Tone.DEEP, Tone.MAIN), hat.map { it.fill })
        val crown = (hat[0] as Mark.Outline).steps
        same(crown[0].at[0], 12 + 2.6 * (3.1 + 0.3 - 5)); same(crown[0].at[1], 9 + 2.6 * (0.2 - 3.5))
        // A stroke grows with the hat.
        val cowboy = def.hat(json("""{"hat":"cowboy"}"""))
        assertEquals(listOf(0.0, 1.1 * 2.6, 0.8 * 2.6).map { it.toFloat() }, cowboy.map { it.width })
        val dot = discs(def.hat(json("""{"hat":"cap"}"""))).single()
        same(dot.x, 12.0); same(dot.y, 9 + 2.6 * (3 - 3.5)); same(dot.r, 2.6 * 0.65)
    }

    @Test fun `a hat the definition lacks is skipped, and so is one with a shape or a tone this app doesn't know`() {
        for (none in listOf("null", """{"hat":""}""", "{}", """"cap"""", """{"hat":7}""", """{"hat":["cap"]}""", """{"hat":"no-such-hat"}""", """{"hat":null}""", """{"hat":{"shapes":"M0 0"}}""",
            """{"hat":{"shapes":[{"shape":"path","d":"M0 0L1 1","fill":"main"}]}}""", """{"hat":{"shapes":[{"shape":"circle","cx":"5","cy":3,"r":1,"fill":"main"}]}}""",
            """{"hat":{"shapes":[{"shape":"circle","cx":5,"cy":3,"r":1}]}}""", """{"hat":{"shapes":[{"shape":"path","d":[["M",1,1],["A",1,1]],"fill":"main"}]}}""",
            """{"hat":{"shapes":[{"shape":"path","d":[["M",1,1],["L",1]],"fill":"main"}]}}""",
            """{"hat":{"shapes":[{"shape":"circle","cx":5,"cy":3,"r":1,"fill":"main"},{"shape":"blob","fill":"main"}]}}""",
            // The white and the ink are the face's: a hat is in the bot's two tones. One tone it knows and one it doesn't is still not drawn.
            """{"hat":{"shapes":[{"shape":"circle","cx":5,"cy":3,"r":1,"fill":"white"}]}}""",
            """{"hat":{"shapes":[{"shape":"circle","cx":5,"cy":3,"r":1,"fill":"main","stroke":"gold","width":1}]}}""")) {
            assertEquals(none, emptyList<Mark>(), def.hat(json(none)))
        }
        assertEquals(emptyList<Mark>(), def.hat(null))
    }

    @Test fun `a hat the Chief drew is drawn like a kit hat, shape for shape`() {
        val inline = json("""{"hat":{"shapes":[
            {"shape":"circle","cx":5,"cy":3.5,"r":1,"fill":"deep"},
            {"shape":"rect","x":1,"y":1,"w":4,"h":2,"fill":"main"},
            {"shape":"rect","x":1,"y":1,"w":4,"h":2,"r":0.5,"stroke":"deep","width":0.8},
            {"shape":"line","x1":0,"y1":3.5,"x2":10,"y2":3.5,"stroke":"main","width":1.2},
            {"shape":"path","d":[["M",5,0],["L",6,1],["Q",7,2,6,3],["C",5,4,4,4,3,3],["Z"]],"fill":"main","stroke":"deep","width":1}
        ]}}""")
        val hat = def.hat(inline)
        assertEquals(5, hat.size)
        // Its origin (5, 3.5) lies on the top of the head.
        assertEquals(Mark.Disc(12f, 9f, 2.6f, Tone.DEEP, null, 0f), hat[0])
        assertEquals(listOf("MLLLZ", "MLCLCLCLCZ", "ML", "MLQCZ"), hat.drop(1).map(::ops))
        assertEquals(listOf(Tone.MAIN to null, null to Tone.DEEP, null to Tone.MAIN, Tone.MAIN to Tone.DEEP), hat.drop(1).map { it.fill to it.stroke })
        assertEquals(listOf(0.0, 0.8 * 2.6, 1.2 * 2.6, 2.6).map { it.toFloat() }, hat.drop(1).map { it.width })
        // A corner is rounded by at most half of each side, as SVG's rx: this one by 0.5 both ways.
        val corner = (hat[2] as Mark.Outline).steps
        same(corner[0].at[0], 12 + 2.6 * (1 + 0.5 - 5)); same(corner[2].at[5], 9 + 2.6 * (1 + 0.5 - 3.5))
        val line = (hat[3] as Mark.Outline).steps
        same(line[0].at[0], 12 - 2.6 * 5); same(line[1].at[0], 12 + 2.6 * 5); same(line[0].at[1], 9.0)
        // A straw hat of two curved outlines, as the server stores a drawn hat.
        val straw = def.hat(json("""{"hat":{"shapes":[{"shape":"path","d":[["M",0.6,4.6],["Q",5,2.6,9.4,4.6],["Q",5,5.8,0.6,4.6],["Z"]],"fill":"deep"},{"shape":"path","d":[["M",2.8,4],["Q",5,0.4,7.2,4],["Z"]],"fill":"main"}]}}"""))
        assertEquals(listOf("MQQZ", "MQZ"), straw.map(::ops))
    }

    @Test fun `a definition this app can't draw from is refused, so the app keeps the copy it has`() {
        fun refused(why: String, change: (MutableMap<String, JsonElement>) -> Unit) = assertThrows(why, IllegalArgumentException::class.java) { FigureDef.parse(changed(change)) }
        fun states(extra: String) = JsonObject(raw["states"]!!.jsonObject + ("extra" to json(extra)))
        refused("the stick figure's version") { it["version"] = json("1") }
        refused("a later version") { it["version"] = json("3") }
        refused("default") { it["default"] = json("\"toString\"") }
        refused("no head") { it.remove("head") }
        refused("no tones") { it.remove("tones") }
        refused("a tone that is not a colour") { it["tones"] = json("""{"white":"white","ink":"#24231f"}""") }
        refused("no pivot") { it.remove("pivot") }
        refused("attach") { it["attach"] = json("""{"hat":{"at":[12,9]}}""") }
        refused("no face") { it["states"] = states("""{"pose":{}}""") }
        // A face it can't draw whole: a shape kind it doesn't know, or a fill that is not one of the four tones.
        refused("a shape") { it["states"] = states("""{"eyes":[{"shape":"star","fill":"white"}],"pupils":[]}""") }
        refused("a tone") { it["states"] = states("""{"eyes":[{"shape":"circle","cx":1,"cy":1,"r":1,"fill":"gold"}],"pupils":[]}""") }
        refused("half a tone") { it["states"] = states("""{"eyes":[],"pupils":[{"shape":"circle","cx":1,"cy":1,"r":1,"fill":"ink","stroke":"gold","width":1}]}""") }
        // A pose may say only what its layer has.
        refused("the eyes don't turn") { it["states"] = states("""{"eyes":[],"pupils":[],"pose":{"eyes":{"turn":3}}}""") }
        refused("the head doesn't scale") { it["states"] = states("""{"eyes":[],"pupils":[],"pose":{"head":{"scale":[1,2]}}}""") }
        refused("the pupils only move") { it["states"] = states("""{"eyes":[],"pupils":[],"pose":{"pupils":{"scale":[1,2]}}}""") }
        refused("a move is [x, y]") { it["states"] = states("""{"eyes":[],"pupils":[],"pose":{"head":{"move":3}}}""") }
        refused("easing") { it["states"] = states("""{"eyes":[],"pupils":[],"move":{"seconds":1,"easing":"bounce","keys":[{"at":0},{"at":1}]}}""") }
        refused("a movement that is not one") { it["states"] = states("""{"eyes":[],"pupils":[],"move":true}""") }
        // The last key must say what the first says, as on the web page: restating the pose in one of them is not that.
        refused("a last key that says more than the first") { it["states"] = states("""{"eyes":[],"pupils":[],"move":{"seconds":1,"easing":"linear","keys":[{"at":0},{"at":1,"head":{"move":[0,0]}}]}}""") }
        refused("a loop that jumps") { it["states"] = states("""{"eyes":[],"pupils":[],"move":{"seconds":1,"easing":"linear","keys":[{"at":0},{"at":1,"head":{"turn":4}}]}}""") }
        refused("keys go up") { it["states"] = states("""{"eyes":[],"pupils":[],"move":{"seconds":1,"easing":"linear","keys":[{"at":0},{"at":0.6},{"at":0.4},{"at":1}]}}""") }
        refused("opacity") { it["states"] = states("""{"eyes":[],"pupils":[],"opacity":2}""") }
        assertThrows(Exception::class.java) { FigureDef.parse("<html>") }
        // Keys it doesn't know are ignored; without a kit, an attachment and a Chief's outfit, bots are heads without hats.
        val hatless = FigureDef.parse(changed { it.remove("kit"); it.remove("chief"); it.remove("attach"); it["later"] = json("""{"anything":[1,2]}""") })
        assertEquals(emptyList<Mark>(), hatless.hat(json("""{"hat":"cap"}""")))
        assertEquals(emptyList<Mark>(), hatless.hat(FigureDef.CHIEF))
        assertEquals(2, hatless.face("working").pupils.size)
        // A linear movement, and a new state, need no new version.
        val more = FigureDef.parse(changed { it["states"] = states("""{"eyes":[],"pupils":[],"pose":{"head":{"turn":10}},"move":{"seconds":2,"easing":"linear","keys":[{"at":0},{"at":0.5,"head":{"turn":30}},{"at":1}]}}""") })
        assertEquals(15.0, more.layers("extra", 0.25).head.turn, 1e-9)
    }

    /** The table the web page and the Mac are checked against too (test/fixtures/figure-cases.json). */
    @Test fun `the definitions every app must take alike are taken so here`() {
        val cases = Json.parseToJsonElement(File(System.getProperty("figureCases") ?: "../../test/fixtures/figure-cases.json").readText()).jsonObject["cases"]!!.jsonArray
        assertTrue(cases.size >= 15)
        for (c in cases.map { it.jsonObject }) {
            val what = c["what"]!!.jsonPrimitive.content
            // The state as it is written in the table: 0.0 and 1e0 reach the app as they stand.
            val text = changed { it["states"] = JsonObject(raw["states"]!!.jsonObject + ("extra" to c["state"]!!)) }
            if (!c["accepted"]!!.jsonPrimitive.boolean) {
                assertThrows(what, IllegalArgumentException::class.java) { FigureDef.parse(text) }
                continue
            }
            val read = try { FigureDef.parse(text) } catch (e: IllegalArgumentException) { throw AssertionError("$what: ${e.message}") }
            assertEquals(what, "extra", read.stateName("extra"))
            assertEquals(what, c["moves"]!!.jsonPrimitive.boolean, read.nextMove("extra", 0.0) != null)
        }
    }

    @Test fun `the deep tone is the colour mixed 45 percent towards black, or towards white on a dark background`() {
        assertEquals(0x1e4c7a, FigureDef.deep(0x378add, dark = false))
        assertEquals(0x91bfec, FigureDef.deep(0x378add, dark = true))
        assertEquals(0x000000, FigureDef.deep(0x000000, dark = false))
        assertEquals(0xffffff, FigureDef.deep(0xffffff, dark = true))
    }

    @Test fun `no definition at all - one bare head looking ahead, with no states, no movement and no hat`() {
        val bare = FigureDef.BARE
        // The numbers ADR 003 fixes for every app; the same head as the web page's built-in one (BARE in public/figure.js).
        assertEquals(24f to 24f, bare.box)
        assertEquals(Mark.Disc(12f, 16.5f, 7.5f, Tone.MAIN, null, 0f), bare.head)
        assertEquals(0xffffff to 0x24231f, bare.white to bare.ink)
        for (s in six + listOf(null, "dancing")) {
            assertEquals(listOf(Mark.Disc(8.8f, 17.1f, 2.2f, Tone.WHITE, null, 0f), Mark.Disc(15.2f, 17.1f, 2.2f, Tone.WHITE, null, 0f)), bare.face(s).eyes)
            assertEquals(listOf(Mark.Disc(8.8f, 17.1f, 1.2f, Tone.INK, null, 0f), Mark.Disc(15.2f, 17.1f, 1.2f, Tone.INK, null, 0f)), bare.face(s).pupils)
            assertEquals(1f, bare.opacity(s))
            assertNull(bare.nextMove(s, 1.0))
            assertEquals(Place(), bare.layers(s, 4.7).eyes)
        }
        assertEquals(emptyList<Mark>(), bare.hat(json("""{"hat":"cap"}""")))
        assertEquals(emptyList<Mark>(), bare.hat(FigureDef.CHIEF))
        assertEquals(listOf(0f, 0f, 24f, 24f), bare.small.toList())
    }

    @Test fun `the small mark shows the part of the box the definition says, or the whole box`() {
        assertEquals(raw["small"]!!.jsonObject["view"]!!.jsonArray.map { it.jsonPrimitive.double.toFloat() }, def.small.toList())
        same(def.smallAspect, 1.0)
        val old = FigureDef.parse(changed { it.remove("small") })
        assertEquals(listOf(0f, 0f, 24f, 24f), old.small.toList())
        val told = FigureDef.parse(changed { it["small"] = json("""{"view":[6,2,12,20]}""") })
        assertEquals(listOf(6f, 2f, 12f, 20f), told.small.toList())
        same(told.smallAspect, 0.6)
        for (bad in listOf("null", "{}", """{"view":[0,0,0,1]}""", """{"view":[0,0,1]}""", """{"view":"0 0 1 1"}""")) {
            assertThrows(bad, IllegalArgumentException::class.java) { FigureDef.parse(changed { it["small"] = json(bad) }) }
        }
    }

    @Test fun `a bot's outfit comes with the bot - a server that sends none leaves a bare head, and a held object is ignored`() {
        val bots = Api.JSON.decodeFromString<List<Bot>>("""[
            {"id":"a","name":"Old server"},
            {"id":"b","name":"Never dressed","outfit":null},
            {"id":"c","name":"Kit","outfit":{"hat":"cap"}},
            {"id":"d","name":"Drawn","outfit":{"hat":{"shapes":[{"shape":"circle","cx":5,"cy":3,"r":1,"fill":"main"}]}}},
            {"id":"e","name":"From the stick-figure build","outfit":{"hat":"cap","holds":"envelope"}},
            {"id":"f","name":"Only a held object","outfit":{"hat":"","holds":{"shapes":[{"shape":"circle","cx":6,"cy":4.5,"r":1.5,"fill":"main"}]}}},
            {"id":"g","name":"Newer server","outfit":{"hat":"a-hat-from-the-future","cape":"red"}}
        ]""")
        val cap = hats()["cap"]!!.jsonObject["shapes"]!!.jsonArray.size
        assertEquals(listOf(0, 0, cap, 1, cap, 0, 0), bots.map { def.hat(it.outfit).size })
        assertNotNull(bots[2].outfit)
    }
}
