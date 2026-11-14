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
import dev.botdot.app.data.Connect
import dev.botdot.app.data.tr
import kotlinx.coroutines.launch

/** Where's your botdot? Checks the address answers as botdot, with an API this app understands (Connect, shared with iOS). */
@Composable
fun ConnectScreen(current: String?, onConnected: (String) -> Unit) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf(current ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }

    fun connect() {
        // As on the iPhone: a botdot on a computer itself, plain HTTP and nonsense are said at once, not asked.
        val typed = Connect.address(address)
        Connect.words(typed)?.let { error = it; return }
        val url = (typed as Connect.Address.Remote).url
        checking = true
        error = null
        scope.launch {
            error = Connect.check(url)
            checking = false
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
