package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/**
 * The interface's language (#645, ADR 108, ADR 280): the app's words in English, or in the language the account chose
 * in Settings. A string is keyed by its English text: tr("Saved") is "Saved" in English and "Zapisano" in Polish, and a
 * string without a translation stays English. trn(n, "{n} bot", "{n} bots") picks the plural form by the language's
 * CLDR rules ([form]). The dictionary is the server's (GET /api/i18n/<code>), with the languages the account may choose
 * and the words the app reads in what a bot or the owner wrote ([phrases]), kept on the phone so the words are there
 * from the first screen. Its state is Compose's: a screen that drew a word draws it again when the language changes.
 */
object I18n {
    const val FEATURE = "language"
    /** A server that offers any language of its registry (ADR 280), and hands out the list with the dictionary. */
    const val MANY = "languages"

    /** A language the account may choose: its code, its own name (never translated), its locale and its date patterns. */
    data class Language(val code: String, val name: String, val locale: String? = null, val longDay: String = ENGLISH_LONG_DAY, val shortDay: String = ENGLISH_SHORT_DAY)

    private const val ENGLISH_LONG_DAY = "EEEE, MMM d"
    private const val ENGLISH_SHORT_DAY = "d MMM"
    private val ENGLISH = Language("en", "English")
    /** What a server older than ADR 280 offers, which hands out no list: English and Polish. */
    private val OLDER_SERVER = listOf(ENGLISH, Language("pl", "Polski", "pl-PL", "EEEE, d MMMM", "d MMM"))

    /** Where the language and its dictionary are kept between starts. */
    interface Keep { fun read(): String?; fun write(value: String) }
    private var keep: Keep? = null

    private val languageState = observed("en")
    var language: String
        get() = languageState.value
        private set(v) { languageState.value = v }
    private val stringsState = observed<Map<String, JsonElement>>(emptyMap())
    private var strings: Map<String, JsonElement>
        get() = stringsState.value
        set(v) { stringsState.value = v }
    private val languagesState = observed(listOf(ENGLISH))
    /** The languages the account may choose, as the server last said. */
    val languages: List<Language> get() = languagesState.value
    private var phraseLists: Map<String, List<String>> = emptyMap()

    /** The languages for the Settings picker: code and own name; the app's own language is always among them. */
    val choices: List<Pair<String, String>>
        get() = languages.map { it.code to it.name }.let { l -> if (l.any { it.first == language }) l else l + (language to language) }

    private val current: Language get() = languages.firstOrNull { it.code == language } ?: ENGLISH
    /** A weekday with its day and month in the app's language ("Thursday, Nov 26", "czwartek, 26 listopada"). */
    val longDay: String get() = current.longDay
    /** A day with its short month in the app's language ("26 Nov", "11月26日"). */
    val shortDay: String get() = current.shortDay

    /** The words of [kind] of every offered language but English (lib/i18n/phrases.js): "because", "noSource", "nameEndings". */
    fun phrases(kind: String): List<String> = phraseLists[kind].orEmpty()

    /** The language and dictionary kept on the phone, at the app's start. */
    fun start(k: Keep) {
        keep = k
        val o = runCatching { k.read()?.let { Api.JSON.parseToJsonElement(it) as? JsonObject } }.getOrNull() ?: return
        use(o["language"].text(), o["strings"] as? JsonObject, languagesOf(o["languages"]) ?: OLDER_SERVER, phrasesOf(o["phrases"]))
    }

    /**
     * [lang] with its [table] (null for English), the [offered] languages and the [words] of every offered language,
     * kept for the next start. A language that is not offered is English.
     */
    fun use(lang: String?, table: JsonObject?, offered: List<Language> = OLDER_SERVER, words: Map<String, List<String>> = phraseLists) {
        val all = offered.ifEmpty { listOf(ENGLISH) }
        val l = lang?.takeIf { c -> c == "en" || all.any { it.code == c } } ?: "en"
        languagesState.value = all
        phraseLists = words
        language = l
        strings = if (l == "en") emptyMap() else table.orEmpty()
        keep?.write(buildJsonObject {
            put("language", l)
            put("strings", JsonObject(strings))
            put("languages", JsonArray(all.map { it.json() }))
            put("phrases", JsonObject(words.mapValues { (_, v) -> JsonArray(v.map { JsonPrimitive(it) }) }))
        }.toString())
    }

    /** The account's language from the server and its dictionary, from a server that has [FEATURE]. */
    suspend fun sync(api: Api, features: Collection<String>?) {
        if (features == null || FEATURE !in features) return
        val lang = runCatching { api.language() }.getOrNull() ?: return
        if (MANY in features) {
            runCatching { api.i18n(lang) }.onSuccess { d -> use(lang, d["strings"] as? JsonObject, languagesOf(d["languages"]) ?: listOf(ENGLISH), phrasesOf(d["phrases"])) }
            return
        }
        if (lang == "en") return use("en", null, OLDER_SERVER, emptyMap())
        runCatching { api.dictionary(lang) }.onSuccess { use(lang, it, OLDER_SERVER, emptyMap()) }
    }

    /** The feed's `language` event: the language another app switched the account to, or null. */
    fun event(ev: FeedEvent): String? = if (ev.type == FEATURE) ev.data["language"].text()?.takeIf { l -> languages.any { it.code == l } } else null

    fun text(key: String): String = (strings[key] as? JsonPrimitive)?.contentOrNull ?: key

    /** A count's text: the form of the language's category, or else "other", then "few", then "many" (as the server picks). */
    fun plural(n: Int, one: String, other: String): String {
        val forms = strings[other] as? JsonObject ?: return if (n == 1) one else other
        return forms[form(language, n)].text() ?: forms["other"].text() ?: forms["few"].text() ?: forms["many"].text() ?: other
    }

    /**
     * The CLDR plural category of the whole number [n] in [lang], for every language of the registry
     * (lib/i18n/languages.json): Kotlin has no Intl.PluralRules, so the rules are here, and PluralRulesTest holds them to
     * what Intl.PluralRules answers (test/fixtures/plural-rules.json). Portuguese is Brazil's (0 and 1 are "one").
     * Any other language takes English's.
     */
    fun form(lang: String, n: Int): String {
        val a = kotlin.math.abs(n)
        val millions = a != 0 && a % 1_000_000 == 0
        val slavicFew = a % 10 in 2..4 && a % 100 !in 12..14
        return when (lang.substringBefore('-').lowercase()) {
            "zh", "ja", "ko", "id" -> "other"
            "pl" -> when { a == 1 -> "one"; slavicFew -> "few"; else -> "many" }
            "ru" -> when { a % 10 == 1 && a % 100 != 11 -> "one"; slavicFew -> "few"; else -> "many" }
            "fr", "pt" -> when { a == 0 || a == 1 -> "one"; millions -> "many"; else -> "other" }
            "es", "it" -> when { a == 1 -> "one"; millions -> "many"; else -> "other" }
            else -> if (a == 1) "one" else "other" // en, de, nl, tr
        }
    }

    fun fill(text: String, vars: Array<out Pair<String, Any?>>): String =
        if (vars.isEmpty()) text else Regex("""\{(\w+)\}""").replace(text) { m -> vars.firstOrNull { it.first == m.groupValues[1] }?.second?.toString() ?: m.value }

    private fun Language.json() = buildJsonObject {
        put("code", code); put("name", name); locale?.let { put("locale", it) }; put("longDay", longDay); put("shortDay", shortDay)
    }

    /** The `languages` of the server's answer, or null when it has none. */
    private fun languagesOf(e: JsonElement?): List<Language>? = (e as? JsonArray)?.mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        val code = o["code"].text() ?: return@mapNotNull null
        Language(code, o["name"].text() ?: code, o["locale"].text(), o["longDay"].text() ?: ENGLISH_LONG_DAY, o["shortDay"].text() ?: ENGLISH_SHORT_DAY)
    }?.takeIf { it.isNotEmpty() }

    private fun phrasesOf(e: JsonElement?): Map<String, List<String>> =
        (e as? JsonObject)?.mapValues { (_, v) -> (v as? JsonArray)?.mapNotNull { it.text() }.orEmpty() }.orEmpty()

    private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
}

/** [text] in the account's language, its {placeholders} filled from [vars]. */
fun tr(text: String, vararg vars: Pair<String, Any?>): String = I18n.fill(I18n.text(text), vars)

/** A count: [one] for one and [other] otherwise in English; the other languages' forms are keyed by [other]. {n} is [n]. */
fun trn(n: Int, one: String, other: String, vararg vars: Pair<String, Any?>): String = I18n.fill(I18n.plural(n, one, other), arrayOf<Pair<String, Any?>>("n" to n, *vars))
