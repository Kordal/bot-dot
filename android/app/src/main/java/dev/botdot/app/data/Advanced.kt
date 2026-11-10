package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Advanced (ADR 200): one switch of the account that shows the technical rows (the models, a bot's commands, helpers,
 * exact tools and permission mode, a job's cron and script, a run's folder, tokens). A server without `advanced` in
 * its features shows them all, as before; until the settings are read nothing is taken away.
 */
object Advanced {
    const val FEATURE = "advanced"

    private val _on = MutableStateFlow(true)
    /** Whether the technical rows show now. */
    val on: StateFlow<Boolean> = _on.asStateFlow()

    /** Whether they show for these features and settings. */
    fun shows(features: Collection<String>?, settings: AppSettings?): Boolean =
        features?.contains(FEATURE) != true || settings?.advanced != false

    /** Takes what the server said (each read or save of the settings). */
    fun take(features: Collection<String>?, settings: AppSettings?) { _on.value = shows(features, settings) }

    /** Reads the account's settings once (as the language is, each time the feed connects). */
    suspend fun sync(api: Api, features: Collection<String>?) {
        if (features?.contains(FEATURE) != true) return take(features, null)
        runCatching { api.settings() }.onSuccess { take(features, it.settings) }
    }
}
