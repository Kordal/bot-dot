package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Settings → Version, while Advanced is on (#1610): the app's own versionName and the server's version and short
 * revision, in one line the owner can read out; an older server without `short` gives its version alone, and one
 * that names no version leaves the row out.
 */
class AppVersionLineTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun theAppAndTheServerWithItsShortRevision() {
        val server = VersionInfo(version = "0.1.0", short = "659cb5e")
        assertEquals("App 0.1.1234 · Server 0.1.0 (659cb5e)", AppVersionLine.of("0.1.1234", server))
    }

    @Test fun anOlderServerWithoutShortGivesItsVersionAlone() {
        assertEquals("App 0.1.1234 · Server 0.1.0", AppVersionLine.of("0.1.1234", VersionInfo(version = "0.1.0")))
        assertEquals("App 0.1.1234 · Server 0.1.0", AppVersionLine.of("0.1.1234", VersionInfo(version = "0.1.0", short = "")))
    }

    @Test fun aServerThatNamesNeitherLeavesTheRowOut() {
        assertNull(AppVersionLine.of("0.1.1234", VersionInfo()))
        assertNull(AppVersionLine.of("0.1.1234", VersionInfo(short = "659cb5e")))
        assertNull(AppVersionLine.of("0.1.1234", null)) // not read yet
    }

    @Test fun theVersionAnswerKeepsWhatItNeedsAndIgnoresTheRest() {
        val v = json.decodeFromString<VersionInfo>("""{"app":"bot-dot","version":"0.1.0","revision":"659cb5e0000","short":"659cb5e","future":1}""")
        assertEquals("App 0.1.7 · Server 0.1.0 (659cb5e)", AppVersionLine.of("0.1.7", v))
    }
}
