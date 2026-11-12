package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Settings → "Delete account" (#1307): the owner deletes their own account, as the admin does on the admin page. Shown
 * only where the front door's session says so (`deleteAccount`): an older front door leaves it out and the app shows
 * nothing. The admin's own account is never offered it; Settings says the machine is removed by its admin instead.
 */
object AccountDeletion {
    /** Whether Settings offers "Delete account": behind a front door (`accounts`) whose session says this account may. */
    fun on(features: List<String>?, session: JsonObject?): Boolean =
        features?.contains("accounts") == true && flag(session, "deleteAccount") == true

    /** Whether Settings says instead that the admin's account goes with its machine: the admin's session, told no. */
    fun adminNote(features: List<String>?, session: JsonObject?): Boolean =
        features?.contains("accounts") == true && flag(session, "admin") == true && flag(session, "deleteAccount") == false

    /** The session's own account, whose name is typed to confirm; empty when the front door sent none. */
    fun account(session: JsonObject?): String = (session?.get("account") as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()

    /** Whether Delete works: the account's name typed exactly, no more and no less. */
    fun matches(typed: String, account: String): Boolean = account.isNotEmpty() && typed == account

    fun body(name: String): JsonObject = buildJsonObject { put("name", name) }

    /** true, false, or null when the field is left out or isn't a boolean. */
    private fun flag(session: JsonObject?, name: String): Boolean? =
        (session?.get(name) as? JsonPrimitive)?.takeIf { !it.isString }?.content?.let { if (it == "true") true else if (it == "false") false else null }
}
