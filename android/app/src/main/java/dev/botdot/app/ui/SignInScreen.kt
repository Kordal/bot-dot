package dev.botdot.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Passkeys
import kotlinx.coroutines.launch

/**
 * Signing in to the account (ADR 028): once, with its passkey, through Android's own sheet. The session is then
 * kept until it is signed out; this screen comes back only when the front door asks again.
 */
@Composable
fun SignInScreen(app: BotDotApp, onSignedIn: () -> Unit, onChangeServer: () -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val api by app.api.collectAsState()
    var error by remember { mutableStateOf<String?>(null) }
    var signingIn by remember { mutableStateOf(false) }
    val host = api?.baseUrl?.substringAfter("://").orEmpty()

    fun signIn() {
        val a = api ?: return
        signingIn = true
        error = null
        scope.launch {
            // The button is back however the sheet ended, and the screen says why in its own words (#82).
            val r = runCatching { a.signInWithPasskey { options -> Passkeys.signIn(context, options) } }
            signingIn = false
            r.onSuccess { app.signedIn(); onSignedIn() }
                .onFailure { e -> error = Passkeys.words(e, host) }
        }
    }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Logo(size = 34.sp)
        Spacer(Modifier.height(8.dp))
        Text("Sign in to your account on $host with its passkey. The phone stays signed in until you sign out.",
            color = p.muted, style = MaterialTheme.typography.bodyLarge)
        if (error != null) {
            Spacer(Modifier.height(10.dp))
            Text(error!!, color = p.err, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { signIn() },
            enabled = !signingIn && api != null,
            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText),
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) { Text(if (signingIn) "Signing in…" else "Sign in with your passkey") }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onChangeServer, modifier = Modifier.fillMaxWidth()) { Text("Change botdot's address", color = p.text) }
    }
}
