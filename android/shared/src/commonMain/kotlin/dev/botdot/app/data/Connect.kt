package dev.botdot.app.data

/**
 * Where's your botdot? The address a phone app is given, read and checked once for both phones (ADR 242): what the
 * Android app's connect screen and the iOS app's address screen say.
 */
object Connect {
    /** The API this app understands (docs/api.md: `GET /api/version`'s `apiVersion`). */
    const val API_VERSION = 1

    /** An address as typed: one to check, one only this computer reaches, or none. */
    sealed interface Address {
        data class Remote(val url: String) : Address
        /** A botdot on the computer itself (the desktop app's local one: localhost, 127.x, ::1): no phone reaches it. */
        data object Local : Address
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
        if (host != null && isLoopback(host)) return Address.Local
        if (s.startsWith("http://")) return Address.Insecure
        return Api.normalize(s)?.let { Address.Remote(it) } ?: Address.NotAnAddress
    }

    /** What the screen says of an [address] that can't be checked; null for one that can. */
    fun words(address: Address): String? = when (address) {
        is Address.Remote -> null
        Address.Local -> tr("That address is on a computer, and only that computer reaches it: a phone can't. Use your botdot's address on your tailnet, the one you open in the browser on the phone.")
        Address.Insecure -> tr("Use HTTPS for a remote botdot server.")
        Address.NotAnAddress -> tr("That doesn't look like an address.")
    }

    /**
     * Asks [url] whether it is a botdot this app can talk to: null when it is, else what to tell the owner. A front
     * door (ADR 028) is botdot, and which botdot is behind it is known once signed in.
     */
    suspend fun check(url: String): String? {
        val r = runCatching { Api(url).version() }
        val v = r.getOrNull()
        val failure = r.exceptionOrNull()
        return when {
            failure is kotlinx.coroutines.CancellationException -> throw failure
            // Before botdot had /api/version (it answers "Unknown endpoint").
            failure is ApiException && failure.status == 404 -> tr("This botdot is older than the app. Ask its admin to update it, then connect again.")
            failure != null -> failure.message
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
