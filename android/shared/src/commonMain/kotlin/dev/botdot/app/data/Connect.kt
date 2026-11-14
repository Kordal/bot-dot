package dev.botdot.app.data

/**
 * Where's your botdot? The address a phone app is given, read and checked once for both phones (ADR 242): what the
 * Android app's connect screen and the iOS app's address screen say.
 */
object Connect {
    /** The API this app understands (docs/api.md: `GET /api/version`'s `apiVersion`). */
    const val API_VERSION = 1

    /** An address as typed: one to check, one on this device itself, or none. */
    sealed interface Address {
        data class Remote(val url: String) : Address
        /**
         * An address on the device itself (localhost, 127.x, ::1): the desktop app's local botdot is one, which a phone
         * doesn't reach. It is still tried, as the Android app always did: the phone's localhost can be a computer's
         * (adb reverse for the Play screenshots, the iPhone simulator on its Mac).
         */
        data class Local(val url: String) : Address
        /** Plain HTTP to another computer: botdot only takes HTTPS from a phone. */
        data object Insecure : Address
        data object NotAnAddress : Address
    }

    /** What [input] is, before anything is asked of it. */
    fun address(input: String): Address {
        val s = input.trim()
        if (s.isEmpty()) return Address.NotAnAddress
        val withScheme = if (s.startsWith("http://") || s.startsWith("https://")) s else "https://$s"
        val host = parseUri(withScheme)?.host?.lowercase()?.removePrefix("[")?.removeSuffix("]")
        if (host != null && isLoopback(host)) return Api.normalize(s)?.let { Address.Local(it) } ?: Address.NotAnAddress
        if (s.startsWith("http://")) return Address.Insecure
        return Api.normalize(s)?.let { Address.Remote(it) } ?: Address.NotAnAddress
    }

    /** What the screen says of an [address] that is refused before it is asked, or of a [Address.Local] that didn't answer. */
    fun words(address: Address): String? = when (address) {
        is Address.Remote -> null
        is Address.Local -> tr("That address is on a computer, and only that computer reaches it: a phone can't. Use your botdot's address on your tailnet, the one you open in the browser on the phone.")
        Address.Insecure -> tr("Use HTTPS for a remote botdot server.")
        Address.NotAnAddress -> tr("That doesn't look like an address.")
    }

    /** What came of an address: the botdot to keep ([frontDoor]: it asks for a sign-in, ADR 028), or what to say. */
    sealed interface Outcome {
        data class Connected(val url: String, val frontDoor: Boolean) : Outcome
        data class Refused(val words: String) : Outcome
    }

    /**
     * What was [typed], read ([address]) and asked whether it is a botdot this app can talk to: the one connect step of
     * both phones' address screens. A front door (ADR 028) is botdot, and which botdot is behind it is known once
     * signed in. An address on the device that doesn't answer is explained as one ([words]).
     */
    @Throws(Exception::class)
    suspend fun connect(typed: String): Outcome {
        val a = address(typed)
        val url = when (a) {
            is Address.Remote -> a.url
            is Address.Local -> a.url
            else -> return Outcome.Refused(words(a)!!)
        }
        val r = runCatching { Api(url).version() }
        r.exceptionOrNull()?.let { if (it is kotlinx.coroutines.CancellationException) throw it }
        val failed = answer(r.getOrNull(), r.exceptionOrNull()) ?: return Outcome.Connected(url, r.getOrNull()?.frontDoor == true)
        return Outcome.Refused(if (a is Address.Local && r.isFailure) words(a)!! else failed)
    }

    /** What [connect] says of the version [v] an address answered, or of the [failure] it answered with instead. */
    internal fun answer(v: VersionInfo?, failure: Throwable?): String? {
        return when {
            // Before botdot had /api/version (it answers "Unknown endpoint").
            failure is ApiException && failure.status == 404 -> tr("This botdot is older than the app. Ask its admin to update it, then connect again.")
            // A failure is never "connected": one without words says the connection dropped.
            failure != null -> failure.message?.ifBlank { null } ?: tr("The connection dropped")
            v == null || v.app != "bot-dot" -> tr("That address answers, but it isn't botdot.")
            v.frontDoor -> null
            v.apiVersion > API_VERSION -> tr("This botdot is newer than the app. Update the app.")
            v.apiVersion < API_VERSION -> tr("This botdot is older than the app. Ask its admin to update it.")
            else -> null
        }
    }

    private fun isLoopback(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".localhost") || host == "::1" || host == "0:0:0:0:0:0:0:1") return true
        val parts = host.split('.')
        return parts.size == 4 && parts[0] == "127" && parts.all { it.toIntOrNull() in 0..255 }
    }
}
