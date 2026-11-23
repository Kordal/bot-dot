package dev.botdot.app.data

/**
 * Settings → Version, shown only while Advanced is on (#1610, ADR 205): which botdot the owner runs. The app's own
 * `versionName` and the server's `version` and `short` revision from GET /api/version, as one read-only line, e.g.
 * `App 0.1.1234 · Server 0.1.0 (659cb5e)`. A server without `short` (an older one) gives its version alone; one that
 * names no version, or not read yet, leaves the row out (null).
 */
object AppVersionLine {
    fun of(appVersion: String, server: VersionInfo?): String? {
        val version = server?.version?.takeIf { it.isNotBlank() } ?: return null
        val short = server.short?.takeIf { it.isNotBlank() }
        val theServer = if (short != null) "$version ($short)" else version
        return tr("App {app} · Server {server}", "app" to appVersion, "server" to theServer)
    }
}
