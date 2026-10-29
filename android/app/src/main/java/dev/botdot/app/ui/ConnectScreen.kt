package dev.botdot.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.botdot.app.data.Api
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

const val API_VERSION = 1

/** Where's your botdot? Checks the address answers as botdot, with an API this app understands. */
@Composable
fun ConnectScreen(current: String?, onConnected: (String) -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf(current ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }

    fun connect() {
        val url = Api.normalize(address) ?: run { error = tr("That doesn't look like an address."); return }
        checking = true
        error = null
        scope.launch {
            val r = runCatching { Api(url).version() }
            checking = false
            val v = r.getOrNull()
            val failure = r.exceptionOrNull()
            error = when {
                // Before botdot had /api/version (it answers "Unknown endpoint").
                failure is ApiException && failure.status == 404 -> tr("This botdot is older than the app. Ask its admin to update it, then connect again.")
                failure != null -> failure.message
                v == null || v.app != "bot-dot" -> tr("That address answers, but it isn't botdot.")
                // A front door (ADR 028): which botdot is behind it is known once signed in.
                v.frontDoor -> null
                v.apiVersion > API_VERSION -> tr("This botdot is newer than the app. Update the app.")
                v.apiVersion < API_VERSION -> tr("This botdot is older than the app. Ask its admin to update it.")
                else -> null
            }
            if (error == null) onConnected(url)
        }
    }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().padding(Space.s24),
        verticalArrangement = Arrangement.Center,
    ) {
        Logo(size = Type.s32)
        Spacer(Modifier.height(Space.s8))
        Text(tr("Your botdot's address, the one you open in the browser. The phone reaches it through Tailscale, so keep Tailscale on."),
            color = p.muted, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(Space.s24))
        Field(
            value = address,
            onValueChange = { address = it; error = null },
            label = { Text(tr("Address")) },
            placeholder = { Text("my-vm.my-tailnet.ts.net") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onGo = { connect() }),
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) {
            Spacer(Modifier.height(Space.s12))
            Text(error!!, color = p.err, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(Space.s16))
        Button(
            onClick = { connect() },
            enabled = !checking && address.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText),
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) { Text(if (checking) tr("Connecting…") else tr("Connect")) }
    }
}
