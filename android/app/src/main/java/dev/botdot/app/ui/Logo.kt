package dev.botdot.app.ui

import androidx.compose.animation.core.EaseOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em

/** "bot" and the big coral dot. While [busy] (the Chief or a bot is working) the dot pulses softly. */
@Composable
fun Logo(size: TextUnit = Type.s20, busy: Boolean = false) {
    val p = LocalPaper.current
    val em = with(LocalDensity.current) { size.toDp() }
    // On the figures' clock, running only while busy (it carries on where it was, so the pulse doesn't jump).
    val clock = movingClock(busy)
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics { contentDescription = "botdot" }) {
        Text("bot", fontSize = size, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.04).em, color = p.text)
        Canvas(Modifier.padding(start = em * 0.07f).offset(y = em * 0.06f).size(em * 0.44f)) {
            val r = this.size.minDimension / 2
            if (clock != null) {
                val t = EaseOut.transform((clock.t.floatValue % 2.4f) / 2.4f)
                drawCircle(p.dot.copy(alpha = 0.45f * (1 - t)), radius = r * (1 + 0.8f * t))
            }
            drawCircle(p.dot, radius = r)
        }
    }
}
