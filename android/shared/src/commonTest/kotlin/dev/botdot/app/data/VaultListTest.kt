package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Vault's list and its login editor as both phones draw them (Vault, VaultLogin, VaultState): the entries of
 * test/fixtures/vault-search.json in their categories, the search over a list longer than eight, folding, each kind's
 * lines, and what a save sends. VaultSearchTest and VaultTypesTest hold the rules these are made of.
 */
class VaultListTest {
    private val items: List<VaultItem> = Vault.read(Json.parseToJsonElement(fixture("vaultSearch")).jsonObject["items"]!!.jsonArray.toString())

    /** The fixture's six and three more without a category: nine, one more than the list holds without a search. */
    private val long = items + (1..3).map { VaultItem(id = "x$it", name = "Extra $it", site = "x$it.example.org") }

    private fun ids(sections: List<Vault.Section>) = sections.map { Triple(it.category, it.open, it.items.map(VaultItem::id)) }

    @Test
    fun theEntriesAreInTheirCategoriesThoseWithoutOneFirst() {
        assertEquals(
            listOf(Triple("", true, listOf("d", "e")), Triple("Servers", true, listOf("b", "f")), Triple("Shopping", true, listOf("a", "c"))),
            ids(Vault.sections(items, "", emptySet())),
        )
    }

    @Test
    fun aFoldedCategoryKeepsItsHeadingAndHidesNothingElse() {
        val s = Vault.sections(items, "", setOf("Servers"))
        assertEquals(listOf(true, false, true), s.map { it.open })
        assertEquals(listOf("b", "f"), s[1].items.map { it.id }, "its entries are still counted under it")
        assertEquals(setOf("Servers", "Shopping"), Vault.toggled(setOf("Servers"), "Shopping"))
        assertEquals(emptySet(), Vault.toggled(setOf("Servers"), "Servers"))
    }

    @Test
    fun eightEntriesHaveNoSearchAndNineHaveOne() {
        assertFalse(Vault.searches(long.take(8)))
        assertTrue(Vault.searches(long))
        // Without the field a query filters nothing: the field is not there to clear it.
        assertEquals(8, Vault.shown(long.take(8), "albert").size)
        assertFalse(Vault.noMatches(long.take(8), "nothing like it"))
    }

    @Test
    fun aSearchShowsWhatItFindsAndOpensAFoldedCategoryForIt() {
        val s = Vault.sections(long, "albert", setOf("Shopping"))
        assertEquals(listOf(Triple("Shopping", true, listOf("a"))), ids(s))
        assertEquals(listOf(false), Vault.sections(long, "   ", setOf("Shopping")).filter { it.category == "Shopping" }.map { it.open }, "blank is no search")
        assertTrue(Vault.noMatches(long, "nothing like it"))
        assertFalse(Vault.noMatches(long, "albert"))
    }

    @Test
    fun eachKindReadsAsTheAndroidAppDrawsIt() {
        val features = listOf(VaultTypes.FEATURE)
        val card = VaultItem(id = "c", name = "Visa", kind = "card", brand = "Visa", last4 = "4242", expiry = "12/29")
        assertEquals(listOf("Visa •••• 4242 · expires 12/29 · you approve each payment"), Vault.lines(card, features))
        assertEquals(listOf("Alice · alice@example.com"), Vault.lines(VaultItem(id = "i", name = "Me", kind = "identity", holder = "Alice", email = "alice@example.com"), features))
        val login = VaultItem(id = "l", name = "Food", site = "food.example.org", username = "alice")
        assertEquals(VaultTypes.rows(login, features), Vault.lines(login, features))
        assertEquals(listOf("🔑", "💳", "🪪", "🗝️", "📄", "🔑"), listOf("login", "card", "identity", "ssh-key", "file", "passkey").map(Vault::icon))
    }

    @Test
    fun aLoginSaysNothingOfItsBotsUntilOneHasItAndACardSaysSo() {
        val bots = listOf(Bot(id = "b1", name = "Ops"))
        assertNull(Vault.botsLine(VaultItem(id = "l", name = "Food"), bots))
        assertEquals("Can be used by Ops, gone", Vault.botsLine(VaultItem(id = "l", name = "Food", allowedBots = listOf("b1", "gone")), bots))
        assertEquals("No bot may use it yet", Vault.botsLine(VaultItem(id = "c", name = "Visa", kind = "card"), bots))
    }

    @Test
    fun theEditorOpensOnTheSavedLoginAndAsksForTheSecretOfANewOne() {
        val saved = VaultItem(id = "l", name = "Proxmox", type = "api-token", site = "pve.example.ts.net", username = "root", allowedHosts = listOf("a.example.com", "b.example.com"), category = "Servers")
        val form = VaultLogin.of(saved)
        assertEquals(VaultLogin("Proxmox", "pve.example.ts.net", "api-token", "root", "", "a.example.com, b.example.com", "Servers"), form)
        assertTrue(form.canSave(isNew = false), "an empty secret keeps the saved one")
        assertFalse(form.canSave(isNew = true))
        assertFalse(form.copy(site = " ").canSave(isNew = false))
        assertEquals(VaultLogin(), VaultLogin.of(null))
        assertEquals("login", VaultLogin.of(VaultItem(id = "o", name = "Odd", type = "passkey")).type, "an unknown type opens as a login")
    }

    @Test
    fun aGitHubAppFillsAnEmptyAddressOnly() {
        assertEquals("api.github.com", VaultLogin().typed(VaultTypes.GITHUB_APP).site)
        assertEquals("ghe.example.com", VaultLogin(site = "ghe.example.com").typed(VaultTypes.GITHUB_APP).site)
        assertEquals("", VaultLogin().typed(VaultTypes.API_TOKEN).site)
    }

    @Test
    fun theAdditionalHostsAreReadAsTyped() {
        assertEquals(listOf("a.example.com", "b.example.com"), Vault.hosts(" a.example.com, ,b.example.com ,"))
        assertEquals(emptyList(), Vault.hosts(""))
    }

    @Test
    fun theStateOfTheScreenFollowsTheServer() {
        val s = VaultState(long, BitwardenStatus(configured = true, unlocked = false), listOf(VaultTypes.FEATURE, VaultTypes.CATEGORIES_FEATURE), emptyList(), setOf("Servers"), null)
        assertTrue(s.locked)
        assertTrue(s.inBitwarden)
        assertTrue(s.searches)
        assertTrue(s.categories)
        assertTrue(s.showsType)
        assertEquals(listOf("login", "api-token", "other"), s.typeIds(null))
        assertEquals(listOf("Servers", "Shopping"), s.suggestions(""))
        assertEquals(false, s.sections("").first { it.category == "Servers" }.open)
        val before = VaultState(items, BitwardenStatus(), emptyList(), emptyList(), emptySet(), null)
        assertFalse(before.locked)
        assertFalse(before.categories)
        assertFalse(before.showsType)
        assertTrue(before.edits(items.first()))
        assertFalse(before.edits(VaultItem(id = "c", name = "Visa", kind = "card")))
    }

    @Test
    fun aWrongMasterPasswordIsSaidInTheAppsWords() {
        assertEquals("Wrong master password", Vault.unlockError(ApiException("The master password is not right")))
        assertEquals("Bitwarden is busy", Vault.unlockError(ApiException("Bitwarden is busy")))
    }
}
