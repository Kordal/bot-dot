package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/** The interface's language (#645, ADR 108): the words in Polish where the dictionary has them, English otherwise. */
class I18nTest {
    private val polish = JsonObject(mapOf(
        "Saved" to JsonPrimitive("Zapisano"),
        "Ran {name}" to JsonPrimitive("Uruchomiono {name}"),
        "{n} bots" to JsonObject(mapOf("one" to JsonPrimitive("{n} bot"), "few" to JsonPrimitive("{n} boty"), "many" to JsonPrimitive("{n} botów"))),
    ))

    @After fun english() = I18n.use("en", null)

    @Test fun englishIsTheTextItself() {
        I18n.use("en", null)
        assertEquals("Saved", tr("Saved"))
        assertEquals("Ran Scout", tr("Ran {name}", "name" to "Scout"))
        assertEquals(listOf("1 bot", "2 bots"), listOf(1, 2).map { trn(it, "{n} bot", "{n} bots") })
    }

    @Test fun polishFromTheDictionaryAndEnglishWithoutIt() {
        I18n.use("pl", polish)
        assertEquals("pl", I18n.language)
        assertEquals("Zapisano", tr("Saved"))
        assertEquals("Uruchomiono Scout", tr("Ran {name}", "name" to "Scout"))
        assertEquals("Not there", tr("Not there"))
        assertEquals(listOf("1 bot", "3 boty", "5 botów", "12 botów", "22 boty"), listOf(1, 3, 5, 12, 22).map { trn(it, "{n} bot", "{n} bots") })
    }

    @Test fun anUnknownLanguageIsEnglish() {
        I18n.use("de", polish)
        assertEquals("en", I18n.language)
        assertEquals("Saved", tr("Saved"))
    }

    @Test fun polishPluralForms() {
        assertEquals(listOf("one", "few", "few", "many", "many", "many", "few", "many", "few"), listOf(1, 2, 4, 5, 13, 21, 22, 112, 122).map { I18n.form("pl", it) })
        assertEquals(listOf("other", "one", "other"), listOf(0, 1, 2).map { I18n.form("en", it) })
    }

    @Test fun theFeedSaysTheLanguage() {
        assertEquals("pl", I18n.event(FeedEvent(null, "language", JsonObject(mapOf("language" to JsonPrimitive("pl"))))))
        assertEquals(null, I18n.event(FeedEvent(null, "language", JsonObject(mapOf("language" to JsonPrimitive("xx"))))))
        assertEquals(null, I18n.event(FeedEvent(null, "checkup", JsonObject(emptyMap()))))
    }
}
