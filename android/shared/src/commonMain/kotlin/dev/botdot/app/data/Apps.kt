package dev.botdot.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Apps (Connectors): the owner's apps through Composio, drawn by Android's ConnectorsScreen and the iPhone's AppsView.
 * Every bot has every connected app unless the owner took it away (ADR 231); connecting one opens its sign-in in the
 * phone's browser.
 */
object Apps {
    /** Where the owner makes a Composio API key: botdot makes no Composio account of its own. */
    const val COMPOSIO_KEYS = "https://platform.composio.dev"

    /** No key yet, or Composio refuses it (#409): what the key's section is titled; null while the key works. */
    fun keyTitle(i: ConnectorsInfo): String? = when {
        !i.configured -> tr("Add your Composio key")
        !i.keyRejected -> null
        i.account == "own" -> tr("Composio no longer accepts your key {key}", "key" to i.keyHint.orEmpty()).trim()
        else -> tr("Composio no longer accepts botdot's Composio account")
    }

    /** The key's line at the top: the machine's key (ADR 206), or the account's own. */
    fun keyLine(i: ConnectorsInfo): String = if (i.machine) tr("Set up for everyone on this botdot") else tr("Composio key {key}", "key" to i.keyHint.orEmpty()).trim()

    /** Whether the key is replaced or removed here: the account's own, or the machine's with Advanced on. */
    fun keyChanges(i: ConnectorsInfo, advanced: Boolean): Boolean = !i.machine || advanced

    /** Under an app's name: its state and which bots use it, "used by all bots" when every one of [bots] does. */
    fun line(c: Connection, bots: List<Bot>): String {
        val n = c.usedBy.size
        val allBots = bots.size > 1 && bots.all { it.id in c.usedBy }
        return "${c.status.lowercase().replaceFirstChar { it.uppercase() }} · " +
            if (n == 0) tr("no bot uses it yet") else if (allBots) tr("used by all bots") else trn(n, "used by {n} bot", "used by {n} bots")
    }

    /** The line is a warning: the app is not working. */
    fun warns(c: Connection): Boolean = c.status != "ACTIVE"

    /** "Add account" (ADR 174): on the app's newest working account only. */
    fun addsAccount(c: Connection, all: List<Connection>): Boolean =
        c.status == "ACTIVE" && all.none { x -> x.toolkit == c.toolkit && x.status == "ACTIVE" && (x.createdAt ?: "") > (c.createdAt ?: "") }

    /** How many apps a search shows. */
    const val FOUND = 30
}

/** Apps at one moment, as the iPhone draws them. [info]: null until botdot answered. */
class AppsState(
    val info: ConnectorsInfo? = null,
    val bots: List<Bot> = emptyList(),
    /** What every bot may do without asking ("Always allow" for all bots on a card, ADR 201). */
    val everyBot: List<AlwaysAllowed> = emptyList(),
    val found: List<CatalogApp> = emptyList(),
    val advanced: Boolean = true,
    /** What happened last, said for a moment; [noticeId] tells one from the next. */
    val notice: String? = null,
    val noticeId: Int = 0,
) {
    val keyTitle: String? get() = info?.let(Apps::keyTitle)
    val keyLine: String? get() = info?.let(Apps::keyLine)
    val keyChanges: Boolean get() = info?.let { Apps.keyChanges(it, advanced) } == true
    fun line(c: Connection): String = Apps.line(c, bots)
    fun addsAccount(c: Connection): Boolean = Apps.addsAccount(c, info?.connections.orEmpty())

    internal fun copy(
        info: ConnectorsInfo? = this.info, bots: List<Bot> = this.bots, everyBot: List<AlwaysAllowed> = this.everyBot,
        found: List<CatalogApp> = this.found, advanced: Boolean = this.advanced,
    ) = AppsState(info, bots, everyBot, found, advanced, notice, noticeId)

    internal fun say(text: String) = AppsState(info, bots, everyBot, found, advanced, text, noticeId + 1)
}

/**
 * Apps on the iPhone (#1370), with Android's rules: botdot's connections, a search of Composio's apps, Connect (the
 * app's sign-in page to open in the browser, or connected at once), Remove, Revoke and the Composio key.
 */
class AppsDesk(private val api: Api, private val store: Store) {
    private val _state = MutableStateFlow(AppsState())
    val state: StateFlow<AppsState> = _state.asStateFlow()

    private fun say(text: String) { _state.value = _state.value.say(text) }

    /** botdot's connections, and the grants for every bot from a server that keeps them. */
    suspend fun load() {
        try {
            val info = api.connectors()
            val bots = store.bots.value.value ?: runCatching { api.bots() }.getOrDefault(emptyList())
            _state.value = _state.value.copy(info = info, bots = bots, advanced = Advanced.on.value)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(e.message ?: tr("Couldn't load"))
        }
        val features = store.version.value.value?.features ?: runCatching { api.version() }.getOrNull()?.features
        if ("every-bot-always" in features.orEmpty()) runCatching { api.everyBotGrants() }.onSuccess { _state.value = _state.value.copy(everyBot = it) }
    }

    private suspend fun attempt(otherwise: String, done: String? = null, then: Boolean = true, call: suspend () -> Unit): Boolean {
        val ok = try {
            call()
            done?.let(::say)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(e.message ?: otherwise)
            false
        }
        if (then) load()
        return ok
    }

    /** Composio's apps for [query]. */
    suspend fun search(query: String) {
        attempt(tr("Couldn't search"), then = false) { _state.value = _state.value.copy(found = api.catalog(query).items.take(Apps.FOUND)) }
    }

    /** Connect (or "Add account"): the sign-in page to open in the browser; null when it connected at once, or failed. */
    suspend fun connect(slug: String, another: Boolean = false): String? {
        var page: String? = null
        attempt(tr("Couldn't connect"), then = false) {
            val link = api.connectApp(slug, another)
            if (link.noAuth) { say(tr("Connected")); load() } else page = link.redirectUrl
        }
        return page
    }

    /** Remove, once the owner said yes: bots lose it. */
    suspend fun remove(id: String) {
        attempt(tr("Couldn't remove")) { say(api.disconnect(id) ?: tr("Removed")) }
    }

    /** An app of an earlier Composio account, no longer offered. */
    suspend fun forget(slug: String) {
        attempt(tr("Couldn't remove")) { api.forgetReconnect(slug) }
    }

    /** Takes back what every bot was allowed. */
    suspend fun revoke(action: String) {
        attempt(tr("Couldn't revoke"), tr("Revoked"), then = false) { _state.value = _state.value.copy(everyBot = api.revokeEveryBotGrant(action)) }
    }

    /** The owner's Composio key, checked by botdot with Composio: whether it was taken. */
    suspend fun saveKey(key: String): Boolean = attempt(tr("Couldn't save"), tr("Saved")) {
        api.setComposioKey(key.trim())
        _state.value = _state.value.copy(found = emptyList())
    }

    /** Removes the Composio key, once the owner said yes. */
    suspend fun removeKey() {
        attempt(tr("Couldn't remove"), tr("Removed")) {
            api.removeComposioKey()
            _state.value = _state.value.copy(found = emptyList())
        }
    }
}
