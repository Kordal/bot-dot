package dev.botdot.app.ui

import android.content.ActivityNotFoundException
import android.content.Context
import androidx.core.net.toUri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.BrowserSignIn
import dev.botdot.app.data.tr

/**
 * Signing in to the account (ADR 028): once, with its passkey, on the front door's own page in the browser (a Custom
 * Tab), where the password manager the person uses there answers it. The page hands the sign-in back to the app
 * (BrowserSignIn), which keeps its session until it is signed out; this screen comes back only when the front door
 * asks again. Where it ended is the main activity's to follow: signed in, it opens the home screen.
 */
@Composable
fun SignInScreen(app: BotDotApp, onChangeServer: () -> Unit) {
    val p = LocalPaper.current
    val context = LocalContext.current
    val api by app.api.collectAsState()
    val state by app.browserSignIn.state.collectAsState()
    val host = api?.baseUrl?.substringAfter("://").orEmpty()
    val toolbar = p.bg.toArgb()

    fun signIn() {
        val page = app.browserSignIn.start() ?: return
        openInBrowser(context, page, toolbar) { app.browserSignIn.couldNotOpen(it) }
    }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().padding(Space.s24),
        verticalArrangement = Arrangement.Center,
    ) {
        Logo(size = Type.s32)
        Spacer(Modifier.height(Space.s8))
        Text(
            if (state == BrowserSignIn.State.Waiting) tr("Finish signing in in the browser. It brings you back here.")
            else tr("Sign in to your account on {host} with its passkey, in the browser: the password manager you use there answers it. The phone stays signed in until you sign out.", "host" to host),
            color = p.muted, style = MaterialTheme.typography.bodyLarge,
        )
        (state as? BrowserSignIn.State.Failed)?.let {
            Spacer(Modifier.height(Space.s12))
            Text(it.words, color = p.err, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(Space.s16))
        val finishing = state == BrowserSignIn.State.Finishing
        Button(
            onClick = { signIn() },
            enabled = !finishing && api != null,
            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText),
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) { Text(when (state) { BrowserSignIn.State.Finishing -> tr("Signing in…"); BrowserSignIn.State.Waiting -> tr("Open the sign-in again"); else -> tr("Sign in with your passkey") }) }
        Spacer(Modifier.height(Space.s8))
        TextButton(onClick = onChangeServer, modifier = Modifier.fillMaxWidth()) { Text(tr("Change botdot's address"), color = p.text) }
    }
}

/** Opens [url] in a Custom Tab of the phone's browser, dark like the app; [failed] says why it could not. */
private fun openInBrowser(context: Context, url: String, toolbar: Int, failed: (String) -> Unit) {
    val colors = CustomTabColorSchemeParams.Builder().setToolbarColor(toolbar).setNavigationBarColor(toolbar).build()
    val tab = CustomTabsIntent.Builder()
        .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
        .setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_DARK, colors)
        .setDefaultColorSchemeParams(colors)
        .setShowTitle(true)
        .build()
    try {
        tab.launchUrl(context, url.toUri())
    } catch (e: ActivityNotFoundException) {
        failed(tr("This phone has no browser to sign in with. Install one, then try again."))
    }
}
