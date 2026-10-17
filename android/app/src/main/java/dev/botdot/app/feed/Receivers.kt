package dev.botdot.app.feed

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.core.app.RemoteInput
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Api
import dev.botdot.app.ui.PLAN_APPROVAL
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** A notification's buttons: Reply in a chat, and Decline / Approve on what waits for your OK (see [Notifier]). */
class NotificationActions : BroadcastReceiver() {
    companion object {
        const val REPLY = "dev.botdot.app.REPLY"
        const val ANSWER = "dev.botdot.app.ANSWER"
        const val EXTRA_KEY = "key" // the notification's tag: "chief:<chatId>", "job:<botId>/<jobId>", …
        const val EXTRA_YES = "yes"
        const val KEY_TEXT = "text"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val app = BotDotApp.of(context)
        val key = intent.getStringExtra(EXTRA_KEY) ?: return
        val done = goAsync()
        app.scope.launch {
            try {
                // Android may have started the app just for this: wait a moment for botdot's address.
                val api = withTimeoutOrNull(5_000) { app.api.filterNotNull().first() }
                when (intent.action) {
                    REPLY -> reply(context, app, api, key, RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY_TEXT)?.toString()?.trim().orEmpty())
                    ANSWER -> answer(context, app, api, key, intent.getBooleanExtra(EXTRA_YES, false))
                }
            } finally {
                done.finish()
            }
        }
    }

    private suspend fun reply(context: Context, app: BotDotApp, api: Api?, chat: String, text: String) {
        if (text.isEmpty()) { withContext(app.notifying) { app.notifier.replied(chat, null) }; return }
        // To a busy bot or a replying Chief the answer is the message that waits its turn (`message-waits`): it went,
        // as one that started a run did.
        val sent = runCatching {
            val a = api ?: error("Not connected to botdot")
            when {
                chat.startsWith("chief:") -> { a.sendToChief(chat.removePrefix("chief:"), text, emptyList()) }
                chat.startsWith("bot:") -> { a.runBot(chat.removePrefix("bot:"), text, emptyList()) }
                // An answer to a group's question is a message to the group: the member that asked has the first turn.
                chat.startsWith("group:") -> { a.sendToGroup(chat.removePrefix("group:"), text, emptyList()) }
            }
        }
        withContext(app.notifying) { app.notifier.replied(chat, text.takeIf { sent.isSuccess }) }
        sent.exceptionOrNull()?.let { Toast.makeText(context, "Couldn't send: ${it.message}", Toast.LENGTH_LONG).show() }
    }

    private suspend fun answer(context: Context, app: BotDotApp, api: Api?, key: String, yes: Boolean) {
        val id = key.substringAfter(':')
        runCatching {
            val a = api ?: error("Not connected to botdot")
            when (key.substringBefore(':')) {
                "job" -> a.approveJob(id.substringBefore('/'), id.substringAfter('/'), yes)
                "ask" -> a.answerAsk(id, yes)
                "tile" -> a.approveTile(id, yes)
                "memory" -> a.settleMemoryChange(id, yes)
                "plan" -> if (yes) a.sendToChief(id, PLAN_APPROVAL, emptyList()) else a.dismissSuggestion(id)
            }
        }.onSuccess { withContext(app.notifying) { app.notifier.take(key) } }
            .onFailure { Toast.makeText(context, "That didn't work: ${it.message}", Toast.LENGTH_LONG).show() }
    }
}

/** Decline / Approve from a notification before Android 12: asks for the phone's unlock, then answers.
 *  Cancelled: nothing is sent. (From Android 12 the buttons ask for the unlock themselves.) */
class UnlockToAnswer : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT < 27) window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (keyguard == null || !keyguard.isKeyguardLocked) return answer()
        keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() = answer()
            override fun onDismissCancelled() = finish()
            override fun onDismissError() = finish()
        })
    }

    private fun answer() {
        sendBroadcast(Intent(this, NotificationActions::class.java).setAction(NotificationActions.ANSWER)
            .putExtra(NotificationActions.EXTRA_KEY, intent.getStringExtra(NotificationActions.EXTRA_KEY))
            .putExtra(NotificationActions.EXTRA_YES, intent.getBooleanExtra(NotificationActions.EXTRA_YES, false)))
        finish()
    }
}

/** After the phone restarts, or the app was updated: open the connection to botdot again, so notifications keep coming. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val app = BotDotApp.of(context)
        val done = goAsync()
        app.scope.launch {
            try {
                withContext(app.notifying) { app.notifier.afterRestart() }
                if (app.settings.serverNow() != null) runCatching { FeedService.start(context) }
            } finally {
                done.finish()
            }
        }
    }
}
