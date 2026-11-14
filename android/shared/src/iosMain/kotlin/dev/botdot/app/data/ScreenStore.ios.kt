package dev.botdot.app.data

import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * A bot's computer screen on the iPhone (#1371), for the botdot of [home]: its [ScreenDesk] with the botdot's features
 * from Home's Store, opened at once. [watch] hands the screen a new [ScreenState] after every change, on the main
 * thread. [close] it when the screen goes.
 */
class ScreenStore(home: HomeStore, botId: String) {
    private val scope = MainScope()
    private val desk = ScreenDesk(home.api, botId, scope, home.store.version.value)

    init {
        desk.open()
    }

    /** Calls [onChange] with the screen now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (ScreenState) -> Unit): Job = scope.launch { desk.state.collect { onChange(it) } }

    /** "Start its screen". */
    fun start() = desk.start()

    /** "Take control" or "Stop controlling". */
    fun control() = desk.control()

    /** "I'm done": whether the screen went back to the bot. */
    @Throws(Exception::class)
    suspend fun done(): Boolean = desk.done()

    /** The session's cookie the page carries, or null. */
    fun cookie(): ComputerScreen.Cookie? = desk.cookie()

    fun close() = scope.cancel()
}
