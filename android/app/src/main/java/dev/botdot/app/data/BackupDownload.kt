package dev.botdot.app.data

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment

/**
 * Downloading the account's backup to the phone's Downloads (Settings → Backups). Android's download manager fetches
 * it, with the app's session: behind the front door (ADR 028) the phone's browser has none, and would get the sign-in
 * page in place of the file. The backup holds this account alone.
 */
object BackupDownload {
    /** The request's headers: the session's cookie, when the app has one for this botdot. */
    fun headers(api: Api): Map<String, String> = api.sessionCookie()?.let { mapOf("Cookie" to it) } ?: emptyMap()

    fun start(context: Context, api: Api, name: String) {
        val request = DownloadManager.Request(Uri.parse(api.backupUrl(name)))
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        // Downloads needs no permission from Android 10; before it, the app's own folder of downloads does.
        if (Build.VERSION.SDK_INT >= 29) request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        else request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, name)
        for ((key, value) in headers(api)) request.addRequestHeader(key, value)
        (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
    }
}
