package dev.botdot.app.data

import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Vault's item types in the Android app (docs/api.md "The Vault's items"): `type` is read on an item and on a
 * login request (there, missing, unknown), how an item reads in the list, what the editor and the request's card
 * ask for, what a save sends, and all of it as before on a server without `vault-types`.
 * `test/vault-types-web.test.js` holds the web page's side, with the same words.
 */
class VaultTypesTest {
    private val types = listOf(VaultTypes.FEATURE)
    private val before = listOf("unread", "tools")

    @Serializable
    data class Words(val id: String, val label: String, val username: String?, val optional: Boolean, val secret: String, val icon: String, val none: String, val saved: String)

    @Serializable
    data class Shown(val item: VaultItem, val rows: List<String>)

    @Serializable
    data class Table(val feature: String, val control: String, val types: List<Words>, val items: List<Shown>)

    /** The words every app shows alike (its "about"); `test/vault-types-web.test.js` holds the web page to it too. */
    private val table: Table = Json { ignoreUnknownKeys = true }.decodeFromString(
        Table.serializer(),
        File(System.getProperty("vaultTypes") ?: "../../test/fixtures/vault-types.json").readText(),
    )

    @Test fun theTypesHaveTheWordsOfTheSharedTableAndAnItemItsTwoLines() {
        assertEquals(table.types, VaultTypes.ALL.map { Words(it.id, it.label, it.username, it.optional, it.secret, it.icon, it.none, it.saved) })
        assertEquals(table.feature, VaultTypes.FEATURE)
        assertEquals(table.control, VaultTypes.CONTROL)
        for (shown in table.items) assertEquals(shown.item.name, shown.rows, VaultTypes.rows(shown.item, types))
    }

    private fun items(json: String): List<VaultItem> = Api.JSON.decodeFromString(json)
    private fun requests(json: String): List<LoginRequest> = Api.JSON.decodeFromString(json)

    @Test fun theThreeTypesWithTheWordsOfTheWebPage() {
        assertEquals(listOf("login" to "Login", "api-token" to "API token", "other" to "Other"), VaultTypes.OPTIONS)
        assertEquals("Type", VaultTypes.CONTROL)
        assertEquals("vault-types", VaultTypes.FEATURE)
    }

    @Test fun anAbsentOrUnknownTypeIsALogin() {
        assertEquals("login", VaultTypes.of(null).id)
        assertEquals("login", VaultTypes.of("").id)
        assertEquals("login", VaultTypes.of("ssh-key").id)
        assertEquals("api-token", VaultTypes.of("api-token").id)
        assertEquals("other", VaultTypes.of("other").id)
    }

    @Test fun theControlShowsOnlyForAServerThatKeepsTypes() {
        assertTrue(VaultTypes.shows(types))
        assertFalse(VaultTypes.shows(before))
        assertFalse(VaultTypes.shows(emptyList()))
        assertFalse("the server has not answered yet", VaultTypes.shows(null))
    }

    @Test fun theTypeIsReadOnItemsWithItWithoutItAndWithOneThisAppDoesNotKnow() {
        val list = items(
            """[{"id":"a","name":"Proxmox","kind":"login","type":"api-token","site":"pve.example.ts.net","username":"root@pam!botdot"},
                {"id":"b","name":"Old","site":"old.example.org","username":"alice"},
                {"id":"c","name":"Odd","kind":"login","type":"ssh-key","site":"odd.example.org","folder":"work"},
                {"id":"d","name":"Visa","kind":"card","last4":"4242"}]""",
        )
        assertEquals(listOf("api-token", "login", "ssh-key", "login"), list.map { it.type })
        assertEquals("the unknown one is drawn as a login, and the rest is still read", listOf("api-token", "login", "login"), list.take(3).map { VaultTypes.of(it.type).id })
        assertEquals("card", list[3].kind)
    }

    @Test fun aRequestCarriesTheTypeThatWasAskedFor() {
        val list = requests(
            """[{"id":"r1","site":"git.example.org","type":"api-token"},{"id":"r2","site":"old.example.org"},{"id":"r3","site":"odd.example.org","type":"passkey"}]""",
        )
        assertEquals(listOf("api-token", "login", "login"), list.map { VaultTypes.of(it.type).id })
    }

    @Test fun anItemInTheListShowsItsTypeBeforeItsAddressAndTheLineOfThatType() {
        val login = VaultItem(id = "1", name = "Food", site = "food.example.org", username = "alice@example.com")
        assertEquals(listOf("Login · food.example.org", "👤 alice@example.com · 🔒 secret saved"), VaultTypes.rows(login, types))
        assertEquals(listOf("Login · food.example.org", "👤 (no username) · 🔒 secret saved"), VaultTypes.rows(login.copy(username = ""), types))
        val token = VaultItem(id = "2", name = "Proxmox", type = "api-token", site = "pve.example.ts.net", username = "root@pam!botdot", insecureTls = true)
        assertEquals(listOf("API token · pve.example.ts.net", "🆔 root@pam!botdot · 🔒 token saved · self-signed certificate OK"), VaultTypes.rows(token, types))
        assertEquals("🆔 (no token ID) · 🔒 token saved", VaultTypes.rows(token.copy(username = "", insecureTls = false), types)[1])
        // Other shows no username, also one it still keeps from its time as a login.
        val other = VaultItem(id = "3", name = "NAS key", type = "other", site = "nas.example.net", username = "kept", hasTotp = true)
        assertEquals(listOf("Other · nas.example.net", "🔒 secret saved · two-step code"), VaultTypes.rows(other, types))
        assertEquals("an unknown type reads as a login", "Login · odd.example.org", VaultTypes.rows(VaultItem(id = "4", name = "Odd", type = "ssh-key", site = "odd.example.org"), types)[0])
    }

    @Test fun usableInItsComputerShowsOnItsLineAndItsSwitchOnlyForAServerThatKeepsIt() {
        val bridge = VaultItem(id = "8", name = "Proton Bridge", site = "127.0.0.1", username = "alice@proton.me", inComputer = true)
        assertEquals("👤 alice@proton.me · 🔒 secret saved · usable in its computer", VaultTypes.rows(bridge, types)[1])
        assertEquals("👤 alice@proton.me · 🔒 secret saved", VaultTypes.rows(bridge.copy(inComputer = false), types)[1])
        assertTrue(VaultTypes.showsInComputer(listOf(VaultTypes.IN_COMPUTER_FEATURE)))
        assertFalse(VaultTypes.showsInComputer(types))
        assertFalse(VaultTypes.showsInComputer(null))
        assertEquals("Usable in its computer", VaultTypes.IN_COMPUTER)
        assertEquals("vault-in-computer", VaultTypes.IN_COMPUTER_FEATURE)
        assertEquals("off for an item that does not say", false, items("""[{"id":"1","name":"Old","site":"old.example.org"}]""")[0].inComputer)
    }

    @Test fun onAServerBeforeTheTypesAnItemIsTheOneLineItAlwaysWas() {
        val token = VaultItem(id = "2", name = "Proxmox", type = "api-token", site = "pve.example.ts.net", username = "root@pam!botdot", insecureTls = true)
        assertEquals(listOf("pve.example.ts.net · root@pam!botdot · self-signed certificate OK"), VaultTypes.rows(token, before))
        assertEquals(listOf("x.example.org · (no username)"), VaultTypes.rows(VaultItem(id = "5", name = "X", site = "x.example.org"), null))
    }

    @Test fun theEditorAsksForWhatTheTypeNeeds() {
        assertEquals(VaultTypes.Fields("Username or email", "Password"), VaultTypes.editorFields("login", types, isNew = true))
        assertEquals(VaultTypes.Fields("Token ID (optional)", "Token"), VaultTypes.editorFields("api-token", types, isNew = true))
        assertEquals(VaultTypes.Fields(null, "Secret"), VaultTypes.editorFields("other", types, isNew = true))
        // A saved item keeps its secret when the field is left empty.
        assertEquals("New password (empty keeps it)", VaultTypes.editorFields("login", types, isNew = false).secret)
        assertEquals("New token (empty keeps it)", VaultTypes.editorFields("api-token", types, isNew = false).secret)
        assertEquals("New secret (empty keeps it)", VaultTypes.editorFields("other", types, isNew = false).secret)
        assertEquals("an unknown type asks as a login", VaultTypes.Fields("Username or email", "Password"), VaultTypes.editorFields("ssh-key", types, isNew = true))
    }

    @Test fun theRequestsCardAsksForWhatTheTypeNeeds() {
        assertEquals(VaultTypes.Fields("Username or email", "Password"), VaultTypes.requestFields("login", types))
        assertEquals(VaultTypes.Fields("Token ID (optional)", "Token"), VaultTypes.requestFields("api-token", types))
        assertEquals(VaultTypes.Fields(null, "Secret"), VaultTypes.requestFields("other", types))
    }

    @Test fun onAServerBeforeTheTypesBothFormsAreAsBefore() {
        for (type in listOf("login", "api-token", "other")) {
            assertEquals(VaultTypes.Fields("Username, email or token ID", "Password, token or key"), VaultTypes.editorFields(type, before, isNew = true))
            assertEquals(VaultTypes.Fields("Username, email or token ID", "New password (empty keeps it)"), VaultTypes.editorFields(type, null, isNew = false))
            assertEquals(VaultTypes.Fields("Username or email", "Password"), VaultTypes.requestFields(type, before))
        }
    }

    @Test fun aSaveSendsTheTypeAndNoUsernameForOther() {
        assertEquals(VaultTypes.Sent("login", "alice"), VaultTypes.sent("login", "alice", types))
        assertEquals(VaultTypes.Sent("api-token", ""), VaultTypes.sent("api-token", "", types))
        val other = VaultTypes.sent("other", "kept", types)
        assertEquals("other", other.type)
        assertNull("no username is sent: the saved one stays", other.username)
    }

    @Test fun anItemOfATypeThisAppDoesNotKnowKeepsItUntilTheOwnerPicksAnother() {
        // Drawn as a login, so the control stands on Login: saving its bots must not make it one.
        assertEquals(VaultTypes.Sent(null, "u"), VaultTypes.sent("login", "u", types, saved = "ssh-key"))
        assertEquals("the owner picked a type", VaultTypes.Sent("api-token", "u"), VaultTypes.sent("api-token", "u", types, saved = "ssh-key"))
        assertEquals("a known type is sent as chosen", VaultTypes.Sent("login", "u"), VaultTypes.sent("login", "u", types, saved = "api-token"))
        assertEquals("a new item", VaultTypes.Sent("login", "u"), VaultTypes.sent("login", "u", types, saved = null))
    }

    @Test fun theRequestsSaveCarriesTheChosenTypeAndForOtherNoUsername() {
        assertEquals("""{"action":"save","type":"api-token","username":"id","password":"p"}""", VaultTypes.requestSave(VaultTypes.sent("api-token", "id", types), "p").toString())
        assertEquals("""{"action":"save","type":"other","password":"p"}""", VaultTypes.requestSave(VaultTypes.sent("other", "kept", types), "p").toString())
        assertEquals("Bitwarden is locked: its master password goes along", """{"action":"save","type":"login","username":"alice","password":"p","unlockPassword":"m"}""", VaultTypes.requestSave(VaultTypes.sent("login", "alice", types), "p", "m").toString())
        assertEquals("a server from before the types", """{"action":"save","username":"alice","password":"p"}""", VaultTypes.requestSave(VaultTypes.sent("api-token", "alice", before), "p").toString())
    }

    @Test fun aSaveToAServerBeforeTheTypesSendsNoTypeAndTheUsernameAsTyped() {
        assertEquals(VaultTypes.Sent(null, "alice"), VaultTypes.sent("other", "alice", before))
        assertEquals(VaultTypes.Sent(null, ""), VaultTypes.sent("api-token", "", null))
    }

    // An SSH key of Bitwarden (#44, `vault-ssh-keys`); test/vault-ssh-keys-web.test.js holds the web page's words.
    @Test fun anSshKeyReadsAsOneWithItsFingerprintAndItsBotsSayWhatSharingDoes() {
        val key = Json { ignoreUnknownKeys = true }.decodeFromString(VaultItem.serializer(),
            """{"id":"i-ssh","name":"Tailnet servers","kind":"ssh-key","type":"ssh-key","fingerprint":"SHA256:abc","publicKey":"ssh-ed25519 AAAA","allowedBots":["b1"]}""")
        assertEquals("SHA256:abc", key.fingerprint)
        assertEquals(listOf("SSH key", "SHA256:abc · 🔒 for SSH on a bot's computer, never shown to it"), VaultTypes.sshKeyRows(key))
        assertEquals(listOf("SSH key", "🔒 for SSH on a bot's computer, never shown to it"), VaultTypes.sshKeyRows(key.copy(fingerprint = null)))
        assertTrue(VaultTypes.itemBotsHint("ssh-key").contains("every bot on that computer could read it"))
        assertEquals("Bots that may pay with this card. You still approve every payment.", VaultTypes.itemBotsHint("card"))
        assertEquals("Bots that may type these details into forms.", VaultTypes.itemBotsHint("identity"))
    }
}
