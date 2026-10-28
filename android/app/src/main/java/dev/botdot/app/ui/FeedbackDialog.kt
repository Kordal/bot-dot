package dev.botdot.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Feedback
import dev.botdot.app.data.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * Feedback (#216, ADR 048), opened beside Settings: Bug or Feature request, and the text, for the admin of this
 * machine, and when the front door takes them ([shotsOn], #223, ADR 048) up to three screenshots, each previewed with a
 * remove button. [send] posts it to the front door and throws its sentence on a refusal. A send that fails keeps the
 * form, its text and its screenshots, and says why; one that went says "Sent" and closes.
 */
@Composable
fun FeedbackDialog(shotsOn: Boolean = false, send: suspend (Feedback.Kind, String, List<ByteArray>) -> Unit, onClose: () -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var kind by rememberSaveable { mutableStateOf(Feedback.Kind.BUG) }
    var text by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    // The chosen screenshots, as their addresses (one per line): kept when the phone turns, read again when sent.
    var picked by rememberSaveable { mutableStateOf("") }
    val shots = picked.lines().filter { it.isNotBlank() }
    var sending by remember { mutableStateOf(false) } // not saved: a send cut off by a restart is no send
    // While picked files are read (and a large photo scaled down), the screenshots can't change: no add, no remove.
    var reading by remember { mutableStateOf(false) }
    // Each screenshot's bytes as they are sent, read once when picked; after a rotation, read again when sent.
    val ready = remember { mutableMapOf<String, ByteArray>() }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        reading = true
        scope.launch {
            val refused = mutableListOf<String>()
            val added = mutableListOf<String>()
            val before = shots
            for (uri in uris) {
                if (before.size + added.size >= Feedback.SHOTS_MAX) { refused += tr("At most {max} screenshots go in one report.", "max" to Feedback.SHOTS_MAX); break }
                val (name, bytes) = withContext(Dispatchers.IO) { readShot(context, uri) }
                val no = Feedback.refusal(name, bytes)
                if (no == null && bytes != null) { added += uri.toString(); ready[uri.toString()] = bytes } else refused += no.orEmpty()
            }
            picked = (before + added).joinToString("\n")
            error = refused.joinToString(" ").ifEmpty { null }
            reading = false
        }
    }
    AlertDialog(
        onDismissRequest = { if (!sending) onClose() },
        title = { Text(tr("Feedback")) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (shotsOn) tr("The admin of this machine reads it and sees each screenshot whole, as it is. Only what you write and add here is sent.")
                     else tr("The admin of this machine reads it. Only what you write here is sent."))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    for (k in Feedback.Kind.entries) Row(
                        Modifier.selectable(selected = kind == k, role = Role.RadioButton) { kind = k },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = kind == k, onClick = null)
                        Text(k.label)
                    }
                }
                OutlinedTextField(text, { text = it; error = null }, placeholder = { Text(tr("What happened, or what you would like")) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp))
                if (shotsOn) {
                    if (shots.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        shots.forEachIndexed { i, uri ->
                            val shape = RoundedCornerShape(8.dp)
                            Box(Modifier.size(72.dp, 56.dp).clip(shape).border(1.dp, p.line2, shape)) {
                                coil3.compose.AsyncImage(model = uri, contentDescription = tr("Screenshot {n}", "n" to i + 1), modifier = Modifier.size(72.dp, 56.dp), contentScale = ContentScale.Crop)
                                IconButton(onClick = { picked = shots.filterIndexed { j, _ -> j != i }.joinToString("\n"); ready.remove(uri); error = null },
                                    enabled = !sending && !reading, modifier = Modifier.align(Alignment.TopEnd).padding(2.dp).size(22.dp).background(Color.Black.copy(alpha = 0.65f), CircleShape)) {
                                    Icon(Icons.Filled.Close, contentDescription = tr("Remove screenshot {n}", "n" to i + 1), tint = Color.White, modifier = Modifier.size(14.dp))
                                }
                            }
                        }
                    }
                    TextButton(enabled = !sending && !reading && shots.size < Feedback.SHOTS_MAX, onClick = { pick.launch(arrayOf("image/png", "image/jpeg", "image/webp")) }) {
                        Text(tr("Add screenshot"), color = p.text)
                    }
                }
                error?.let { Text(it, color = p.err) }
            }
        },
        confirmButton = {
            TextButton(enabled = !sending && !reading && text.isNotBlank(), onClick = {
                sending = true
                scope.launch {
                    runCatching {
                        val read = withContext(Dispatchers.IO) { shots.map { u -> ready[u]?.let { "" to it } ?: readShot(context, Uri.parse(u)) } }
                        read.firstNotNullOfOrNull { (name, bytes) -> Feedback.refusal(name, bytes) }?.let { throw Refused(it) }
                        send(kind, text, read.map { it.second!! })
                    }
                        .onSuccess { Toast.makeText(context, tr("Sent"), Toast.LENGTH_SHORT).show(); onClose() }
                        .onError { error = if (it is Refused) it.message else Feedback.failed(it, shots.size) }
                    sending = false
                }
            }) { Text(tr("Send"), color = p.text) }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !sending) { Text(tr("Cancel"), color = p.text) } },
    )
}

/** A picked screenshot that can't go (no longer readable, or no picture): its sentence, shown in the form. */
private class Refused(said: String) : Exception(said)

/** The longest side a photo over the limit is scaled down to before it is sent. */
private const val SHOT_SIDE = 2560
/** The most read of a picked file: a photo past this is not read, and is refused as too large. */
private const val SHOT_READ_MAX = 64 * 1024 * 1024

/**
 * A picked screenshot: its name, and its bytes as they are sent (null when it can't be read). A picture over the front
 * door's 5 MB is scaled down to [SHOT_SIDE] and sent as a JPEG, so a large photo still goes.
 */
private fun readShot(context: Context, uri: Uri): Pair<String, ByteArray?> {
    val resolver = context.contentResolver
    val name = runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull() ?: tr("That file")
    val bytes = runCatching { resolver.openInputStream(uri)?.use { atMost(it, SHOT_READ_MAX + 1) } }.getOrNull() ?: return name to null
    if (bytes.size <= Feedback.SHOT_BYTES || Feedback.pictureType(bytes) == null) return name to bytes
    val smaller = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= SHOT_SIDE) sample *= 2
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return@runCatching null
        val side = maxOf(bitmap.width, bitmap.height)
        val scaled = if (side > SHOT_SIDE) Bitmap.createScaledBitmap(bitmap, bitmap.width * SHOT_SIDE / side, bitmap.height * SHOT_SIDE / side, true) else bitmap
        ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
    }.getOrNull()
    return name to (smaller ?: bytes)
}

private fun atMost(input: InputStream, limit: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val buf = ByteArray(64 * 1024)
    while (out.size() < limit) {
        val n = input.read(buf, 0, minOf(buf.size, limit - out.size()))
        if (n < 0) break
        out.write(buf, 0, n)
    }
    return out.toByteArray()
}
