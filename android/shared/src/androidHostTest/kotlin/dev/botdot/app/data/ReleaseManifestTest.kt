package dev.botdot.app.data

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class ReleaseManifestTest {
    @Test fun sharedFixtureRejectsTamperingAndRollback() {
        val vectors = Json.parseToJsonElement(File(System.getProperty("releaseVectors")).readText()).jsonObject
        val key = vectors.getValue("publicKey").jsonPrimitive.content
        val valid = Json.decodeFromString<ReleaseManifest>(vectors.getValue("valid").toString())
        assertTrue(ReleaseTrust.KEY.isNotBlank())
        assertNotEquals(key, ReleaseTrust.KEY)
        assertThrows(ApiException::class.java) { valid.verify("mac", 41) }
        valid.verify("mac", 41, key)
        for (candidate in listOf(valid.copy(sha256 = "0".repeat(64)), valid.copy(signature = "AAAA"))) {
            assertThrows(ApiException::class.java) { candidate.verify("mac", 41, key) }
        }
        assertThrows(ApiException::class.java) { valid.verify("mac", 43, key) }
        assertThrows(ApiException::class.java) { valid.verify("android", 41, key) }
    }
    @Test fun transport() {
        for (url in listOf("https://example.com", "http://127.0.0.1:4747", "http://[::1]:4747")) assertTrue(ReleaseManifest.secureURL(url))
        for (url in listOf("http://example.com", "http://10.0.0.1", "http://127.0.0.1.evil.example")) assertFalse(ReleaseManifest.secureURL(url))
    }
    @Test fun anOldPlainHttpAddressIsAskedForAgainNotUsed() {
        assertEquals("https://vm.tailnet.ts.net", usableServer("https://vm.tailnet.ts.net"))
        assertEquals("http://localhost:4801", usableServer("http://localhost:4801"))
        assertNull(usableServer("http://10.0.2.2:4840"))
        assertNull(usableServer(null))
    }
}
