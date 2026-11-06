package dev.botdot.app.ui

import dev.botdot.app.data.Attachment
import org.junit.Assert.assertEquals
import org.junit.Test

/** A file whose upload failed is not silently left out of the message (#1074): Send takes only the uploaded files. */
class FailedUploadTest {
    @Test fun aFailedOrUploadingFileStaysInTheBox() {
        val photo = Attachment(name = "photo.jpg", file = "u1/photo.jpg", size = 10)
        val items = mutableListOf(
            PendingFiles.Item(0, "photo.jpg", 10, "ready", photo),
            PendingFiles.Item(1, "scan.pdf", 20, "failed", error = "botdot answered 502"),
            PendingFiles.Item(2, "big.mov", 30, "uploading"),
        )
        assertEquals(listOf(photo), PendingFiles.sendable(items))
        assertEquals(listOf("scan.pdf", "big.mov"), items.map { it.name })
        assertEquals(emptyList<Attachment>(), PendingFiles.sendable(items))
        assertEquals(2, items.size)
    }
}
