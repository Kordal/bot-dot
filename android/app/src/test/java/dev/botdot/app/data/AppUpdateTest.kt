package dev.botdot.app.data

import dev.botdot.app.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The line for a newer app (ADR 173): the GitHub build offers it, the Google Play build never does. */
class AppUpdateTest {
    private val newer = VersionInfo(android = AndroidRelease(versionCode = BuildConfig.VERSION_CODE + 1))

    @Test fun theGithubBuildOffersANewerApp() {
        assertEquals(BuildConfig.VERSION_CODE + 1, AppUpdate.newer(newer, selfUpdate = true)?.versionCode)
    }

    @Test fun theGithubBuildOffersNothingOlderOrTheSame() {
        assertNull(AppUpdate.newer(VersionInfo(android = AndroidRelease(versionCode = BuildConfig.VERSION_CODE)), selfUpdate = true))
    }

    @Test fun thePlayBuildNeverOffersOne() {
        assertNull(AppUpdate.newer(newer, selfUpdate = false))
    }

    @Test fun theDebugBuildUpdatesItself() {
        assertEquals(true, BuildConfig.SELF_UPDATE)
    }
}
