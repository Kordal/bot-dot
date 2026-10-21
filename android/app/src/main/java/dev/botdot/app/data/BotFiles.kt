package dev.botdot.app.data

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.app.DownloadManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File

/**
 * Files a bot attached to its reply (a PDF, a spreadsheet…): downloaded into the app's cache, then
 * opened in whatever app on the phone handles them, where they can also be shared or saved.
 */
object BotFiles {
    /** "file:<runId>/<name>": what a notification for a reply with one file opens. */
    const val PREFIX = "file:"

    suspend fun open(context: Context, api: Api, file: String, name: String = file.substringAfterLast('/')) {
        val dest = File(File(context.cacheDir, "botfiles"), file)
        if (!dest.exists() || dest.length() == 0L) api.downloadFile(file, dest)
        view(context, dest, name)
    }

    /** One of the files the owner gave a bot (#235), from its settings. */
    suspend fun openUpload(context: Context, api: Api, botId: String, f: UploadedFile) {
        val dest = File(File(File(context.cacheDir, "botfiles"), "uploads-$botId"), f.file.substringAfterLast('/'))
        if (!dest.exists() || dest.length() == 0L) api.downloadBotFile(botId, f.file, dest)
        view(context, dest, f.name)
    }

    /** A file of the document viewer (#251), by its API path, fetched again each time (a bot may have rewritten it)
     *  into the app's cache for Share and Open in another app. */
    private suspend fun cached(context: Context, api: Api, src: String, name: String): File {
        val dest = File(File(File(context.cacheDir, "botfiles"), "viewer-${src.hashCode().toUInt().toString(16)}"), name.substringAfterLast('/'))
        api.downloadTo(src, dest)
        return dest
    }

    /** The viewer's "Open in another app": whatever app on the phone handles it. */
    suspend fun openElsewhere(context: Context, api: Api, src: String, name: String) = view(context, cached(context, api, src, name), name)

    /** The viewer's "Share…": the phone's share sheet with the file. */
    suspend fun share(context: Context, api: Api, src: String, name: String) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", cached(context, api, src, name))
        val send = Intent(Intent.ACTION_SEND).setType(typeOf(name)).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** The viewer's "Save to Downloads": Android's download manager fetches it with the app's session, as a backup is (BackupDownload). */
    fun saveToDownloads(context: Context, api: Api, src: String, name: String) {
        val file = name.substringAfterLast('/')
        val request = DownloadManager.Request(Uri.parse(api.url(src))).setTitle(file)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        if (Build.VERSION.SDK_INT >= 29) request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, file)
        else request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, file)
        for ((key, value) in BackupDownload.headers(api)) request.addRequestHeader(key, value)
        (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
    }

    private fun typeOf(name: String) = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"

    private fun view(context: Context, dest: File, name: String) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", dest)
        val ext = name.substringAfterLast('.', "").lowercase()
        val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(view)
        } catch (e: ActivityNotFoundException) {
            throw ApiException("No app on this phone opens ${if (ext.isBlank()) "this file" else ".$ext files"}.")
        }
    }
}
