package dev.botdot.app.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl
import okhttp3.Interceptor

/**
 * The app's session with the front door (ADR 028, docs/api.md "The front door"): the secret of the cookie
 * `botdot_session`, one per botdot address, kept on the phone until it is signed out. Every request to that address
 * carries it, the feed and pictures too ([interceptor]); a new one arrives with a sign-in's `Set-Cookie`, and a
 * cleared one with a sign-out's. When the front door answers `401` with `signIn`, the session has ended (signed out
 * everywhere, from here or elsewhere): it is forgotten, and [signInNeeded] names the address that asks for a sign-in.
 */
class Session(private val keep: Keep) {
    /** Where the secret is kept: the phone's private preferences, or memory in a test. */
    interface Keep {
        fun read(server: String): String?
        fun write(server: String, token: String?)
    }

    private val _signInNeeded = MutableStateFlow<String?>(null)
    /** The botdot address whose front door asks for a sign-in, or null while none does. */
    val signInNeeded: StateFlow<String?> = _signInNeeded

    private val _paused = MutableStateFlow<String?>(null)
    /**
     * The botdot address whose account the admin paused (`503` with `paused`), or null: its paused screen, with the
     * way to sign in as another account (#466). It goes by itself once that address answers anything else.
     */
    val paused: StateFlow<String?> = _paused

    /** The session's secret for this botdot address, for a page the app opens itself (a bot's screen), or null. */
    fun token(server: String): String? = keep.read(server)

    val interceptor = Interceptor { chain ->
        val req = chain.request()
        val server = originOf(req.url)
        val token = keep.read(server)
        val res = chain.proceed(if (token != null) req.newBuilder().header("Cookie", "$COOKIE=$token").build() else req)
        for (c in res.headers("Set-Cookie")) {
            val pair = c.substringBefore(';').trim()
            if (pair.substringBefore('=') != COOKIE) continue
            val value = pair.substringAfter('=', "")
            val cleared = value.isEmpty() || c.split(';').any { it.trim().equals("Max-Age=0", ignoreCase = true) }
            keep.write(server, if (cleared) null else value)
            _signInNeeded.value = if (cleared) server else _signInNeeded.value.takeIf { it != server }
        }
        // Only the session this request carried has ended: a sign-in that came meanwhile keeps its new one.
        if (res.code == 401 && asksForSignIn(res.peekBody(4096).string()) && keep.read(server) == token) {
            keep.write(server, null)
            _signInNeeded.value = server
        }
        // Paused until botdot itself answers otherwise (the front door's own routes answer a paused account too), or
        // until this phone has no session there any more.
        if (res.code == 503 && saysPaused(res.peekBody(4096).string())) _paused.value = server
        else if (_paused.value == server && (req.url.encodedPath.startsWith("/api/") || keep.read(server) == null)) _paused.value = null
        res
    }

    companion object {
        const val COOKIE = "botdot_session"

        /** "https://my-vm.ts.net" for a request's address: what a session belongs to, as Api's baseUrl writes it. */
        fun originOf(url: HttpUrl): String =
            "${url.scheme}://${url.host}" + if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"

        /** The front door's answer to a request without a session: `{ "error": …, "signIn": "/sign-in" }`. */
        private fun asksForSignIn(body: String) =
            runCatching { Api.JSON.parseToJsonElement(body).jsonObject["signIn"] }.getOrNull() != null

        /** The front door's answer for a paused account: `{ "error": …, "paused": true }`. */
        private fun saysPaused(body: String) =
            runCatching { Api.JSON.parseToJsonElement(body).jsonObject["paused"]?.jsonPrimitive?.booleanOrNull }.getOrNull() == true

        /** The phone's own keeping: private to the app, which Android never backs up (allowBackup is off). */
        fun onPhone(context: Context) = Session(object : Keep {
            private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
            override fun read(server: String) = prefs.getString(server, null)
            override fun write(server: String, token: String?) {
                prefs.edit { if (token == null) remove(server) else putString(server, token) }
            }
        })
    }
}
