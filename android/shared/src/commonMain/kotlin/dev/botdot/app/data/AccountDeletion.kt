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

    /**
     * Where a managed machine's owner starts deleting the account instead (#1312): the page of botdot.app the front
     * door's session names (`deleteAccountPage`), only an https address; null elsewhere and from an older front door.
     */
    fun page(features: List<String>?, session: JsonObject?): String? {
        if (features?.contains("accounts") != true) return null
        val page = (session?.get("deleteAccountPage") as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        return page.takeIf { parseUri(page)?.let { it.scheme == "https" && !it.host.isNullOrEmpty() } == true }
    }

    /**
     * Whether Delete asks for the account to be deleted rather than deleting it at once (#1313): a managed machine,
     * whose fleet console erases it. The account is paused and signed out at once.
     */
    fun request(session: JsonObject?): Boolean = flag(session, "deletionRequest") == true

    /** The session's own account, whose name is typed to confirm; empty when the front door sent none. */
    fun account(session: JsonObject?): String = (session?.get("account") as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()

    /** Whether Delete works: the account's name typed exactly, no more and no less. */
    fun matches(typed: String, account: String): Boolean = account.isNotEmpty() && typed == account

    /** What the confirmation says the deletion does: a request on a managed machine, else at once and for good. */
    fun warning(session: JsonObject?): String = if (request(session)) tr("Your account is paused and you are signed out at once. Your subscription is cancelled, and the account, its bots, chats, files, notes and Board are erased within 7 days. This can't be undone.")
        else tr("This deletes at once, for good: the account, its bots, chats, files, notes, Board, containers, passkeys, sessions and feedback.")

    /** The line under it, on the off-site backups. */
    val backups: String get() = tr("Off-site backups of the account are kept for 14 days, then removed.")

    /** The confirmation's field, which takes the account's name. */
    fun typeToConfirm(account: String): String = tr("Type your account name, {name}, to confirm", "name" to account)

    /**
     * What an app offers for deleting this account, as Android's Settings does: Delete with its confirmation ([Delete]),
     * the page of botdot.app that says how ([Page]), or why the admin's account can't be ([AdminNote]); null: nothing.
     */
    sealed class Offer {
        data class Delete(val account: String, val warning: String) : Offer()
        data class Page(val url: String) : Offer() { val text: String get() = tr("Your account is deleted on botdot.app: the page says how.") }
        data object AdminNote : Offer() { val text: String get() = tr("This is the admin's account of this machine, so it can't be deleted here. The machine is removed by its admin instead.") }
    }

    fun offer(features: List<String>?, session: JsonObject?): Offer? = when {
        on(features, session) -> Offer.Delete(account(session), warning(session))
        page(features, session) != null -> Offer.Page(page(features, session)!!)
        adminNote(features, session) -> Offer.AdminNote
        else -> null
    }

    fun body(name: String): JsonObject = buildJsonObject { put("name", name) }

    /**
     * What the front door answered: [boat] is why its machines on boat.dev were not all deleted, or null when they were;
     * [requested], that a managed machine took the request to delete it (#1313).
     */
    data class Done(val boat: String?, val requested: Boolean = false, val demo: Boolean = false)
    fun done(answer: JsonObject?): Done = Done(
        (answer?.get("boat") as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.ifEmpty { null },
        flag(answer, "requested") == true,
        flag(answer, "demo") == true,
    )

    /**
     * What the phone says once it is deleted: with a line on boat.dev's machines when not all of them went. The review
     * demo is never deleted, and says so.
     */
    fun said(done: Done): String = if (done.demo) tr("This is a demo account: it is not deleted.")
        else if (done.requested) tr("Your account is being deleted.")
        else done.boat?.let { tr("Your account is deleted, but not all its machines on boat.dev were ({why}). Tell the admin of this machine.", "why" to it) }
        ?: tr("Your account is deleted.")

    /** true, false, or null when the field is left out or isn't a boolean. */
    private fun flag(session: JsonObject?, name: String): Boolean? =
        (session?.get(name) as? JsonPrimitive)?.takeIf { !it.isString }?.content?.let { if (it == "true") true else if (it == "false") false else null }
}
