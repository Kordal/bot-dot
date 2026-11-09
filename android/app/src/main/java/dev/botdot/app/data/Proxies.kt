package dev.botdot.app.data

import kotlinx.serialization.Serializable

/**
 * The account's proxies (ADR 171, docs/api.md "Proxies"): HTTP or SOCKS5 servers the bots' browsers go out through.
 * botdot never hands out a login's password, only whether there is one; an empty password in a change keeps it.
 */
@Serializable
data class ProxyTest(val ok: Boolean = false, val ip: String? = null, val country: String? = null, val city: String? = null, val ms: Double? = null, val error: String? = null)

@Serializable
data class Proxy(
    val id: String,
    val name: String = "",
    val type: String = "socks5",
    val host: String = "",
    val port: Int = 0,
    val username: String = "",
    val hasPassword: Boolean = false,
    val lastTest: ProxyTest? = null,
)

@Serializable
data class ProxyList(val proxies: List<Proxy> = emptyList(), val default: String = "")

@Serializable
data class ProxySaved(val proxy: Proxy)

/** A proxy as the form has it, before it is saved. */
data class ProxyForm(val name: String = "", val type: String = "socks5", val host: String = "", val port: String = "", val username: String = "", val password: String = "")

object Proxies {
    const val FEATURE = "proxies"
    fun shows(features: List<String>?) = FEATURE in features.orEmpty()

    /** A country's flag from its two letters: "PL" → 🇵🇱. */
    fun flag(cc: String?): String {
        if (cc == null || !Regex("^[A-Z]{2}$").matches(cc)) return ""
        return cc.map { String(Character.toChars(0x1f1a5 + it.code)) }.joinToString("")
    }

    /** Where a test came out, in a few words: "🇵🇱 Warsaw", or that it doesn't work. */
    fun where(t: ProxyTest?): String = when {
        t == null -> ""
        t.ok -> listOf(flag(t.country), t.city?.ifBlank { null } ?: t.country.orEmpty()).filter { it.isNotBlank() }.joinToString(" ")
        else -> tr("Not working")
    }

    /** What a failed test said, with a capital first letter. */
    fun said(error: String?): String = error.orEmpty().replaceFirstChar { it.uppercase() }

    /**
     * A pasted address in Host fills the form, as botdot reads it (lib/proxies.js parsed): socks5://user:pass@host:port,
     * http://host:port, host:port:user:pass or host:port. Null when it is none of them.
     */
    fun pasted(text: String, form: ProxyForm): ProxyForm? {
        val raw = text.trim()
        Regex("^(socks5h?|socks|https?)://(.+)$", RegexOption.IGNORE_CASE).find(raw)?.let { m ->
            val rest = m.groupValues[2]
            val at = rest.lastIndexOf('@')
            val login = if (at >= 0) rest.substring(0, at) else ""
            val address = if (at >= 0) rest.substring(at + 1) else rest
            val colon = address.lastIndexOf(':')
            val host = (if (colon > 0 && !address.endsWith("]")) address.substring(0, colon) else address).removePrefix("[").removeSuffix("]")
            val port = if (colon > 0 && !address.endsWith("]")) address.substring(colon + 1).takeWhile { it.isDigit() } else ""
            val user = login.substringBefore(':').let { decode(it) }
            val word = if (':' in login) decode(login.substringAfter(':')) else ""
            return form.copy(type = if (m.groupValues[1].lowercase().startsWith("socks")) "socks5" else "http", host = host,
                port = port.ifEmpty { form.port }, username = user.ifEmpty { form.username }, password = word.ifEmpty { form.password })
        }
        val parts = raw.split(':')
        if (parts.size == 4 && parts[1].isNotEmpty() && parts[1].all { it.isDigit() }) return form.copy(host = parts[0], port = parts[1], username = parts[2], password = parts[3])
        if (parts.size == 2 && parts[1].isNotEmpty() && parts[1].all { it.isDigit() }) return form.copy(host = parts[0], port = parts[1])
        return null
    }

    private fun decode(s: String) = runCatching { java.net.URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") }.getOrDefault(s)
}
