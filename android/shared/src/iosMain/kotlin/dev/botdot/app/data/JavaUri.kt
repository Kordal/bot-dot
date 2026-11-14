package dev.botdot.app.data

/**
 * An address read as java.net.URI reads it (RFC 2396), for iOS: what Android's code checked with URI stays checked
 * the same way. An address with a character URI refuses is none; an authority that is no server's has no host.
 */
internal object JavaUri {
    private val SHAPE = Regex("^(?:([^:/?#]+):)?(?://([^/?#]*))?([^?#]*)(?:\\?([^#]*))?(?:#(.*))?$")
    private val SCHEME = Regex("^[A-Za-z][A-Za-z0-9+.-]*$")
    private val LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
    private val HOSTNAME = Regex("^$LABEL(?:\\.$LABEL)*\\.?$")
    private val IPV4 = Regex("^\\d{1,3}(?:\\.\\d{1,3}){3}$")
    private val IPV6 = Regex("^\\[[0-9A-Fa-f:.]+(?:%[A-Za-z0-9._~-]+)?]$")
    private val USER = Regex("^(?:[A-Za-z0-9\\-_.!~*'();:&=+$,]|%[0-9A-Fa-f]{2})*$")
    // Characters URI takes somewhere: unreserved, reserved, escapes and any other non-ASCII, non-space character.
    private const val ALLOWED = "-_.!~*'();/?:@&=+$,[]#%"

    fun parse(value: String): UriParts? {
        if (value.isEmpty()) return UriParts(null, null, null, null)
        for ((i, c) in value.withIndex()) {
            val ok = c.isLetterOrDigit() && c.code < 128 || c in ALLOWED || c.code >= 128 && !c.isWhitespace() && !c.isISOControl()
            if (!ok) return null
            if (c == '%' && (i + 2 >= value.length || !value[i + 1].isHex() || !value[i + 2].isHex())) return null
        }
        val m = SHAPE.find(value) ?: return null
        val scheme = m.groupValues[1].ifEmpty { null }
        if (scheme != null && !SCHEME.matches(scheme)) return null
        if (value.startsWith(":")) return null
        val authority = m.groups[2]?.value
        val query = m.groups[4]?.value
        if (scheme != null && authority == null && m.groupValues[3].isNotEmpty() && !m.groupValues[3].startsWith("/")) {
            // An opaque URI ("mailto:a@b"): no host, no query.
            return UriParts(scheme, null, null, null)
        }
        var host: String? = null
        var user: String? = null
        if (!authority.isNullOrEmpty()) {
            val at = authority.lastIndexOf('@')
            val u = if (at >= 0) authority.substring(0, at) else null
            val hostPort = authority.substring(at + 1)
            val colon = if (hostPort.startsWith("[")) hostPort.indexOf("]:").let { if (it < 0) -1 else it + 1 } else hostPort.lastIndexOf(':')
            val h = if (colon >= 0) hostPort.substring(0, colon) else hostPort
            val port = if (colon >= 0) hostPort.substring(colon + 1) else ""
            val server = (u == null || USER.matches(u)) && port.all { it.isDigit() } &&
                (IPV6.matches(h) || IPV4.matches(h) && h.split('.').all { it.toInt() <= 255 } || HOSTNAME.matches(h) && !IPV4.matches(h))
            if (server && h.isNotEmpty()) { host = h; user = u }
            else if (authority.contains('[') || authority.contains(']')) return null
        }
        return UriParts(scheme, host, user, query)
    }

    private fun Char.isHex() = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'
}
