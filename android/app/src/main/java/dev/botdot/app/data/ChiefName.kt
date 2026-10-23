package dev.botdot.app.data

/**
 * The Chief of Staff's name (#41, docs/api.md "The Chief's name"): the owner names it once in the first-run setup,
 * and later renames it in the Chief's settings, as a bot is renamed (#379), or asks the Chief. botdot hands it out as `chief.name`
 * of `GET /api/chief` and announces a change with the feed's `chief_name`. A botdot from before it says "Chief of Staff".
 */
object ChiefName {
    const val FEATURE = "chief-name"
    /** The role's own name: the Chief's name when the owner gave it none. */
    const val ROLE = "Chief of Staff"
    /** The longest name botdot keeps. */
    const val MAX = 40

    /** A name as botdot said it, or the role's own when it said none. */
    fun named(name: String?): String = name?.trim()?.ifEmpty { null } ?: ROLE

    /** The name in the Chief's part of `GET /api/chief`. */
    fun of(chief: ChiefOverview?): String = named(chief?.chief?.name)

    /**
     * Whether this phone asks for the name, as the web page's setup does: only a botdot that knows the question
     * ([FEATURE]), whose setup is not done and that has not had an answer yet (also a skip) from any app.
     */
    fun ask(features: Collection<String>?, setup: SetupInfo?): Boolean =
        features?.contains(FEATURE) == true && setup != null && !setup.done && !setup.chiefNameAsked

    /** What the name field of the Chief's settings starts with: empty for the role's own name, so its placeholder shows. */
    fun field(name: String): String = if (named(name) == ROLE) "" else name.trim()

    /** Whether the field holds another name than the Chief has, so that Save renames it. */
    fun changed(field: String, name: String): Boolean = named(field.take(MAX)) != named(name)
}
