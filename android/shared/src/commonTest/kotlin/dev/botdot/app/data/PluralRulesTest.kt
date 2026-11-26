package dev.botdot.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The phones' plural rules (I18n.form, ADR 280) are CLDR's, as Intl.PluralRules answers them on the web page and the
 * server: every language of the registry, for every number of test/fixtures/plural-rules.json.
 */
class PluralRulesTest {
    @Test fun everyLanguageOfTheRegistryPicksTheCategoryIntlPicks() {
        val table = Json.parseToJsonElement(fixture("pluralRules")).jsonObject
        val numbers = table.getValue("numbers").jsonArray.map { it.jsonPrimitive.int }
        val languages = table.getValue("languages").jsonObject
        assertTrue(languages.size >= 14, "the registry's 14 languages")
        for ((lang, want) in languages) {
            val got = numbers.map { I18n.form(lang, it) }
            assertEquals(want.jsonArray.map { it.jsonPrimitive.content }, got, lang)
        }
    }

    @Test fun aNegativeCountTakesItsNumbersCategory() {
        assertEquals("one", I18n.form("pl", -1))
        assertEquals("few", I18n.form("ru", -3))
    }

    @Test fun aLanguageOutsideTheRegistryTakesEnglishRules() {
        assertEquals(listOf("other", "one", "other"), listOf(0, 1, 2).map { I18n.form("xx", it) })
    }
}
