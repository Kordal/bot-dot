package dev.botdot.app.data

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import okio.BufferedSink
import okio.source
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * An error botdot explained in words ({ "error": "…" }), or a connection problem. [status]: the answer's, 0 without
 * one. [said]: the message is botdot's own sentence. [sent]: without an answer, whether the request had gone out
 * when the connection failed, so botdot may have taken it.
 */
class ApiException(message: String, val status: Int = 0, val said: Boolean = false, val sent: Boolean = false) : IOException(message)

/** Set once a request is written to a connection: before that, botdot never saw it. */
private class Went { @Volatile var out = false }

/**
 * botdot's API (docs/api.md). baseUrl is e.g. https://my-vm.my-tailnet.ts.net. [session]: the front door's session
 * (ADR 028), which every request carries; none for a check of an address before it is used.
 */
class Api(val baseUrl: String, val session: Session? = null) {
    init { require(ReleaseManifest.secureURL(baseUrl)) { "Use HTTPS for a remote botdot server." } }
    val json = JSON

    // One connection pool for the whole app (and pictures, see BotDotApp): a new Api doesn't mean new connections.
    private val client = session?.let { CLIENT.newBuilder().addInterceptor(it.interceptor).build() } ?: CLIENT

    // Live streams stay open: no read timeout (botdot pings every 15–20 s).
    private val streamClient = client.newBuilder().readTimeout(0, TimeUnit.SECONDS).build()

    /** The full address of an API path ("/files/…"), e.g. for a picture. */
    fun url(path: String) = baseUrl.trimEnd('/') + "/api" + path
    private val JSON_TYPE = "application/json".toMediaType()

    private fun request(path: String) = Request.Builder().url(url(path)).header("Accept", "application/json")

    private suspend fun call(req: Request): String = withContext(Dispatchers.IO) {
        val went = Went()
        try {
            client.newCall(req.newBuilder().tag(Went::class.java, went).build()).execute().use { res ->
                try {
                    readOrThrow(res)
                } catch (e: ApiException) {
                    throw e
                } catch (e: IOException) {
                    // The answer began and broke off: its status still says whether botdot took the request.
                    throw ApiException("Can't reach botdot. Is Tailscale on? (${e.message ?: e.javaClass.simpleName})", res.code, sent = true)
                }
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            throw ApiException("Can't reach botdot. Is Tailscale on? (${e.message ?: e.javaClass.simpleName})", sent = went.out)
        }
    }

    private fun readOrThrow(res: Response): String {
        val body = res.body.string()
        if (!res.isSuccessful) {
            val msg = runCatching { json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.takeIf { it.isString }?.content }.getOrNull()?.trim()?.ifEmpty { null }
            throw ApiException(msg ?: if (res.code == 403) "botdot refused this device: ${body.take(200)}" else "botdot answered ${res.code}", res.code, said = msg != null)
        }
        return body
    }

    private suspend fun get(path: String) = call(request(path).get().build())
    private suspend fun send(method: String, path: String, body: JsonObject = JsonObject(emptyMap())) =
        call(request(path).header("X-Bot-Dot", "1").method(method, body.toString().toRequestBody(JSON_TYPE)).build())

    // ---------- the front door: signing in ----------

    /** One of the front door's own routes (not under /api), written to as its page writes to it. */
    private suspend fun door(path: String, body: JsonObject = JsonObject(emptyMap())) =
        call(Request.Builder().url(baseUrl.trimEnd('/') + path).header("Accept", "application/json").header("X-Bot-Dot", "1")
            .post(body.toString().toRequestBody(JSON_TYPE)).build())

    /**
     * Ends a sign-in in the browser ([BrowserSignIn]): the code the front door's page handed back and the secret whose
     * SHA-256 that page carried. The session arrives as its cookie and is kept ([Session]). Returns the account's name;
     * a code the front door did not take (spent, too old, or for another secret) throws its sentence.
     */
    suspend fun finishSignIn(code: String, verifier: String): String {
        val answer = door("/sign-in/handoff", buildJsonObject { put("code", code); put("verifier", verifier) })
        return json.parseToJsonElement(answer).jsonObject.str("account")
    }

    /** "Sign out everywhere": the front door ends every session of the account, in every app, this one too. */
    suspend fun signOutEverywhere() { door("/sign-out-everywhere") }

    // ---------- version, bots, runs ----------

    suspend fun version(): VersionInfo = json.decodeFromString(get("/version"))
    suspend fun bots(): List<Bot> = json.decodeFromString(get("/bots"))
    suspend fun bot(id: String): Bot = json.decodeFromString(get("/bots/${enc(id)}"))
    /** Says which chat this app shows now, in front ("bot:<id>", "chief:<chatId>"), or null for none: botdot takes it as read. */
    suspend fun read(app: String, chat: String?): ReadAnswer = json.decodeFromString(send("POST", "/read", buildJsonObject { put("app", app); put("chat", chat) }))
    /** The figure definition every bot is drawn from, as the server sent it (FigureDef.parse reads it). */
    suspend fun figure(): String = get("/figure")
    /** Its newest runs; before: the page older than that run (an older botdot ignores it and sends the newest). */
    suspend fun runs(botId: String, limit: Int = 40, before: String? = null): List<Run> =
        json.decodeFromString(get("/runs?botId=${enc(botId)}&limit=$limit${before?.let { "&before=${enc(it)}" } ?: ""}"))
    /** Notes other bots left for this bot, waiting for its next run. */
    suspend fun inbox(botId: String): List<InboxNote> = json.decodeFromString(get("/bots/${enc(botId)}/inbox"))
    /**
     * What waits for the owner's yes, a switch of a saved login a bot asks for (`vault-switch=1`) and what the Chief
     * asked to do after it read the web (`chief-action=1`) too: this app draws both cards.
     */
    suspend fun asks(): List<Ask> = Ask.list(get("/asks?vault-switch=1&chief-action=1"))
    /** The owner's answer to an ask. What the server says of it ([Answered]): what a yes started (`carriesOn`, docs/api.md "What follows a yes"), and its own words for the answered card. */
    suspend fun answerAsk(id: String, yes: Boolean, always: Boolean = false): Answered =
        Answered.of(send("POST", "/asks/${enc(id)}", buildJsonObject { put("yes", yes); put("always", always) }))
    /** Every bot's latest runs, newest first. */
    suspend fun search(q: String): List<ChatHit> = json.decodeFromString(get("/search?q=${enc(q)}"))
    suspend fun recentRuns(limit: Int = 200): List<Run> = json.decodeFromString(get("/runs?limit=$limit"))

    /**
     * [key]: the message's key (docs/api.md, "A message sent twice"): botdot takes a key once, so the message can be
     * sent again after a send that got no answer. An older botdot ignores it. The answer to a key botdot had already
     * is the run the first send started.
     * The answer is a run, or, from a busy bot with `message-waits`, the message that waits its turn: the same
     * fields with `status: "queued"` ([Run.isQueued]). Both are a message that went.
     */
    suspend fun runBot(botId: String, prompt: String, attachments: List<Attachment>, key: String? = null): Run = json.decodeFromString(
        send("POST", "/bots/${enc(botId)}/run", buildJsonObject {
            if (prompt.isNotBlank()) put("prompt", prompt)
            put("attachments", json.encodeToJsonElement(attachments))
            if (key != null) put("key", key)
        }),
    )

    suspend fun run(runId: String): Run = json.decodeFromString(get("/runs/${enc(runId)}"))

    suspend fun stopRun(runId: String) { send("POST", "/runs/${enc(runId)}/stop") }

    /** "Take back" on a message that waits for a bot: it is gone from the server, and its text and files come back. 409 once it has started. */
    suspend fun takeBack(botId: String, queuedId: String): TakenBack = TakenBack.of(send("DELETE", "/bots/${enc(botId)}/queued/${enc(queuedId)}"))

    /** A run as it happens: steps, text, and its end. Replays what already happened first. */
    fun runStream(runId: String): Flow<RunEvent> = sse("/runs/${enc(runId)}/stream?simple") { _, data ->
        val o = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: return@sse null
        RunEvent.of(o)
    }

    // ---------- groups ----------

    /** Every group, with what its chat holds now. Only of a server that has groups ([hasGroups]). */
    suspend fun groups(): List<Group> = Group.list(get("/group-chats"))
    /** One group: asked when its chat comes on screen, for where its new replies begin. */
    suspend fun group(id: String): Group = json.decodeFromString(get("/group-chats/${enc(id)}"))
    /** A new group of these bots, in their order. A refusal is the server's sentence for the owner. */
    suspend fun makeGroup(name: String, members: List<String>): Group = json.decodeFromString(
        send("POST", "/group-chats", buildJsonObject { put("name", name); put("members", strings(members)) }))
    /** A change to a group: any of `name`, `members` (the whole list as it is to be), `category`, `order`, `pinned`. */
    suspend fun updateGroup(id: String, changes: JsonObject): Group = json.decodeFromString(send("PUT", "/group-chats/${enc(id)}", changes))
    fun membersOf(ids: List<String>): JsonObject = buildJsonObject { put("members", strings(ids)) }
    /** Deletes the group and its chat. No bot and no run is deleted. */
    suspend fun deleteGroup(id: String) { send("DELETE", "/group-chats/${enc(id)}") }
    /** The newest [limit] items of a group's chat, or the page [before] the item with that id. */
    suspend fun groupChat(id: String, limit: Int, before: String? = null): GroupChatPage =
        GroupChatPage.of(get("/group-chats/${enc(id)}/chat?limit=$limit${before?.let { "&before=${enc(it)}" } ?: ""}"))
    /** The owner writes in a group: one message, and the server gives the turns. [key]: as [runBot]'s. */
    suspend fun sendToGroup(id: String, text: String, attachments: List<Attachment>, key: String? = null): GroupSent = GroupSent.of(
        send("POST", "/group-chats/${enc(id)}/messages", buildJsonObject {
            put("text", text)
            put("attachments", json.encodeToJsonElement(attachments))
            if (key != null) put("key", key)
        }))
    /** "Take back" on a message none of whose turns has started, as [takeBack]. 409 once one has. */
    suspend fun takeBackFromGroup(id: String, messageId: String): TakenBack = TakenBack.of(send("DELETE", "/group-chats/${enc(id)}/messages/${enc(messageId)}"))
    /** "Stop all": every run of the group at work ends, and the turns behind them never start. */
    suspend fun stopGroup(id: String) { send("POST", "/group-chats/${enc(id)}/stop") }
    /** "Go on": every line of the group that stopped at the limit goes on. 409 when none is stopped. */
    suspend fun goOn(id: String): GroupSent = GroupSent.of(send("POST", "/group-chats/${enc(id)}/go-on"))

    // ---------- scheduled jobs ----------

    suspend fun setJobEnabled(botId: String, jobId: String, on: Boolean): Job = json.decodeFromString(
        send("PUT", "/bots/${enc(botId)}/jobs/${enc(jobId)}", buildJsonObject { put("enabled", on) }))
    /** "Run now": whether it started, waits for the bot, or was skipped and why ([RunNow]). */
    suspend fun runJob(botId: String, jobId: String): RunNow = RunNow.of(send("POST", "/bots/${enc(botId)}/jobs/${enc(jobId)}/run"))
    /** always: approve it and trust its later changes too (until you take that back). What the server says of the answer, as [answerAsk]. */
    suspend fun approveJob(botId: String, jobId: String, approve: Boolean, always: Boolean = false): Answered =
        Answered.of(send("POST", "/bots/${enc(botId)}/jobs/${enc(jobId)}/approve", buildJsonObject { put("approve", approve); put("always", always) }))
    suspend fun setJobAlwaysApprove(botId: String, jobId: String, on: Boolean): Job = json.decodeFromString(
        send("PUT", "/bots/${enc(botId)}/jobs/${enc(jobId)}", buildJsonObject { put("alwaysApprove", on) }))

    // ---------- the Board ----------

    /** quiet reads cached tiles; an owner POST refreshes stale values and pictures. */
    suspend fun dashboard(quiet: Boolean = false): Dashboard = json.decodeFromString(if (quiet) get("/dashboard?quiet") else send("POST", "/dashboard/refresh", buildJsonObject {}))
    /** on: what a switch should become. */
    suspend fun tapTile(id: String, on: Boolean? = null): TileTap = TileTap.of(
        send("POST", "/dashboard/tiles/${enc(id)}/tap", buildJsonObject { if (on != null) put("on", on) }))
    /** One of a tile's controls (a switch, button, slider, colour or choice; block: its key) was used. */
    suspend fun actTile(id: String, block: String, value: kotlinx.serialization.json.JsonElement?): TileTap = TileTap.of(
        send("POST", "/dashboard/tiles/${enc(id)}/act", buildJsonObject { put("block", block); if (value != null) put("value", value) }))
    /** withTiles: a group goes with the tiles in it (otherwise they stay, loose). */
    suspend fun removeTile(id: String, withTiles: Boolean = false) { send("DELETE", "/dashboard/tiles/${enc(id)}${if (withTiles) "?all" else ""}") }
    /** Dragged: under this heading, or into this group (parent), before this tile (null: at the end there). */
    suspend fun moveTile(id: String, section: String?, parent: String?, before: String?) {
        send("POST", "/dashboard/tiles/${enc(id)}/move", buildJsonObject { if (section != null) put("section", section); put("parent", parent); put("before", before) })
    }
    /** A bot's suggestion: Add (true) or ✕ (false; that bot won't suggest it again). */
    suspend fun answerSuggestion(id: String, add: Boolean): Answered =
        Answered.of(send("POST", "/dashboard/suggestions/${enc(id)}", buildJsonObject { put("add", add) }))
    /** What the server says of the answer, as [answerAsk]. */
    suspend fun approveTile(id: String, approve: Boolean): Answered =
        Answered.of(send("POST", "/dashboard/tiles/${enc(id)}/approve", buildJsonObject { put("approve", approve) }))

    // ---------- things that need you ----------

    suspend fun loginRequests(): List<LoginRequest> = json.decodeFromString(get("/vault/requests"))

    /** Answer a login request: { action: save | allow | approve | decline, … } (see docs/api.md). */
    suspend fun answerRequest(id: String, body: JsonObject) { send("POST", "/vault/requests/${enc(id)}", body) }

    // ---------- the vault (Settings → Vault) ----------

    suspend fun vault(): List<VaultItem> = json.decodeFromString(get("/vault"))

    /**
     * Adds a login-kind item (id null) or changes one. An empty password keeps the saved one. [type] and
     * [username] are sent when given (VaultTypes.sent): without a type a new item is a login and a saved one
     * keeps its type; without a username a saved item keeps its own. [inComputer] ("Usable in its computer") is sent
     * when given: only to a server with `vault-in-computer` (VaultTypes.showsInComputer).
     */
    suspend fun saveVaultLogin(id: String?, name: String, site: String, username: String?, password: String, insecureTls: Boolean, bots: List<String>, allowedHosts: List<String>, type: String? = null, inComputer: Boolean? = null) {
        val body = buildJsonObject {
            if (type != null) put("type", type)
            put("name", name); put("site", site); if (username != null) put("username", username); put("insecureTls", insecureTls)
            if (inComputer != null) put("inComputer", inComputer)
            put("allowedBots", strings(bots)); put("allowedHosts", strings(allowedHosts))
            if (password.isNotEmpty()) put("password", password)
        }
        if (id == null) send("POST", "/vault", body) else send("PUT", "/vault/${enc(id)}", body)
    }

    /** Which bots may use a card or an identity (their details are changed in Bitwarden). */
    suspend fun setVaultBots(id: String, bots: List<String>) { send("PUT", "/vault/${enc(id)}", buildJsonObject { put("allowedBots", strings(bots)) }) }
    suspend fun deleteVaultItem(id: String) { send("DELETE", "/vault/${enc(id)}") }

    /** Connects Bitwarden with its API key (server: us, eu, or custom with its address). */
    suspend fun setUpBitwarden(server: String, serverUrl: String, clientId: String, clientSecret: String) {
        send("POST", "/vault/bitwarden/setup", buildJsonObject { put("server", server); put("serverUrl", serverUrl); put("clientId", clientId); put("clientSecret", clientSecret) })
    }
    suspend fun lockBitwarden() { send("POST", "/vault/bitwarden/lock") }
    suspend fun syncBitwarden() { send("POST", "/vault/bitwarden/sync") }
    private fun strings(xs: List<String>) = JsonArray(xs.map { kotlinx.serialization.json.JsonPrimitive(it) })

    suspend fun bitwarden(): BitwardenStatus = json.decodeFromString(get("/vault/bitwarden"))
    suspend fun unlockBitwarden(masterPassword: String) {
        send("POST", "/vault/bitwarden/unlock", buildJsonObject { put("password", masterPassword) })
    }

    /**
     * The memory changes that wait, the guarded ones too (`guarded=1`): this app draws each of those as a card of
     * its own and keeps it out of "Approve all". A server from before them ignores the question and lists what it has.
     */
    suspend fun memoryChanges(): List<MemoryChange> = json.decodeFromString(get("/memory/pending?guarded=1"))
    /** Answers a waiting memory change. What it returns has the server's words for the answered card (`text`), where it sends them. */
    suspend fun settleMemoryChange(id: String, approve: Boolean): Answered =
        Answered.of(send("POST", "/memory/pending/${enc(id)}", buildJsonObject { put("approve", approve) }))

    // ---------- a bot's settings and computer ----------

    suspend fun updateBot(botId: String, changes: JsonObject): Bot = json.decodeFromString(send("PUT", "/bots/${enc(botId)}", changes))
    suspend fun deleteBot(botId: String) { send("DELETE", "/bots/${enc(botId)}") }
    suspend fun computer(botId: String): ComputerInfo = json.decodeFromString(get("/bots/${enc(botId)}/computer"))
    suspend fun startComputer(botId: String) { send("POST", "/bots/${enc(botId)}/computer", buildJsonObject { put("action", "start") }) }
    /**
     * Erases a bot's old computer of its own, made before the account's computer (#104). A server from before that
     * erases the bot's computer itself (apps, files, browser logins).
     */
    suspend fun resetComputer(botId: String) { send("POST", "/bots/${enc(botId)}/computer", buildJsonObject { put("action", "reset") }) }
    /** Erases the account's computer for every bot that works on it (#107). Only with `computer-reset` in its features. */
    suspend fun resetAccountComputer(): ComputerChanged = json.decodeFromString(send("POST", "/computer/reset"))
    /** Makes the account's computer again from the newer desktop, keeping /home/box, /workspace and the logins (#107). */
    suspend fun updateAccountComputer(): ComputerChanged = json.decodeFromString(send("POST", "/computer/update"))
    /** Copies the home of a bot's old computer into its folder on the account's computer (#107, `old-computer-copy`). */
    suspend fun copyOldComputer(botId: String): OldCopied =
        json.decodeFromString(send("POST", "/bots/${enc(botId)}/computer", buildJsonObject { put("action", "copy-old") }))
    /** The page that shows a bot's desktop (noVNC, relayed by botdot). control = mouse and keyboard, not just watching. */
    fun screenUrl(botId: String, control: Boolean): String {
        val id = enc(botId)
        return baseUrl.trimEnd('/') + "/computer/$id/vnc.html?autoconnect=1&reconnect=1&resize=scale&show_dot=1&view_only=${if (control) 0 else 1}&path=" + enc("computer/$botId/websockify")
    }

    // ---------- settings, setup, updates ----------

    suspend fun settings(): SettingsInfo = json.decodeFromString(get("/settings"))
    suspend fun saveSettings(s: AppSettings): SettingsInfo = json.decodeFromString(send("PUT", "/settings", json.encodeToJsonElement(s) as JsonObject))
    /** The Chief's checkup; null from a server that answered without it. Only with `checkup` in its features. */
    suspend fun checkup(): Checkup? = Checkup.answer(get("/settings/checkup"))
    /** Switches one of the checkup's two switches ([field]: "on" or "webSearch"); a refusal throws the server's words. */
    suspend fun setCheckup(field: String, value: Boolean): Checkup? = Checkup.answer(send("PUT", "/settings/checkup", buildJsonObject { put(field, value) }))
    suspend fun setup(): SetupInfo = json.decodeFromString(get("/setup?fresh"))
    /** The owner's answer to the question for the Chief's name (ChiefName): "" keeps "Chief of Staff". A refusal throws the server's words. */
    suspend fun nameChief(name: String): SetupInfo = json.decodeFromString(send("PUT", "/setup", buildJsonObject { put("chiefName", name) }))
    suspend fun claudeLogin(): LoginLink = json.decodeFromString(send("POST", "/setup/claude/login"))
    suspend fun claudeLogout() { send("DELETE", "/setup/claude") }
    /** Signs in with the code. The status after it, which may be a check that could not tell (claudeCouldNotTell); null when the server sent none. */
    suspend fun claudeCode(code: String): ClaudeStatus? = claudeOfAnswer(send("POST", "/setup/claude/code", buildJsonObject { put("code", code) }))
    /** Saves an Anthropic API key, which bots then run on (#35); a key Anthropic refuses throws the server's words. Only with `claude-api-key` in its features. */
    suspend fun claudeSaveKey(key: String): ClaudeStatus? = claudeOfAnswer(send("PUT", "/setup/claude/key", buildJsonObject { put("key", key) }))
    /** Which one bots run on: "api-key" or "subscription". */
    suspend fun claudeUse(use: String): ClaudeStatus? = claudeOfAnswer(send("PUT", "/setup/claude/use", buildJsonObject { put("use", use) }))
    suspend fun claudeRemoveKey(): ClaudeStatus? = claudeOfAnswer(send("DELETE", "/setup/claude/key"))
    suspend fun backups(): BackupInfo = json.decodeFromString(get("/backups"))
    suspend fun backupNow(): BackupInfo = json.decodeFromString(send("POST", "/backups/now"))
    fun backupUrl(name: String) = url("/backups/${enc(name)}")
    /** The session's cookie, for a download Android makes itself (a backup): the front door lets in nothing without it. */
    fun sessionCookie(): String? = session?.token(baseUrl.trimEnd('/'))?.let { "${Session.COOKIE}=$it" }

    /** Downloads the app update botdot hands out into [dest], reporting 0..1 as it goes. */
    /** A file a bot attached to its reply ("<runId>/<name>"), saved to [dest]. */
    suspend fun downloadFile(file: String, dest: java.io.File) = download("/files/" + file.split('/').joinToString("/") { enc(it) }, dest)

    /** The screenshots a run's tools took, in order: addresses under /api ("/runs/<id>/images/<name>"). */
    suspend fun runImages(runId: String): List<String> =
        (json.parseToJsonElement(get("/runs/${enc(runId)}/images")).jsonObject["images"]?.jsonArray ?: JsonArray(emptyList()))
            .mapNotNull { it.jsonPrimitive.contentOrNull?.removePrefix("/api") }

    private suspend fun download(path: String, dest: java.io.File) = withContext(Dispatchers.IO) {
        val req = request(path).header("Accept", "*/*").get().build()
        val part = java.io.File(dest.path + ".part")
        try {
            streamClient.newCall(req).execute().use { res ->
                if (!res.isSuccessful) readOrThrow(res)
                dest.parentFile?.mkdirs()
                res.body.byteStream().use { input -> part.outputStream().use { input.copyTo(it) } }
            }
            if (!part.renameTo(dest)) throw ApiException("Couldn't save the file.")
        } catch (e: ApiException) {
            part.delete(); throw e
        } catch (e: IOException) {
            part.delete(); throw ApiException("Can't reach botdot. Is Tailscale on? (${e.message ?: e.javaClass.simpleName})")
        }
    }

    suspend fun downloadApp(dest: java.io.File, onProgress: (Float) -> Unit) = withContext(Dispatchers.IO) {
        val req = request("/app/android.apk").header("Accept", "application/vnd.android.package-archive").get().build()
        try {
            streamClient.newBuilder().followRedirects(false).followSslRedirects(false).build().newCall(req).execute().use { res ->
                if (!res.isSuccessful) readOrThrow(res)
                val total = res.body.contentLength().takeIf { it > 0 } ?: -1L
                dest.parentFile?.mkdirs()
                res.body.byteStream().use { input ->
                    dest.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        var done = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            done += n
                            if (total > 0) onProgress(done.toFloat() / total)
                        }
                    }
                }
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            throw ApiException("Can't reach botdot. Is Tailscale on? (${e.message ?: e.javaClass.simpleName})")
        }
    }

    // ---------- skills and connectors ----------

    suspend fun skills(): SkillsInfo = json.decodeFromString(get("/skills"))
    suspend fun connectors(): ConnectorsInfo = json.decodeFromString(get("/connectors"))
    suspend fun catalog(search: String): Catalog = json.decodeFromString(get("/connectors/catalog?search=${enc(search)}"))
    suspend fun connectApp(slug: String): ConnectLink = json.decodeFromString(send("POST", "/connectors/connect", buildJsonObject { put("app", slug) }))
    suspend fun disconnect(connectionId: String) { send("DELETE", "/connectors/connections/${enc(connectionId)}") }

    // ---------- the Chief of Staff ----------

    suspend fun chief(): ChiefOverview = json.decodeFromString(get("/chief"))
    /** limit: only its last N messages; offset: from message I on (see ChiefChat.offset). An older botdot sends them all. */
    suspend fun chiefChat(id: String, offset: Int? = null, limit: Int? = null): ChiefChat = json.decodeFromString(
        get("/chief/chats/${enc(id)}" + listOfNotNull(offset?.let { "offset=$it" }, limit?.let { "limit=$it" }).joinToString("&").let { if (it.isEmpty()) "" else "?$it" }))
    suspend fun newChiefChat(): ChiefChat = json.decodeFromString(send("POST", "/chief/chats"))
    /**
     * [key]: as [runBot]'s. An answer with `again` is a message that went: botdot had it already. The answer is the
     * chat: with `message-waits` and a reply going on, the message is in its `queued` and not yet in its messages.
     * null when the answer is not a chat this app can read: the message went all the same.
     */
    suspend fun sendToChief(chatId: String, text: String, attachments: List<Attachment>, key: String? = null): ChiefChat? {
        val answer = send("POST", "/chief/chats/${enc(chatId)}/messages", buildJsonObject {
            put("text", text)
            put("attachments", json.encodeToJsonElement(attachments))
            if (key != null) put("key", key)
        })
        return runCatching { json.decodeFromString<ChiefChat>(answer) }.getOrNull()
    }
    suspend fun stopChief(chatId: String) { send("POST", "/chief/chats/${enc(chatId)}/stop") }
    /** "Take back" on a message that waits in a Chief chat, as [takeBack]. */
    suspend fun takeBackFromChief(chatId: String, queuedId: String): TakenBack = TakenBack.of(send("DELETE", "/chief/chats/${enc(chatId)}/queued/${enc(queuedId)}"))
    suspend fun dismissSuggestion(chatId: String) { send("POST", "/chief/chats/${enc(chatId)}/dismiss") }
    /** Rate the unasked message at [index] of the whole chat: "up", "down", or null to clear it (Ratings). */
    suspend fun rate(chatId: String, index: Int, rating: String?) {
        send("PUT", "/chief/chats/${enc(chatId)}/messages/$index/rating", buildJsonObject { put("rating", rating) })
    }

    /** What the Chief is doing ("activity") until it's "done". */
    fun chiefStream(chatId: String): Flow<Pair<String, JsonObject>> = sse("/chief/chats/${enc(chatId)}/stream") { _, data ->
        val o = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: return@sse null
        (o["type"]?.jsonPrimitive?.contentOrNull ?: return@sse null) to o
    }

    // ---------- files ----------

    /** Upload one file for a message. to = "bot:<id>", "chief" or "group:<id>". */
    suspend fun upload(resolver: ContentResolver, uri: Uri, to: String): Attachment = withContext(Dispatchers.IO) {
        val (name, size) = describe(resolver, uri)
        val body = object : RequestBody() {
            override fun contentType() = "application/octet-stream".toMediaType()
            override fun contentLength() = size ?: -1L
            override fun writeTo(sink: BufferedSink) {
                resolver.openInputStream(uri)?.use { sink.writeAll(it.source()) } ?: throw IOException("Can't open $name")
            }
        }
        val req = request("/uploads?to=${enc(to)}")
            .header("X-Bot-Dot", "1")
            .header("X-File-Name", enc(name))
            .post(body)
            .build()
        json.decodeFromString<Attachment>(call(req)).copy(name = name)
    }

    fun describe(resolver: ContentResolver, uri: Uri): Pair<String, Long?> {
        var name = uri.lastPathSegment?.substringAfterLast('/')?.takeIf { '.' in it } ?: "file"
        var size: Long? = null
        runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getString(0)?.let { name = it }
                    if (!c.isNull(1)) size = c.getLong(1)
                }
            }
        }
        return name to size
    }

    // ---------- the live feed ----------

    /**
     * The live feed. lastEventId: resume after it (botdot replays what was missed). Asked with `guarded=1`: what
     * waits then lists the guarded memory changes too, which have a card and a notification of their own.
     */
    fun feed(lastEventId: String?, onOpen: () -> Unit = {}): Flow<FeedEvent> = sse(
        "/events?guarded=1" + (lastEventId?.let { "&since=${enc(it)}" } ?: ""),
        onOpen = onOpen,
    ) { meta, data ->
        val o = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: JsonObject(emptyMap())
        FeedEvent(meta.id, meta.type ?: "message", o)
    }

    private data class SseMeta(val id: String?, val type: String?)

    private fun <T : Any> sse(path: String, onOpen: () -> Unit = {}, parse: (SseMeta, String) -> T?): Flow<T> = callbackFlow {
        val req = request(path).header("Accept", "text/event-stream").build()
        val source = EventSources.createFactory(streamClient).newEventSource(req, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) = onOpen()
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                parse(SseMeta(id, type), data)?.let { trySend(it) }
            }
            override fun onClosed(eventSource: EventSource) { channel.close() }
            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                val msg = response?.let { r -> runCatching { r.body.string() }.getOrNull()?.take(200) }
                channel.close(ApiException(msg?.takeIf { it.isNotBlank() } ?: t?.message ?: "The connection dropped", response?.code ?: 0))
            }
        })
        awaitClose { source.cancel() }
    }

    companion object {
        val JSON = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

        /** Debug builds: each request in Logcat (tag botdot-http), so too many of them show. */
        private val logRequests = okhttp3.Interceptor { chain ->
            val req = chain.request()
            val t0 = System.nanoTime()
            val res = chain.proceed(req)
            android.util.Log.d("botdot-http", "${req.method} ${req.url.encodedPath}${req.url.encodedQuery?.let { "?$it" } ?: ""} -> ${res.code} (${(System.nanoTime() - t0) / 1_000_000} ms)")
            res
        }

        val CLIENT: OkHttpClient = OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(5, TimeUnit.MINUTES) // uploads
            // A request reaches here once it has a connection: from then on botdot may have taken it (ApiException.sent).
            .addNetworkInterceptor { chain -> chain.request().tag(Went::class.java)?.out = true; chain.proceed(chain.request()) }
            .apply { if (dev.botdot.app.BuildConfig.DEBUG) addInterceptor(logRequests) }
            .build()

        fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

        /** "my-vm.tail1234.ts.net" -> "https://my-vm.tail1234.ts.net"; null if it can't be an address. */
        fun normalize(input: String): String? {
            var s = input.trim().trimEnd('/')
            if (s.isEmpty()) return null
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
            val u = s.toHttpUrlOrNull() ?: return null
            if (!ReleaseManifest.secureURL(u.toString())) return null
            return u.newBuilder().encodedPath("/").query(null).build().toString().trimEnd('/')
        }
    }
}

fun JsonObject.str(key: String): String = this[key]?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() } ?: ""
fun JsonObject.arr(key: String): JsonArray? = this[key] as? JsonArray
