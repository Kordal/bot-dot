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
    private var elision: Elision? = null

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
        use(o["language"].text(), o["strings"] as? JsonObject, languagesOf(o["languages"]) ?: OLDER_SERVER, phrasesOf(o["phrases"]), o["elision"] as? JsonObject)
    }

    /**
     * [lang] with its [table] (null for English), the [offered] languages, the [words] of every offered language and
     * the language's [elision] rule (lib/i18n/elision.js), kept for the next start. A language that is not offered is English.
     */
    fun use(lang: String?, table: JsonObject?, offered: List<Language> = OLDER_SERVER, words: Map<String, List<String>> = phraseLists, elision: JsonObject? = null) {
        val all = offered.ifEmpty { listOf(ENGLISH) }
        val l = lang?.takeIf { c -> c == "en" || all.any { it.code == c } } ?: "en"
        languagesState.value = all
        phraseLists = words
        language = l
        strings = if (l == "en") emptyMap() else table.orEmpty()
        val rule = if (l == "en") null else Elision.of(elision)
        this.elision = rule
        keep?.write(buildJsonObject {
            put("language", l)
            put("strings", JsonObject(strings))
            put("languages", JsonArray(all.map { it.json() }))
            put("phrases", JsonObject(words.mapValues { (_, v) -> JsonArray(v.map { JsonPrimitive(it) }) }))
            rule?.let { put("elision", it.json()) }
        }.toString())
    }

    /** The account's language from the server and its dictionary, from a server that has [FEATURE]. */
    suspend fun sync(api: Api, features: Collection<String>?) {
        if (features == null || FEATURE !in features) return
        val lang = runCatching { api.language() }.getOrNull() ?: return
        if (MANY in features) {
            runCatching { api.i18n(lang) }.onSuccess { d -> use(lang, d["strings"] as? JsonObject, languagesOf(d["languages"]) ?: listOf(ENGLISH), phrasesOf(d["phrases"]), d["elision"] as? JsonObject) }
            return
        }
        if (lang == "en") return use("en", null, OLDER_SERVER, emptyMap())
        runCatching { api.dictionary(lang) }.onSuccess { use(lang, it, OLDER_SERVER, emptyMap()) }
    }

    /** The feed's `language` event: the language another app switched the account to, or null. */
    fun event(ev: FeedEvent): String? = if (ev.type == FEATURE) ev.data["language"].text()?.takeIf { l -> languages.any { it.code == l } } else null

    fun text(key: String): String = (strings[key] as? JsonPrimitive)?.contentOrNull ?: key

    /** [key]'s text with its {placeholders} filled from [vars]; a text of the dictionary elides (lib/i18n/elision.js), English does not. */
    fun tr(key: String, vars: Array<out Pair<String, Any?>>): String {
        val found = (strings[key] as? JsonPrimitive)?.contentOrNull
        return if (found != null) fill(found, vars, elision) else fill(key, vars)
    }

    /** A count's text: the form of the language's category, or else "other", then "few", then "many" (as the server picks). */
    fun plural(n: Int, one: String, other: String): String = pluralOf(n, one, other).first

    /** The text of [plural] and whether it came from the dictionary. */
    private fun pluralOf(n: Int, one: String, other: String): Pair<String, Boolean> {
        val forms = strings[other] as? JsonObject ?: return (if (n == 1) one else other) to false
        val t = forms[form(language, n)].text() ?: forms["other"].text() ?: forms["few"].text() ?: forms["many"].text()
        return if (t != null) t to true else other to false
    }

    /** A count's text with {n} and [vars] filled in, elided as [tr] is. */
    fun trn(n: Int, one: String, other: String, vars: Array<out Pair<String, Any?>>): String {
        val (text, found) = pluralOf(n, one, other)
        return fill(text, arrayOf<Pair<String, Any?>>("n" to n, *vars), if (found) elision else null)
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

    /** [s] in capitals by the interface language's own rules (Turkish "i" is "İ"): for what the owner reads, never for a key. */
    fun upper(s: String): String = uppercaseIn(s, language)
    /** [s] in small letters by the interface language's own rules. */
    fun lower(s: String): String = lowercaseIn(s, language)
    /** [s] with its first letter in capitals by the interface language's own rules. */
    fun upperFirst(s: String): String = if (s.isEmpty()) s else upper(s.take(1)) + s.drop(1)

    /**
     * [text] with its {placeholders} filled from [vars]; with an [elision] rule, a word that stands right before a
     * placeholder is elided where the value asks for it ("de {name}" is "d'Anna" but "de Bob", French's).
     */
    fun fill(text: String, vars: Array<out Pair<String, Any?>>, elision: Elision? = null): String {
        if (vars.isEmpty()) return text
        fun value(key: String) = vars.firstOrNull { it.first == key }?.second?.toString()
        if (elision == null) return PLACEHOLDER.replace(text) { m -> value(m.groupValues[1]) ?: m.value }
        return elision.pattern.replace(text) { m ->
            val word = m.groups[1]?.value
            val v = value((if (word != null) m.groups[3] else m.groups[4])!!.value) ?: return@replace m.value
            val form = word?.let { elision.words[it.lowercase()] }
            when {
                word == null -> v
                form == null || !elision.soft(v) -> word + m.groupValues[2] + v
                word[0].isUpperCase() -> form.replaceFirstChar { it.uppercase() } + v
                else -> form + v
            }
        }
    }

    private val PLACEHOLDER = Regex("""\{(\w+)\}""")

    /**
     * Elision before a name (lib/i18n/elision.js, French's "d'Anna"): the [words] that elide and what each becomes
     * before a vowel, and the [silentH] words whose mute h a vowel's rule treats as one. It is the server's data
     * (`elision` of GET /api/i18n/<code>); the rule here is the same as the server's and the web page's.
     */
    class Elision(val words: Map<String, String>, val silentH: List<String>) {
        internal val pattern = Regex("(?<![\\p{L}\\p{N}'’])(${words.keys.joinToString("|") { Regex.escape(it) }})([ \u00a0\u202f])\\{(\\w+)\\}|\\{(\\w+)\\}", RegexOption.IGNORE_CASE)

        /** Whether [value] starts with a vowel or a mute h, as a word of letters alone ("Anna", "ouvrir"; not "app.js" or "Yann"). */
        fun soft(value: String): Boolean {
            val word = FIRST_WORD.find(value)?.value?.lowercase() ?: return false
            return word[0] in VOWELS || (word[0] == 'h' && word.substringBefore('-') in silentH)
        }

        internal fun json() = buildJsonObject {
            put("words", JsonObject(words.mapValues { JsonPrimitive(it.value) }))
            put("silentH", JsonArray(silentH.map { JsonPrimitive(it) }))
        }

        companion object {
            private const val VOWELS = "aeiouàâäéèêëîïôöùûüœæ"
            private val FIRST_WORD = Regex("^[\\p{L}\\p{M}][\\p{L}\\p{M}'’-]*(?=$|[\\s,;:!?)»…])")

            /** The rule of the server's `elision`, or null when the language has none. */
            fun of(e: JsonObject?): Elision? {
                val words = (e?.get("words") as? JsonObject)?.mapNotNull { (w, f) -> f.text()?.takeIf { it.isNotEmpty() && w.isNotEmpty() && w.all(Char::isLetter) }?.let { w.lowercase() to it } }?.toMap().orEmpty()
                if (words.isEmpty()) return null
                return Elision(words, (e?.get("silentH") as? JsonArray)?.mapNotNull { it.text()?.lowercase() }.orEmpty())
            }
        }
    }

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
fun tr(text: String, vararg vars: Pair<String, Any?>): String = I18n.tr(text, vars)

/** A count: [one] for one and [other] otherwise in English; the other languages' forms are keyed by [other]. {n} is [n]. */
fun trn(n: Int, one: String, other: String, vararg vars: Pair<String, Any?>): String = I18n.trn(n, one, other, vars)
