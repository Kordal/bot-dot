package dev.botdot.app.data

import kotlinx.serialization.Serializable
import java.net.URI
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

internal object ReleaseTrust {
    // P-256 SPKI DER, base64. Production release key, pinned 2026-10-17.
    const val KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdDU16CG2HWzALPBB5pDx5BQHKTrcfdHF4t90R++nTnsMvIQKGQq/o26wIF0w0o6OEt4RoPi+Sf2rJsZmz3vvng=="
}

@Serializable
data class ReleaseManifest(val app: String, val version: Long, val revision: String, val file: String, val sha256: String, val signature: String) {
    internal fun verify(expectedApp: String, installed: Long, publicKey: String = ReleaseTrust.KEY) {
        if (app != expectedApp || version !in 1..9_007_199_254_740_991L || !Regex("[0-9a-f]{40}").matches(revision) ||
            !Regex("[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}").matches(file) || !Regex("[0-9a-f]{64}").matches(sha256)) throw ApiException(tr("Invalid release manifest."))
        if (version < installed) throw ApiException(tr("An older release cannot be installed."))
        val valid = runCatching {
            val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(publicKey)))
            Signature.getInstance("SHA256withECDSA").run {
                initVerify(key)
                update("botdot-release-v1\n$app\n$version\n$revision\n$file\n$sha256\n".toByteArray(Charsets.UTF_8))
                verify(Base64.getDecoder().decode(signature))
            }
        }.getOrDefault(false)
        if (!valid) throw ApiException(tr("The release signature is invalid or no release key is pinned."))
    }

    companion object {
        fun secureURL(value: String): Boolean = runCatching {
            val u = URI(value)
            val host = u.host?.lowercase() ?: return false
            val parts = host.split('.')
            val loopback = host in listOf("localhost", "::1", "[::1]") ||
                parts.size == 4 && parts[0] == "127" && parts.all { it.toIntOrNull() in 0..255 }
            u.userInfo == null && (u.scheme == "https" || u.scheme == "http" && loopback)
        }.getOrDefault(false)
    }
}
