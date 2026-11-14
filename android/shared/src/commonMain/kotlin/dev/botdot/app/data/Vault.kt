package dev.botdot.app.data

/**
 * The Vault's list and its login editor (Settings → Passwords), as the phones draw them: what each entry reads, the
 * search above a long list, the categories with their headings that fold (ADR 213), and what a login's save sends.
 * The words and the rules of a type are [VaultTypes]'; Android's VaultScreen and the iPhone's VaultView draw this.
 */
object Vault {
    /** The mark before an entry's name, by its kind. */
    fun icon(kind: String): String = when (kind) {
        "card" -> "💳"
        "identity" -> "🪪"
        VaultTypes.SSH_KEY -> "🗝️"
        VaultTypes.FILE -> "📄"
        else -> "🔑"
    }

    /** The lines under an entry's name: a card's brand and digits, an identity's holder, or the lines of its type. */
    fun lines(i: VaultItem, features: Collection<String>?): List<String> = when (i.kind) {
        "card" -> listOf("${i.brand ?: tr("Card")} •••• ${i.last4.orEmpty()}" + (i.expiry?.let { " · " + tr("expires {date}", "date" to it) } ?: "") + " · " + tr("you approve each payment"))
        "identity" -> listOf(listOfNotNull(i.holder, i.email).joinToString(" · "))
        VaultTypes.SSH_KEY -> VaultTypes.sshKeyRows(i)
        VaultTypes.FILE -> VaultTypes.fileRows(i)
        else -> VaultTypes.rows(i, features) // its type before its address, then the line of that type
    }

    /**
     * Which bots may use it, by name, or null for none. A login reaches a bot on the owner's one yes to its request
     * (ADR 192): no warning while none has it yet; any other kind says that no bot may use it.
     */
    fun botsLine(i: VaultItem, bots: List<Bot>): String? {
        val names = i.allowedBots.map { id -> bots.firstOrNull { it.id == id }?.name ?: id }
        if (names.isEmpty() && i.kind == "login") return null
        return if (names.isEmpty()) tr("No bot may use it yet") else tr("Can be used by {names}", "names" to names.joinToString(", "))
    }

    /** Whether the list gets a search field: once it is longer than [VaultTypes.SEARCH_AFTER]. */
    fun searches(items: List<VaultItem>): Boolean = items.size > VaultTypes.SEARCH_AFTER

    /** The entries the search shows: all of them while the list has no field. */
    fun shown(items: List<VaultItem>, query: String): List<VaultItem> =
        if (searches(items)) items.filter { VaultTypes.matches(it, query) } else items

    /** Nothing the search found: the list says "No matches". */
    fun noMatches(items: List<VaultItem>, query: String): Boolean = searches(items) && shown(items, query).isEmpty()

    /** A category of the list: its name ("" for the entries without one, drawn with no heading), whether it is open, and its entries. */
    data class Section(val category: String, val open: Boolean, val items: List<VaultItem>)

    /**
     * The list as drawn ([VaultTypes.groups]): the entries the search shows in their categories, each folded one
     * closed but while a search finds something in it.
     */
    fun sections(items: List<VaultItem>, query: String, folded: Set<String>): List<Section> {
        val searching = searches(items) && query.isNotBlank()
        return VaultTypes.groups(shown(items, query)).map { (c, inIt) -> Section(c, c !in folded || searching, inIt) }
    }

    /** A tap on a category's heading: folded, or open again. */
    fun toggled(folded: Set<String>, category: String): Set<String> = if (category in folded) folded - category else folded + category

    /** The additional exact hosts as typed, "a.example.com, b.example.com". */
    fun hosts(typed: String): List<String> = typed.split(',').map(String::trim).filter(String::isNotEmpty)

    /** What deleting an entry does: to Bitwarden's trash, or out of botdot's own vault. */
    fun deleteWords(bitwarden: Boolean): String =
        if (bitwarden) tr("It moves to Bitwarden's trash, where you can restore it for 30 days.") else tr("Bots can't use it any more.")

    /** What a refused unlock of Bitwarden says: a wrong master password, or the server's sentence. */
    fun unlockError(e: Throwable): String = unlockFailed(e) // Needs you's rule (NeedsDesk.kt)

    /** The entries of a `GET /api/vault` answer. */
    fun read(json: String): List<VaultItem> = Api.JSON.decodeFromString(json)
}

/**
 * The login editor's fields, for a new login ([of] null) or a saved one. Its Type comes first, the fields of that type
 * follow ([fields]); the secret is write-only: empty keeps the saved one. It draws no switch: every login is usable in
 * its computer and takes a self-signed certificate (ADR 177), and no bots list: a bot gets a login on the owner's yes to
 * its request (ADR 192).
 */
data class VaultLogin(
    val name: String = "",
    val site: String = "",
    val type: String = VaultTypes.LOGIN,
    /** Kept while Other shows no field for it: a login changed to Other and back shows its username again. */
    val username: String = "",
    val secret: String = "",
    val hosts: String = "",
    val category: String = "",
) {
    /** The fields this type asks for. */
    fun fields(features: Collection<String>?, isNew: Boolean): VaultTypes.Fields = VaultTypes.editorFields(type, features, isNew)

    /** Another type picked: one with its own address (a GitHub App's api.github.com) fills an empty address. */
    fun typed(id: String): VaultLogin = copy(type = id, site = VaultTypes.of(id).site?.takeIf { site.isBlank() } ?: site)

    /** Save can be tapped: a name and an address, and for a new login its secret. */
    fun canSave(isNew: Boolean): Boolean = name.isNotBlank() && site.isNotBlank() && (!isNew || secret.isNotEmpty())

    /**
     * Saves it as [item] (null: a new login), with what the server keeps ([features]): its type and username as
     * [VaultTypes.sent] says, its category only to a server that keeps them, and its bots left as they are. A refusal
     * throws the server's sentence, to show in the form.
     */
    @Throws(Exception::class)
    suspend fun save(api: Api, item: VaultItem?, features: Collection<String>?) {
        val sent = VaultTypes.sent(type, username, features, saved = item?.type)
        api.saveVaultLogin(item?.id, name.trim(), site.trim(), sent.username, secret, null, Vault.hosts(hosts), sent.type,
            if (VaultTypes.categories(features)) category.trim() else null)
    }

    companion object {
        /** The editor's fields as it opens on [item], or empty for a new login. */
        fun of(item: VaultItem?): VaultLogin = VaultLogin(
            name = item?.name.orEmpty(), site = item?.site.orEmpty(), type = VaultTypes.of(item?.type).id, username = item?.username.orEmpty(),
            hosts = item?.allowedHosts.orEmpty().joinToString(", "), category = item?.category.orEmpty(),
        )
    }
}

/**
 * Everything the iPhone's Vault draws, at one moment. [items] null: not read yet. [features]: the server's, null
 * before it answered. [folded]: the categories folded on this phone. [error]: what went wrong reading it.
 */
class VaultState(
    val items: List<VaultItem>?,
    val bitwarden: BitwardenStatus?,
    val features: List<String>?,
    val bots: List<Bot>,
    val folded: Set<String>,
    val error: String?,
) {
    /** Bitwarden is connected and locked: the list is empty until its master password unlocks it. */
    val locked: Boolean get() = bitwarden?.let { it.configured && !it.unlocked } == true
    /** Bitwarden holds the entries: a save says so, and a deletion moves to its trash. */
    val inBitwarden: Boolean get() = bitwarden?.configured == true
    val searches: Boolean get() = Vault.searches(items.orEmpty())
    fun sections(query: String): List<Vault.Section> = Vault.sections(items.orEmpty(), query, folded)
    fun noMatches(query: String): Boolean = Vault.noMatches(items.orEmpty(), query)
    fun lines(i: VaultItem): List<String> = Vault.lines(i, features)
    fun botsLine(i: VaultItem): String? = Vault.botsLine(i, bots)
    /** A login-kind entry opens its editor; the bots of any other kind are the Android app's and the web page's for now. */
    fun edits(i: VaultItem): Boolean = i.kind == "login"
    /** The Type control: only for a server that keeps types, with its options for [current] ([VaultTypes.options]). */
    val showsType: Boolean get() = VaultTypes.shows(features)
    fun typeIds(current: String?): List<String> = VaultTypes.options(features, current).map { it.first }
    fun typeLabel(id: String): String = VaultTypes.of(id).label
    /** The fields the login editor asks for with [form]'s type, for a new login or a saved one. */
    fun fields(form: VaultLogin, isNew: Boolean): VaultTypes.Fields = form.fields(features, isNew)
    /** The Category field: only for a server that keeps categories, with the ones in use that hold what is typed. */
    val categories: Boolean get() = VaultTypes.categories(features)
    fun suggestions(typed: String): List<String> = VaultTypes.suggestions(items.orEmpty(), typed)
}
