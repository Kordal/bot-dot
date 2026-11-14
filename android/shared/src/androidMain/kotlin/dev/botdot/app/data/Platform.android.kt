package dev.botdot.app.data

import android.os.SystemClock
import androidx.compose.runtime.mutableStateOf
import kotlin.time.Instant
import kotlin.time.toJavaInstant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toJavaZoneId
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Month
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Base64
import java.util.Locale

internal actual fun elapsedRealtimeMs(): Long = SystemClock.elapsedRealtime()

internal actual fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

private val random by lazy { SecureRandom() }
internal actual fun secureRandomBytes(n: Int): ByteArray = ByteArray(n).also(random::nextBytes)

internal actual fun verifyP256(publicKey: String, data: ByteArray, signature: String): Boolean = runCatching {
    val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(publicKey)))
    Signature.getInstance("SHA256withECDSA").run {
        initVerify(key)
        update(data)
        verify(Base64.getDecoder().decode(signature))
    }
}.getOrDefault(false)

internal actual fun parseUri(value: String): UriParts? =
    runCatching { URI(value) }.getOrNull()?.let { UriParts(it.scheme, it.host, it.userInfo, it.rawQuery) }

internal actual fun formEncode(s: String): String = URLEncoder.encode(s, "UTF-8")

private val NOT_NAME = Regex("[^\\p{L}\\p{N}_-]")
internal actual fun nameChars(s: String): String = s.replace(NOT_NAME, "")

internal actual fun formDecode(s: String): String = URLDecoder.decode(s, "UTF-8")

/** The JVM's locale for a language tag: "" is Locale.ROOT, null the phone's own. */
fun localeOf(tag: String?): Locale = when (tag) {
    null -> Locale.getDefault()
    "" -> Locale.ROOT
    else -> Locale.forLanguageTag(tag)
}

actual fun formatIn(locale: String?, pattern: String, vararg args: Any?): String =
    if (locale == null) String.format(pattern, *args) else String.format(localeOf(locale), pattern, *args)

actual fun formatDate(at: Instant, pattern: String, locale: String?, zone: TimeZone): String =
    (if (locale == null) DateTimeFormatter.ofPattern(pattern) else DateTimeFormatter.ofPattern(pattern, localeOf(locale)))
        .format(at.toJavaInstant().atZone(zone.toJavaZoneId()))

actual fun monthShort(month: Int, locale: String): String = Month.of(month).getDisplayName(TextStyle.SHORT, localeOf(locale))

/** The interface language's locale, for dates, month and day names. */
val I18n.locale: Locale get() = Locale.forLanguageTag(language)

actual fun <T> observed(initial: T): Observed<T> = object : Observed<T> {
    private val state = mutableStateOf(initial)
    override var value: T
        get() = state.value
        set(v) { state.value = v }
}
