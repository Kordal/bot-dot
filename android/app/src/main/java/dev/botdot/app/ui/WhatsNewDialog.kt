package dev.botdot.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.WhatsNew

/**
 * What's new (#219): the notes of the releases this person has not seen, newest first, each a title and its points,
 * drawn as plain text. One button; closing it any way (the button, back, a tap outside) calls [onClose], which marks
 * them seen.
 */
@Composable
fun WhatsNewDialog(entries: List<WhatsNew.Entry>, onClose: () -> Unit) {
    val p = LocalPaper.current
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(WhatsNew.TITLE) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) { WhatsNewEntries(entries) }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(WhatsNew.GOT_IT, color = p.text) } },
    )
}

/** The notes as the dialog draws them: also under Settings → Updates while a version waits (#303). */
@Composable
fun WhatsNewEntries(entries: List<WhatsNew.Entry>, color: Color = Color.Unspecified) {
    val p = LocalPaper.current
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        WhatsNew.countLine(entries)?.let { Text(it, color = p.muted, fontSize = 13.sp) }
        entries.forEachIndexed { i, e ->
            // Past the newest few (#380): the title alone, its points on a tap.
            var open by remember(e.id) { mutableStateOf(WhatsNew.openAtFirst(i)) }
            val title = if (WhatsNew.openAtFirst(i)) Modifier else Modifier.clickable { open = !open }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (WhatsNew.openAtFirst(i)) e.title else (if (open) "▾  " else "▸  ") + e.title, color = color, fontWeight = FontWeight.SemiBold, modifier = title)
                Unfold(open) { Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { for (point in e.points) Text("•  $point", color = color) } }
            }
        }
    }
}
