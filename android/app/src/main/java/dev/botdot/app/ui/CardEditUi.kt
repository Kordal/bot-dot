package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import dev.botdot.app.data.tr
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The pencil on a board tile (ADR 273; web: public/board-edit.js). [CardEditHandle] is what the board's tiles read: the
 * tile pointed at now, and how to point at one. Null where the board has no pencil (the server lacks `card-edit`, the
 * project is not running or has no chat to open).
 */
internal class CardEditHandle(val target: dev.botdot.app.data.CardEdit.Target?, val point: (id: String, label: String) -> Unit)

internal val LocalCardEdit = compositionLocalOf<CardEditHandle?> { null }

/** The pencil in a tile's head, right of its title: opens the project's chat with a chip naming the tile. */
@Composable
internal fun CardPencil(id: String, label: String, modifier: Modifier = Modifier) {
    val handle = LocalCardEdit.current ?: return
    val p = LocalPaper.current
    Box(
        modifier.size(28.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = tr("Edit {name}", "name" to label)) { handle.point(id, label) },
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Outlined.Edit, tr("Edit {name}", "name" to label), tint = p.faint, modifier = Modifier.size(16.dp))
    }
}

/** A thin ring around the tile while it is the one the chip names. */
@Composable
internal fun Modifier.cardRing(id: String): Modifier {
    val on = LocalCardEdit.current?.target?.id == id
    return if (on) border(1.dp, LocalPaper.current.muted, Radius.card) else this
}

/** Above the message box while a tile is pointed at: its name, and ✕ to send a plain message. */
@Composable
fun CardChip(label: String, onClear: () -> Unit) {
    val p = LocalPaper.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Space.s16, vertical = Space.s4),
        horizontalArrangement = Arrangement.Start,
    ) {
        Row(
            Modifier.clip(Radius.small).background(p.fill).padding(start = Space.s12),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = p.text, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            IconButton(onClick = onClear, modifier = Modifier.size(28.dp)) {
                Icon(Icons.Outlined.Close, tr("Remove {name} from this message", "name" to label), tint = p.muted, modifier = Modifier.size(14.dp))
            }
        }
    }
}

/** The tile's name, small, above an owner's message that was about it. */
@Composable
internal fun CardAbout(card: dev.botdot.app.data.TileRef?, modifier: Modifier = Modifier) {
    if (card == null || card.label.isEmpty()) return
    Text(card.label, color = LocalPaper.current.faint, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = modifier)
}
