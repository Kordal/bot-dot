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
    /** Android's sheet was closed without a choice: nothing to say. */
    class Closed : CancellationException("The sign-in was closed.")

    suspend fun signIn(context: Context, requestJson: String): String {
        val result = try {
            CredentialManager.create(context).getCredential(context, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson))))
        } catch (_: GetCredentialCancellationException) {
            throw Closed()
        } catch (_: NoCredentialException) {
            throw ApiException("This phone has no passkey for this botdot. It is in the password manager you made it with: add that one in Android's settings (Passwords and accounts), then try again.")
        } catch (e: GetCredentialException) {
            throw ApiException(e.errorMessage?.toString()?.ifBlank { null } ?: "The passkey didn't answer. Try again.")
        }
        return (result.credential as? PublicKeyCredential)?.authenticationResponseJson ?: throw ApiException("That was no passkey. Try again.")
    }
}
