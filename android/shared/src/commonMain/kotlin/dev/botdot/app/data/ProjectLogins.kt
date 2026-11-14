package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** One of a project's logins (#804): a Vault login's id, and its name and site while the Vault has it. */
@Serializable
data class ProjectLogin(val id: String = "", val name: String? = null, val site: String? = null)

/**
 * A project's logins (#804, ADR 126; docs/api.md "Cards made by Claude"; web: public/company-settings.js): the Vault
 * logins its cards call the owner's own servers with, picked in project settings. A card that needs one it lacks has
 * [ProjectCard.needsLogin], the host, and offers Add login.
 */
object ProjectLogins {
    const val FEATURE = "project-logins"
    /** lib/company.js MAX.logins. */
    const val MAX = 8

    /** The Vault's logins that can be added: logins only, not picked yet. */
    fun addable(vault: List<VaultItem>, c: Company): List<VaultItem> = vault.filter { it.kind == "login" && c.logins.none { l -> l.id == it.id } }

    /** The PATCH of the whole list, by id. */
    fun patch(ids: List<String>): JsonObject = JsonObject(mapOf("logins" to JsonArray(ids.distinct().map { JsonPrimitive(it) })))
    fun added(c: Company, id: String): JsonObject = patch(c.logins.map { it.id } + id)
    fun removed(c: Company, id: String): JsonObject = patch(c.logins.map { it.id }.filter { it != id })
}
