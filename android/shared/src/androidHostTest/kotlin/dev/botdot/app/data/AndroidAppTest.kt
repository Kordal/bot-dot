package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** The Android app's sign-in page names android, as before the shared layer (docs/api.md). */
class AndroidAppTest {
    @Test fun itSignsInAsAndroid() = assertEquals("android", signInApp)
}
