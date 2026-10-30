package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** What a proposed bot must reach on Android (#808): what a card carries, its gaps, what a gap offers, and the change a pick makes. */
class TeamReachesTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val p = json.decodeFromString<Proposed>("""{"key":"k1","name":"Homelab Keeper","computer":true,"logins":[{"need":"proxmox pve","id":"a1","name":"Proxmox pve"},{"need":"nas.lan"}],"ssh":[{"need":"backup.lan"}]}""")

    @Test fun `a card carries the computer and its needs, and a server from before has none`() {
        assertEquals(true, p.computer)
        assertEquals(listOf(Need("proxmox pve", "a1", "Proxmox pve"), Need("nas.lan")), p.logins)
        val old = json.decodeFromString<Proposed>("""{"key":"k2"}""")
        assertEquals(false, old.computer)
        assertEquals(emptyList<Pair<String, Need>>(), TeamReaches.gaps(old))
    }

    @Test fun `a gap offers the Vault's entries of its kind, and a pick fills that need only`() {
        assertEquals(listOf("logins" to Need("nas.lan"), "ssh" to Need("backup.lan")), TeamReaches.gaps(p))
        val vault = listOf(VaultItem(id = "a1", name = "Proxmox pve"), VaultItem(id = "s1", name = "Home key", kind = "ssh-key"), VaultItem(id = "c1", name = "Visa", kind = "card"))
        assertEquals(listOf("a1"), TeamReaches.pickable(vault, TeamReaches.LOGINS).map { it.id })
        assertEquals(listOf("s1"), TeamReaches.pickable(vault, TeamReaches.SSH).map { it.id })
        assertEquals("""{"logins":[{"need":"proxmox pve","id":"a1"},{"need":"nas.lan","id":"b2"}]}""", JsonObject(TeamReaches.picked(p, TeamReaches.LOGINS, "nas.lan", "b2")).toString())
    }
}
