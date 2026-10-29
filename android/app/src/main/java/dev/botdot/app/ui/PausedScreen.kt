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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.tr
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * An account the admin paused (#466, docs/api.md "A suspended account"): the front door's one sentence and its one way
 * out, as on its paused page. "Use another account" signs this phone out, and the sign-in screen follows (Session).
 * Botdot is asked again every minute, so a resumed account opens by itself.
 */
@Composable
fun PausedScreen(app: BotDotApp) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    var said by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(api) {
        while (true) {
            delay(60_000)
            runCatching { api?.bots() }
        }
    }

    Column(Modifier.fillMaxSize().systemBarsPadding().padding(Space.s24), verticalArrangement = Arrangement.Center) {
        Logo(size = Type.s32)
        Spacer(Modifier.height(Space.s8))
        Text(tr("Your account is paused by the admin."), color = p.muted, style = MaterialTheme.typography.bodyLarge)
        said?.let {
            Spacer(Modifier.height(Space.s12))
            Text(it, color = p.err, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(Space.s16))
        Button(
            onClick = {
                busy = true; said = null
                scope.launch {
                    runCatching { api!!.signOut() }.onError { said = it.message ?: tr("Couldn't sign out") }
                    busy = false
                }
            },
            enabled = !busy && api != null,
            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText),
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) { Text(tr("Use another account")) }
    }
}
