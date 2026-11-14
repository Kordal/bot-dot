package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The iPhone signs in and talks to botdot as the iOS app (docs/api.md: app ios; lib/activity.js: botdot-ios/). */
class IosAppTest {
    @Test fun itSignsInAsIos() = assertEquals("ios", signInApp)
    @Test fun itNamesItselfOnEveryRequest() = assertTrue(userAgent.orEmpty().startsWith("botdot-ios/"), userAgent)
}
