package dev.botdot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.data.Api
import dev.botdot.app.data.AppUpdate
import dev.botdot.app.data.VersionInfo
import kotlinx.coroutines.launch

/** Installing the app update botdot has: downloading, then Android's installer. */
private class Installer {
    var progress by mutableStateOf<Float?>(null) // null = not downloading
}

@Composable
private fun rememberInstall(api: Api?, tell: (String) -> Unit): Pair<Installer, (dev.botdot.app.data.AndroidRelease) -> Unit> {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state = remember { Installer() }
    return state to { rel ->
        val a = api
        when {
            a == null || state.progress != null -> Unit
            !AppUpdate.mayInstall(context) -> { tell("Allow botdot to install apps, then tap Install again."); AppUpdate.openInstallSetting(context) }
            else -> scope.launch {
                state.progress = 0f
                runCatching { AppUpdate.install(context, a, rel) { state.progress = it } }.onError { tell(it.message ?: "Couldn't download the update") }
                state.progress = null
            }
        }
    }
}

/** On the home screen: a thin line when a newer app is ready. */
@Composable
fun AppUpdateBanner(api: Api?, version: VersionInfo?, tell: (String) -> Unit) {
    val p = LocalPaper.current
    val newer = AppUpdate.newer(version) ?: return
    val (state, install) = rememberInstall(api, tell)
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.sunk).clickable(enabled = state.progress == null) { install(newer) }.padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("A new version of the app is ready", color = p.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(state.progress?.let { "${(it * 100).toInt()}%" } ?: "Install", color = p.okText, fontSize = 14.sp)
    }
}
