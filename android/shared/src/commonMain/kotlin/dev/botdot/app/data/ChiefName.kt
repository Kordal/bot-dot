package dev.botdot.app.data

import kotlinx.coroutines.CancellationException

/**
 * The Chief of Staff's name (#41, docs/api.md "The Chief's name"): the owner names it once in the first-run setup,
 * and later renames it in the Chief's settings, as a bot is renamed (#379), or asks the Chief. botdot hands it out as `chief.name`
 * of `GET /api/chief` and announces a change with the feed's `chief_name`. A botdot from before it says "Chief of Staff".
 */
object ChiefName {
    const val FEATURE = "chief-name"
    /** The role's own name as botdot says it: the Chief's name when the owner gave it none. */
    const val ROLE = "Chief of Staff"
    /** [ROLE] in the account's language. */
    val role: String get() = tr("Chief of Staff")
    /** The longest name botdot keeps. */
    const val MAX = 40

    /** A name as botdot said it, or the role's own, in the account's language, when it said none or the role's. */
    fun named(name: String?): String = name?.trim()?.ifEmpty { null }?.takeIf { it != ROLE } ?: role

    /** The name in the Chief's part of `GET /api/chief`. */
    fun of(chief: ChiefOverview?): String = named(chief?.chief?.name)

    /**
     * Whether this phone asks for the name, as the web page's setup does: only a botdot that knows the question
     * ([FEATURE]), whose setup is not done and that has not had an answer yet (also a skip) from any app.
     */
    fun ask(features: Collection<String>?, setup: SetupInfo?): Boolean =
        features?.contains(FEATURE) == true && setup != null && !setup.done && !setup.chiefNameAsked

    /**
     * The first run, once the phone is in: whether to ask for the name ([ask]). A botdot with no time zone of its own
     * yet (#756) takes this device's, [zone], once. Nothing is asked of a botdot from before the name.
     */
    @Throws(Exception::class)
    suspend fun firstRun(api: Api, features: Collection<String>, zone: String): Boolean {
        if (FEATURE !in features) return false
        val setup = try { api.setup() } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
        if (setup != null && setup.savedTimezone == null) try { api.deviceTimezone(zone) } catch (e: CancellationException) { throw e } catch (_: Exception) { }
        return ask(features, setup)
    }

    /** Save ([given]) or Skip (""): null once botdot kept it; else why not, and the question stays. */
    @Throws(Exception::class)
    suspend fun answer(api: Api, given: String): String? =
        try { api.nameChief(given.take(MAX)); null } catch (e: CancellationException) { throw e } catch (e: Exception) { e.message ?: tr("Couldn't save the name") }

    /** The question's own words, as the web page's setup asks it. */
    val question: String get() = tr("Name your Chief of Staff")
    val explain: String get() = tr("It runs your team of bots and talks with you. Leave it empty to keep “Chief of Staff”. You can ask it for another name any time.")

    /** What the name field of the Chief's settings starts with: empty for the role's own name, so its placeholder shows. */
    fun field(name: String): String = if (named(name) == role) "" else name.trim()

    /** Whether the field holds another name than the Chief has, so that Save renames it. */
    fun changed(field: String, name: String): Boolean = named(field.take(MAX)) != named(name)
}
