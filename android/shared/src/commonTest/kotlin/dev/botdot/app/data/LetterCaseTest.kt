package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals

/** Capital and small letters follow the interface language's rules: Turkish "i" is "İ", not "I" (I18n.upper, uppercaseIn). */
class LetterCaseTest {
    @Test fun aLanguageTagSetsTheRules() {
        assertEquals("İ", uppercaseIn("i", "tr"))
        assertEquals("ı", lowercaseIn("I", "tr"))
        assertEquals("I", uppercaseIn("i", "en"))
        assertEquals("i", lowercaseIn("I", "en"))
        assertEquals("I", uppercaseIn("i", "")) // no language's conventions
    }

    @Test fun theInterfaceLanguageSetsTheRules() {
        val offered = listOf(I18n.Language("en", "English"), I18n.Language("tr", "Türkçe", "tr-TR"))
        try {
            I18n.use("tr", null, offered)
            assertEquals("İSTANBUL", I18n.upper("istanbul"))
            assertEquals("dıyarbakır", I18n.lower("DIYARBAKIR"))
            assertEquals("diyarbakır", I18n.lower("DİYARBAKIR"))
            assertEquals("İzmir'e git", I18n.upperFirst("izmir'e git"))
            assertEquals("", I18n.upperFirst(""))
            I18n.use("en", null, offered)
            assertEquals("ISTANBUL", I18n.upper("istanbul"))
            assertEquals("Izmir", I18n.upperFirst("izmir"))
        } finally {
            I18n.use("en", null)
        }
    }
}
