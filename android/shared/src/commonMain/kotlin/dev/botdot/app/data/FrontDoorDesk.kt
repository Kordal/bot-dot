package dev.botdot.app.data

import kotlinx.coroutines.CancellationException

/**
 * What the front door offers this account, read once (ADR 028): deleting the account ([AccountDeletion.Offer]), and
 * Feedback, with or without screenshots and read by the developers ([FrontDoorOffers.developers], ADR 259) or an admin. Behind no front door (no `accounts` in `features`) it offers nothing.
 */
data class FrontDoorOffers(val deletion: AccountDeletion.Offer? = null, val feedback: Boolean = false, val shots: Boolean = false, val developers: Boolean = false)

/**
 * The front door's parts of an account for a phone (ADR 242): what it offers ([read]), the account's deletion
 * ([delete]) and Feedback ([sendFeedback]), with the Android app's rules and words. The iPhone draws what it answers.
 */
class FrontDoorDesk(private val api: Api) {
    /**
     * What the front door offers, from its session; null when its session couldn't be read, so the phone asks again
     * later instead of offering nothing for good. Behind no front door it offers nothing, and asks nothing.
     */
    @Throws(Exception::class)
    suspend fun read(features: List<String>?): FrontDoorOffers? {
        if (features?.contains("accounts") != true) return FrontDoorOffers()
        val session = try { api.frontDoorSession() } catch (e: CancellationException) { throw e } catch (_: Exception) { return null }
        return FrontDoorOffers(AccountDeletion.offer(features, session), Feedback.on(features, session), Feedback.shotsOn(session), Feedback.toDevelopers(session))
    }

    /**
     * Delete pressed, [typed] the account's name: what the phone says after it, and whether it went. The review demo's
     * account is never deleted and keeps its session: not done, so the phone says it in the form and stays signed in.
     */
    data class Deleted(val words: String, val done: Boolean)

    /**
     * Deletes the account (or asks for it, on a managed machine). Once it went, the front door ends this phone's session
     * and the sign-in follows. Nothing is sent unless [typed] is the account's name ([AccountDeletion.matches]).
     */
    @Throws(Exception::class)
    suspend fun delete(account: String, typed: String): Deleted {
        if (!AccountDeletion.matches(typed, account)) return Deleted(AccountDeletion.typeToConfirm(account), false)
        return try {
            val done = api.deleteAccount(account)
            Deleted(AccountDeletion.said(done), !done.demo)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Deleted(e.message ?: tr("Couldn't delete the account"), false)
        }
    }

    /** Sends a report: null once it went, else the form's sentence ([Feedback.failed]); what was typed stays. */
    @Throws(Exception::class)
    suspend fun sendFeedback(kind: Feedback.Kind, text: String, shots: List<ByteArray> = emptyList()): String? {
        return try {
            api.sendFeedback(kind, text, shots.take(Feedback.SHOTS_MAX))
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Feedback.failed(e, shots.size)
        }
    }
}
