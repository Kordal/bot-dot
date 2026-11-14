package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Instant
import kotlinx.datetime.TimeZone

/** What the shared data layer does alike on both phones at the edges of an address and a time zone. */
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

    @Test fun aFixedOffsetZoneIsUsedNotThePhones() {
        assertEquals("02:30", formatDate(Instant.parse("2026-01-01T00:30:00Z"), "HH:mm", "en", TimeZone.of("UTC+02:00")))
    }
}
