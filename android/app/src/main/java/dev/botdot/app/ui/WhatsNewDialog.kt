package dev.botdot.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
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
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                for (e in entries) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(e.title, fontWeight = FontWeight.SemiBold)
                    for (point in e.points) Text("•  $point")
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(WhatsNew.GOT_IT, color = p.text) } },
    )
}
