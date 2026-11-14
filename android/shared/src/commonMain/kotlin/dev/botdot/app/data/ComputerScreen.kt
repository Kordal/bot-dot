package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * A bot's computer screen, as the Android app's LiveScreen and the iPhone's ScreenView open it (#1371): botdot's own
 * screen page (noVNC) in a web view, which carries the app's session. Where it opens (running, its own screen off, or
 * started), the page's address, when "I'm done" shows (ADR 225) and what it sends, and the words of each state.
 */
object ComputerScreen {
    const val CHECKING = "checking"
    const val STARTING = "starting"
    const val RUNNING = "running"
    const val OFF = "off"
    const val ERROR = "error"
    const val RESETTING = "resetting"
    const val RESET = "reset"
    const val UPDATING = "updating"

    /**
     * Whether [bot] has this screen: a seat on the account's computer. A machine of its own on boat.dev shows another
     * page (Android's BoatScreen), not on the iPhone yet.
     */
    fun opens(bot: Bot): Boolean = bot.computer == "linux"

    /** The screen's title: the bot's emoji and name, as Android's. */
    fun title(bot: Bot): String = "${bot.emoji} ${bot.name}"

    /** A state the screen is in, the server's words for the computer, and why it couldn't start. */
    data class Opened(val state: String, val info: ComputerInfo? = null, val error: String? = null)

    /** The session's cookie the page and its WebSocket carry through the front door (ADR 028). */
    data class Cookie(val name: String, val value: String, val secure: Boolean) {
        /** As Android's CookieManager takes it. */
        val header: String get() = "$name=$value; Path=/; Secure; HttpOnly"
    }

    /**
     * Where the screen opens: a running computer shows its screen, or says its own screen is off (#134), started only
     * when asked, rather than a viewer that can't connect. Any other is started; [starting] is told so first, with what
     * the server said of it (null when that read failed).
     */
    @Throws(Exception::class)
    suspend fun open(api: Api, botId: String, starting: (ComputerInfo?) -> Unit = {}): Opened {
        val found = quietly { api.computer(botId) }
        if (found?.state == "running") return Opened(if (found.screenOff != null) OFF else RUNNING, found)
        starting(found)
        return start(api, botId).copy(info = found)
    }

    /** Starts its computer and its screen: running, or the error and why. */
    @Throws(Exception::class)
    suspend fun start(api: Api, botId: String): Opened = try {
        api.startComputer(botId)
        Opened(RUNNING)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Opened(ERROR, error = e.message)
    }

    /** "I'm done" (ADR 225): shown while the owner has control of a running screen, on a botdot with `screen-done`. */
    fun canHandBack(state: String, control: Boolean, features: List<String>?): Boolean =
        state == RUNNING && control && features?.contains(SCREEN_DONE) == true

    /** Hands the screen back to the bot, whose last run carries on: null once it went, or why not in the server's words. */
    @Throws(Exception::class)
    suspend fun handBack(api: Api, botId: String): String? = try {
        api.computerDone(botId)
        null
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        e.message ?: tr("Couldn't hand it back")
    }

    /** The page's address: watching only, or with [control] taps and typing go to the bot's screen. */
    fun url(api: Api, botId: String, control: Boolean): String = api.screenUrl(botId, control)

    /** The cookie for the page, or null without a session (a botdot with no front door). */
    fun cookie(api: Api): Cookie? =
        api.session?.token(api.baseUrl)?.let { Cookie(Session.COOKIE, it, api.baseUrl.startsWith("https://")) }

    /** What the button that takes or gives up control reads. */
    fun controlLabel(control: Boolean): String = if (control) tr("Stop controlling") else tr("Take control")

    /** The line under the spinner while it waits. */
    fun waitLine(state: String): String = when (state) {
        STARTING -> tr("Starting its computer…")
        RESETTING -> tr("Resetting…")
        UPDATING -> tr("Updating…")
        else -> ""
    }

    /** Why it couldn't start: the server's words, or the app's. */
    fun errorLine(error: String?): String = error ?: tr("Couldn't start its computer.")

    /** What the button that starts its own screen reads: the server's word, or the app's. */
    fun startLabel(info: ComputerInfo?): String = info?.screenOff?.start?.ifBlank { null } ?: tr("Start its screen")

    private suspend fun <T> quietly(read: suspend () -> T): T? = try {
        read()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }
}

/**
 * One bot's screen while it is open, on the iPhone: what it shows ([ScreenState]), from the same rules as Android's
 * LiveScreen ([ComputerScreen]). [features] are the botdot's, for "I'm done".
 */
class ScreenDesk(private val api: Api, val botId: String, private val scope: CoroutineScope, features: StateFlow<VersionInfo?>) {
    private data class Own(val state: String = ComputerScreen.CHECKING, val control: Boolean = false, val info: ComputerInfo? = null,
        val error: String? = null, val notice: String? = null, val noticeId: Int = 0, val closed: Boolean = false)

    private val own = MutableStateFlow(Own())

    val state: StateFlow<ScreenState> = combine(own, features) { o, v -> of(o, v?.features) }
        .stateIn(scope, SharingStarted.Eagerly, of(Own(), features.value?.features))

    private fun of(o: Own, features: List<String>?) = ScreenState(
        o.state, o.control, o.info, o.error,
        url = if (o.state == ComputerScreen.RUNNING) ComputerScreen.url(api, botId, o.control) else null,
        handBack = ComputerScreen.canHandBack(o.state, o.control, features),
        notice = o.notice, noticeId = o.noticeId, closed = o.closed,
    )

    /** Opens the screen ([ComputerScreen.open]). */
    fun open() {
        scope.launch {
            val o = ComputerScreen.open(api, botId) { found -> own.update { it.copy(state = ComputerScreen.STARTING, info = found) } }
            own.update { it.copy(state = o.state, info = o.info, error = o.error) }
        }
    }

    /** "Start its screen", when its own screen is off. */
    fun start() {
        if (own.value.state != ComputerScreen.OFF) return
        own.update { it.copy(state = ComputerScreen.STARTING) }
        scope.launch {
            val o = ComputerScreen.start(api, botId)
            own.update { it.copy(state = o.state, error = o.error) }
            // The server's words read again, as Android's: kept as they were when that read fails.
            if (o.state == ComputerScreen.RUNNING) {
                val info = try { api.computer(botId) } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
                if (info != null) own.update { it.copy(info = info) }
            }
        }
    }

    /** "Take control" or "Stop controlling", on a running screen. */
    fun control() {
        own.update { if (it.state == ComputerScreen.RUNNING) it.copy(control = !it.control) else it }
    }

    /** "I'm done": whether the screen went back to the bot. If not, the notice says why. */
    @Throws(Exception::class)
    suspend fun done(): Boolean {
        if (!state.value.handBack) return false
        val failed = ComputerScreen.handBack(api, botId)
        own.update { if (failed == null) it.copy(closed = true) else it.copy(notice = failed, noticeId = it.noticeId + 1) }
        return failed == null
    }

    /** The cookie the page carries ([ComputerScreen.cookie]). */
    fun cookie(): ComputerScreen.Cookie? = ComputerScreen.cookie(api)
}

/**
 * What a bot's screen shows now: its [state] (ComputerScreen's), whether the owner has [control], the page's [url]
 * while it runs, whether "I'm done" shows ([handBack]), a [notice] (new with each [noticeId]), and [closed] once the
 * screen went back to the bot.
 */
data class ScreenState(
    val state: String,
    val control: Boolean,
    val info: ComputerInfo?,
    val error: String?,
    val url: String?,
    val handBack: Boolean,
    val notice: String?,
    val noticeId: Int,
    val closed: Boolean,
) {
    val waiting: Boolean get() = state == ComputerScreen.CHECKING || state == ComputerScreen.STARTING
    val waitLine: String get() = ComputerScreen.waitLine(state)
    val errorLine: String get() = ComputerScreen.errorLine(error)
    /** The server's line when its own screen is off, and its start button. */
    val offLine: String get() = info?.screenOff?.text.orEmpty()
    val startLabel: String get() = ComputerScreen.startLabel(info)
    val controlLabel: String get() = ComputerScreen.controlLabel(control)
    val doneLabel: String get() = tr("I'm done")
}
