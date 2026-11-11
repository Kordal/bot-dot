package dev.botdot.app.data

import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/** Passwords' search in the Android app: the cases of test/fixtures/vault-search.json, which the web page checks too. */
class VaultSearchTest {
    @Serializable
    data class Case(val query: String, val found: List<String>)

    @Serializable
    data class Group(val category: String, val found: List<String>)

    @Serializable
    data class Table(val items: List<VaultItem>, val cases: List<Case>, val groups: List<Group> = emptyList())

    private val table = Json { ignoreUnknownKeys = true }.decodeFromString(Table.serializer(),
        File(System.getProperty("vaultSearch") ?: "../../test/fixtures/vault-search.json").readText())

    @Test
    fun aSearchFindsAnItemByAnyWordOfWhatItHolds() {
        for (c in table.cases) assertEquals("\"${c.query}\"", c.found, table.items.filter { VaultTypes.matches(it, c.query) }.map { it.id })
    }

    @Test
    fun aListLongerThanEightGetsTheField() = assertEquals(8, VaultTypes.SEARCH_AFTER)

    @Test
    fun theListIsInItsCategoriesThoseWithoutOneFirst() {
        assertEquals(table.groups.map { it.category to it.found }, VaultTypes.groups(table.items).map { (c, items) -> c to items.map { it.id } })
        assertEquals(listOf("Servers", "Shopping"), VaultTypes.groups(table.items.filter { it.category.isNotEmpty() }).map { it.first })
        assertEquals(emptyList<Pair<String, List<VaultItem>>>(), VaultTypes.groups(emptyList()))
    }

    @Test
    fun anEditorOffersTheCategoriesInUseThatHoldWhatIsTyped() {
        assertEquals(listOf("Servers", "Shopping"), VaultTypes.suggestions(table.items, ""))
        assertEquals(listOf("Shopping"), VaultTypes.suggestions(table.items, "sho"))
        assertEquals(emptyList<String>(), VaultTypes.suggestions(table.items, "shopping"))
    }
}
