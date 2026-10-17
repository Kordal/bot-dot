package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * One update for every account, a backup per account (#473, ADR 028): the app has no update of botdot (the admin
 * updates every account at once, on the admin page), and it downloads the account's backup with its own session,
 * which the phone's browser doesn't have. `test/updates-by-admin.test.js` holds the server's and the web page's side.
 */
class UpdatesByAdminTest {
    private val sources = File("src/main/java/dev/botdot/app").walkTopDown().filter { it.extension == "kt" }.toList()

    @Test fun theAppCallsNoUpdateOfBotdot() {
        val calls = sources.flatMap { f -> f.readLines().filter { "\"/updates" in it }.map { "${f.name}: ${it.trim()}" } }
        assertEquals("no route of botdot's update is called", emptyList<String>(), calls)
    }

    @Test fun settingsHasNoUpdate() {
        val settings = sources.first { it.name == "SettingsScreen.kt" }.readText()
        assertTrue("no Updates section", "Section(\"Updates\")" !in settings)
        assertTrue("no update button of botdot", "applyUpdate" !in settings && "checkUpdates" !in settings)
    }

    @Test fun theBackupIsDownloadedWithTheSession() {
        val kept = mutableMapOf("https://botdot.example.com" to "s3cret")
        val session = Session(object : Session.Keep {
            override fun read(server: String) = kept[server]
            override fun write(server: String, token: String?) { if (token == null) kept.remove(server) else kept[server] = token }
        })
        val api = Api("https://botdot.example.com", session)
        assertEquals(mapOf("Cookie" to "botdot_session=s3cret"), BackupDownload.headers(api))
        assertEquals("https://botdot.example.com/api/backups/bot-dot-20261016-0300.bdb", api.backupUrl("bot-dot-20261016-0300.bdb"))
        kept.clear()
        assertEquals("signed out, nothing is sent", emptyMap<String, String>(), BackupDownload.headers(api))
        assertEquals("without a session (an older botdot)", emptyMap<String, String>(), BackupDownload.headers(Api("https://botdot.example.com")))
    }
}
