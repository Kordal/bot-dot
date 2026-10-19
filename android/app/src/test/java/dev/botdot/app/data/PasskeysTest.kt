package dev.botdot.app.data

import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.exceptions.NoCredentialException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the sign-in screen says when Android's sheet ends without a passkey (#82): no passkey for this botdot on the
 * phone says where to look, a closed sheet says it calmly with the same hint (Android's "No available sign-in" sheet
 * ends that way too), and any other failure says Android's own words or a plain retry.
 */
class PasskeysTest {
    private fun says(e: Throwable) = Passkeys.words(Passkeys.failure(e), "hq.example.com")

    @Test fun noPasskeyOnThePhoneSaysWhereToLook() {
        val words = says(NoCredentialException())
        assertTrue(words, words.startsWith("This phone has no passkey for hq.example.com."))
        assertTrue(words, "passkey provider" in words && "Android's settings" in words)
    }

    @Test fun aClosedSheetSaysItCalmlyWithTheSameHint() {
        val words = says(GetCredentialCancellationException())
        assertTrue(words, words.startsWith("Sign-in closed."))
        assertTrue(words, "passkey provider" in words)
    }

    @Test fun anotherFailureSaysAndroidsWordsOrAPlainRetry() {
        assertEquals("The passkey didn't answer: Something broke. Try again.", says(GetCredentialUnknownException("Something broke")))
        assertEquals("The passkey didn't answer. Try again.", says(GetCredentialUnknownException(" ")))
        assertEquals("The passkey didn't answer. Try again.", says(GetCredentialUnknownException()))
    }

    @Test fun whatTheFrontDoorSaidIsSaidAsItIs() {
        assertEquals("Signed out.", Passkeys.words(ApiException("Signed out."), "hq.example.com"))
        assertEquals("That didn't sign you in.", Passkeys.words(RuntimeException(), "hq.example.com"))
    }
}
