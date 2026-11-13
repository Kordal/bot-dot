package dev.botdot.app.data

import kotlinx.serialization.json.JsonArray
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

    /**
     * Where a managed machine's deletion is (#1313, ADR 241): "pending" while its fleet console ends the subscription,
     * "failed" when it couldn't (nothing was deleted), else null.
     */
    fun deletion(session: JsonObject?): String? =
        (session?.get("deletion") as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it == "pending" || it == "failed" }

    /** Whether deleting it cancels the subscription first: the account that pays for a managed machine. */
    fun endsSubscription(session: JsonObject?): Boolean = flag(session, "deleteEndsSubscription") == true

    /** The other accounts of the machine that go with it. */
    fun also(session: JsonObject?): List<String> = (session?.get("deletesAlso") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: emptyList()

    /** The session's own account, whose name is typed to confirm; empty when the front door sent none. */
    fun account(session: JsonObject?): String = (session?.get("account") as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()

    /** Whether Delete works: the account's name typed exactly, no more and no less. */
    fun matches(typed: String, account: String): Boolean = account.isNotEmpty() && typed == account

    fun body(name: String): JsonObject = buildJsonObject { put("name", name) }

    /**
     * What the front door answered: [boat] is why its machines on boat.dev were not all deleted, or null when they were;
     * [pending] when a managed machine's fleet console ends the subscription first (#1313).
     */
    data class Done(val boat: String?, val pending: Boolean = false)
    fun done(answer: JsonObject?): Done = Done(
        (answer?.get("boat") as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.ifEmpty { null },
        (answer?.get("pending") as? JsonPrimitive)?.takeIf { !it.isString }?.content == "true",
    )

    /** What the phone says when the console couldn't cancel the subscription. */
    fun failed(): String = tr("Your subscription couldn't be cancelled, so nothing was deleted. Try again later.")

    /** What the phone says once it is deleted: with a line on boat.dev's machines when not all of them went. */
    fun said(done: Done): String = done.boat?.let { tr("Your account is deleted, but not all its machines on boat.dev were ({why}). Tell the admin of this machine.", "why" to it) }
        ?: tr("Your account is deleted.")

    /** true, false, or null when the field is left out or isn't a boolean. */
    private fun flag(session: JsonObject?, name: String): Boolean? =
        (session?.get(name) as? JsonPrimitive)?.takeIf { !it.isString }?.content?.let { if (it == "true") true else if (it == "false") false else null }
}
