package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * One sign-in in the browser (docs/api.md, "The front door"): the secret this app keeps while the front door's
 * sign-in page is open in a Custom Tab, and the botdot it is for. The page carries only the secret's SHA-256
 * ([challenge]); after the passkey it sends the browser to `botdot://signed-in?code=…`, and the code with [verifier]
 * is what the front door turns into this app's session. Another app that claims botdot:// sees the code, never the
 * secret, so it signs nobody in.
 */
class Handoff(val server: String, val verifier: String, val startedAt: Long) {
    val challenge: String get() = challengeOf(verifier)

    /** The front door's sign-in page, which hands the sign-in back to this app. */
    val page: String get() = "${server.trimEnd('/')}/sign-in?app=android&handoff=$challenge"

    /** What the phone keeps of it until the browser comes back. */
    fun kept(): String = "$startedAt $server $verifier"

    companion object {
        const val SCHEME = "botdot"
        const val HOST = "signed-in"

        /** How long the app waits for the browser: the person may take a while there. The code itself lasts 2 minutes. */
        const val WAITS_MS = 15 * 60_000L

        private val CODE = Regex("^[A-Za-z0-9_-]{43}$")
        private val b64 = Base64.getUrlEncoder().withoutPadding()

        /** A new sign-in for [server]: a fresh secret of 32 random bytes, in base64url. */
        fun start(server: String, now: Long, random: SecureRandom = SecureRandom()): Handoff =
            Handoff(server.trimEnd('/'), b64.encodeToString(ByteArray(32).also(random::nextBytes)), now)

        /** The SHA-256 of [verifier] in base64url, as the front door checks it. */
        fun challengeOf(verifier: String): String =
            b64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

        /** The code in the address the browser came back with (`botdot://signed-in?code=…`), or null when it has none. */
        fun codeOf(uri: String?): String? {
            val u = runCatching { URI(uri ?: return null) }.getOrNull() ?: return null
            if (!u.scheme.equals(SCHEME, ignoreCase = true) || u.host != HOST) return null
            val code = u.rawQuery?.split('&')?.firstNotNullOfOrNull { p -> p.split('=', limit = 2).takeIf { it.size == 2 && it[0] == "code" }?.get(1) }
            return code?.takeIf { CODE.matches(it) }
        }

        /** Whether this address is the browser coming back from a sign-in, with a code or without. */
        fun isReturn(uri: String?): Boolean =
            runCatching { URI(uri ?: return false) }.getOrNull()?.let { it.scheme.equals(SCHEME, ignoreCase = true) && it.host == HOST } == true

        fun parse(kept: String?): Handoff? {
            val parts = kept?.split(' ') ?: return null
            if (parts.size != 3) return null
            return Handoff(parts[1], parts[2], parts[0].toLongOrNull() ?: return null)
        }
    }
}

/**
 * The Android app's sign-in, in the browser (ADR 028, #469's way for the Mac app): [start] makes a [Handoff], keeps it
 * and gives the page to open; [back] takes the address the browser came back with and turns its code into this app's
 * session at `POST /sign-in/handoff`. The browser and its password manager (Proton Pass, Bitwarden, Google's) answer
 * the passkey for the site itself, so no Digital Asset Links and no `FRONT_DOOR_ANDROID_KEYS` take part.
 */
class BrowserSignIn(private val keep: Keep, private val now: () -> Long = System::currentTimeMillis, private val api: () -> Api?) {
    /** Where the phone keeps the waiting sign-in, so that it survives Android ending the app while the browser is open. */
    interface Keep {
        fun read(): String?
        fun write(value: String?)
    }

    sealed interface State {
        data object Idle : State
        /** The page is open in the browser. */
        data object Waiting : State
        /** Back from the browser, turning the code into a session. */
        data object Finishing : State
        data class Done(val account: String) : State
        data class Failed(val words: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state

    /** A new sign-in for the botdot this app is set to: the page to open, or null with none set. */
    fun start(): String? {
        val a = api() ?: return null
        val h = Handoff.start(a.baseUrl, now())
        keep.write(h.kept())
        _state.value = State.Waiting
        return h.page
    }

    /** The browser could not be opened. */
    fun couldNotOpen(words: String) {
        keep.write(null)
        _state.value = State.Failed(words)
    }

    /** The sign-in screen showed what ended: back to the start. */
    fun seen() { if (_state.value is State.Done || _state.value is State.Failed) _state.value = State.Idle }

    /**
     * The browser came back with [uri]. The kept secret is used once, whatever comes of it; a code for no waiting
     * sign-in, an old one, or one for another botdot signs nothing in.
     */
    suspend fun back(uri: String?) {
        val code = Handoff.codeOf(uri)
        val waiting = Handoff.parse(keep.read())
        keep.write(null)
        val a = api()
        _state.value = when {
            code == null -> State.Failed(tr("The sign-in didn't come back from the browser. Sign in again."))
            waiting == null || now() - waiting.startedAt > Handoff.WAITS_MS -> State.Failed(tr("That sign-in has ended. Sign in again."))
            a == null || a.baseUrl.trimEnd('/') != waiting.server -> State.Failed(tr("That sign-in was for another botdot. Sign in again."))
            else -> {
                _state.value = State.Finishing
                try {
                    State.Done(a.finishSignIn(code, waiting.verifier))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    State.Failed(e.message?.ifBlank { null } ?: tr("That didn't sign you in."))
                }
            }
        }
    }
}
