package dev.botdot.app.data

import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem

/** A file on the phone picked for a message (Photos, Files), read as it is sent: its [name] and its bytes at [path]. */
fun outgoingFile(path: String, name: String): OutgoingFile {
    val p = Path(path)
    val size = runCatching { SystemFileSystem.metadataOrNull(p)?.size }.getOrNull()
    return OutgoingFile(name, size) { runCatching { SystemFileSystem.source(p) }.getOrNull() }
}
