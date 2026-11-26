package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.VersionUpdateCard
import dev.botdot.app.data.tr

/**
 * The Chief's note of a new version as one card of the block kit (web: public/version-update.js; docs/api.md "A new version in
 * the Chief's chat", #1759), in the look of the project update's card: the head with the version, the line saying when the
 * account moves to it, the What's new titles as plain text, and, when the card in Needs you waits, one button that opens
 * Needs you. Now and Tonight stay on that card and are not repeated here.
 */
@Composable
fun VersionUpdateCardUi(v: VersionUpdateCard) {
    val p = LocalPaper.current
    val ways = LocalProjectUpdateWays.current
    Column(Modifier.fillMaxWidth().raised(Radius.card).testTag("version-update")) {
        Row(Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s16, top = Space.s16, bottom = Space.s12), horizontalArrangement = Arrangement.spacedBy(Space.s12), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(Space.s32).clip(Radius.small).background(p.sunk), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.ArrowUpward, contentDescription = null, tint = p.muted, modifier = Modifier.size(16.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(v.head, color = p.text, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
                v.version?.let { Text(it, color = p.muted, fontSize = Type.s12) }
            }
        }
        if (v.body.isNotBlank()) Text(v.body, color = p.text, modifier = Modifier.fillMaxWidth().padding(start = Space.s16, end = Space.s16, bottom = Space.s16))
        if (v.notes.isNotEmpty()) Column(
            Modifier.fillMaxWidth().drawBehind { drawLine(p.line, androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Offset(size.width, 0f), strokeWidth = 1.dp.toPx()) }
                .padding(start = Space.s16, end = Space.s16, top = Space.s12, bottom = Space.s16),
            verticalArrangement = Arrangement.spacedBy(Space.s12),
        ) {
            if (v.heading.isNotBlank()) Text(v.heading, color = p.muted, fontSize = Type.s12, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
            Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) { v.notes.forEach { Text(it, color = p.text) } }
        }
        // A button that opens nothing is no button: with no card in Needs you to open, there is none.
        if (v.cardId != null && ways != null) Box(
            Modifier.fillMaxWidth().drawBehind { drawLine(p.line, androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Offset(size.width, 0f), strokeWidth = 1.dp.toPx()) }
                .padding(start = Space.s16, end = Space.s16, top = Space.s12, bottom = Space.s16),
        ) {
            Box(
                Modifier.heightIn(min = 48.dp).clip(Radius.pill).background(p.fill).clickable(role = Role.Button) { ways.open("needs") }.padding(horizontal = Space.s16),
                contentAlignment = Alignment.Center,
            ) { Text(tr("Open card"), color = p.text, fontWeight = FontWeight.SemiBold, fontSize = Type.s14, maxLines = 1) }
        }
    }
}
