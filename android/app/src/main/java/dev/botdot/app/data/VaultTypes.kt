package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The type of a login-kind item of the Vault: a login, an API token or any other secret (docs/api.md "The Vault's
 * items"). The type is a label and the fields its form asks for, nothing else. This says how an item reads in the
 * list, what the editor and the login request's card ask for, and what a save sends; the screens draw what it
 * says. `VAULT_TYPES` in `public/app.js` is the web page's side, with the same words.
 */
object VaultTypes {
    const val FEATURE = "vault-types"
    const val LOGIN = "login"
    const val API_TOKEN = "api-token"
    const val OTHER = "other"

    /** The label of the control that picks the type. */
    const val CONTROL = "Type"

    /** "Usable in its computer" (docs/api.md, The Vault's items): a server that keeps it says so in its features. */
    const val IN_COMPUTER_FEATURE = "vault-in-computer"
    const val IN_COMPUTER = "Usable in its computer"
    const val IN_COMPUTER_HINT = "Bots may use it in a command on the account's computer, e.g. for Proton Bridge there. Every bot on that computer could then read it: only for secrets that guard something on it."

    /** Whether the server keeps "Usable in its computer": only then is there a switch for it, and a value to send. */
    fun showsInComputer(features: Collection<String>?): Boolean = features != null && IN_COMPUTER_FEATURE in features

    /**
     * What a type is called and asks for. [username]: the label of its first field, null where the form has the
     * secret alone. [none]: what the list shows for an item without a username.
     */
    data class Type(val id: String, val label: String, val username: String?, val optional: Boolean, val secret: String, val icon: String, val none: String, val saved: String)

    val ALL = listOf(
        Type(LOGIN, "Login", "Username or email", false, "Password", "👤", "(no username)", "secret saved"),
        Type(API_TOKEN, "API token", "Token ID", true, "Token", "🆔", "(no token ID)", "token saved"),
        Type(OTHER, "Other", null, false, "Secret", "", "", "secret saved"),
    )

    /** The types as the Type control offers them: id to label. */
    val OPTIONS = ALL.map { it.id to it.label }

    /** The type of an item or a request: a login where it has none, or one this app does not know. */
    fun of(type: String?): Type = ALL.firstOrNull { it.id == type } ?: ALL.first()

    /** Whether the server keeps types: only then is there a Type control, and a type to send. */
    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /**
     * A login-kind item in the Vault's list, under its name: its type before its address, then the line of that
     * type. From a server before the types it is the one line the list always had.
     */
    fun rows(i: VaultItem, features: Collection<String>?): List<String> {
        val extras = (if (i.hasTotp) " · two-step code" else "") + (if (i.insecureTls) " · self-signed certificate OK" else "") + (if (i.inComputer) " · usable in its computer" else "")
        if (!shows(features)) return listOf("${i.site} · ${i.username.ifBlank { "(no username)" }}$extras")
        val t = of(i.type)
        val who = if (t.username == null) "" else "${t.icon} ${i.username.ifBlank { t.none }} · "
        return listOf("${t.label} · ${i.site}", "$who🔒 ${t.saved}$extras")
    }

    /** An SSH key of Bitwarden (kind `ssh-key`, docs/api.md): "SSH key", then its fingerprint and that a bot never sees it. */
    const val SSH_KEY = "ssh-key"
    fun sshKeyRows(i: VaultItem): List<String> =
        listOf("SSH key", (i.fingerprint?.takeIf { it.isNotBlank() }?.let { "$it · " } ?: "") + "🔒 for SSH on a bot's computer, never shown to it")

    /** The owner adds an SSH key from the app (`vault-ssh-key-add`, #160): only with a server that takes one. */
    const val SSH_KEY_ADD_FEATURE = "vault-ssh-key-add"
    fun addsSshKeys(features: Collection<String>?): Boolean = features != null && SSH_KEY_ADD_FEATURE in features

    /** Above the bots of a card, an identity or an SSH key: what sharing it lets a bot do. */
    fun itemBotsHint(kind: String): String = when (kind) {
        "card" -> "Bots that may pay with this card. You still approve every payment."
        SSH_KEY -> "Bots that may use this key for SSH from the account's computer. botdot loads it into an ssh-agent there for one command: no file holds the key, but every bot on that computer could read it meanwhile."
        else -> "Bots that may type these details into forms."
    }

    /** The two fields that hold the secret of a type. [username] null: the form shows the secret alone. */
    data class Fields(val username: String?, val secret: String)

    /** The Vault editor's fields. [isNew]: a new item needs its secret, a saved one keeps it when the field is left empty. */
    fun editorFields(type: String?, features: Collection<String>?, isNew: Boolean): Fields {
        if (!shows(features)) return Fields("Username, email or token ID", if (isNew) "Password, token or key" else "New password (empty keeps it)")
        val t = of(type)
        return Fields(usernameLabel(t), if (isNew) t.secret else "New ${t.secret.lowercase()} (empty keeps it)")
    }

    /** The new-login fields of a login request's card. */
    fun requestFields(type: String?, features: Collection<String>?): Fields {
        if (!shows(features)) return Fields("Username or email", "Password")
        val t = of(type)
        return Fields(usernameLabel(t), t.secret)
    }

    private fun usernameLabel(t: Type): String? = t.username?.let { if (t.optional) "$it (optional)" else it }

    /** What a save sends beside the secret. [type] null: none is sent. [username] null: none is sent, and the server keeps the saved one. */
    data class Sent(val type: String?, val username: String?)

    /**
     * What a save sends for the chosen type: the type, and the username where the type has one. A server from
     * before the types gets no type and the username as typed. [saved]: the type the item has on the server, for a
     * saved item; one this app does not know is drawn as a login, and stays what it is while the owner leaves
     * the Type control on Login.
     */
    fun sent(type: String?, username: String, features: Collection<String>?, saved: String? = null): Sent {
        if (!shows(features)) return Sent(null, username)
        val t = of(type)
        val unknownKept = saved != null && ALL.none { it.id == saved } && t.id == LOGIN
        return Sent(if (unknownKept) null else t.id, if (t.username == null) null else username)
    }

    /** The answer that saves a new item from a login request's card (docs/api.md "Login requests"). [master]: Bitwarden's master password, when it is locked. */
    fun requestSave(sent: Sent, password: String, master: String = ""): JsonObject = buildJsonObject {
        put("action", "save")
        sent.type?.let { put("type", it) }
        sent.username?.let { put("username", it) }
        put("password", password)
        if (master.isNotEmpty()) put("unlockPassword", master)
    }
}
