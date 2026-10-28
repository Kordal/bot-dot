package dev.botdot.app.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * The interface's language (#645, ADR 107): the app's words in English, or in Polish when the account chose it in
 * Settings. A string is keyed by its English text: tr("Saved") is "Saved" in English and "Zapisano" in Polish, and a
 * string without a translation stays English. trn(n, "{n} bot", "{n} bots") picks the plural form by the language's
 * rules. The dictionary is the server's (GET /api/i18n/pl), kept on the phone so the words are there from the first
 * screen. Its state is Compose's: a screen that drew a word draws it again when the language changes.
 */
object I18n {
    const val FEATURE = "language"
    /** The languages and their own names, which are never translated. */
    val LANGUAGES = listOf("en" to "English", "pl" to "Polski")

    /** Where the language and its dictionary are kept between starts. */
    interface Keep { fun read(): String?; fun write(value: String) }
    private var keep: Keep? = null

    var language by mutableStateOf("en"); private set
    private var strings by mutableStateOf<Map<String, JsonElement>>(emptyMap())

    /** The language and dictionary kept on the phone, at the app's start. */
    fun start(k: Keep) {
        keep = k
        val o = runCatching { k.read()?.let { Api.JSON.parseToJsonElement(it) as? JsonObject } }.getOrNull() ?: return
        use(o["language"].text(), o["strings"] as? JsonObject)
    }

    /** [lang] with its [table] (null for English), kept for the next start. */
    fun use(lang: String?, table: JsonObject?) {
        val l = if (lang == "pl") "pl" else "en"
        language = l
        strings = if (l == "en") emptyMap() else table.orEmpty()
        keep?.write(JsonObject(mapOf("language" to JsonPrimitive(l), "strings" to JsonObject(strings))).toString())
    }

    /** The account's language from the server and its dictionary, from a server that has [FEATURE]. */
    suspend fun sync(api: Api, features: Collection<String>?) {
        if (features == null || FEATURE !in features) return
        val lang = runCatching { api.language() }.getOrNull() ?: return
        if (lang == "en") return use("en", null)
        runCatching { api.dictionary(lang) }.onSuccess { use(lang, it) }
    }

    /** The feed's `language` event: the language another app switched the account to, or null. */
    fun event(ev: FeedEvent): String? = if (ev.type == FEATURE) ev.data["language"].text()?.takeIf { l -> LANGUAGES.any { it.first == l } } else null

    fun text(key: String): String = (strings[key] as? JsonPrimitive)?.contentOrNull ?: key

    fun plural(n: Int, one: String, other: String): String {
        val forms = strings[other] as? JsonObject ?: return if (n == 1) one else other
        return forms[form(language, n)].text() ?: forms["many"].text() ?: other
    }

    /** The plural form of [n]: English one/other, Polish one/few/many. */
    fun form(lang: String, n: Int): String {
        val a = kotlin.math.abs(n)
        if (lang != "pl") return if (a == 1) "one" else "other"
        return when {
            a == 1 -> "one"
            a % 10 in 2..4 && a % 100 !in 12..14 -> "few"
            else -> "many"
        }
    }

    fun fill(text: String, vars: Array<out Pair<String, Any?>>): String =
        if (vars.isEmpty()) text else Regex("""\{(\w+)\}""").replace(text) { m -> vars.firstOrNull { it.first == m.groupValues[1] }?.second?.toString() ?: m.value }

    private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
}

/** [text] in the account's language, its {placeholders} filled from [vars]. */
fun tr(text: String, vararg vars: Pair<String, Any?>): String = I18n.fill(I18n.text(text), vars)

/** A count: [one] for one and [other] otherwise in English; the Polish forms are keyed by [other]. {n} is [n]. */
fun trn(n: Int, one: String, other: String, vararg vars: Pair<String, Any?>): String = I18n.fill(I18n.plural(n, one, other), arrayOf<Pair<String, Any?>>("n" to n, *vars))
