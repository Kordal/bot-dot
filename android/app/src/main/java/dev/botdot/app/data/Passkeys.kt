package dev.botdot.app.data

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import kotlinx.coroutines.CancellationException

/**
 * The phone's half of a passkey sign-in (ADR 028): Android's Credential Manager asks the person to pick the
 * account's passkey and confirm with their screen lock, and answers the front door's options with a
 * PublicKeyCredential as JSON. [context] is the activity on screen, over which Android draws its sheet.
 */
object Passkeys {
    /** Android's sheet was closed without a choice. */
    class Closed : CancellationException("The sign-in was closed.")

    /** No passkey provider on the phone has a passkey for this botdot (or Android lets none answer for this app). */
    class NoPasskey : Exception("No passkey for this botdot.")

    // Where a passkey provider is turned on: Android's own words for that screen differ between versions and makers.
    private const val HINT = "turn on the password manager that holds it as a passkey provider in Android's settings " +
        "(Passwords, passkeys and accounts), then try again."

    suspend fun signIn(context: Context, requestJson: String): String {
        val result = try {
            CredentialManager.create(context).getCredential(context, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson))))
        } catch (e: GetCredentialException) {
            throw failure(e)
        }
        return (result.credential as? PublicKeyCredential)?.authenticationResponseJson ?: throw ApiException("That was no passkey. Try again.")
    }

    /** What a failed request to Credential Manager becomes: [Closed], [NoPasskey], or an [ApiException] in Android's words. */
    fun failure(e: Throwable): Throwable = when (e) {
        is GetCredentialCancellationException -> Closed()
        is NoCredentialException -> NoPasskey()
        is GetCredentialException -> ApiException(e.errorMessage?.toString()?.trim()?.ifEmpty { null }
            ?.let { "The passkey didn't answer: ${it.trimEnd('.')}. Try again." } ?: "The passkey didn't answer. Try again.")
        else -> e
    }

    /**
     * What the sign-in screen says after a sign-in that didn't sign in, for the botdot at [host] (#82). A closed sheet
     * gets the hint too: Android's "No available sign-in" sheet, which it shows when no provider has a passkey, ends so.
     */
    fun words(e: Throwable, host: String): String = when (e) {
        is Closed -> "Sign-in closed. If Android listed no passkey for $host, $HINT"
        is NoPasskey -> "This phone has no passkey for $host. ${HINT.replaceFirstChar(Char::uppercaseChar)}"
        else -> e.message?.ifBlank { null } ?: "That didn't sign you in."
    }
}
