package dev.botdot.app.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.BoardCanvas
import kotlin.math.roundToInt

/** A tile of the board: its id ([BoardCanvas]) and how it is drawn, filling the modifier it is given. */
internal class Tile(val id: String, val draw: @Composable (Modifier) -> Unit)

/**
 * A project's board as a free canvas (#784, ADR 124; web: public/board-canvas-view.js): each tile where [saved] puts
 * it on a canvas [BoardCanvas.W] wide, drawn at that size and scaled to the screen's width; two fingers zoom and pan.
 * While [arranging], a long press on a tile and a drag moves it, from near an edge or corner resizes it; a tile in the
 * way slides down, and each drop is [save]d whole. Without [saved] the tiles take the first free spots, and are saved
 * at once so every app shows the same.
 */
@Composable
internal fun BoardCanvasView(tiles: List<Tile>, saved: Map<String, BoardCanvas.R>?, arranging: Boolean, save: (Map<String, BoardCanvas.R>) -> Unit) {
    val p = LocalPaper.current
    val ids = tiles.map { it.id }
    var places by remember(saved, ids) { mutableStateOf(BoardCanvas.complete(saved, ids)) }
    val now by rememberUpdatedState(places)
    LaunchedEffect(arranging, saved == null) { if (arranging && saved == null) save(now) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    val density = LocalDensity.current.density
    val unit = 1.dp
    Layout(
        modifier = Modifier.fillMaxWidth().clipToBounds().pointerInput(Unit) {
            // Two fingers: zoom (1 to 4 times) and pan, the canvas's top left held inside.
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false)
                do {
                    val e = awaitPointerEvent()
                    if (e.changes.count { it.pressed } >= 2) {
                        val z = (zoom * e.calculateZoom()).coerceIn(1f, 4f)
                        val w = size.width.toFloat(); val h = size.height.toFloat()
                        val o = pan + e.calculatePan()
                        pan = Offset(o.x.coerceIn(-(z - 1) * w, 0f), o.y.coerceIn(-(z - 1) * h, 0f))
                        zoom = z
                        e.changes.forEach { it.consume() }
                    }
                } while (e.changes.any { it.pressed })
            }
        },
        content = {
            Box(Modifier.size(unit * BoardCanvas.W, unit * BoardCanvas.height(places)).then(if (arranging) Modifier.pointerInput(ids) {
                var drag: Pair<String, String?>? = null
                var from = places
                var moved = Offset.Zero
                detectDragGesturesAfterLongPress(
                    onDragStart = { at ->
                        val x = at.x / density; val y = at.y / density
                        val hit = now.entries.lastOrNull { (_, r) -> x >= r.x && x <= r.right && y >= r.y && y <= r.bottom }
                        drag = hit?.let { (id, r) ->
                            val near = 28f
                            val edge = buildString {
                                if (y > r.bottom - near) append('s')
                                if (x > r.right - near) append('e') else if (x < r.x + near) append('w')
                            }.ifEmpty { null }
                            id to edge
                        }
                        from = now
                        moved = Offset.Zero
                    },
                    onDrag = { change, amount ->
                        val d = drag ?: return@detectDragGesturesAfterLongPress
                        change.consume()
                        moved += amount
                        places = BoardCanvas.drag(from, d.first, d.second, (moved.x / density).toDouble(), (moved.y / density).toDouble())
                    },
                    onDragEnd = { if (drag != null) save(now); drag = null },
                    onDragCancel = { places = from; drag = null },
                )
            } else Modifier)) {
                for (t in tiles) {
                    val r = places[t.id] ?: continue
                    Box(Modifier.offset(unit * r.x, unit * r.y).size(unit * r.w, unit * r.h)) {
                        t.draw(Modifier.matchParentSize())
                        // While arranging, the tile is held: its own buttons wait.
                        if (arranging) Box(Modifier.matchParentSize().border(1.dp, p.line2, Radius.card).pointerInput(Unit) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false) } })
                    }
                }
            }
        },
    ) { measurables, constraints ->
        val w = constraints.maxWidth
        val canvas = (BoardCanvas.W * density).roundToInt()
        val s = w.toFloat() / canvas
        val tall = (BoardCanvas.height(places) * density).roundToInt()
        val child = measurables.first().measure(Constraints.fixed(canvas, tall.coerceAtLeast(0)))
        layout(w, (tall * s).roundToInt()) {
            child.placeWithLayer(0, 0) {
                transformOrigin = TransformOrigin(0f, 0f)
                scaleX = s * zoom; scaleY = s * zoom
                translationX = pan.x; translationY = pan.y
            }
        }
    }
}
