package dev.botdot.app.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import dev.botdot.app.BuildConfig
import java.io.File
import java.security.MessageDigest

/**
 * Updating the app from botdot itself: the server image carries the newest signed app (see
 * images.yml), the phone downloads it over Tailscale and hands it to Android's installer. Android
 * only installs it over this app when it's signed with the same key.
 */
object AppUpdate {
    /** The newer version botdot has, or null. */
    fun newer(v: VersionInfo?): AndroidRelease? = v?.android?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }

    /** Android asks once whether botdot may install apps; until then, this opens that setting. */
    fun mayInstall(context: Context): Boolean =
        Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

    fun openInstallSetting(context: Context) {
        context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Download, check it's the file botdot described, and open the installer. */
    suspend fun install(context: Context, api: Api, release: AndroidRelease, onProgress: (Float) -> Unit) {
        if (!ReleaseManifest.secureURL(api.baseUrl)) throw ApiException(tr("Use HTTPS for a remote botdot server."))
        val manifest = release.release ?: throw ApiException(tr("This update has no signed release manifest."))
        manifest.verify("android", BuildConfig.VERSION_CODE.toLong())
        if (manifest.version != release.versionCode.toLong() || manifest.sha256 != release.sha256) throw ApiException(tr("The release does not match its signed manifest."))
        val dir = File(context.cacheDir, "updates").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
        val file = File(dir, "bot-dot-${release.versionName ?: release.versionCode}.apk")
        api.downloadApp(file, onProgress)
        val sha = release.sha256
        if (sha256(file) != sha) {
            file.delete()
            throw ApiException(tr("The download was damaged. Try again."))
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        context.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
