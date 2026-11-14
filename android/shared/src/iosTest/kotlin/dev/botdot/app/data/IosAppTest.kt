package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertTrue

/** The iPhone signs in and talks to botdot as the iOS app (docs/api.md: app ios; lib/activity.js: botdot-ios/). */
class IosAppTest {
    @Test fun itSignsInAsIos() {
        val page = Handoff.start("https://hq.example.com", 0).page
        assertTrue(page.startsWith("https://hq.example.com/sign-in?app=ios&handoff="), page)
    }
    @Test fun itNamesItselfOnEveryRequest() = assertTrue(userAgent.orEmpty().startsWith("botdot-ios/"), userAgent)
}
