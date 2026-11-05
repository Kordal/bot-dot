package dev.botdot.app.ui

import dev.botdot.app.data.BackupInfo
import dev.botdot.app.data.OffsiteBackup
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/** Settings → Backups (ADR 158): the row says the account's off-site backup, and a download being made. */
class BackupValueTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun theRowSaysTheOffSiteBackup() {
        assertEquals("Off", backupValue(BackupInfo(), false))
        assertEquals("Off", backupValue(BackupInfo(OffsiteBackup("off")), false))
        assertEquals("Backing up…", backupValue(BackupInfo(OffsiteBackup("backing-up", "2026-11-05T02:14:00Z")), false))
        assertEquals("Failed", backupValue(BackupInfo(OffsiteBackup("failed", "2026-11-04T02:14:00Z", late = true)), false))
        assertEquals("No backup yet", backupValue(BackupInfo(OffsiteBackup("done")), false))
        assertEquals(shortTime("2026-11-05T02:14:00Z"), backupValue(BackupInfo(OffsiteBackup("done", "2026-11-05T02:14:00Z")), false))
        assertEquals("Preparing…", backupValue(BackupInfo(OffsiteBackup("done", "2026-11-05T02:14:00Z")), true))
        assertEquals("Preparing…", backupValue(BackupInfo(preparing = true), false))
    }

    @Test fun readsWhatTheServerSends() {
        val b = json.decodeFromString<BackupInfo>("""{"offsite":{"state":"done","lastSuccess":"2026-11-05T02:14:00.000Z","late":false},"preparing":false,"minPassphrase":12}""")
        assertEquals(OffsiteBackup("done", "2026-11-05T02:14:00.000Z", false), b.offsite)
        // An older server's answer (before ADR 158): nothing it knows of the off-site backup.
        val old = json.decodeFromString<BackupInfo>("""{"configured":true,"running":false,"last":{"name":"bot-dot-20261101-030000.bdb"},"count":3}""")
        assertEquals(null, old.offsite)
        assertEquals(12, old.minPassphrase)
    }
}
