package dev.botdot.app

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.widget.Toast
import androidx.core.content.edit
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import dev.botdot.app.data.Api
import dev.botdot.app.data.BrowserSignIn
import dev.botdot.app.data.FigureDef
import dev.botdot.app.data.isTrue
import dev.botdot.app.data.ReadReport
import dev.botdot.app.data.Unread
import dev.botdot.app.data.Session
import dev.botdot.app.data.Settings
import dev.botdot.app.data.Store
import dev.botdot.app.feed.Feed
import dev.botdot.app.feed.Notifier
import dev.botdot.app.feed.newChats
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import dev.botdot.app.data.tr
import okio.Path.Companion.toOkioPath

/** The app's shared pieces: settings, the API for the chosen botdot, the live feed, what it has, notifications. */
class BotDotApp : Application(), SingletonImageLoader.Factory {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    /** Notifications are made here, one at a time and off the main thread ([Notifier]'s state stays on this one lane). */
    val notifying = Dispatchers.Default.limitedParallelism(1)
    lateinit var settings: Settings
    lateinit var notifier: Notifier
    val feed by lazy { Feed(scope, getSharedPreferences("feed", MODE_PRIVATE)) }

    /** Each chat's plan as the owner left it: folded or open, and the stopped plans dismissed (PlanMemory). */
    val plans by lazy {
        val prefs = getSharedPreferences("plan", MODE_PRIVATE)
        dev.botdot.app.data.PlanMemory(object : dev.botdot.app.data.PlanMemory.Keep {
            override fun read(key: String) = prefs.getString(key, null)
            override fun write(key: String, value: String) { prefs.edit { putString(key, value) } }
        })
    }

    /** The search match to show when its chat opens (set by the home screen's search). */
    var jump: dev.botdot.app.data.ChatHit? = null

    /** Words to start a new Chief chat with, taken once by the chat that opens (the Company's "Change direction"). */
    var chiefWords: String? = null

    /** True while Bitwarden unlocks. It runs here, not in a screen, so you can keep using the app meanwhile. */
    val bwUnlocking = MutableStateFlow(false)
    /** Why the last unlock didn't work, shown on the Bitwarden card until the next try. */
    val bwUnlockError = MutableStateFlow<String?>(null)

    fun unlockBitwarden(api: Api, masterPassword: String) {
        if (bwUnlocking.value) return
        bwUnlocking.value = true
        bwUnlockError.value = null
        scope.launch {
            val r = runCatching { api.unlockBitwarden(masterPassword) }
            val error = r.exceptionOrNull()?.let { e -> if (e.message.orEmpty().contains("not right")) tr("Wrong master password") else e.message ?: tr("That didn't work") }
            bwUnlockError.value = error
            bwUnlocking.value = false
            Toast.makeText(this@BotDotApp, error ?: tr("Bitwarden is unlocked"), Toast.LENGTH_SHORT).show()
        }
    }

    /** Logins being saved (their request ids). Like unlocking, it runs here so you needn't wait for it. */
    val savingLogins = MutableStateFlow(setOf<String>())

    fun saveLogin(api: Api, requestId: String, body: kotlinx.serialization.json.JsonObject, botName: String) {
        if (requestId in savingLogins.value) return
        savingLogins.value += requestId
        scope.launch {
            val r = runCatching { api.answerRequest(requestId, body) }
            val error = r.exceptionOrNull()?.let { e ->
                when {
                    e is dev.botdot.app.data.ApiException && e.status == 423 -> tr("Bitwarden is locked: enter your master password too.")
                    e.message.orEmpty().contains("not right") -> tr("Wrong master password, login not saved")
                    else -> tr("Login not saved: {why}", "why" to (e.message ?: tr("that didn't work")))
                }
            }
            store.needs.refresh()
            savingLogins.value -= requestId
            Toast.makeText(this@BotDotApp, error ?: tr("Saved. {botName} will continue.", "botName" to botName), Toast.LENGTH_SHORT).show()
        }
    }

    /** The front door's session, kept on the phone (ADR 028): every request to botdot carries it. */
    val session by lazy { Session.onPhone(this) }

    /** Signed in again: the feed connects at once, and its hello brings everything back. */
    fun signedIn() = feed.retryNow()

    /** The sign-in in the browser (docs/api.md, "The front door"): its secret is kept privately until the browser is back. */
    val browserSignIn by lazy {
        val prefs = getSharedPreferences("sign-in", MODE_PRIVATE)
        BrowserSignIn(object : BrowserSignIn.Keep {
            override fun read() = prefs.getString("handoff", null)
            // Written at once: the browser may come back to an app Android ended meanwhile.
            override fun write(value: String?) { prefs.edit(commit = true) { if (value == null) remove("handoff") else putString("handoff", value) } }
        }, api = { api.value })
    }

    /** The browser came back to the app with [uri]: once botdot's address is read, its code becomes the session. */
    fun backFromBrowser(uri: String?) {
        scope.launch {
            withTimeoutOrNull(5_000) { api.first { it != null } }
            browserSignIn.back(uri)
        }
    }

    private val _api = MutableStateFlow<Api?>(null)
    /** null until a botdot address is set. */
    val api: StateFlow<Api?> = _api

    /** The bots, the Chief's chats, what waits for you, the Board: kept once, for every screen. */
    val store by lazy { Store(scope, api) }

    /** True while the activity is resumed: the app is in front, and what it shows is being looked at. */
    val resumed = MutableStateFlow(false)

    /** Shared rooms (ADR 060): on or not for this account, its rooms and invitations, followed while the app is in front. */
    val rooms by lazy { dev.botdot.app.data.RoomsHub(scope, api, store.version.value, resumed) }

    /**
     * Tells the botdot server which chat is on screen while the app is in front, so it counts as read everywhere
     * (ADR 005). Only to a server that keeps read positions (`unread` in its features). It follows the activity's
     * resumed state, not the chat screen's presence: with the screen off nobody reads.
     */
    val reading by lazy {
        val id = Unread.appId()
        ReadReport(
            scope,
            on = store.version.value.map { it != null && "unread" in it.features }.stateIn(scope, SharingStarted.Eagerly, false),
            front = resumed,
            post = { chat -> api.value?.read(id, chat) },
            onRead = { store.read(it) },
        )
    }

    /** The figure definition bots are drawn from: the copy the app was built with, then the server's when it has one. */
    val figure = MutableStateFlow<FigureDef?>(null)

    /**
     * The server's figure definition replaces the bundled one when the server says it has one (`figure` in its
     * features) and it is of a version this app knows. An older server, no connection or a definition this app can't
     * use: the bundled copy stays.
     */
    private suspend fun followFigure(bundled: FigureDef?) {
        // Asked again when the server's version or revision changes (an update may bring a new definition) and for
        // another server.
        store.version.value.map { it?.figureKey }.distinctUntilChanged().collectLatest { key ->
            val server = api.value
            if (key == null || server == null) { figure.value = bundled; return@collectLatest }
            while (true) {
                val text = runCatching { server.figure() }.getOrElse { e -> if (e is CancellationException) throw e; null }
                if (text != null) {
                    // One this app can't draw from (a newer format): the bundled copy, not an earlier server's.
                    figure.value = withContext(Dispatchers.Default) { runCatching { FigureDef.parse(text) }.getOrNull() } ?: bundled
                    return@collectLatest
                }
                delay(30_000) // it didn't arrive: ask again until it does
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        settings = Settings(this)
        val words = getSharedPreferences("i18n", MODE_PRIVATE) // the interface's language and its dictionary (#645)
        dev.botdot.app.data.I18n.start(object : dev.botdot.app.data.I18n.Keep {
            override fun read() = words.getString("kept", null)
            override fun write(value: String) { words.edit { putString("kept", value) } }
        })
        notifier = Notifier(
            this,
            figure = { figure.value },
            outfitOf = { id -> store.bots.value.value?.firstOrNull { it.id == id }?.outfit },
            newChats = { api.value?.let { a -> try { newChats(a) } catch (e: CancellationException) { throw e } catch (e: Exception) { null } } },
            groupNameOf = { id -> store.groups.value.value?.firstOrNull { it.id == id }?.name },
            chiefName = { store.chiefName.value },
        ).also { it.createChannels() }
        scope.launch {
            settings.server.collect { url ->
                if (url == _api.value?.baseUrl && url != null) return@collect // the same botdot: keep it as it is
                val a = url?.let { Api(it, session) }
                _api.value = a
                notifier.serverUrl = url
                feed.connect(a)
            }
        }
        scope.launch { feed.events.collect { store.handle(it) } }
        // The account's language, asked again each time the feed connects and when another app changes it (#645).
        scope.launch {
            feed.events.collect { ev ->
                if (ev.type != "hello" && dev.botdot.app.data.I18n.event(ev) == null) return@collect
                val a = api.value ?: return@collect
                dev.botdot.app.data.I18n.sync(a, runCatching { a.version().features }.getOrNull())
            }
        }
        val bundled = runCatching { FigureDef.parse(assets.open("figure.json").bufferedReader().use { it.readText() }) }.getOrNull()
        figure.value = bundled
        scope.launch { followFigure(bundled) }
        scope.launch(notifying) {
            feed.events.collect { ev ->
                // "hello" brings back what waits for you, each with its bot's head: the bots' hats are wanted for that.
                if (ev.type == "hello" && store.bots.value.value == null) withTimeoutOrNull(3_000) { store.bots.value.first { it != null } }
                // A question asked in a group is titled with the group's name: the groups are wanted for that.
                if (ev.type == "group_run_finished" && isTrue(ev.data["notify"]) && store.groups.value.value == null) withTimeoutOrNull(3_000) { store.groups.value.first { it != null } }
                notifier.handle(ev)
                if (ev.type == "hello") launch { notifier.catchUp() } // beside the events: they don't wait for botdot's answers
            }
        }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { notifier.appInForeground = true; feed.retryNow() }
            override fun onStop(owner: LifecycleOwner) { notifier.appInForeground = false }
        })
        scope.launch(Dispatchers.IO) { trimCache() }
        // Back online (Wi-Fi, mobile, Tailscale reconnecting): reconnect right away.
        getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = feed.retryNow()
        })
    }

    /** Files a bot sent, opened here, are kept a while (to open again at once), then go. Pictures have their own
     *  cache with a size limit (below); the folder screenshots were once kept in isn't used any more. */
    private fun trimCache() {
        val old = System.currentTimeMillis() - 14L * 24 * 3600_000
        cacheDir.resolve("botfiles").walkBottomUp().forEach { f -> if (f.isFile && f.lastModified() < old) f.delete() }
        cacheDir.resolve("runshots").deleteRecursively()
    }

    /** Pictures (a bot's, a tile's, a run's screenshots): decoded at the size shown, kept in memory and on disk. */
    override fun newImageLoader(context: PlatformContext): ImageLoader = ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { Api.CLIENT.newBuilder().addInterceptor(session.interceptor).build() })) }
        .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.2).build() }
        .diskCache { DiskCache.Builder().directory(cacheDir.resolve("images").toOkioPath()).maxSizeBytes(150L * 1024 * 1024).build() }
        .crossfade(true)
        .build()

    companion object {
        fun of(context: Context) = context.applicationContext as BotDotApp
    }
}
