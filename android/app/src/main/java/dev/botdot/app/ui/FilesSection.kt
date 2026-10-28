package dev.botdot.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import dev.botdot.app.data.Api
import dev.botdot.app.data.BotFiles
import dev.botdot.app.data.DocumentView
import dev.botdot.app.data.UploadedFile
import dev.botdot.app.data.UploadedFiles
import kotlinx.coroutines.launch

/**
 * The Files section (#235): what the owner gave a bot, newest first. Tap one to open it; keep one in mind so it comes
 * with every task; delete one. The Chief's settings draw its own with the same section (#383): [ownerId] is then
 * [UploadedFiles.CHIEF]. [empty] is said when there is none; the list has no helper line above it (#636).
 */
@Composable
fun FilesSection(api: Api?, ownerId: String, ownerName: String, viewer: Boolean, empty: String, tell: (String) -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var files by remember { mutableStateOf<List<UploadedFile>?>(null) }
    var toDelete by remember { mutableStateOf<UploadedFile?>(null) }
    LaunchedEffect(api, ownerId) { val a = api ?: return@LaunchedEffect; runCatching { a.botFiles(ownerId) }.onSuccess { files = it.files } }
    val list = files ?: return
    FoldSection("Files", UploadedFiles.summary(list)) {
        if (list.isEmpty()) Hint(empty)
        list.forEach { f ->
            key(f.file) {
                Column(Modifier.fillMaxWidth()) {
                    Text(f.name, color = p.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.clickable {
                        // In the viewer (#251) where the server has it; else in the phone's own app, as before.
                        if (viewer) DocViewer.open = DocViewer.Request(DocumentView.botFile(ownerId, f.file), f.name, ownerName)
                        else scope.launch { runCatching { BotFiles.openUpload(context, api ?: error("Not connected to botdot"), ownerId, f) }.onError { tell(it.message ?: "Couldn't open ${f.name}") } }
                    })
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(UploadedFiles.detail(f), color = p.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        TextButton(onClick = {
                            scope.launch { runCatching { api!!.pinBotFile(ownerId, f.file, !f.pinned) }.onSuccess { files = it.files }.onError { tell(it.message ?: "Couldn't save") } }
                        }) { Text(if (f.pinned) "📌 Kept in mind" else "Keep in mind", color = if (f.pinned) p.text else p.muted) }
                        TextButton(onClick = { toDelete = f }) { Text("Delete", color = p.err) }
                    }
                }
            }
        }
    }
    toDelete?.let { f ->
        AlertDialog(
            onDismissRequest = { toDelete = null },
            title = { Text("Delete ${f.name}?") },
            text = { Text("$ownerName won't have it any more.", color = p.text) },
            confirmButton = {
                TextButton(onClick = {
                    toDelete = null
                    scope.launch { runCatching { api!!.deleteBotFile(ownerId, f.file) }.onSuccess { files = it.files }.onError { tell(it.message ?: "Couldn't delete") } }
                }) { Text("Delete", color = p.err) }
            },
            dismissButton = { TextButton(onClick = { toDelete = null }) { Text("Cancel", color = p.text) } },
        )
    }
}
