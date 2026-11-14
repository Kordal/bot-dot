package dev.botdot.app.data

import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The Board on the iPhone, for the botdot of [home]: its [BoardDesk] on the same shared [Store] as Home, and the live
 * feed while the screen is open, so a tile's new value comes in by itself, as on Android. [watch] hands the screen a
 * new [BoardState] after every change, on the main thread. [close] it when the screen goes.
 */
class BoardStore(home: HomeStore) {
    private val scope = MainScope()
    private val desk = BoardDesk(home.store, home.api, scope)

    init {
        scope.followFeed(home.api, home.store)
    }

    /** Calls [onChange] with the Board now and after every change, until the returned job is cancelled or [close]. */
    fun watch(onChange: (BoardState) -> Unit): Job = scope.launch { desk.state.collect { onChange(it) } }

    fun width(points: Float) = desk.width(points)
    fun filter(name: String) = desk.filter(name)

    /** The refresh button, and a pull: every tile read again. */
    @Throws(Exception::class)
    suspend fun refresh() = desk.load(all = true)

    /** A tap on a tile; what is left for the screen to do ([BoardTap]). [asked]: its question was answered yes. */
    @Throws(Exception::class)
    suspend fun tap(key: String, asked: Boolean): BoardTap = desk.tap(key, asked)

    @Throws(Exception::class)
    suspend fun setSwitch(key: String, block: String, on: Boolean) = desk.setSwitch(key, block, on)

    @Throws(Exception::class)
    suspend fun setNumber(key: String, block: String, value: Double) = desk.setNumber(key, block, value)

    @Throws(Exception::class)
    suspend fun choose(key: String, block: String, option: Int) = desk.choose(key, block, option)

    @Throws(Exception::class)
    suspend fun press(key: String, block: String) = desk.press(key, block)

    @Throws(Exception::class)
    suspend fun remove(key: String, withTiles: Boolean) = desk.remove(key, withTiles)

    @Throws(Exception::class)
    suspend fun askChange(key: String, text: String): Boolean = desk.askChange(key, text)

    @Throws(Exception::class)
    suspend fun answer(suggestion: String, add: Boolean) = desk.answer(suggestion, add)

    fun close() {
        desk.close()
        scope.cancel()
    }
}
