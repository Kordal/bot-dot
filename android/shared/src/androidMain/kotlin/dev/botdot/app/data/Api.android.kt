package dev.botdot.app.data

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.header
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.io.asSource
import kotlinx.io.files.Path
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** The header that carries a request's [Went] to the network interceptor, which takes it off again. */
private const val WENT = "X-Botdot-Went"
private val wents = ConcurrentHashMap<String, Went>()

internal actual fun HttpRequestBuilder.track(went: Went): () -> Unit {
    val id = UUID.randomUUID().toString()
    wents[id] = went
    header(WENT, id)
    return { wents.remove(id) }
}

internal actual fun sentOf(e: Throwable, went: Went): Boolean = went.out

/** Debug builds: each request in Logcat (tag botdot-http), so too many of them show. */
private val logRequests = Interceptor { chain ->
    val req = chain.request()
    if (!Api.logRequests) return@Interceptor chain.proceed(req)
    val t0 = System.nanoTime()
    val res = chain.proceed(req)
    android.util.Log.d("botdot-http", "${req.method} ${req.url.encodedPath}${req.url.encodedQuery?.let { "?$it" } ?: ""} -> ${res.code} (${(System.nanoTime() - t0) / 1_000_000} ms)")
    res
}

private val client: OkHttpClient by lazy {
    OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.MINUTES) // uploads
        // A request reaches here once it has a connection: from then on botdot may have taken it (ApiException.sent).
        .addNetworkInterceptor { chain ->
            val req = chain.request()
            val went = req.header(WENT)
            if (went == null) chain.proceed(req) else { wents[went]?.out = true; chain.proceed(req.newBuilder().removeHeader(WENT).build()) }
        }
        .addInterceptor(logRequests)
        .build()
}

/** One connection pool for the whole app: the API's (through Ktor) and the pictures' (Coil, BotDotApp). */
val Api.Companion.CLIENT: OkHttpClient get() = client

internal actual fun httpEngine(): HttpClientEngine = OkHttp.create { preconfigured = client }

internal actual fun parseHttpAddress(s: String): HttpAddress? {
    val u = s.toHttpUrlOrNull() ?: return null
    return HttpAddress(u.toString(), u.newBuilder().encodedPath("/").query(null).build().toString())
}

// The phone's files, as the screens hand them over: a picked file by its Uri, a file in the app's cache.

fun Api.describe(resolver: ContentResolver, uri: Uri): Pair<String, Long?> {
    var name = uri.lastPathSegment?.substringAfterLast('/')?.takeIf { '.' in it } ?: "file"
    var size: Long? = null
    runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
    }
    return name to size
}

private fun Api.outgoing(resolver: ContentResolver, uri: Uri): OutgoingFile {
    val (name, size) = describe(resolver, uri)
    return OutgoingFile(name, size) { resolver.openInputStream(uri)?.asSource() }
}

/** Upload one file for a message. to = "bot:<id>", "chief" or "group:<id>". */
suspend fun Api.upload(resolver: ContentResolver, uri: Uri, to: String): Attachment =
    upload(withContext(Dispatchers.IO) { outgoing(resolver, uri) }, to)

/** Uploads one file into folder [path] (another name when that one is taken); [made]: its missing folders are made first. */
suspend fun Api.uploadToWorkspace(resolver: ContentResolver, uri: Uri, botId: String, path: String, root: String = WorkspaceFiles.SERVER, made: Boolean = false) =
    uploadToWorkspace(withContext(Dispatchers.IO) { outgoing(resolver, uri) }, botId, path, root, made)

suspend fun Api.downloadBotFile(botId: String, file: String, dest: File) = downloadBotFile(botId, file, Path(dest.path))
suspend fun Api.downloadFile(file: String, dest: File) = downloadFile(file, Path(dest.path))
suspend fun Api.downloadTo(src: String, dest: File) = downloadTo(src, Path(dest.path))
suspend fun Api.downloadApp(dest: File, onProgress: (Float) -> Unit) = downloadApp(Path(dest.path), onProgress)
suspend fun Api.exportDocument(title: String, text: String, format: String, dir: File): File =
    File(exportDocument(title, text, format, Path(dir.path)).toString())
