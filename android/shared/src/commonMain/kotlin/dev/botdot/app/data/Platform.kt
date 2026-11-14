package dev.botdot.app.data

import kotlin.math.roundToLong
import kotlin.time.Instant
import kotlinx.datetime.TimeZone

// What each phone does its own way (ADR 242). Android keeps the JVM's code it ran before the data layer was shared
// (androidMain), so nothing changes there; iOS does the same with Foundation and Security (iosMain).

/** Milliseconds since the phone started, never going back (Android's SystemClock.elapsedRealtime). */
internal expect fun elapsedRealtimeMs(): Long

/** The SHA-256 of [bytes]. */
internal expect fun sha256(bytes: ByteArray): ByteArray

/** [n] bytes from the phone's secure random source. */
internal expect fun secureRandomBytes(n: Int): ByteArray

/** Whether [signature] (DER, base64) is [data]'s ECDSA P-256 SHA-256 signature by [publicKey] (SPKI DER, base64). */
internal expect fun verifyP256(publicKey: String, data: ByteArray, signature: String): Boolean

/** The parts of an address as java.net.URI reads it, or null when it is no URI. */
internal class UriParts(val scheme: String?, val host: String?, val userInfo: String?, val rawQuery: String?)

internal expect fun parseUri(value: String): UriParts?

/** [s] encoded as java.net.URLEncoder encodes it in UTF-8: a space is "+". */
internal expect fun formEncode(s: String): String

/** [s] decoded as java.net.URLDecoder decodes it in UTF-8; a broken escape throws IllegalArgumentException. */
internal expect fun formDecode(s: String): String

/**
 * String.format in [locale]: a language tag ("pl", "en-US"), "" for no language's conventions (Locale.ROOT), or null
 * for the phone's own. Only %d, %s, %f with flags, width and precision are used.
 */
expect fun formatIn(locale: String?, pattern: String, vararg args: Any?): String

/** [at] in [zone] as [pattern] (DateTimeFormatter's letters) writes it in [locale] (a language tag, or null for the phone's). */
expect fun formatDate(at: Instant, pattern: String, locale: String?, zone: TimeZone = TimeZone.currentSystemDefault()): String

/** The short name of [month] (1 to 12) in [locale]: "Jan", "sty". */
expect fun monthShort(month: Int, locale: String): String

/** Math.round: the nearest whole number, halves up, and 0 for NaN. */
internal fun jround(v: Double): Long = if (v.isNaN()) 0L else v.roundToLong()

/** The character of Unicode code point [cp], as String(Character.toChars(cp)) makes it. */
internal fun codePointString(cp: Int): String =
    if (cp < 0x10000) cp.toChar().toString()
    else charArrayOf((0xD800 + ((cp - 0x10000) shr 10)).toChar(), (0xDC00 + ((cp - 0x10000) and 0x3ff)).toChar()).concatToString()

/** A value whose changes the screens see: on Android Compose state, so a screen that read it draws again. */
interface Observed<T> { var value: T }

expect fun <T> observed(initial: T): Observed<T>
