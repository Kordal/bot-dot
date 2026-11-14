package dev.botdot.app.data

import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * A bot's settings on the iPhone (#1370), for the botdot of [home]: its [BotSettingsDesk] on Home's Store. [watch] hands
 * the screen a new [BotSettingsState] after every change, on the main thread. [close] it when the screen goes.
 */
class BotSettingsStore(home: HomeStore, botId: String) {
    private val scope = MainScope()
    private val desk = BotSettingsDesk(home.api, botId, home.store, scope)

    /** Calls [onChange] with the settings now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (BotSettingsState) -> Unit): Job = scope.launch { desk.state.collect { onChange(it) } }

    @Throws(Exception::class)
    suspend fun load() = desk.load()

    /** What the owner changed: saved by itself a moment after the last change. */
    fun edit(draft: BotDraft) = desk.edit(draft)

    /** Delete, once the owner said yes. A refusal throws its sentence. */
    @Throws(Exception::class)
    suspend fun delete() = desk.delete()

    fun deleteText(): String = desk.deleteText()

    fun close() = scope.cancel()
}

/** The app's Settings on the iPhone (#1370): its [AppSettingsDesk] on Home's Store. */
class AppSettingsStore(home: HomeStore) {
    private val scope = MainScope()
    private val desk = AppSettingsDesk(home.api, home.store)

    fun watch(onChange: (AppSettingsState) -> Unit): Job = scope.launch { desk.state.collect { onChange(it) } }

    @Throws(Exception::class)
    suspend fun load() = desk.load()

    @Throws(Exception::class)
    suspend fun setModel(id: String) = desk.setModel(id)

    @Throws(Exception::class)
    suspend fun setEffort(id: String) = desk.setEffort(id)

    @Throws(Exception::class)
    suspend fun setAdvanced(on: Boolean) = desk.setAdvanced(on)

    @Throws(Exception::class)
    suspend fun setLanguage(to: String) = desk.setLanguage(to)

    @Throws(Exception::class)
    suspend fun setAutoUpdate(on: Boolean) = desk.setAutoUpdate(on)

    @Throws(Exception::class)
    suspend fun pickUsage(preset: Usage.Preset) = desk.pickUsage(preset)

    fun close() = scope.cancel()
}

/** Apps on the iPhone (#1370): its [AppsDesk] on Home's Store. */
class AppsStore(home: HomeStore) {
    private val scope = MainScope()
    private val desk = AppsDesk(home.api, home.store)

    fun watch(onChange: (AppsState) -> Unit): Job = scope.launch { desk.state.collect { onChange(it) } }

    @Throws(Exception::class)
    suspend fun load() = desk.load()

    @Throws(Exception::class)
    suspend fun search(query: String) = desk.search(query)

    /** The sign-in page to open in Safari; null when it connected at once, or could not. */
    @Throws(Exception::class)
    suspend fun connect(slug: String, another: Boolean): String? = desk.connect(slug, another)

    @Throws(Exception::class)
    suspend fun remove(id: String) = desk.remove(id)

    @Throws(Exception::class)
    suspend fun forget(slug: String) = desk.forget(slug)

    @Throws(Exception::class)
    suspend fun revoke(action: String) = desk.revoke(action)

    @Throws(Exception::class)
    suspend fun saveKey(key: String): Boolean = desk.saveKey(key)

    @Throws(Exception::class)
    suspend fun removeKey() = desk.removeKey()

    fun close() = scope.cancel()
}
