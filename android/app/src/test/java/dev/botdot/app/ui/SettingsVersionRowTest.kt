package dev.botdot.app.ui

import dev.botdot.app.BuildConfig
import dev.botdot.app.data.VersionInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Settings → Version (#1610): the row shows only while Advanced is on, with the app's own versionName and the server's version. */
class SettingsVersionRowTest {
    private val server = VersionInfo(version = "0.1.0", short = "659cb5e")

    @Test fun showsTheAppAndTheServerWhileAdvancedIsOn() {
        assertEquals("App ${BuildConfig.VERSION_NAME} · Server 0.1.0 (659cb5e)", versionRowLine(true, server))
    }

    @Test fun isHiddenWhileAdvancedIsOff() {
        assertNull(versionRowLine(false, server))
    }

    @Test fun isHiddenWhenTheServerNamesNoVersion() {
        assertNull(versionRowLine(true, VersionInfo()))
        assertNull(versionRowLine(true, null))
    }
}
