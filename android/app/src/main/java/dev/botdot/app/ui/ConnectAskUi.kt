package dev.botdot.app.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableStateMapOf
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.ApiException
import dev.botdot.app.data.Ask
import dev.botdot.app.data.AskAct
import dev.botdot.app.data.AskConnect
import dev.botdot.app.data.CONNECT_CARDS
import dev.botdot.app.data.tr
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Opens the Connectors screen, for the cards whose button does (`act` open, and Connect on a server without connect cards). */
val LocalOpenConnectors = compositionLocalOf<(() -> Unit)?> { null }

/**
 * Where the Connect of a missing app's card is, by ask (docs/api.md "A missing connected app", as the web page's
 * `connecting`): its card in a chat, on Needs you and its row over the keys all read it. The sign-in page opens in the
 * browser; as the app comes back ([check]) the card asks how the connection stands, and goes once it is connected.
 */
internal object ConnectAsks {
    enum class Step { Opening, Waiting, Failed }
    data class At(val step: Step, val error: String? = null)

    val at = mutableStateMapOf<String, At>()

    /** The card's button, as it reads now: "Opening…" while it opens, "Try again" after it failed, else its own word. */
    fun button(a: Ask, label: String): String = when (at[a.id]?.step) {
        Step.Opening -> tr("Opening…")
        Step.Failed -> tr("Try again")
        else -> label
    }

    /** The card's line under its title: that it waits for the sign-in, or nothing. */
    fun line(a: Ask): String? = if (at[a.id]?.step == Step.Waiting) tr("Waiting for sign-in") else null

    /** Why the last Connect did not go, in Composio's or botdot's words, or null. */
    fun error(a: Ask): String? = at[a.id]?.takeIf { it.step == Step.Failed }?.error

    /**
     * The card's main button. Connect: `POST /api/asks/:id/connect`, then the sign-in page in the browser. An app with
     * no sign-in is connected at once. A refusal says why and the next list draws the card in setup. Open Connectors,
     * and Connect on a server without connect cards (where that POST would be a no): the Connectors screen.
     */
    fun press(scope: CoroutineScope, app: BotDotApp, context: Context, a: Ask, openConnectors: (() -> Unit)?) {
        val act = a.act ?: return
        if (act.verb == AskAct.OPEN || CONNECT_CARDS !in app.store.version.value.value?.features.orEmpty()) { openConnectors?.invoke(); return }
        if (at[a.id]?.step == Step.Opening) return
        at[a.id] = At(Step.Opening)
        scope.launch {
            runCatching { (app.api.value ?: throw ApiException(tr("Can't reach botdot."))).connectAsk(a.id) }
                .onSuccess { c ->
                    val url = c.redirectUrl
                    if (c.outcome == AskConnect.Outcome.Connected || url == null) { at.remove(a.id); app.store.needs.refresh(); return@onSuccess }
                    at[a.id] = At(Step.Waiting)
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        .onFailure { at[a.id] = At(Step.Failed, tr("Couldn't connect {name}.", "name" to a.appName)) }
                }
                .onFailure {
                    at[a.id] = At(Step.Failed, it.message ?: tr("Couldn't connect {name}.", "name" to a.appName))
                    app.store.needs.refresh()
                }
        }
    }

    /**
     * Back in the app: how each Connect that waits stands (`GET /api/asks/:id/connect`). Connected, or answered
     * elsewhere meanwhile (404): the card goes with the next list. Failed or expired: its button again. Still waiting:
     * as it was.
     */
    suspend fun check(app: BotDotApp) {
        val api = app.api.value ?: return
        val waiting = at.filterValues { it.step == Step.Waiting }.keys.toList()
        if (waiting.isEmpty()) return
        var changed = false
        for (id in waiting) {
            val s = runCatching { api.askConnectStatus(id) }.getOrElse { e -> if ((e as? ApiException)?.status == 404) AskConnect(settled = true) else null } ?: continue
            when (s.outcome) {
                AskConnect.Outcome.Connected -> { at.remove(id); changed = true }
                AskConnect.Outcome.Ended -> at.remove(id)
                AskConnect.Outcome.Waiting -> {}
            }
        }
        if (changed) app.store.needs.refresh()
    }
}
