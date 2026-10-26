package dev.botdot.app.data

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document

/**
 * A folder the owner picked to upload into a bot's workspace (#576): its name and every file in it, each with the
 * folder it sits in inside the picked one ("" at its top). Read through the storage access framework, at most
 * [WorkspaceFiles.MAX_FOLDER_FILES] + 1 files, so a folder that is too big is told without walking all of it.
 */
data class PickedFolder(val name: String, val files: List<PickedFile>) {
    val tooMany: Boolean get() = files.size > WorkspaceFiles.MAX_FOLDER_FILES

    companion object {
        fun read(resolver: ContentResolver, tree: Uri): PickedFolder {
            val top = DocumentsContract.getTreeDocumentId(tree)
            val cols = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_SIZE)
            val name = resolver.query(DocumentsContract.buildDocumentUriUsingTree(tree, top), cols, null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(1) else null
            } ?: "folder"
            val files = mutableListOf<PickedFile>()
            val left = ArrayDeque(listOf(top to ""))
            while (left.isNotEmpty() && files.size <= WorkspaceFiles.MAX_FOLDER_FILES) {
                val (id, dir) = left.removeFirst()
                resolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, id), cols, null, null, null)?.use { c ->
                    while (c.moveToNext() && files.size <= WorkspaceFiles.MAX_FOLDER_FILES) {
                        val child = c.getString(0)
                        val n = c.getString(1) ?: continue
                        if (c.getString(2) == Document.MIME_TYPE_DIR) left.addLast(child to WorkspaceFiles.folderDir(dir, n))
                        else files += PickedFile(dir, n, DocumentsContract.buildDocumentUriUsingTree(tree, child), if (c.isNull(3)) null else c.getLong(3))
                    }
                }
            }
            return PickedFolder(name, files)
        }
    }
}

/** One file of a [PickedFolder]: [dir] is its folder inside the picked one. */
data class PickedFile(val dir: String, val name: String, val uri: Uri, val size: Long?)
