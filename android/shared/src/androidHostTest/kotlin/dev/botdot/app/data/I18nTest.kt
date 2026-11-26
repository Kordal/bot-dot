package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/** The interface's language (#645, ADR 108, ADR 280): the words in the account's language where the dictionary has them, English otherwise. */
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

    @Test fun anyLanguageTheServerOffersWithItsPluralsAndItsDates() {
        val offered = listOf(I18n.Language("en", "English"), I18n.Language("de", "Deutsch", "de-DE", "EEEE, d. MMMM", "d. MMM"), I18n.Language("ja", "日本語", "ja-JP", "M月d日 EEEE", "M月d日"))
        val german = JsonObject(mapOf("Saved" to JsonPrimitive("Gespeichert"), "{n} bots" to JsonObject(mapOf("one" to JsonPrimitive("{n} Bot"), "other" to JsonPrimitive("{n} Bots")))))
        I18n.use("de", german, offered, mapOf("because" to listOf("weil")))
        assertEquals("de", I18n.language)
        assertEquals("Gespeichert", tr("Saved"))
        assertEquals(listOf("1 Bot", "2 Bots", "0 Bots"), listOf(1, 2, 0).map { trn(it, "{n} bot", "{n} bots") })
        assertEquals("EEEE, d. MMMM", I18n.longDay)
        assertEquals(listOf("en" to "English", "de" to "Deutsch", "ja" to "日本語"), I18n.choices)
        assertEquals(listOf("weil"), I18n.phrases("because"))
        assertEquals("ja", I18n.event(FeedEvent(null, "language", JsonObject(mapOf("language" to JsonPrimitive("ja"))))))
        I18n.use("ja", JsonObject(mapOf("{n} bots" to JsonObject(mapOf("other" to JsonPrimitive("ボット{n}体"))))), offered)
        assertEquals("Japanese has one form, other", "ボット1体", trn(1, "{n} bot", "{n} bots"))
        assertEquals("M月d日", I18n.shortDay)
        I18n.use("fr", null, offered)
        assertEquals("a language the server does not offer is English", "en", I18n.language)
    }

    @Test fun aMissingFormFallsBackToOtherThenFewThenMany() {
        I18n.use("pl", JsonObject(mapOf("{n} hours" to JsonObject(mapOf("one" to JsonPrimitive("{n} godzina"), "few" to JsonPrimitive("{n} godziny"))))))
        assertEquals("many is missing: few", "5 godziny", trn(5, "{n} hour", "{n} hours"))
    }

    // French elides before a name (lib/i18n/elision.js): the server hands out the rule with the dictionary.
    private val frenchRule = JsonObject(mapOf(
        "words" to JsonObject(mapOf("de" to JsonPrimitive("d'"), "que" to JsonPrimitive("qu'"), "le" to JsonPrimitive("l'"), "la" to JsonPrimitive("l'"))),
        "silentH" to kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive("hélène"))),
    ))
    private val frenchOffered = listOf(I18n.Language("en", "English"), I18n.Language("fr", "Français", "fr-FR"))
    private val french = JsonObject(mapOf(
        "Plan of {who}" to JsonPrimitive("Plan de {who}"),
        "Waits for {bot}" to JsonPrimitive("Attend que {bot} soit libre"),
        "The {thing}" to JsonPrimitive("Le {thing} est prêt"),
        "{n} files of {bot}" to JsonObject(mapOf("one" to JsonPrimitive("{n} fichier de {bot}"), "other" to JsonPrimitive("{n} fichiers de {bot}"))),
    ))

    @Test fun frenchElidesDeQueAndLeBeforeAVowelNameAndOnlyThere() {
        I18n.use("fr", french, frenchOffered, emptyMap(), frenchRule)
        assertEquals("Plan d'Anna", tr("Plan of {who}", "who" to "Anna"))
        assertEquals("Plan de Bob", tr("Plan of {who}", "who" to "Bob"))
        assertEquals("Attend qu'Émile soit libre", tr("Waits for {bot}", "bot" to "Émile"))
        assertEquals("Attend que Zoé soit libre", tr("Waits for {bot}", "bot" to "Zoé"))
        assertEquals("L'Alice est prêt", tr("The {thing}", "thing" to "Alice"))
        assertEquals("Le Bob est prêt", tr("The {thing}", "thing" to "Bob"))
        assertEquals("Plan d'Hélène", tr("Plan of {who}", "who" to "Hélène"))
        assertEquals("a name with an aspirated h is not elided", "Plan de Hugo", tr("Plan of {who}", "who" to "Hugo"))
        assertEquals("a value that is not a word of letters is not elided", "Plan de anna@x.com", tr("Plan of {who}", "who" to "anna@x.com"))
        assertEquals("Plan de 8", tr("Plan of {who}", "who" to 8))
        assertEquals("a count elides too", "2 fichiers d'Anna", trn(2, "{n} file of {bot}", "{n} files of {bot}", "bot" to "Anna"))
        assertEquals("a string with no placeholder is as it is", "Not there d'Anna", tr("Not there d'Anna"))
        assertEquals("English text is never elided", "Ask de Anna", tr("Ask de {who}", "who" to "Anna"))
    }

    @Test fun aLanguageThatDeclaresNoRuleDoesNotElide() {
        I18n.use("pl", JsonObject(mapOf("Plan of {who}" to JsonPrimitive("Plan: de {who}"))), listOf(I18n.Language("en", "English"), I18n.Language("pl", "Polski")))
        assertEquals("Plan: de Anna", tr("Plan of {who}", "who" to "Anna"))
    }

    @Test fun theFeedSaysTheLanguage() {
        assertEquals("pl", I18n.event(FeedEvent(null, "language", JsonObject(mapOf("language" to JsonPrimitive("pl"))))))
        assertEquals(null, I18n.event(FeedEvent(null, "language", JsonObject(mapOf("language" to JsonPrimitive("xx"))))))
        assertEquals(null, I18n.event(FeedEvent(null, "checkup", JsonObject(emptyMap()))))
    }
}
