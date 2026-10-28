package dev.botdot.app.data

/**
 * The owner's library skills for the Chief of Staff (docs/api.md, "Skills"): the Chief is given a skill as a bot is,
 * by its id "chief" in a skill's `usedBy`, and its list is `chiefSkills` in the settings. Only a server with
 * `chief-skills` in its features keeps them. `drawChiefSkills` in `public/app.js` is the web page's side.
 */
object ChiefSkills {
    const val FEATURE = "chief-skills"
    const val CHIEF_ID = "chief"
    const val TITLE = "Skills"
    const val EMPTY = "No skills in your library yet."

    /** Whether the server keeps the Chief's skills: only then is there a list to tick. */
    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /** Who uses a skill, by name: the Chief first, then the bots by their names (a deleted bot is left out). */
    fun usedBy(ids: List<String>, botNames: Map<String, String>): List<String> =
        (if (CHIEF_ID in ids) listOf("the Chief") else emptyList()) + ids.filter { it != CHIEF_ID }.mapNotNull { botNames[it] }

    /** The Chief's list with [name] ticked ([on]) or unticked, in the order it was given. */
    fun toggle(current: List<String>?, name: String, on: Boolean): List<String> {
        val now = current.orEmpty()
        return if (on) (if (name in now) now else now + name) else now - name
    }
}
