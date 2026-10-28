package dev.botdot.app.data

/**
 * "Use another saved login" in the card of a login request (docs/api.md "Login requests"): the logins saved for
 * another website, which of them stay for what is typed in the search of a long list, and the second question
 * before one of them is used on the requested host. The card draws what these say; `loginRequestOthers`,
 * `loginRequestMatches` and `loginRequestConfirm` in `public/app.js` are the web page's side.
 */
object OtherLogins {
    /** A list longer than this gets a search field and scrolls inside the card. */
    const val SEARCH_ABOVE = 6
    val OPEN: String get() = tr("Use another saved login")
    val HEADING: String get() = tr("Saved for another website")
    val SEARCH: String get() = tr("Search")
    val NO_MATCH: String get() = tr("No saved login matches.")
    val USE: String get() = tr("Use it")
    val BACK: String get() = tr("Back")
    val SENDING: String get() = tr("Letting it use the login…")

    /** How long the confirmation's button waits before it takes a tap: a second tap on the list's row answers nothing. */
    const val CONFIRM_AFTER_MS = 600L

    /**
     * The login the second question is about: the one picked from the list, while the server still offers it.
     * Nothing picked, or a login the list no longer has, is no question, and so nothing to send.
     */
    fun picked(others: List<OtherLogin>, id: String?): OtherLogin? = if (id == null) null else others.firstOrNull { it.id == id }

    /** The other logins a request offers: none for a card request, and none from a server that sends none. */
    fun of(r: LoginRequest): List<OtherLogin> = if (r.kind == "card") emptyList() else r.others

    /** Whether the list is long enough for the search field. */
    fun hasSearch(others: List<OtherLogin>): Boolean = others.size > SEARCH_ABOVE

    /**
     * Whether a login stays in the list for what was typed: every typed word is in its name, username or website,
     * whatever the case. Nothing typed keeps every login.
     */
    fun matches(e: OtherLogin, typed: String): Boolean {
        val hay = listOf(e.name, e.username, e.site).map { it.lowercase() }
        return typed.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }.all { w -> hay.any { it.contains(w) } }
    }

    /** The rows left for what was typed, in the server's order. */
    fun shown(others: List<OtherLogin>, typed: String): List<OtherLogin> = others.filter { matches(it, typed) }

    /** A row's first line: the login's name and, when it has one, its username. Its website is the second line. */
    fun label(e: OtherLogin): String = if (e.username.isNotBlank()) "${e.name} · ${e.username}" else e.name

    /** The second question: the login, where it is saved, the requested host, the warning and the one button that answers. */
    data class Confirm(val lead: String, val login: String, val savedFor: String, val on: String, val host: String, val warning: String, val yes: String)

    /** What the confirmation says before [e] is used on the host [r] asks for, by the bot named [by]. */
    fun confirm(r: LoginRequest, e: OtherLogin, by: String): Confirm = Confirm(
        lead = tr("Use the login"),
        login = e.name,
        savedFor = if (e.site.isNotBlank()) tr("saved for {site}", "site" to e.site) else tr("saved without a website"),
        on = tr("on"),
        host = r.site,
        warning = tr("Its password will also be used on {site}, by {bot}. Only continue if {site} really takes this login: web pages can try to trick bots into asking.", "site" to r.site, "bot" to by),
        yes = tr("Use it on {site}", "site" to r.site),
    )
}
