@file:OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)

package dev.botdot.app.data

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.engine.darwin.DarwinHttpRequestException
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.http.URLBuilder
import io.ktor.http.Url
import io.ktor.http.encodedPath
import kotlin.io.encoding.Base64
import kotlin.time.Instant
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.convert
import kotlinx.cinterop.ptr
import kotlinx.cinterop.usePinned
import kotlinx.datetime.TimeZone
import platform.CoreCrypto.CC_SHA256
import platform.CoreCrypto.CC_SHA256_DIGEST_LENGTH
import platform.CoreFoundation.CFDataCreate
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFDictionarySetValue
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.kCFTypeDictionaryKeyCallBacks
import platform.CoreFoundation.kCFTypeDictionaryValueCallBacks
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSCharacterSet
import platform.Foundation.NSLocale
import platform.Foundation.NSURLErrorAppTransportSecurityRequiresSecureConnection
import platform.Foundation.NSURLErrorCannotConnectToHost
import platform.Foundation.NSURLErrorCannotFindHost
import platform.Foundation.NSURLErrorDNSLookupFailed
import platform.Foundation.NSURLErrorNotConnectedToInternet
import platform.Foundation.NSURLErrorSecureConnectionFailed
import platform.Foundation.NSURLErrorServerCertificateUntrusted
import platform.Foundation.NSTimeZone
import platform.Foundation.currentLocale
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.Foundation.decimalSeparator
import platform.Foundation.groupingSeparator
import platform.Foundation.timeZoneForSecondsFromGMT
import platform.Foundation.timeZoneWithName
import kotlinx.datetime.offsetAt
import platform.Security.SecKeyCreateWithData
import platform.Security.SecKeyVerifySignature
import platform.Security.SecRandomCopyBytes
import platform.Security.kSecAttrKeyClass
import platform.Security.kSecAttrKeyClassPublic
import platform.Security.kSecAttrKeyType
import platform.Security.kSecAttrKeyTypeECSECPrimeRandom
import platform.Security.kSecKeyAlgorithmECDSASignatureMessageX962SHA256
import platform.Security.kSecRandomDefault
import platform.posix.CLOCK_MONOTONIC
import platform.posix.clock_gettime_nsec_np

internal actual fun elapsedRealtimeMs(): Long = (clock_gettime_nsec_np(CLOCK_MONOTONIC.convert()) / 1_000_000u).toLong()

internal actual fun sha256(bytes: ByteArray): ByteArray {
    val out = UByteArray(CC_SHA256_DIGEST_LENGTH)
    out.usePinned { o ->
        if (bytes.isEmpty()) CC_SHA256(null, 0u, o.addressOf(0))
        else bytes.usePinned { b -> CC_SHA256(b.addressOf(0), bytes.size.convert(), o.addressOf(0)) }
    }
    return out.asByteArray()
}

internal actual fun secureRandomBytes(n: Int): ByteArray {
    val out = ByteArray(n)
    if (n > 0) out.usePinned { check(SecRandomCopyBytes(kSecRandomDefault, n.convert(), it.addressOf(0)) == 0) { "No secure random bytes" } }
    return out
}

private fun cfData(bytes: ByteArray) = bytes.asUByteArray().usePinned { CFDataCreate(null, if (bytes.isEmpty()) null else it.addressOf(0), bytes.size.convert()) }

internal actual fun verifyP256(publicKey: String, data: ByteArray, signature: String): Boolean = runCatching {
    val spki = Base64.decode(publicKey)
    // A P-256 key's SPKI ends with the point itself (04 || X || Y, 65 bytes), which is what Security takes.
    if (spki.size < 65 || spki[spki.size - 65] != 4.toByte()) return false
    val point = cfData(spki.copyOfRange(spki.size - 65, spki.size))
    val attrs = CFDictionaryCreateMutable(null, 2, kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr)
    CFDictionarySetValue(attrs, kSecAttrKeyType, kSecAttrKeyTypeECSECPrimeRandom)
    CFDictionarySetValue(attrs, kSecAttrKeyClass, kSecAttrKeyClassPublic)
    val key = SecKeyCreateWithData(point, attrs, null)
    val msg = cfData(data)
    val sig = cfData(Base64.decode(signature))
    try {
        key != null && SecKeyVerifySignature(key, kSecKeyAlgorithmECDSASignatureMessageX962SHA256, msg, sig, null)
    } finally {
        key?.let(::CFRelease); CFRelease(attrs); CFRelease(point); CFRelease(msg); CFRelease(sig)
    }
}.getOrDefault(false)

internal actual fun parseUri(value: String): UriParts? = JavaUri.parse(value)

internal actual fun formEncode(s: String): String = buildString {
    for (b in s.encodeToByteArray()) {
        val c = (b.toInt() and 0xff)
        when {
            c in 'a'.code..'z'.code || c in 'A'.code..'Z'.code || c in '0'.code..'9'.code || c == '.'.code || c == '-'.code || c == '*'.code || c == '_'.code -> append(c.toChar())
            c == ' '.code -> append('+')
            else -> { append('%'); append(HEX[c shr 4]); append(HEX[c and 0xf]) }
        }
    }
}
private const val HEX = "0123456789ABCDEF"

internal actual fun formDecode(s: String): String {
    val out = StringBuilder()
    var i = 0
    while (i < s.length) {
        when (val c = s[i]) {
            '+' -> { out.append(' '); i++ }
            '%' -> {
                // Consecutive escapes are one run of UTF-8 bytes, as URLDecoder reads them.
                val bytes = ArrayList<Byte>()
                while (i < s.length && s[i] == '%') {
                    require(i + 3 <= s.length) { "URLDecoder: Incomplete trailing escape (%) pattern" }
                    val hex = s.substring(i + 1, i + 3)
                    require(hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) { "URLDecoder: Illegal hex characters in escape (%) pattern" }
                    bytes += hex.toInt(16).toByte(); i += 3
                }
                out.append(bytes.toByteArray().decodeToString())
            }
            else -> { out.append(c); i++ }
        }
    }
    return out.toString()
}

private fun nsLocale(tag: String?): NSLocale = when (tag) {
    null -> NSLocale.currentLocale
    "" -> NSLocale(localeIdentifier = "en_US_POSIX")
    else -> NSLocale(localeIdentifier = tag.replace('-', '_'))
}

actual fun formatIn(locale: String?, pattern: String, vararg args: Any?): String {
    val l = nsLocale(locale)
    return JavaFormat.format(pattern, args, decimal = l.decimalSeparator, grouping = l.groupingSeparator)
}

actual fun formatDate(at: Instant, pattern: String, locale: String?, zone: TimeZone): String {
    val f = NSDateFormatter()
    f.locale = nsLocale(locale)
    f.dateFormat = pattern
    // A zone Foundation has no name for (a fixed offset, "UTC+02:00") is its offset at that moment, not the phone's zone.
    f.timeZone = NSTimeZone.timeZoneWithName(zone.id) ?: NSTimeZone.timeZoneForSecondsFromGMT(zone.offsetAt(at).totalSeconds.toLong())
    return f.stringFromDate(NSDate.dateWithTimeIntervalSince1970(at.toEpochMilliseconds() / 1000.0))
}

actual fun monthShort(month: Int, locale: String): String {
    val f = NSDateFormatter()
    f.locale = nsLocale(locale)
    return f.shortMonthSymbols[month - 1] as String
}

actual fun <T> observed(initial: T): Observed<T> = object : Observed<T> {
    override var value: T = initial
}

internal actual fun HttpRequestBuilder.track(went: Went): () -> Unit = {}

/** Whether URLSession had a connection when [e] came: a host not found or not reached never saw the request. */
internal actual fun sentOf(e: Throwable, went: Went): Boolean {
    if (e is io.ktor.client.network.sockets.ConnectTimeoutException) return false
    val code = (e as? DarwinHttpRequestException)?.origin?.code ?: return true
    return code !in setOf(NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed, NSURLErrorNotConnectedToInternet,
        NSURLErrorAppTransportSecurityRequiresSecureConnection, NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted)
}

internal actual fun httpEngine(): HttpClientEngine = Darwin.create()

/** The iPhone app has no name of its own on its requests yet: what botdot makes of it is the iOS app's work. */
internal actual val userAgent: String? = null

internal actual fun parseHttpAddress(s: String): HttpAddress? {
    val u = runCatching { Url(s) }.getOrNull()?.takeIf { it.host.isNotEmpty() && (it.protocol.name == "http" || it.protocol.name == "https") } ?: return null
    val root = URLBuilder(u).apply { encodedPath = "/"; encodedParameters.clear(); fragment = "" }.buildString()
    return HttpAddress(u.toString(), root)
}

internal actual fun nameChars(s: String): String = buildString {
    var i = 0
    while (i < s.length) {
        val c = s[i]
        // A letter or number past the first 65 536 (two chars) is asked of Foundation; one within them, of its category.
        if (c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate()) {
            val cp = 0x10000 + ((c.code - 0xD800) shl 10) + (s[i + 1].code - 0xDC00)
            if (NSCharacterSet.letterCharacterSet.longCharacterIsMember(cp.toUInt()) && !NSCharacterSet.nonBaseCharacterSet.longCharacterIsMember(cp.toUInt()) ||
                NSCharacterSet.decimalDigitCharacterSet.longCharacterIsMember(cp.toUInt())) append(c).append(s[i + 1])
            i += 2
            continue
        }
        if (c == '_' || c == '-' || c.isLetter() || c.category.code.startsWith("N")) append(c)
        i++
    }
}
