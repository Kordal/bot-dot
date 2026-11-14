package dev.botdot.app.data

import org.junit.Assert.assertTrue
import org.junit.Test

/** The Android app's sign-in page names android, as before the shared layer (docs/api.md). */
class AndroidAppTest {
    @Test fun itSignsInAsAndroid() {
        val page = Handoff.start("https://hq.example.com", 0).page
        assertTrue(page, page.startsWith("https://hq.example.com/sign-in?app=android&handoff="))
    }
}
