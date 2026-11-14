package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals

class ShortWhyTest {
    @Test fun anNSErrorSaysOnlyItsDescription() = assertEquals(
        "Could not connect to the server",
        shortWhy("Exception in http request: Error Domain=NSURLErrorDomain Code=-1004 \"Could not connect to the server.\" UserInfo={_kCFStreamErrorCodeKey=61, NSLocalizedDescription=Could not connect to the server., NSErrorFailingURLKey=http://localhost:62804/api/bots}"),
    )
    @Test fun anyOtherMessageStands() = assertEquals("timeout", shortWhy("timeout"))
    @Test fun noMessageIsNone() = assertEquals(null, shortWhy(null))
}
