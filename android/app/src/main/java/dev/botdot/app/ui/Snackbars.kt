package dev.botdot.app.ui

import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarVisuals
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** A note that says something failed: [BotSnackbarHost] draws it red, as the web page's `.toast.err`. */
private class FailedNote(override val message: String) : SnackbarVisuals {
    override val actionLabel: String? = null
    override val withDismissAction = false
    override val duration = SnackbarDuration.Short
}

/** Shows [message] as a failure (#1191). */
suspend fun SnackbarHostState.showError(message: String) { showSnackbar(FailedNote(message)) }

/**
 * Every screen's notes at the bottom (#1191), the web page's toast: a pill in ink, or red on its soft red for a
 * failure ([showError]). A screen never takes Material's own SnackbarHost, which draws them lavender (ThemeTest).
 */
@Composable
fun BotSnackbarHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    val p = LocalPaper.current
    SnackbarHost(state, modifier) { data ->
        val failed = data.visuals is FailedNote
        val ink = if (failed) p.err else p.inkText
        Snackbar(
            data, shape = Radius.pill,
            containerColor = if (failed) p.errSoft else p.ink, contentColor = ink,
            actionColor = ink, actionContentColor = ink, dismissActionContentColor = ink,
        )
    }
}
