package dev.botdot.app.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Feedback
import kotlinx.coroutines.launch

/**
 * Feedback (#216, ADR 048), opened beside Settings: Bug or Feature request, and the text, for the admin of this
 * machine. [send] posts it to the front door and throws its sentence on a refusal. A send that fails keeps the form
 * and its text and says why; one that went says "Sent" and closes.
 */
@Composable
fun FeedbackDialog(send: suspend (Feedback.Kind, String) -> Unit, onClose: () -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var kind by rememberSaveable { mutableStateOf(Feedback.Kind.BUG) }
    var text by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) } // not saved: a send cut off by a restart is no send
    AlertDialog(
        onDismissRequest = { if (!sending) onClose() },
        title = { Text("Feedback") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("The admin of this machine reads it. Only what you write here is sent.")
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    for (k in Feedback.Kind.entries) Row(
                        Modifier.selectable(selected = kind == k, role = Role.RadioButton) { kind = k },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = kind == k, onClick = null)
                        Text(k.label)
                    }
                }
                OutlinedTextField(text, { text = it; error = null }, placeholder = { Text("What happened, or what you would like") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp))
                error?.let { Text(it, color = p.err) }
            }
        },
        confirmButton = {
            TextButton(enabled = !sending && text.isNotBlank(), onClick = {
                sending = true
                scope.launch {
                    runCatching { send(kind, text) }
                        .onSuccess { Toast.makeText(context, "Sent", Toast.LENGTH_SHORT).show(); onClose() }
                        .onError { error = Feedback.failed(it) }
                    sending = false
                }
            }) { Text("Send", color = p.text) }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !sending) { Text("Cancel", color = p.text) } },
    )
}
