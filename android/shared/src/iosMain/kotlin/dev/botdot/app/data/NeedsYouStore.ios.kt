package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Needs you on the iPhone, for the botdot of [home]: its [NeedsDesk] on the same shared [Store] as Home, and the live
 * feed while the screen is open, so that a card answered elsewhere, or withdrawn by its bot, goes from the list as it
 * does on Android. [watch] hands the screen a new [NeedsState] after every change, on the main thread. [close] it when
 * the screen goes.
 */
class NeedsYouStore(home: HomeStore) {
    private val scope = MainScope()
    private val store = home.store
    private val api = home.api
    private val desk = NeedsDesk(store, api, scope) { shortClock(it) }

    init {
        // The live feed: each event refreshes what it changed. A dropped connection tries again after a moment.
        scope.launch {
            var last: String? = null
            while (true) {
                try {
                    api.feed(last).collect { ev -> ev.id?.let { last = it }; store.handle(ev) }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                }
                delay(RETRY_MS)
            }
        }
    }

    /** Calls [onChange] with Needs you now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (NeedsState) -> Unit): Job = scope.launch { desk.state.collect { onChange(it) } }

    /** Pull to refresh. */
    @Throws(Exception::class)
    suspend fun refresh() = desk.load()

    /** A tap on a card's button ([NeedsDesk.press]): the address to open in the browser, for a Connect with a sign-in page. */
    @Throws(Exception::class)
    suspend fun press(key: String, button: String): String? = desk.press(key, button)

    /** "Approve N" above the cards. */
    @Throws(Exception::class)
    suspend fun approveAll() = desk.approveAll()

    /** The type picked on a login's card. */
    fun choose(key: String, type: String) = desk.choose(key, type)

    /** A login's new fields, saved in the Vault. */
    @Throws(Exception::class)
    suspend fun saveLogin(key: String, type: String, username: String, secret: String, master: String) = desk.saveLogin(key, type, username, secret, master)

    /** Bitwarden's master password. */
    @Throws(Exception::class)
    suspend fun unlock(master: String) = desk.unlock(master)

    /** The answers typed on a question's card. */
    @Throws(Exception::class)
    suspend fun answer(key: String, answers: List<String>) = desk.answer(key, answers)

    /** Back in the app, after a sign-in page in the browser. */
    @Throws(Exception::class)
    suspend fun back() = desk.back()

    fun close() {
        desk.close()
        scope.cancel()
    }

    private companion object {
        const val RETRY_MS = 3_000L
    }
}
