package dev.botdot.app.data

/**
 * A project's own bots in no team (ADR 233; web: public/company-home.js addToProject): the owner adds a bot to the
 * project without a team, on a botdot that has `project-bots`.
 */
object ProjectBots {
    const val FEATURE = "project-bots"

    /** The bots "Add bot" offers: the account's bots not in [c] yet, on none of its teams and not its own. */
    fun addable(c: Company, bots: List<Bot>): List<Bot> {
        val mine = (c.teams.flatMap { it.bots } + c.bots).toSet()
        return bots.filter { it.id !in mine }
    }
}
