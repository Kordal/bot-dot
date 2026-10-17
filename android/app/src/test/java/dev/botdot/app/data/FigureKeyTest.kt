package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** When the app asks the server for its figure definition again (BotDotApp.followFigure): the key it compares. */
class FigureKeyTest {
    private fun version(json: String) = Api.JSON.decodeFromString(VersionInfo.serializer(), json)
    private val before = version("""{"app":"bot-dot","version":"0.1.0","revision":"659cb5e0aa","short":"659cb5e","features":["events","figure","outfits"]}""")

    @Test fun anUpdateChangesTheKeyThoughTheVersionStays() {
        val after = version("""{"app":"bot-dot","version":"0.1.0","revision":"a28b646f11","short":"a28b646","features":["events","figure","outfits"]}""")
        assertEquals(before.version, after.version)
        assertNotEquals(before.figureKey, after.figureKey)
    }

    @Test fun theSameServerKeepsItsKey() {
        // The feed's hello carries the version again with every reconnect: nothing to fetch when nothing changed.
        assertEquals(before.figureKey, before.copy(docker = true, apiVersion = 9).figureKey)
    }

    @Test fun aNewVersionChangesTheKeyToo() {
        assertNotEquals(before.figureKey, before.copy(version = "0.2.0").figureKey)
    }

    @Test fun aServerWithoutTheFigureHasNoKey() {
        assertNull(before.copy(features = listOf("events")).figureKey)
        assertNull(version("""{"app":"bot-dot","version":"0.1.0"}""").figureKey)
    }

    @Test fun aServerThatSendsNoRevisionStillHasAKey() {
        val old = version("""{"app":"bot-dot","version":"0.1.0","features":["figure"]}""")
        assertEquals("0.1.0 ", old.figureKey)
        assertNotEquals(old.figureKey, old.copy(version = "0.1.1").figureKey)
        assertEquals("0.1.0 ", version("""{"version":"0.1.0","revision":null,"features":["figure"]}""").figureKey)
    }
}
