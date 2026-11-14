package dev.botdot.app.data

import io.ktor.utils.io.ByteReadChannel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Instant
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.TimeZone

/** What the shared data layer does alike on both phones at the edges of an address, a stream and a time zone. */
class SharedEdgesTest {
    @Test fun anAddressIsItsRootWithoutPathQueryOrFragment() {
        assertEquals("https://x.example", Api.normalize("https://x.example/#a"))
        assertEquals("https://x.example:8443", Api.normalize("x.example:8443/a/b?c=1#d"))
    }

    @Test fun anIpv6HostIsOneSessionWithBracketsOrWithout() {
        assertEquals("http://[::1]:4747", Session.originOf("http", "::1", 4747))
        assertEquals("http://[::1]:4747", Session.originOf("http", "[::1]", 4747))
        assertEquals("https://my-vm.ts.net", Session.originOf("https", "My-VM.ts.net", 443))
    }

    @Test fun aStreamsLinesEndAtCrlfLfOrCr() = runTest {
        val got = mutableListOf<Triple<String?, String?, String>>()
        Sse.read(ByteReadChannel("id: 1\r\nevent: a\r\ndata: x\r\n\r\nevent: b\rdata: y\r\rdata: z\n\n".encodeToByteArray())) { id, type, data -> got.add(Triple(id, type, data)) }
        assertEquals(listOf<Triple<String?, String?, String>>(Triple("1", "a", "x"), Triple("1", "b", "y"), Triple("1", null, "z")), got)
    }

    @Test fun aFixedOffsetZoneIsUsedNotThePhones() {
        assertEquals("02:30", formatDate(Instant.parse("2026-01-01T00:30:00Z"), "HH:mm", "en", TimeZone.of("UTC+02:00")))
    }
}
