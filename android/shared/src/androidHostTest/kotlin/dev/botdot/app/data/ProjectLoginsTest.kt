package dev.botdot.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A project's logins on Android (#804): what the project carries, what Add offers, the PATCH, and a card's needsLogin. */
class ProjectLoginsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun `a project carries its logins, and a failed card the host it needs`() {
        val c = json.decodeFromString<Company>("""{"id":"p1","logins":[{"id":"a1","name":"Proxmox pve","site":"pve.lan"},{"id":"gone"}],"cards":[{"id":"k1","ask":"VMs","state":"failed","error":"No login for pve.lan","needsLogin":"pve.lan"}]}""")
        assertEquals(listOf(ProjectLogin("a1", "Proxmox pve", "pve.lan"), ProjectLogin("gone")), c.logins)
        assertEquals("pve.lan", c.cards[0].needsLogin)
        assertNull(json.decodeFromString<Company>("""{"id":"p2","cards":[{"id":"k2","ask":"x"}]}""").cards[0].needsLogin)
    }

    @Test fun `Add offers the Vault's logins not picked yet, and the PATCH is the whole list`() {
        val c = Company(id = "p1", logins = listOf(ProjectLogin("a1", "Proxmox pve")))
        val vault = listOf(VaultItem(id = "a1", name = "Proxmox pve"), VaultItem(id = "b2", name = "Uptime Kuma"), VaultItem(id = "c3", name = "Visa", kind = "card"))
        assertEquals(listOf("b2"), ProjectLogins.addable(vault, c).map { it.id })
        assertEquals("""{"logins":["a1","b2"]}""", ProjectLogins.added(c, "b2").toString())
        assertEquals("""{"logins":[]}""", ProjectLogins.removed(c, "a1").toString())
    }
}
