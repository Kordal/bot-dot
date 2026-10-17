package dev.botdot.app.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PointMode
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import dev.botdot.app.data.FigureDef
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The picture of a bot in a notification is drawn by the function that draws every bot: here onto a canvas that
 * only counts what is drawn (a unit test has no Android bitmap; the bitmap itself is looked at on the emulator).
 */
class FigurePictureTest {
    private val def = FigureDef.parse(File(System.getProperty("figureDefinition") ?: "../../lib/figure.json").readText())

    private class Counting : Canvas {
        var circles = 0
        var paths = 0
        override fun drawCircle(center: Offset, radius: Float, paint: Paint) { circles++ }
        override fun drawPath(path: Path, paint: Paint) { paths++ }
        override fun save() {}
        override fun restore() {}
        override fun saveLayer(bounds: Rect, paint: Paint) {}
        override fun translate(dx: Float, dy: Float) {}
        override fun scale(sx: Float, sy: Float) {}
        override fun rotate(degrees: Float) {}
        override fun skew(sx: Float, sy: Float) {}
        override fun concat(matrix: Matrix) {}
        override fun clipRect(left: Float, top: Float, right: Float, bottom: Float, clipOp: ClipOp) {}
        override fun clipPath(path: Path, clipOp: ClipOp) {}
        override fun drawLine(p1: Offset, p2: Offset, paint: Paint) {}
        override fun drawRect(left: Float, top: Float, right: Float, bottom: Float, paint: Paint) {}
        override fun drawRoundRect(left: Float, top: Float, right: Float, bottom: Float, radiusX: Float, radiusY: Float, paint: Paint) {}
        override fun drawOval(left: Float, top: Float, right: Float, bottom: Float, paint: Paint) {}
        override fun drawArc(left: Float, top: Float, right: Float, bottom: Float, startAngle: Float, sweepAngle: Float, useCenter: Boolean, paint: Paint) {}
        override fun drawImage(image: ImageBitmap, topLeftOffset: Offset, paint: Paint) {}
        override fun drawImageRect(image: ImageBitmap, srcOffset: IntOffset, srcSize: IntSize, dstOffset: IntOffset, dstSize: IntSize, paint: Paint) {}
        override fun drawPoints(pointMode: PointMode, points: List<Offset>, paint: Paint) {}
        override fun drawRawPoints(pointMode: PointMode, points: FloatArray, paint: Paint) {}
        override fun drawVertices(vertices: androidx.compose.ui.graphics.Vertices, blendMode: androidx.compose.ui.graphics.BlendMode, paint: Paint) {}
        override fun enableZ() {}
        override fun disableZ() {}
    }

    private fun drawn(outfit: String?, from: FigureDef = def) = Counting().also {
        drawPortrait(it, from, "#3b82f6", outfit?.let(Json::parseToJsonElement), 144, dark = false)
    }

    @Test fun `a bot without a hat is drawn as its bare head, and one with a hat with the hat's shapes over it`() {
        val bare = drawn(null)
        assertTrue("the head and its eyes", bare.circles + bare.paths >= 3)
        for (none in listOf("""{"hat":""}""", """{"hat":"no-such-hat"}""")) {
            assertEquals(bare.circles to bare.paths, drawn(none).let { it.circles to it.paths })
        }
        val cap = drawn("""{"hat":"cap"}""")
        assertEquals("every shape of the hat is drawn besides the head", def.hat(Json.parseToJsonElement("""{"hat":"cap"}""")).size, cap.circles + cap.paths - bare.circles - bare.paths)
        val chief = Counting().also { drawPortrait(it, def, "#d85a30", FigureDef.CHIEF, 144, dark = true) }
        assertTrue("the Chief's hat", chief.circles + chief.paths > bare.circles + bare.paths)
        // The built-in bare head, for a definition this app can't use.
        assertTrue(drawn("""{"hat":"cap"}""", FigureDef.BARE).let { it.circles + it.paths } >= 3)
    }
}
