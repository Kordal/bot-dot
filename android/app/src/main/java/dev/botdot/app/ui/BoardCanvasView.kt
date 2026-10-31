package dev.botdot.app.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.BoardCanvas
import kotlin.math.roundToInt

/** A tile of the board: its id ([BoardCanvas]) and how it is drawn, filling the modifier it is given. */
internal class Tile(val id: String, val draw: @Composable (Modifier) -> Unit)

/**
 * A long press anywhere inside, even on a tile's own buttons: seen before them (the Initial pass), so once [onHold]
 * takes it the held finger is the tile's and the buttons get nothing, not even the lift. A tap, a swipe or two fingers
 * before the press is long go on to the buttons and the page as before. [onDrag] gets how far the finger is from where
 * it went down; [onEnd] whether it moved.
 */
internal suspend fun PointerInputScope.holdAndDrag(onHold: (Offset) -> Boolean, onDrag: (Offset) -> Unit = {}, onEnd: (Boolean) -> Unit = {}) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        val slop = viewConfiguration.touchSlop
        val gone = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
            while (true) {
                val e = awaitPointerEvent(PointerEventPass.Initial)
                val ch = e.changes.firstOrNull { it.id == down.id }
                if (ch == null || !ch.pressed || e.changes.count { it.pressed } > 1 || (ch.position - down.position).getDistance() > slop) break
            }
        }
        if (gone != null || !onHold(down.position)) return@awaitEachGesture
        var moved = false
        while (true) {
            val e = awaitPointerEvent(PointerEventPass.Initial)
            val ch = e.changes.firstOrNull { it.id == down.id } ?: break
            e.changes.forEach { it.consume() }
            if (!ch.pressed) break
            val d = ch.position - down.position
            if (moved || d.getDistance() > slop) { moved = true; onDrag(d) }
        }
        onEnd(moved)
    }
}

/**
 * A project's board as a free canvas (#784, ADR 124; web: public/board-canvas-view.js): each tile where [saved] puts
 * it on a canvas [BoardCanvas.W] wide, drawn at that size and scaled to the screen's width; two fingers zoom and pan.
 * A long press on a tile, then a drag, moves it, from near an edge or corner resizes it (#821, ADR 130: no Arrange
 * mode); a tile in the way slides down, and each drop is [save]d whole. Without [saved] the tiles take the first free
 * spots, and are saved at once so every app shows the same.
 */
@Composable
internal fun BoardCanvasView(tiles: List<Tile>, saved: Map<String, BoardCanvas.R>?, save: (Map<String, BoardCanvas.R>) -> Unit) {
    val p = LocalPaper.current
    val haptic = LocalHapticFeedback.current
    val ids = tiles.map { it.id }
    var places by remember(saved, ids) { mutableStateOf(BoardCanvas.complete(saved, ids)) }
    val now by rememberUpdatedState(places)
    LaunchedEffect(saved == null) { if (saved == null) save(now) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    var held by remember { mutableStateOf<String?>(null) }
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
            Box(Modifier.size(unit * BoardCanvas.W, unit * BoardCanvas.height(places)).pointerInput(ids) {
                var edge: String? = null
                var from = places
                holdAndDrag(
                    onHold = hold@{ at ->
                        val x = at.x / density; val y = at.y / density
                        val hit = now.entries.lastOrNull { (_, r) -> x >= r.x && x <= r.right && y >= r.y && y <= r.bottom } ?: return@hold false
                        val (id, r) = hit
                        val near = 28f
                        edge = buildString {
                            if (y > r.bottom - near) append('s')
                            if (x > r.right - near) append('e') else if (x < r.x + near) append('w')
                        }.ifEmpty { null }
                        from = now
                        held = id
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        true
                    },
                    onDrag = { d -> held?.let { places = BoardCanvas.drag(from, it, edge, (d.x / density).toDouble(), (d.y / density).toDouble()) } },
                    onEnd = { moved -> if (moved) save(now); held = null },
                )
            }) {
                for (t in tiles) {
                    val r = places[t.id] ?: continue
                    Box(Modifier.offset(unit * r.x, unit * r.y).size(unit * r.w, unit * r.h)) {
                        t.draw(Modifier.matchParentSize())
                        // The held tile is outlined while the finger has it.
                        if (held == t.id) Box(Modifier.matchParentSize().border(2.dp, p.text, Radius.card))
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
