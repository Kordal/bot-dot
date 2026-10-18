package dev.botdot.app.data

/**
 * The Chief of Staff's name (#41, docs/api.md "The Chief's name"): the owner names it once in the first-run setup,
 * and later asks the Chief for another name (no control for it: AGENTS.md rule 5). botdot hands it out as `chief.name`
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
}
