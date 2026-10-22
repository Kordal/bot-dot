package dev.botdot.app.ui

import android.view.WindowManager
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.foundation.clickable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonArray
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.Alignment
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Answered
import dev.botdot.app.data.Ask
import dev.botdot.app.data.AskSkill
import dev.botdot.app.data.BitwardenStatus
import dev.botdot.app.data.ChiefChatSummary
import dev.botdot.app.data.Bot
import dev.botdot.app.data.CarriesOn
import dev.botdot.app.data.ChangedPart
import dev.botdot.app.data.Job
import dev.botdot.app.data.Tile
import dev.botdot.app.data.LoginRequest
import dev.botdot.app.data.MemoryCard
import dev.botdot.app.data.MemoryChange
import dev.botdot.app.data.memoryCard
import dev.botdot.app.data.OtherLogin
import dev.botdot.app.data.OtherLogins
import dev.botdot.app.data.standsInChat
import dev.botdot.app.data.CardGroups
import dev.botdot.app.data.GroupRef
import dev.botdot.app.data.groupOfChat
import dev.botdot.app.data.ToolCard
import dev.botdot.app.data.VaultTypes
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Everything waiting for you: bots asking for logins or to pay, Bitwarden, jobs and memory changes to approve. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NeedsYouScreen(app: BotDotApp, onChat: (String) -> Unit = {}, onDone: (() -> Unit)? = null, onBack: () -> Unit) {
    // After the last card, back where the screen was opened from: only while it is the screen in front.
    val leave = onDone ?: onBack
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    // A message at the bottom, without holding up what comes after it (showSnackbar waits until it's gone).
    fun tell(msg: String) { scope.launch { snack.showSnackbar(msg) } }
    // What waits, as the app keeps it (Store): shown at once, kept up to date from the live feed.
    val store = app.store
    val server by store.version.value.collectAsState() // its features: whether it keeps the Vault's item types, and writes a memory card's words
    val features = server?.features
    // What the owner chose and typed on a login request's card, by request: the card is taken down while its save
    // runs, and a save that failed (a wrong master password) brings it back as it was left, the secret aside.
    val chosenType = remember { mutableStateMapOf<String, String>() }
    val typedUser = remember { mutableStateMapOf<String, String>() }
    val needsNow by store.needs.value.collectAsState()
    val botsNow by store.bots.value.collectAsState()
    val chiefNow by store.chief.value.collectAsState()
    val dashNow by store.dashboard.value.collectAsState()
    val jobThens by store.jobThens.value.collectAsState() // who carries on after the yes on a waiting job
    val groupsNow by store.groups.value.collectAsState()
    val cardGroups by store.cardGroups.value.collectAsState() // the group a waiting job or tile was asked in
    // A card asked in a group says so after its bot's name ("Coder in Dev"), by the group's name as it is now.
    val inGroup = { who: Named, g: GroupRef? -> who.inGroup(g?.let { ref -> groupsNow?.firstOrNull { it.id == ref.id }?.name ?: ref.name }) }
    val needsError by store.needs.error.collectAsState()
    val requests = needsNow?.requests.orEmpty()
    val bw = needsNow?.bitwarden
    val bots = botsNow.orEmpty()
    val memory = needsNow?.memory.orEmpty()
    val plans = remember(chiefNow) { chiefNow?.chats.orEmpty().filter { it.waiting != null } }
    val asks = needsNow?.asks.orEmpty()
    val tiles = dashNow?.waiting.orEmpty()
    val loaded = needsNow != null
    val unlocking by app.bwUnlocking.collectAsState()
    val unlockError by app.bwUnlockError.collectAsState()
    val saving by app.savingLogins.collectAsState()
    var refreshing by remember { mutableStateOf(false) }

    // Passwords are typed here: keep this screen out of screenshots and the app switcher's preview.
    val activity = androidx.activity.compose.LocalActivity.current
    DisposableEffect(Unit) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }

    // After you answered something, or pulled to refresh: all of it again, at once.
    suspend fun load() = coroutineScope { listOf(store.needs, store.bots, store.chief, store.dashboard).forEach { launch { it.refresh() } } }
    LaunchedEffect(needsError) { needsError?.let { tell(it) } }
    var fresh by remember { mutableStateOf(false) } // the lists were read from the server since the screen opened
    LaunchedEffect(unlocking) { if (!unlocking) { load(); fresh = true } }
    fun act(done: String, block: suspend () -> Unit) = scope.launch {
        val r = runCatching { block() }
        load()
        answered()
        tell(r.fold({ done }, { it.message ?: "That didn't work" }))
    }

    val waitingJobs = bots.flatMap { b -> b.jobs.filter { it.waits }.map { b to it } }
    val locked = bw?.configured == true && bw.unlocked == false
    val whoOf = { id: String?, name: String -> named(bots.firstOrNull { it.id == id }, name, null) } // the bot as it looks now
    // Approved or declined here: they stay, faded, until you leave the screen.
    var decided by remember { mutableStateOf(listOf<Decided>()) }
    // The last open card answered here: back where the screen was opened from, after a moment to read the answer
    // (NeedsLeave, #264). Counted once the lists are fresh from the server, not as the app kept them, and a card
    // that comes in during the moment changes the count and calls the wait off.
    val open = if (!loaded || !fresh) -1 else requests.size + (if (locked) 1 else 0) + waitingJobs.size + memory.size + plans.size + asks.size + tiles.size
    var seenOpen by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(open) {
        if (open < 0) return@LaunchedEffect
        val now = NeedsLeave.step(seenOpen, open, decided.isNotEmpty())
        seenOpen = now.seen
        if (now.leave) { delay(NeedsLeave.DELAY_MS); leave() }
    }
    // [block] sends the answer and returns what the server says of it, if anything: its words for the answered card,
    // and what the yes started. The label says both. [ask]: the ask answered, whose chat then says so too.
    fun decide(key: String, who: Named?, title: String, yes: Boolean, label: String? = null, ask: Ask? = null, block: suspend () -> Answered?) = scope.launch {
        runCatching { block() }
            .onSuccess { said ->
                val d = Decided(key, who, title, answeredLabel(answeredWord(label, said, yes), said?.carriesOn.takeIf { yes }))
                decided = decided + d
                ask?.let { store.answeredAway.add(it, d.title, d.label) } // the chat the card stood in says what you answered
            }
            .onError { tell(it.message ?: "That didn't work") }
        load()
        answered()
    }
    val jobWho = { b: Bot, j: Job -> inGroup(b.named(), cardGroups[CardGroups.jobKey(b.id, j.id)]) }
    val memWho = { m: MemoryChange -> inGroup(whoOf(m.botId, bots.firstOrNull { it.id == m.botId }?.name ?: m.bot?.name ?: "A bot"), m.group) }
    // What one tap may approve: what a card shows in words. A script is answered on its own card.
    val all = approveAll(
        jobsLeft(waitingJobs, decided.map { it.key }),
        memory.filter { m -> decided.none { it.key == "m:${m.id}" } },
        tilesLeft(tiles, decided.map { it.key }),
    )
    // "Always approve" a job: approve it and trust its later changes. Scripts only after the warning.
    var scriptWarning by remember { mutableStateOf<Pair<Bot, Job>?>(null) }
    fun alwaysJob(b: Bot, j: Job) = decide(jobKey(b, j), jobWho(b, j), jobCard(j).title, true, "Always approved") { api!!.approveJob(b.id, j.id, true, always = true) }
    scriptWarning?.let { (b, j) ->
        AlertDialog(
            onDismissRequest = { scriptWarning = null },
            title = { Text("Always approve \"${j.name}\"?") },
            text = { Text(scriptWarningText(b.name)) },
            confirmButton = { TextButton(onClick = { scriptWarning = null; alwaysJob(b, j) }) { Text("Always approve", color = p.err) } },
            dismissButton = { TextButton(onClick = { scriptWarning = null }) { Text("Cancel", color = p.text) } },
        )
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text("Needs you", style = MaterialTheme.typography.titleMedium) },
                actions = {
                    // AI jobs and memory changes need only a yes; a script, logins, payments and Bitwarden need you to look.
                    all.label?.let { label ->
                        Button(onClick = {
                            all.jobs.forEach { (b, j) -> decide(jobKey(b, j), jobWho(b, j), jobCard(j).title, true) { api!!.approveJob(b.id, j.id, true) } }
                            all.memory.forEach { m -> decide("m:${m.id}", memWho(m), memoryCard(m, features).title, true) { api!!.settleMemoryChange(m.id, true) } }
                        }, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText), modifier = Modifier.padding(end = 8.dp)) { Text(label) }
                    }
                })
        },
    ) { pad ->
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, modifier = Modifier.padding(pad).fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (loaded && requests.isEmpty() && !locked && waitingJobs.isEmpty() && memory.isEmpty() && plans.isEmpty() && asks.isEmpty() && tiles.isEmpty()) item {
                    Text("All done.", color = p.muted, modifier = Modifier.padding(12.dp))
                }
                // What the button above leaves for its own card, in one line.
                all.line?.let { line -> item(key = "left") { Text(line, color = p.muted, fontSize = 12.5.sp, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth()) } }
                if (locked) item {
                    if (unlocking) Busy("Unlocking Password Manager…")
                    else BitwardenCard(bw, bw.wantedBy?.let { w -> whoOf(w.id, w.name) }, unlockError) { pw -> api?.let { app.unlockBitwarden(it, pw) } }
                }
                items(requests, key = { "r:${it.id}" }) { r ->
                    val who = inGroup(if (r.bot == null && r.from == "chief") chiefNamed() else whoOf(r.bot?.id, r.bot?.name ?: "A bot"), r.group)
                    if (r.kind == "card") CardRequest(r, who,
                        onAllow = { act("Allowed for this task") { api!!.answerRequest(r.id, buildJsonObject { put("action", "approve") }) } },
                        onDecline = { act("Declined") { api!!.answerRequest(r.id, buildJsonObject { put("action", "decline") }) } })
                    else if (r.id in saving) Busy("Saving login…")
                    else LoginRequestCard(r, who, bitwardenLocked = locked, features = features,
                        type = chosenType[r.id] ?: VaultTypes.of(r.type).id, onType = { chosenType[r.id] = it },
                        user = typedUser[r.id] ?: r.username, onUser = { typedUser[r.id] = it },
                        onUse = { loginId -> act("${r.bot?.name ?: "The bot"} can use it now") { api!!.answerRequest(r.id, buildJsonObject { put("action", "allow"); put("loginId", loginId) }) } },
                        // A login of another website, after the second question. A refusal (the login has 20
                        // additional hosts already) is the server's sentence, told like every other error; the request stays.
                        // The card waits for the answer (answered), so that it is asked once.
                        onUseOther = { loginId, answered -> act("${r.bot?.name ?: "The bot"} can use it on ${r.site} now") { api!!.answerRequest(r.id, buildJsonObject { put("action", "allow"); put("loginId", loginId) }) }.invokeOnCompletion { answered() } },
                        onSave = { sent, pw, master ->
                            api?.let { a ->
                                app.saveLogin(a, r.id, VaultTypes.requestSave(sent, pw, master), r.bot?.name ?: "The bot")
                            }
                        },
                        onDecline = { act("Declined") { api!!.answerRequest(r.id, buildJsonObject { put("action", "decline") }) } })
                }
                items(jobsLeft(waitingJobs, decided.map { it.key }), key = { (b, j) -> jobKey(b, j) }) { (b, j) ->
                    JobApproval(jobWho(b, j), j, (j.then ?: jobThens["${b.id}/${j.id}"])?.line(),
                        onAlways = { if (j.touchesScript) scriptWarning = b to j else alwaysJob(b, j) },
                        onApprove = { decide(jobKey(b, j), jobWho(b, j), jobCard(j).title, true) { api!!.approveJob(b.id, j.id, true) } },
                        onDecline = { decide(jobKey(b, j), jobWho(b, j), jobCard(j).title, false) { api!!.approveJob(b.id, j.id, false) } })
                }
                items(memory.filter { m -> decided.none { it.key == "m:${m.id}" } }, key = { "m:${it.id}" }) { m ->
                    val card = memoryCard(m, features)
                    MemoryApproval(card, memWho(m),
                        onAlways = { decide("m:${m.id}", memWho(m), card.title, true, "Always allowed") { api!!.settleMemoryChange(m.id, true, always = true) } },
                        onApprove = { decide("m:${m.id}", memWho(m), card.title, true) { api!!.settleMemoryChange(m.id, true) } },
                        onDecline = { decide("m:${m.id}", memWho(m), card.title, false) { api!!.settleMemoryChange(m.id, false) } })
                }
                // A tile of the Board with a script, or a change to one: it runs on your botdot, so it waits for you.
                items(tilesLeft(tiles, decided.map { it.key }), key = { tileKey(it) }) { t ->
                    val b = bots.firstOrNull { it.id == t.bot }
                    val who = inGroup(b?.named() ?: chiefNamed(), cardGroups[CardGroups.tileKey(t.id)])
                    TileApproval(who, t, t.then?.line(),
                        onApprove = { decide(tileKey(t), who, tileCard(t).title, true) { api!!.approveTile(t.id, true) } },
                        onDecline = { decide(tileKey(t), who, tileCard(t).title, false) { api!!.approveTile(t.id, false) } })
                }
                // A permission or a skill a bot (or the Chief) asked for, and a tool the Chief asks to install for a bot.
                items(asks.filter { a -> decided.none { it.key == "a:${a.id}" } }, key = { "a:${it.id}" }) { a ->
                    val who = inGroup(a.bot?.let { whoOf(it.id, it.name) } ?: chiefNamed(), a.group)
                    AskApproval(a, who) { title, yes, label, always -> decide("a:${a.id}", who, title, yes, label, ask = a) { api!!.answerAsk(a.id, yes, always) } }
                }
                // A bot's plan for the Chief: nothing happens until you approve it, here or in its chat.
                items(plans.filter { c -> decided.none { it.key == "p:${c.id}" } }, key = { "p:${it.id}" }) { c ->
                    val from = c.waiting!!.from
                    val who = whoOf(from.id, from.name)
                    val title = "A plan for the Chief: ${c.title}"
                    Card(who, title, "Nothing happens until you approve it", expandable = true) {
                        Body(c.waiting.text.replace("**", "").replace(Regex("""(?m)^\s*[-*#]+\s+"""), ""))
                        Text("Open chat", color = p.muted, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { onChat(c.id) }.padding(6.dp))
                        Buttons("Approve", { decide("p:${c.id}", who, title, true, "Approved · the Chief is on it") { api!!.sendToChief(c.id, PLAN_APPROVAL, emptyList()); null } },
                            "Decline", { decide("p:${c.id}", who, title, false) { api!!.dismissSuggestion(c.id); null } })
                    }
                }
                items(decided, key = { "d:${it.key}" }) { d ->
                    Card(d.who, d.title, done = true) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { Muted(d.label) } }
                }
            }
        }
    }
}

// ---------- in the chat ----------

/**
 * What waits for your OK, at the bottom of the chat it belongs to: in a bot's chat, the jobs it set up,
 * the permissions and skills it asked for, its memory changes and its logins; in the Chief's
 * (scope "chief"), the jobs the Chief set up, the skills and logins it asked for. A tool to install is in both:
 * the Chief asked for it, and it is installed for that bot; so is a bot change the Chief asked for. Logins and
 * payments open Needs you, where passwords are typed. [chiefChat]: the Chief chat on screen (all of them show the
 * same cards): a card whose yes makes the Chief carry on in that very chat says "in this chat".
 * In a group's chat (scope "group:<id>"): the cards asked in that group, each with its bot's name. Such a card
 * stands in no bot's own chat and not in the Chief's ([chatCards]).
 */
@Composable
fun ChatNeeds(app: BotDotApp, scope: String, onNeeds: () -> Unit, chiefChat: String? = null) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val cs = rememberCoroutineScope()
    // What waits, as the app keeps it (Store), kept up to date from the live feed.
    val store = app.store
    val needsNow by store.needs.value.collectAsState()
    val botsNow by store.bots.value.collectAsState()
    val dashNow by store.dashboard.value.collectAsState()
    val jobThens by store.jobThens.value.collectAsState() // who carries on after the yes on a waiting job
    val cardGroups by store.cardGroups.value.collectAsState() // the group a waiting job or tile was asked in
    val server by store.version.value.collectAsState() // its features: whether it writes a memory card's words
    val features = server?.features
    val requests = needsNow?.requests.orEmpty()
    val bots = botsNow.orEmpty()
    val memory = needsNow?.memory.orEmpty()
    val asks = needsNow?.asks.orEmpty()
    val tiles = dashNow?.waiting.orEmpty()
    val suggestions = dashNow?.suggestions.orEmpty()
    var error by remember { mutableStateOf<String?>(null) }
    // Decided here: a faded line each, until you leave the chat.
    var decided by remember(scope) { mutableStateOf(listOf<Decided>()) }
    // And what was answered on the Needs you screen for this chat: the same line, taken once (AnsweredAway).
    val answeredAway by store.answeredAway.value.collectAsState()
    LaunchedEffect(scope, answeredAway) {
        val mine = store.answeredAway.take(scope).filter { a -> decided.none { it.key == a.key } }
        if (mine.isNotEmpty()) decided = decided + mine.map { Decided(it.key, null, it.title, it.label) }
    }

    suspend fun load() = coroutineScope { listOf(store.needs, store.bots, store.dashboard).forEach { launch { it.refresh() } } }
    // [block] sends the answer and returns what the server says of it, if anything: the label says it too.
    fun decide(key: String, title: String, yes: Boolean, label: String? = null, block: suspend () -> Answered?) = cs.launch {
        runCatching { block() }
            .onSuccess { said -> decided = decided + Decided(key, null, title, answeredLabel(answeredWord(label, said, yes), said?.carriesOn.takeIf { yes })); error = null }
            .onError { error = it.message ?: "That didn't work" }
        load()
        answered()
    }

    val chief = scope == "chief"
    val group = groupOfChat(scope)
    // In a bot's chat it's all that bot's: no need to name it. In the Chief's, say which bot a job is for; in a
    // group's, which member asked.
    val whoOf = { b: Bot? -> if (chief || group != null) b?.named() else null }
    // A card asked in a group stands at the end of that group's chat, and in no other.
    val here = { asked: GroupRef? -> chatCards(scope, asked) }
    val jobs = jobsLeft(bots.flatMap { b -> b.jobs.filter { it.waits }.map { b to it } }
        .filter { (b, j) -> here(cardGroups[CardGroups.jobKey(b.id, j.id)]) && (group != null || if (chief) j.askedBy == "chief" else b.id == scope && j.askedBy != "chief") }, decided.map { it.key })
    val mems = if (chief) emptyList() else memory.filter { here(it.group) && (group != null || it.botId == scope) && decided.none { d -> d.key == "m:${it.id}" } }
    val myAsks = asks.filter { a -> a.standsInChat(scope) && decided.none { it.key == "a:${a.id}" } }
    val reqs = requests.filter { r -> here(r.group) && (group != null || if (chief) r.from == "chief" else r.bot?.id == scope && r.from != "chief") }
    val mySuggestions = if (chief || group != null) emptyList() else suggestions.filter { x -> x.bot == scope && decided.none { it.key == "s:${x.id}" } }
    val myTiles = tilesLeft(tiles.filter { t -> here(cardGroups[CardGroups.tileKey(t.id)]) && (group != null || if (chief) t.askedBy != "bot" else t.bot == scope && t.askedBy == "bot") }, decided.map { it.key })
    var scriptWarning by remember { mutableStateOf<Pair<Bot, Job>?>(null) }
    fun alwaysJob(b: Bot, j: Job) = decide(jobKey(b, j), jobCard(j).title, true, "Always approved") { api!!.approveJob(b.id, j.id, true, always = true) }
    scriptWarning?.let { (b, j) ->
        AlertDialog(
            onDismissRequest = { scriptWarning = null },
            title = { Text("Always approve \"${j.name}\"?") },
            text = { Text(scriptWarningText(b.name)) },
            confirmButton = { TextButton(onClick = { scriptWarning = null; alwaysJob(b, j) }) { Text("Always approve", color = p.err) } },
            dismissButton = { TextButton(onClick = { scriptWarning = null }) { Text("Cancel", color = p.text) } },
        )
    }
    if (decided.isEmpty() && jobs.isEmpty() && mems.isEmpty() && myAsks.isEmpty() && reqs.isEmpty() && myTiles.isEmpty() && mySuggestions.isEmpty()) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        decided.forEach { Text("${it.title} · ${it.label}", color = p.muted, fontSize = 12.5.sp) }
        if (error != null) Text(error!!, color = p.err, fontSize = 12.5.sp)
        reqs.forEach { r ->
            val who = if (chief || group != null) r.bot?.let { named(bots.firstOrNull { b -> b.id == it.id }, it.name, null) } else null
            Card(who, if (r.kind == "card") "Pay on ${r.site}" else "A login for ${r.site}", if (r.kind == "card") r.amount else r.reason) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Button(onClick = onNeeds, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(if (r.kind == "card") "Review" else "Add it") }
                }
            }
        }
        jobs.forEach { (b, j) ->
            JobApproval(whoOf(b), j, (j.then ?: jobThens["${b.id}/${j.id}"])?.line(chiefChat),
                onAlways = { if (j.touchesScript) scriptWarning = b to j else alwaysJob(b, j) },
                onApprove = { decide(jobKey(b, j), jobCard(j).title, true) { api!!.approveJob(b.id, j.id, true) } },
                onDecline = { decide(jobKey(b, j), jobCard(j).title, false) { api!!.approveJob(b.id, j.id, false) } })
        }
        mems.forEach { m ->
            val card = memoryCard(m, features)
            MemoryApproval(card, if (group != null) whoOf(bots.firstOrNull { it.id == m.botId }) else null,
                onAlways = { decide("m:${m.id}", card.title, true, "Always allowed") { api!!.settleMemoryChange(m.id, true, always = true) } },
                onApprove = { decide("m:${m.id}", card.title, true) { api!!.settleMemoryChange(m.id, true) } },
                onDecline = { decide("m:${m.id}", card.title, false) { api!!.settleMemoryChange(m.id, false) } })
        }
        myAsks.forEach { a ->
            // In the Chief's chat the card of a tool, and of a changed bot, says which bot it is for, as it looks now.
            val who = if (chief || group != null) a.bot?.let { named(bots.firstOrNull { b -> b.id == it.id }, it.name, it.color) } else null
            AskApproval(a, who, chiefChat) { title, yes, label, always -> decide("a:${a.id}", title, yes, label) { api!!.answerAsk(a.id, yes, always) } }
        }
        // A tile this bot suggested for the Board.
        mySuggestions.forEach { x ->
            Card(null, "Put “${x.tile.title}” on your Board?", x.reason, expandable = x.tile.scripts.isNotEmpty()) {
                x.tile.scripts.forEach { Body(it, mono = true) }
                ThenLine(x.then?.line(chiefChat))
                Buttons("Add", { decide("s:${x.id}", x.tile.title, true, "On your Board") { api!!.answerSuggestion(x.id, true) } },
                    "No", { decide("s:${x.id}", x.tile.title, false, "Not added") { api!!.answerSuggestion(x.id, false) } })
            }
        }
        myTiles.forEach { t ->
            TileApproval(whoOf(bots.firstOrNull { it.id == t.bot }), t, t.then?.line(chiefChat),
                onApprove = { decide(tileKey(t), tileCard(t).title, true) { api!!.approveTile(t.id, true) } },
                onDecline = { decide(tileKey(t), tileCard(t).title, false) { api!!.approveTile(t.id, false) } })
        }
    }
}

/**
 * Whether a card stands at the end of the chat [scope] ("chief", a bot's id, or a group's "group:<id>") as far as
 * the group it was [asked] in goes: a card asked in a group stands in that group's chat alone, and a card asked
 * anywhere else in no group's (docs/api.md, "A card and a question in a group").
 */
internal fun chatCards(scope: String, asked: GroupRef?): Boolean = groupOfChat(scope) == asked?.id

// ---------- the cards ----------

/** What you decided: whose card it was (the bot named, with its small mark), what it was about and what you said. */
private data class Decided(val key: String, val who: Named?, val title: String, val label: String)

/**
 * What an answered card is remembered by, until the owner leaves the screen or the chat: the job, and for a change to
 * an approved job the change too, by when it was proposed (`at`), as the web page's `changeKey` does. A second change
 * to the same job, proposed after the first was answered, is a card of its own and not the answered one. A job never
 * approved has no such part: its yes approves it for good and its no removes it, and the server gives a new job a
 * new id, so it never waits a second time under the id it had.
 */
internal fun jobKey(b: Bot, j: Job): String = "j:${b.id}:${j.id}${changeKey(j.change.takeIf { j.approved }?.let { it.at.orEmpty() })}"

/** The same for a tile of the Board and a change to an approved one. */
internal fun tileKey(t: Tile): String = "t:${t.id}${changeKey(t.change.takeIf { t.approved }?.let { it.at.orEmpty() })}"

/** [at]: when the change was proposed, "" where the server does not say, and null for what is no change. */
private fun changeKey(at: String?): String = if (at == null) "" else ":change:${at.trim()}"

/** The [jobs] that wait and whose card was not [answered] here: they have a card with its buttons, and "Approve N" counts them. */
internal fun jobsLeft(jobs: List<Pair<Bot, Job>>, answered: List<String>): List<Pair<Bot, Job>> = jobs.filter { (b, j) -> jobKey(b, j) !in answered }

/** The same for the [tiles] that wait. */
internal fun tilesLeft(tiles: List<Tile>, answered: List<String>): List<Tile> = tiles.filter { tileKey(it) !in answered }

/**
 * What an answered card says: the app's own word for the answer and, after a yes that started something, what the
 * server says carries on ("Allowed · it carries on"). Without it the word stands alone.
 */
internal fun answeredLabel(label: String, started: CarriesOn?): String = if (started == null) label else "$label · ${started.text}"

/**
 * The word for an answer: the card's own where it has one ([own]: "Always approved", "Allowed"), else the server's
 * words for the answered card ("Declined and removed", "Changed: daily at 07:00", "Kept as it was: daily at 08:00"),
 * else "Approved" or "Declined", as before the server said any.
 */
internal fun answeredWord(own: String?, said: Answered?, yes: Boolean): String = own ?: said?.text ?: if (yes) "Approved" else "Declined"

/** Under the body of a change to an approved job or tile: nothing stops while the card waits. */
internal const val RUNS_AS_APPROVED = "Runs as you approved it until you answer."

/** The question before "Always allow this action" answers, in the web page's words (public/app.js). */
internal const val ALWAYS_ALLOW_QUESTION = "Allow this exact connector action for this bot in future runs, with any arguments?"

/** The same question on the Chief's own card (ADR 047), with the Chief's name, as the web page asks it. */
internal fun alwaysAllowChief(name: String) = "Allow this exact connector action for $name from now on, with any arguments?"

/**
 * What "Approve all" does with what waits: it approves [jobs] and [memory], which a card shows in words, and leaves
 * every job and tile that runs a script for its own card. A guarded memory change (one to what the owner said, and
 * a forget) is left for its own card too: it is neither in [memory] nor counted, and no line names it. [label]: what the button reads, counting what it approves
 * ("Approve 3"); null with fewer than two, and then there is no button. [line]: what is left, named in one line
 * under the title; null without the button, or when nothing is left.
 */
internal class ApproveAll(val jobs: List<Pair<Bot, Job>>, val memory: List<MemoryChange>, left: List<String>) {
    val label: String? = (jobs.size + memory.size).takeIf { it >= 2 }?.let { "Approve $it" }
    val line: String? = scriptsLeft(left).takeIf { label != null }
}

/** [jobs], [memory] and [tiles]: what waits and was not answered yet. A tile waits for a script, so it is always left. */
internal fun approveAll(jobs: List<Pair<Bot, Job>>, memory: List<MemoryChange>, tiles: List<Tile>): ApproveAll {
    val (scripts, words) = jobs.partition { (_, j) -> j.touchesScript }
    return ApproveAll(words, memory.filter { !it.guarded }, scripts.map { (_, j) -> j.name } + tiles.map { "“${it.title}”" })
}

/** The line that names what "Approve all" left: "Disk check runs a script: approve it on its card." null for none. */
internal fun scriptsLeft(names: List<String>): String? = when (names.size) {
    0 -> null
    1 -> "${names[0]} runs a script: approve it on its card."
    else -> "${names.dropLast(1).joinToString(", ")} and ${names.last()} run scripts: approve them on their cards."
}

/**
 * What the card of a waiting job shows. A job before its first OK: its name, and "Decline" in the server's words where
 * it sends them (`no`: "Decline and remove"). An approved job with a change beside it: "<name>: a change", the approved
 * schedule and the new one, and what goes beside what comes: [promptWas] is the approved text, struck above [prompt],
 * where the text changes; [scriptWas] the approved script above [script], where the script changes. [script] is null
 * for a job that runs none after the yes. [line]: [RUNS_AS_APPROVED] on a change. [also]: what else the change
 * changes, a line each: whether the owner hears of every run, and when a script job asks the AI. [summary]: what the
 * change changes in its proposer's one sentence, null where the server sends none: a closed card shows it in place of
 * what goes and what comes, which a tap brings.
 */
internal data class JobCard(
    val title: String, val meta: String,
    val script: String?, val scriptWas: String?,
    val prompt: String, val promptWas: String?,
    val line: String?, val no: String, val yes: String,
    val also: List<String> = emptyList(),
    val summary: String? = null,
)

/** A job's report setting in words (`notify`, docs/api.md); a value this app does not know as it came. */
private fun notifyWords(v: String) = when (v) { "always" -> "after every run"; "report-only" -> "only when it has something to report"; else -> v }

/** When a script job asks the AI, in the words of the web page's job dialog (`aiWhen`); a value this app does not know as it came. */
private fun aiWhenWords(v: String) = when (v) {
    "output" -> "only when it prints something"; "failed" -> "only when it fails"; "always" -> "every time it runs"; "never" -> "never, just its output"; else -> v
}

/** "<label>: <was> → <now>" for a setting that changes, "<label>: <now>" for one that had none; null when it stays. */
private fun changed(label: String, was: String?, now: String?, words: (String) -> String): String? = when {
    now == null || now == was -> null
    was == null -> "$label: ${words(now)}"
    else -> "$label: ${words(was)} → ${words(now)}"
}

private fun kindWords(script: Boolean) = if (script) "a script, no AI" else "uses AI"

/** Under a change's sentence on a closed card: where the rest is. */
internal const val SEE_FULL_CHANGE = "Tap to see the full change"

/** Whether the card shows what goes and what comes: always without a sentence, and with one once it is [open]. */
internal fun showsFull(card: JobCard, open: Boolean) = open || card.summary == null

internal fun jobCard(j: Job): JobCard {
    val c = j.change.takeIf { j.approved }
    val was = scheduleWords(j) // the approved schedule: a change shows the new one beside it
    if (c == null) {
        val by = when (j.changedBy ?: j.createdBy) { "chief" -> "added by the Chief"; "bot" -> "added by itself"; else -> "changed" }
        val script = j.kind == "script"
        return JobCard(j.name, "$was · ${kindWords(script)} · $by", j.script.takeIf { script }, null, j.prompt, null, null, j.no ?: "Decline", j.yes ?: "Approve")
    }
    val by = when (c.by) { "chief" -> "changed by the Chief"; "bot" -> "changed by itself"; else -> "changed" }
    val now = c.words ?: was
    // After the yes it runs a script: the change says so or carries one ([Job.touchesScript] reads it the same way),
    // or it says nothing of it and the approved job runs one.
    val script = c.runsScript || (c.kind == null && j.kind == "script")
    val scriptNow = (c.script ?: j.script).takeIf { script }
    val prompt = c.prompt ?: j.prompt
    val meta = listOfNotNull(
        if (now == was) was else "now $was → $now",
        c.name?.takeIf { it != j.name }?.let { "renamed “$it”" },
        kindWords(script), by,
    ).joinToString(" · ")
    return JobCard(
        "${j.name}: a change", meta,
        scriptNow, j.script.takeIf { j.kind == "script" && it != scriptNow },
        prompt, j.prompt.takeIf { it.isNotBlank() && it != prompt },
        RUNS_AS_APPROVED, j.no ?: "Keep as it is", j.yes ?: "Approve the change",
        listOfNotNull(
            changed("Tells you", j.notify ?: "report-only", c.notify, ::notifyWords),
            changed("Asks the AI", j.aiWhen?.ifBlank { null }, c.aiWhen.takeIf { script }, ::aiWhenWords),
        ),
        c.summary,
    )
}

/**
 * What the card of a waiting tile shows, as [JobCard]: a tile before its first OK with its [scripts], and an approved
 * tile with a change beside it: "<title>: a change", the scripts it runs today ([scriptsWas], where the server lists
 * them) above those it would run. A change that lists no scripts shows none as proposed: the approved ones are never
 * shown as what the yes would approve, and stand above as the approved ones, as on the web page.
 */
internal data class TileCard(val title: String, val meta: String, val scripts: List<String>, val scriptsWas: List<String>, val line: String?, val no: String, val yes: String)

internal fun tileCard(t: Tile): TileCard {
    val c = t.change.takeIf { t.approved }
    val scripts = if (c == null) t.scripts else c.scripts.orEmpty()
    val by = if (c == null) { if (t.changedBy == "bot") "added by itself" else "added by the Chief" }
        else when (c.by) { "chief" -> "changed by the Chief"; "bot" -> "changed by itself"; else -> "changed" }
    // Every script it runs: the card says "a script" only above the scripts it shows.
    val meta = listOfNotNull(
        t.section.ifEmpty { null }, c?.title?.takeIf { it != t.title }?.let { "renamed “$it”" },
        "a script, no AI".takeIf { scripts.isNotEmpty() }, by,
    ).joinToString(" · ")
    return if (c == null) TileCard("Put “${t.title}” on your Board?", meta, scripts, emptyList(), null, t.no ?: "Decline", t.yes ?: "Approve")
    else TileCard("${t.title}: a change", meta, scripts, t.scripts.takeIf { it != scripts }.orEmpty(), RUNS_AS_APPROVED, t.no ?: "Keep as it is", t.yes ?: "Approve the change")
}

/**
 * The line under the title of an action in a connected app: that [bot] waits for the answer inside its run ([held]),
 * or when it stopped waiting ([stoppedAt], shown with the app's short [time]). null when the server says neither, or a
 * time this app cannot read: the card keeps the line it has today.
 */
internal fun connectorState(bot: String, held: Boolean?, stoppedAt: String?, time: (String) -> String = ::shortTime): String? = when {
    held == true -> "$bot waits for your answer"
    held == false && stoppedAt != null -> time(stoppedAt).ifEmpty { null }?.let { "$bot stopped waiting at $it" }
    else -> null
}

/** A row the card of an action in a connected app draws was clipped ([Ask.rowsCut]): a yes would send more than the card shows. */
private fun connectorCut(a: Ask): Boolean = a.rows.isNotEmpty() && a.rowsCut

/**
 * Whether that card says [TOO_LONG]: the action is too long to show in full ([Ask.tooLong]). The card has the rows
 * that fit, or none, and never `details`, which is as long as the action.
 */
internal fun connectorTooLong(a: Ask): Boolean = a.tooLong && !connectorCut(a)

/** The line of a card whose action is too long to show in full, as the web page says it. */
internal const val TOO_LONG = "Too long to show in full."

/**
 * Whether the card offers "Always allow this action": not while a row it draws was clipped. It grants the action
 * with any arguments, so it is offered for an action too long to show in full too.
 */
internal fun connectorAlways(a: Ask): Boolean = !connectorCut(a)

/**
 * Whether the card offers "Allow once", which sends exactly the action's arguments: only when the card shows them
 * all. Not while a row was clipped, and not for an action too long to show in full. Without rows the card shows
 * `details`, which is whole.
 */
internal fun connectorOnce(a: Ask): Boolean = connectorAlways(a) && !connectorTooLong(a)

/** Whether that card shows `details`: in place of rows it does not have, and under rows that were clipped. */
internal fun connectorDetails(a: Ask): Boolean = !connectorTooLong(a) && (a.rows.isEmpty() || (a.rowsCut && a.details.isNotBlank()))

/** The title of the card of a skill a bot wrote: the server's line, or the app's own where it sent none. */
internal fun skillTitle(a: Ask): String = a.line.ifEmpty { "Wants to keep a skill it wrote: “${a.skill?.name.orEmpty()}”" }

/** What the yes button of a changed bot reads: the server's word where it sends one ("Allow"), "Approve" otherwise. */
internal fun changeYes(a: Ask): String = a.yes ?: "Approve"

/** Whether the card around it is open: closed, cards show a few lines of each text (like the web page). */
private val LocalCardOpen = staticCompositionLocalOf { true }

/** expandable: closed until tapped, then everything shows (not for cards you type into). */
@Composable
private fun Card(who: Named?, title: String, meta: String? = null, done: Boolean = false, expandable: Boolean = false, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    var open by remember { mutableStateOf(!expandable) }
    Column(
        Modifier.fillMaxWidth().alpha(if (done) 0.4f else 1f).background(p.panel, RoundedCornerShape(18.dp)).border(1.dp, p.line, RoundedCornerShape(18.dp))
            .then(if (expandable) Modifier.clickable(onClickLabel = if (open) "Show less" else "Show all") { open = !open } else Modifier).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (who != null) Row(verticalAlignment = Alignment.CenterVertically) {
            SmallFigure(who.color, who.outfit, 16.dp)
            Text(" ${who.name}", color = p.muted, fontSize = 12.5.sp)
        }
        Text(title, style = MaterialTheme.typography.titleMedium, color = p.text, maxLines = if (open) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)
        if (!meta.isNullOrBlank()) Text(meta, color = p.muted, fontSize = 12.5.sp, maxLines = if (open) Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis)
        CompositionLocalProvider(LocalCardOpen provides open) { content() }
    }
}

/** A grey box for what it will do: the task, the script, the note. */
@Composable
private fun Body(text: String, mono: Boolean = false) {
    val p = LocalPaper.current
    Text(text, color = p.text, fontSize = 13.sp, fontFamily = if (mono) GeistMono else null,
        maxLines = if (LocalCardOpen.current) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth().background(p.sunk, RoundedCornerShape(10.dp)).then(if (mono) Modifier.horizontalScroll(rememberScrollState()) else Modifier).padding(10.dp))
}

// Each answer sent from a card, once the server said yes or no and the cards are loaded again: a card still there
// (the answer failed) can be pressed again (#129).
private val answers = mutableIntStateOf(0)
private fun answered() { answers.intValue++ }

/** What the yes of a card that turns on a call or a notify address says while its answer is on its way (#154). */
internal const val CREATING_CONNECTION = "Creating connection…"

/**
 * What a card's button says while its answer is on its way: "Approving…" for "Approve", as on the web page. [connects]:
 * it is the yes of a card that turns on a call or a notify address ([dev.botdot.app.data.Job.createsConnection]): "Creating connection…".
 */
internal fun busyWord(label: String, connects: Boolean = false): String = if (connects) CREATING_CONNECTION else when (label) {
    "Approve", "Always approve" -> "Approving…"
    "Allow", "Allow once", "Always allow" -> "Allowing…"
    "Decline" -> "Declining…"
    "Save" -> "Saving…"
    "Install" -> "Installing…"
    "Add" -> "Adding…"
    else -> if (label.startsWith("Always allow ") || label.startsWith("Allow always ")) "Allowing…" else "$label…" // the server's "Always allow reminders" (#280)
}

/**
 * Decline on the left, the yes on the right, at the card's right edge ("Always approve" between them, wrapping if needed).
 * A press says so on its button ([busyWord]) and leaves none of them to press again until the answer came back: a slow
 * save to Bitwarden made a call key for each press (#129).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Buttons(primary: String, onPrimary: () -> Unit, secondary: String, onSecondary: () -> Unit, enabled: Boolean = true, onAlways: (() -> Unit)? = null, connects: Boolean = false, alwaysLabel: String = "Always approve") {
    val p = LocalPaper.current
    var pressed by remember { mutableStateOf<String?>(null) }
    val sent = answers.intValue
    LaunchedEffect(sent) { pressed = null }
    val press = { label: String, action: () -> Unit -> { if (pressed == null) { pressed = label; action() } } }
    // A yes of a card that turns on a call or a notify address ([connects]) turns a spinner in its button while it says so.
    val spins = { label: String -> connects && pressed == label && label != secondary }
    val word = { label: String -> if (pressed == label) busyWord(label, spins(label)) else label }
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
        OutlinedButton(onClick = press(secondary, onSecondary), enabled = pressed == null) { Text(word(secondary), color = p.text) }
        if (onAlways != null) OutlinedButton(onClick = press(alwaysLabel, onAlways), enabled = pressed == null) {
            if (spins(alwaysLabel)) ButtonSpinner(p.text)
            Text(word(alwaysLabel), color = p.text)
        }
        Button(onClick = press(primary, onPrimary), enabled = enabled && pressed == null, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) {
            if (spins(primary)) ButtonSpinner(LocalContentColor.current)
            Text(word(primary))
        }
    }
}

/** A small spinner before a pressed button's words (#154). */
@Composable
private fun ButtonSpinner(color: Color) {
    CircularProgressIndicator(Modifier.size(14.dp), color = color, strokeWidth = 2.dp)
    Spacer(Modifier.width(8.dp))
}

@Composable
private fun Muted(text: String) = Text(text, color = LocalPaper.current.muted, style = MaterialTheme.typography.bodyMedium)

/** Who carries on after the yes, in the server's sentence: one line under the card's body, also on a closed card. Nothing without one. */
@Composable
private fun ThenLine(text: String?) {
    if (!text.isNullOrBlank()) Text(text, color = LocalPaper.current.muted, fontSize = 12.5.sp)
}

@Composable
internal fun PasswordField(value: String, onChange: (String) -> Unit, label: String) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Password },
    )
}

/** A secret of several lines (a private key, #155): masked as a password is, its line breaks kept. */
@Composable
internal fun SecretBox(value: String, onChange: (String) -> Unit, label: String) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, minLines = 3, maxLines = 6,
        visualTransformation = PasswordVisualTransformation(),
        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun BitwardenCard(bw: BitwardenStatus, who: Named?, error: String?, onUnlock: (String) -> Unit) {
    var pw by remember { mutableStateOf("") }
    Card(who, "Bitwarden is locked") {
        Muted(bw.wantedBy?.let { "${it.name} needs a saved login. Unlock Bitwarden so bots can use your logins." }
            ?: "Bots can't use your saved logins until you unlock it. The master password is only kept in botdot's memory, never saved.")
        if (error != null) Text(error, color = LocalPaper.current.err, style = MaterialTheme.typography.bodyMedium)
        PasswordField(pw, { pw = it }, "Master password")
        val p = LocalPaper.current
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Button(onClick = { onUnlock(pw); pw = "" }, enabled = pw.isNotEmpty(), colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text("Unlock") }
        }
    }
}

/** Bitwarden unlocking, or a login being saved, in the background: one line with a pulsing dot. */
@Composable
private fun Busy(text: String) {
    val p = LocalPaper.current
    val a by rememberInfiniteTransition(label = "unlocking").animateFloat(1f, 0.35f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "a")
    Row(Modifier.padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(9.dp).alpha(a).clip(CircleShape).background(p.dot))
        Text(text, color = p.muted, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun LoginRequestCard(r: LoginRequest, who: Named, bitwardenLocked: Boolean, features: Collection<String>?, type: String, onType: (String) -> Unit, user: String, onUser: (String) -> Unit, onUse: (String) -> Unit, onUseOther: (String, () -> Unit) -> Unit, onSave: (VaultTypes.Sent, String, String) -> Unit, onDecline: () -> Unit) {
    val p = LocalPaper.current
    // type: the one that was asked for, until the owner changes it; the new-login fields follow it (VaultTypes).
    // It and the typed username are kept by the screen, so that they outlive a save that failed.
    val fields = VaultTypes.requestFields(type, features)
    var pw by remember(r.id) { mutableStateOf("") }
    var master by remember(r.id) { mutableStateOf("") }
    val others = OtherLogins.of(r)
    var othersOpen by remember(r.id) { mutableStateOf(false) }
    var typed by remember(r.id) { mutableStateOf("") }
    // The login of another website picked from the list, by its id: gone from the list, the question is gone too.
    var picked by remember(r.id) { mutableStateOf<String?>(null) }
    val confirming = OtherLogins.picked(others, picked)
    // Its answer is on its way to the server: nothing more to pick until the server has said yes or no.
    var sending by remember(r.id) { mutableStateOf(false) }
    var fileError by remember(r.id) { mutableStateOf<String?>(null) }
    val pick = rememberSecretFilePick({ pw = it; fileError = null }) { fileError = it }
    Card(who, "A login for ${r.site}") {
        if (confirming != null) OtherLoginConfirm(OtherLogins.confirm(r, confirming, who.name), onBack = { picked = null }, onYes = { picked = null; sending = true; onUseOther(confirming.id) { sending = false } })
        else {
            if (r.reason.isNotBlank()) Muted("“${r.reason}”")
            val usable = r.existing.filter { !it.allowed }
            if (usable.isNotEmpty()) {
                Muted("Let it use a login you already saved:")
                usable.forEach { e ->
                    OutlinedButton(onClick = { onUse(e.id) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Use ${e.name}${if (e.username.isNotBlank()) " (${e.username})" else ""}", color = p.text)
                    }
                }
            }
            if (sending) Busy(OtherLogins.SENDING)
            else if (others.isNotEmpty()) {
                Text(OtherLogins.OPEN, color = p.muted, fontSize = 13.sp,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClickLabel = if (othersOpen) "Hide the list" else "Show the list") { othersOpen = !othersOpen }.padding(6.dp))
                if (othersOpen) OtherLoginsList(others, typed, { typed = it }) { picked = it.id }
            }
            if (usable.isNotEmpty()) Muted("Or save a new one:")
            else Muted("It goes straight into your vault${if (bitwardenLocked) " (Bitwarden)" else ""}. The bot never sees the password.")
            if (VaultTypes.shows(features)) Choice(VaultTypes.CONTROL, type, VaultTypes.options(features, r.type), onType)
            fields.username?.let { label ->
                OutlinedTextField(user, onUser, label = { Text(label) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Username })
            }
            if (fields.multiline) {
                SecretBox(pw, { pw = it }, fields.secret)
                TextButton(onClick = pick) { Text("Pick its file", color = p.text) }
                fileError?.let { Text(it, color = p.err, style = MaterialTheme.typography.bodyMedium) }
            } else PasswordField(pw, { pw = it }, fields.secret)
            if (bitwardenLocked) PasswordField(master, { master = it }, "Bitwarden master password (it's locked)")
            Buttons("Save", { onSave(VaultTypes.sent(type, user, features), pw, master); pw = ""; master = "" }, "Decline", onDecline, enabled = pw.isNotEmpty())
        }
    }
}

/**
 * The logins saved for other websites: a row each, with its name, username and website. A long list has a search
 * field above it and scrolls inside the card, so the new-login fields below stay near (OtherLogins).
 */
@Composable
private fun OtherLoginsList(others: List<OtherLogin>, typed: String, onTyped: (String) -> Unit, onPick: (OtherLogin) -> Unit) {
    val p = LocalPaper.current
    val long = OtherLogins.hasSearch(others)
    val rows = if (long) OtherLogins.shown(others, typed) else others
    Muted(OtherLogins.HEADING)
    if (long) OutlinedTextField(typed, onTyped, label = { Text(OtherLogins.SEARCH) }, singleLine = true,
        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
    if (rows.isEmpty()) Muted(OtherLogins.NO_MATCH)
    else Column(
        Modifier.fillMaxWidth().then(if (long) Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState()) else Modifier),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        rows.forEach { e ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(1.dp, p.line, RoundedCornerShape(10.dp)).clickable(onClickLabel = OtherLogins.USE) { onPick(e) }.padding(horizontal = 12.dp, vertical = 8.dp)) {
                Text(OtherLogins.label(e), color = p.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (e.site.isNotBlank()) Text(e.site, color = p.muted, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/**
 * The second question, in the card's place: only its button sends the answer, Back returns to the card. The button
 * takes a tap only after a moment, so that a second tap on a row of the list, which stood where it now is, answers nothing.
 */
@Composable
private fun OtherLoginConfirm(c: OtherLogins.Confirm, onBack: () -> Unit, onYes: () -> Unit) {
    val p = LocalPaper.current
    var armed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(OtherLogins.CONFIRM_AFTER_MS); armed = true }
    Muted(c.lead)
    Text(c.login, color = p.text, style = MaterialTheme.typography.titleMedium)
    Muted(c.savedFor)
    Muted(c.on)
    Text(c.host, color = p.text, style = MaterialTheme.typography.titleMedium)
    Warning(c.warning)
    Buttons(c.yes, onYes, OtherLogins.BACK, onBack, enabled = armed)
}

@Composable
private fun CardRequest(r: LoginRequest, who: Named, onAllow: () -> Unit, onDecline: () -> Unit) {
    val card = r.card?.let { "${it.name}${it.last4?.let { l -> " ••$l" } ?: ""}" } ?: "a saved card"
    Card(who, "Pay on ${r.site}") {
        Muted("With $card${if (r.amount.isNotBlank()) ", ${r.amount}" else ""}.")
        if (r.reason.isNotBlank()) Muted("“${r.reason}”")
        Muted("Your OK covers this task, this card and this site for 15 minutes. The bot never sees the card number.")
        Buttons("Allow", onAllow, "Decline", onDecline)
    }
}

@Composable
private fun JobApproval(who: Named?, j: Job, then: String?, onAlways: () -> Unit, onApprove: () -> Unit, onDecline: () -> Unit) {
    val card = jobCard(j)
    val script = card.script != null
    Card(who, card.title, card.meta, expandable = true) {
        val open = LocalCardOpen.current
        // The change in its proposer's sentence: closed, it stands for what goes and what comes.
        if (card.summary != null) {
            Text(card.summary, color = LocalPaper.current.text, fontSize = 14.sp)
            if (!open) Faint(SEE_FULL_CHANGE)
        }
        if (showsFull(card, open)) {
            // Where the script changes: the approved one and the new one, each under what it is.
            if (card.scriptWas != null) { Faint("Approved script"); Body(card.scriptWas.ifBlank { "(empty)" }, mono = true); if (script) Faint("New script") }
            if (card.script != null) Body(card.script.ifBlank { "(empty)" }, mono = true)
            val asked = { text: String -> if (script) "Then the AI is asked: $text" else text }
            if (card.promptWas != null) WasNow(asked(card.promptWas), card.prompt.takeIf { it.isNotBlank() }?.let(asked).orEmpty())
            else if (card.prompt.isNotBlank() && (open || !script)) Body(asked(card.prompt))
            card.also.forEach { Faint(it) }
        }
        if (j.assessment.isNotBlank() && open) Muted(j.assessment)
        ThenLine(card.line)
        ThenLine(then)
        Buttons(card.yes, onApprove, card.no, onDecline, onAlways = onAlways, connects = j.createsConnection)
    }
}

/** A faint label above a box: which of two scripts it is. */
@Composable
private fun Faint(text: String) = Text(text, color = LocalPaper.current.faint, fontSize = 12.5.sp)

/** A text that changes, in one box: what goes, struck, above what comes (as a changed text of a bot change is drawn). */
@Composable
private fun WasNow(was: String, now: String) {
    val p = LocalPaper.current
    val open = LocalCardOpen.current
    Column(Modifier.fillMaxWidth().background(p.sunk, RoundedCornerShape(10.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(was, color = p.muted, fontSize = 13.sp, textDecoration = TextDecoration.LineThrough, maxLines = if (open) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)
        if (now.isNotEmpty()) Text(now, color = p.text, fontSize = 13.sp, maxLines = if (open) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
    }
}

/** A tile of the Board whose script, or a change to it, waits for your OK: the scripts, in full when opened. */
@Composable
private fun TileApproval(who: Named?, t: Tile, then: String?, onApprove: () -> Unit, onDecline: () -> Unit) {
    val card = tileCard(t)
    Card(who, card.title, card.meta, expandable = true) {
        if (card.scriptsWas.isNotEmpty()) {
            Faint(if (card.scriptsWas.size == 1) "Approved script" else "Approved scripts")
            card.scriptsWas.forEach { Body(it.ifBlank { "(empty)" }, mono = true) }
            if (card.scripts.isNotEmpty()) Faint(if (card.scripts.size == 1) "New script" else "New scripts")
        }
        card.scripts.forEach { Body(it.ifBlank { "(empty)" }, mono = true) }
        ThenLine(card.line)
        ThenLine(then)
        Buttons(card.yes, onApprove, card.no, onDecline)
    }
}

/**
 * A memory change that waits: its words are [memoryCard]'s, the botdot server's where it writes them. A change is one
 * block, what goes above what comes, so that a closed card shows the start of both.
 */
@Composable
private fun MemoryApproval(card: MemoryCard, who: Named?, onAlways: () -> Unit, onApprove: () -> Unit, onDecline: () -> Unit) {
    // "Always allow for this bot" (#280), where the server offers it: it asks first, in the server's words.
    var asking by remember(card) { mutableStateOf(false) }
    if (asking) AlwaysQuestion(card.alwaysAsk ?: "${card.always}?", card.always ?: "") { asking = false; if (it) onAlways() }
    Card(who, card.title, card.meta, expandable = true) {
        if (card.was != null && card.now.isNotEmpty() && card.oneBlock) WasNow(card.was, card.now)
        else {
            if (card.was != null) Body(card.was)
            if (card.now.isNotEmpty()) Body(card.now)
        }
        Buttons(card.yes, onApprove, card.no, onDecline, onAlways = card.always?.let { { asking = true } }, alwaysLabel = card.always ?: "Always approve")
    }
}

/** The question before a second yes that lasts (#280): [text] in the server's words, answered with [label] or Cancel. */
@Composable
private fun AlwaysQuestion(text: String, label: String, done: (Boolean) -> Unit) = AlertDialog(
    onDismissRequest = { done(false) },
    text = { Text(text) },
    confirmButton = { TextButton(onClick = { done(true) }) { Text(label, color = LocalPaper.current.text) } },
    dismissButton = { TextButton(onClick = { done(false) }) { Text("Cancel", color = LocalPaper.current.text) } },
)

/** A warning, set apart in amber: that of a tool from a link, and that of a login used on another website; the app puts the sign in front. Closed, it keeps two lines in sight. */
@Composable
private fun Warning(text: String) {
    val p = LocalPaper.current
    Text("⚠️ $text", color = p.text, fontSize = 13.sp, maxLines = if (LocalCardOpen.current) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth().background(p.sunk, RoundedCornerShape(10.dp)).border(1.dp, p.warnLine, RoundedCornerShape(10.dp)).padding(10.dp))
}

/**
 * The two columns of a tool's facts in a box [width] wide: the labels' is as wide as the [widestLabel], at most
 * 40% of the box; the values' is what is left after the [gap]. Together they never exceed the box.
 */
internal fun factColumns(width: Int, widestLabel: Int, gap: Int): Pair<Int, Int> {
    val label = widestLabel.coerceIn(0, (width * 0.4f).toInt().coerceAtLeast(0))
    return label to (width - label - gap).coerceAtLeast(0)
}

/**
 * The facts of a tool's card, as on the web page: rows of a faint label and its value, in two columns. A value takes
 * the width its column has and wraps inside it (an address, a checksum, a file's name), so nothing scrolls sideways.
 * [whole]: every value in full; without it each row keeps to one line, for a closed card.
 */
@Composable
private fun Facts(rows: List<ToolCard.Fact>, whole: Boolean = true) {
    val p = LocalPaper.current
    val lines = if (whole) Int.MAX_VALUE else 1
    Layout(
        content = {
            rows.forEach { f ->
                Text(f.label, color = p.faint, fontSize = 13.sp, maxLines = lines, overflow = TextOverflow.Ellipsis)
                Text(f.value, color = p.text, fontSize = 13.sp, maxLines = lines, overflow = TextOverflow.Ellipsis)
            }
        },
        modifier = Modifier.fillMaxWidth().background(p.sunk, RoundedCornerShape(10.dp)).padding(10.dp),
    ) { measurables, constraints ->
        val gap = 12.dp.roundToPx()
        val between = 2.dp.roundToPx()
        val labels = measurables.filterIndexed { i, _ -> i % 2 == 0 }
        val values = measurables.filterIndexed { i, _ -> i % 2 == 1 }
        val widest = labels.maxOfOrNull { it.maxIntrinsicWidth(constraints.maxHeight) } ?: 0
        // In a card the width is given. Where it is not, the labels and the values are as wide as their text.
        val (labelWidth, valueWidth) = if (constraints.hasBoundedWidth) factColumns(constraints.maxWidth, widest, gap) else widest to Constraints.Infinity
        val label = labels.map { it.measure(Constraints(maxWidth = labelWidth)) }
        val value = values.map { it.measure(Constraints(maxWidth = valueWidth)) }
        val heights = label.indices.map { maxOf(label[it].height, value[it].height) }
        val width = if (constraints.hasBoundedWidth) constraints.maxWidth else labelWidth + gap + (value.maxOfOrNull { it.width } ?: 0)
        layout(constraints.constrainWidth(width), constraints.constrainHeight(heights.sum() + between * (heights.size - 1).coerceAtLeast(0))) {
            var y = 0
            label.indices.forEach { i ->
                label[i].placeRelative(0, y)
                value[i].placeRelative(labelWidth + gap, y)
                y += heights[i] + between
            }
        }
    }
}

/**
 * The parts of a bot change as the card draws them, in the server's order: a changed text by itself, and the parts
 * that are no text together while they follow one another, as the rows of one box.
 */
internal fun partGroups(parts: List<ChangedPart>): List<List<ChangedPart>> {
    val groups = mutableListOf<MutableList<ChangedPart>>()
    for (part in parts) {
        val last = groups.lastOrNull()
        if (part.was == null && last != null && last.last().was == null) last += part else groups += mutableListOf(part)
    }
    return groups
}

/**
 * What a bot change changes, in place of its `details`, in the server's order: what is switched on or added as rows of
 * a label and what it becomes, and each changed text with what goes struck and what comes under it. A text says which
 * one it is when the change has more than one part; alone, the card's title says it.
 */
@Composable
private fun ChangedParts(parts: List<ChangedPart>) {
    val p = LocalPaper.current
    val open = LocalCardOpen.current
    partGroups(parts).forEach { group ->
        val t = group.first()
        if (t.was == null) Facts(group.map { ToolCard.Fact(it.label, it.now) }, whole = open)
        else Column(Modifier.fillMaxWidth().background(p.sunk, RoundedCornerShape(10.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (parts.size > 1) Text(t.label, color = p.faint, fontSize = 12.5.sp)
            if (t.was.isNotEmpty()) Text(t.was, color = p.muted, fontSize = 13.sp, textDecoration = TextDecoration.LineThrough,
                maxLines = if (open) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)
            if (t.now.isNotEmpty()) Text(t.now, color = p.text, fontSize = 13.sp, maxLines = if (open) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * A permission or a skill a bot (or the Chief) asked for, a tool the Chief asks to install for a bot, a changed bot,
 * an action in a connected app, or a switch of a saved login. answer(title, yes, label, always). [chiefChat]: the Chief chat the card stands in,
 * if it stands in one: its line then says "in this chat" for that chat ([dev.botdot.app.data.Then.line]).
 */
@Composable
private fun AskApproval(a: Ask, who: Named?, chiefChat: String? = null, answer: (String, Boolean, String?, Boolean) -> Unit) {
    val decide: (String, Boolean, String?) -> Unit = { title, yes, label -> answer(title, yes, label, false) }
    val then = a.then?.line(chiefChat)
    if (a.kind == "connector-action") {
        // The server's title and the action's fields as rows, drawn as a tool's facts are: every row, and every value
        // in full on an opened card; under the title, whether its run still waits. From a server that sends neither:
        // the line and the text the card has today. Rows that were cut short (the feed's entry) are not all a yes
        // approves: the card then shows `details` under them and offers Decline alone, until the whole rows are there.
        // An action too long to show in full has the rows that fit and one line that says so: it cannot be allowed
        // once, so Decline and "Always allow this action" are left.
        val rows = a.rows
        // "Always allow this action" grants the action with any arguments: it asks first, as on the web page.
        var asking by remember(a.id) { mutableStateOf(false) }
        if (asking) AlertDialog(
            onDismissRequest = { asking = false },
            text = { Text(if (a.chiefsAction) alwaysAllowChief(who?.name ?: "the Chief") else ALWAYS_ALLOW_QUESTION) },
            confirmButton = { TextButton(onClick = { asking = false; answer(a.title, true, "Always allowed", true) }) { Text("Always allow", color = LocalPaper.current.text) } },
            dismissButton = { TextButton(onClick = { asking = false }) { Text("Cancel", color = LocalPaper.current.text) } },
        )
        Card(who, a.title, connectorState(who?.name ?: a.bot?.name?.ifBlank { null } ?: "The bot", a.held, a.stoppedAt) ?: a.reason, expandable = true) {
            if (rows.isNotEmpty()) Facts(rows, whole = LocalCardOpen.current)
            if (connectorDetails(a)) Body(a.details)
            if (connectorTooLong(a)) Text(TOO_LONG, color = LocalPaper.current.muted, fontSize = 12.5.sp)
            ThenLine(then)
            if (connectorAlways(a)) TextButton(onClick = { asking = true }) { Text("Always allow this action") }
            if (connectorOnce(a)) Buttons("Allow once", { decide(a.title, true, "Approved") }, "Decline", { decide(a.title, false, null) })
            else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                OutlinedButton(onClick = { decide(a.title, false, null) }) { Text("Decline", color = LocalPaper.current.text) }
            }
        }
    } else if (a.kind == "chief-action") {
        // What the Chief asked to do after it read the web in a chat: the server's title and line, and what it sent
        // as rows, drawn as an action's are. The yes does exactly that, so a card that cannot show it all offers
        // Decline alone.
        // A request of a type the owner may let through for good (#280) has the server's second yes, `always`, which
        // asks first with the server's `warning`.
        val always = a.always?.takeIf { it.isNotBlank() && a.chiefActionYes }
        var asking by remember(a.id) { mutableStateOf(false) }
        if (asking && always != null) AlwaysQuestion(ToolCard.text(a.warning).ifEmpty { "$always?" }, always) { asking = false; if (it) answer(a.title, true, "Always allowed", true) }
        Card(who, a.title, a.chiefActionLine, expandable = true) {
            if (a.rows.isNotEmpty()) Facts(a.rows, whole = LocalCardOpen.current)
            if (a.tooLong) Text(TOO_LONG, color = LocalPaper.current.muted, fontSize = 12.5.sp)
            ThenLine(then)
            if (a.chiefActionYes) Buttons("Approve", { decide(a.title, true, "Approved") }, "Decline", { decide(a.title, false, null) },
                onAlways = always?.let { { asking = true } }, alwaysLabel = always ?: "Always approve")
            else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                OutlinedButton(onClick = { decide(a.title, false, null) }) { Text("Decline", color = LocalPaper.current.text) }
            }
        }
    } else if (a.kind == "bot-change") {
        val parts = a.parts
        Card(who, a.title, a.reason, expandable = true) {
            if (parts.isNotEmpty()) ChangedParts(parts) else Body(a.details)
            ThenLine(then)
            Buttons(changeYes(a), { decide(a.title, true, "Approved") }, "Decline", { decide(a.title, false, null) })
        }
    } else if (ToolCard.isTool(a)) {
        // The server's own fields, no wording from here: what the tool is and why, the warning of a tool from a
        // link, then the facts. Closed, the card shows the start of the body and of the warning; the facts open with it.
        val t = ToolCard.parts(a)
        Card(who, t.title, t.meta, expandable = true) {
            if (t.body.isNotEmpty()) Body(t.body)
            if (t.warning.isNotEmpty()) Warning(t.warning)
            if (t.facts.isNotEmpty() && LocalCardOpen.current) Facts(t.facts)
            ThenLine(then)
            Buttons(ToolCard.INSTALL, { decide(t.title, true, ToolCard.answered(true)) }, ToolCard.DECLINE, { decide(t.title, false, ToolCard.answered(false)) })
        }
    } else if (a.kind == "vault-switch" || a.kind == "vault-remove" || a.kind == "vault-file" || a.kind == "override") {
        // A switch of a saved login a bot asks for: the server's title, the bot's reason, the login and the switch as
        // rows, the warning of "Usable in its computer", and the server's word on the yes. As on the web page. A Vault
        // entry a bot asks to remove is drawn the same way: its rows name the entry, the bot and Bitwarden's Trash. So
        // are secrets a bot asks to keep in a file (#253): the secrets, the file, and who can read it there.
        val warning = ToolCard.text(a.warning)
        Card(who, a.title, a.reason, expandable = true) {
            if (a.parts.isNotEmpty()) ChangedParts(a.parts)
            if (warning.isNotEmpty()) Warning(warning)
            ThenLine(then)
            // A rule a bot asks to lift (#253) has the server's second yes, `always`: "Allow always for this bot".
            val always = if (a.kind == "override") a.always?.takeIf { it.isNotBlank() } else null
            Buttons(a.yes ?: "Allow", { decide(a.title, true, "Allowed") }, "Decline", { decide(a.title, false, null) },
                onAlways = always?.let { { answer(a.title, true, "Always allowed", true) } }, alwaysLabel = always ?: "Always approve")
        }
    } else if (a.kind == "permission") {
        val title = "Let it ${a.what?.label ?: a.permission}?"
        Card(who, title, a.reason, expandable = true) {
            Body("${(a.what?.hint ?: "").replaceFirstChar { it.uppercase() }}. It can't until you allow it; you can change this in its settings.")
            ThenLine(then)
            Buttons("Allow", { decide(title, true, "Allowed") }, "Decline", { decide(title, false, null) })
        }
    } else if (a.written) {
        // A skill the bot wrote after it read content from others: the server's line as the title, and the whole
        // text a yes would save, as on the web page. Closed, the card shows its start; opened, all of it.
        val title = skillTitle(a)
        Card(who, title, a.reason, expandable = true) {
            Body(a.skill?.instructions.orEmpty().ifBlank { "(empty)" })
            ThenLine(then)
            Buttons("Approve", { decide(title, true, "Approved") }, "Decline", { decide(title, false, null) })
        }
    } else {
        val k = a.skill ?: AskSkill()
        val title = "Install the skill \"${k.name}\"?"
        val forWhom = if (a.forBots.isNotEmpty()) " · for ${a.forBots.joinToString(", ") { it.name }}" else ""
        Card(who, title, a.url.removePrefix("https://").removePrefix("www.") + forWhom, expandable = true) {
            Body(k.description.ifBlank { "No description." } + (if (k.files > 1) " (${k.files} files)" else "") + (if (k.exists) " It replaces your skill of the same name." else "") + (if (a.reason.isNotBlank()) "\n\nWhy: ${a.reason}" else ""))
            ThenLine(then)
            Buttons("Install", { decide(title, true, "Installed") }, "Decline", { decide(title, false, null) })
        }
    }
}

// ---------- schedules in words ----------

/** A job's schedule as every screen shows it: the server's words (`when`, docs/api.md), or the app's own for a server that sends none. */
fun scheduleWords(j: Job): String = j.words?.takeIf { it.isNotBlank() } ?: describeCron(j.cron)

private const val CUSTOM = "Custom schedule"
// What parts the fields on the server: JavaScript's white space, which is neither Kotlin's trim() nor every regex engine's \s.
private val SPACES = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
private val DAYS = listOf("Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays")
private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
private val MONTH_DAYS = listOf(31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31) // February in a leap year

/** A field that is one number of `range`, "07" too: null for anything else. */
private fun number(field: String, range: IntRange): Int? =
    field.takeIf { f -> f.all { it in '0'..'9' } }?.toIntOrNull()?.takeIf { it in range }

// The step of a field that is every step-th value ("*/15"), when the steps divide `whole` evenly: null otherwise.
private fun stepOf(field: String, whole: Int): Int? =
    field.takeIf { it.startsWith("*/") }?.let { number(it.drop(2), 2..whole / 2) }?.takeIf { whole % it == 0 }

private fun two(n: Int) = n.toString().padStart(2, '0')

/**
 * The app's own words for a schedule, for a server that sends no `when`: "0 9 * * *" -> "Daily at 09:00". It knows the
 * common shapes and says each as the server does (test/fixtures/cron-words.json, which ScheduleWordsTest holds it to).
 * Any other schedule is "Custom schedule", and text that is not five fields "Invalid schedule": never the expression.
 */
fun describeCron(cron: String): String {
    val f = cron.split(SPACES).filter { it.isNotEmpty() }
    if (f.size != 5) return "Invalid schedule"
    val (min, hour, dom, mon, dow) = f
    val everyDay = dom == "*" && mon == "*" && dow == "*"
    if (everyDay && hour == "*") stepOf(min, 60)?.let { return "Every $it min" }
    val m = number(min, 0..59) ?: return CUSTOM
    val atMinute = if (m == 0) "" else ", at minute $m"
    if (everyDay && hour == "*") return "Hourly$atMinute"
    if (everyDay) stepOf(hour, 24)?.let { return "Every $it hours$atMinute" }
    val h = number(hour, 0..23) ?: return CUSTOM
    val at = "at ${two(h)}:${two(m)}"
    val day = number(dom, 1..31)
    val month = number(mon, 1..12)
    val weekday = number(dow, 0..7) // 0 and 7 are Sunday
    return when {
        everyDay -> if (h == 2 && m == 0) "Nightly at 02:00" else "Daily $at"
        dom == "*" && mon == "*" && dow == "1-5" -> "Weekdays $at"
        dom == "*" && mon == "*" && dow == "0,6" -> "Weekends $at"
        dom == "*" && mon == "*" && weekday != null -> "${DAYS[weekday % 7]} $at"
        day != null && mon == "*" && dow == "*" -> "Monthly on day $day $at"
        // One day of the year: how a one-time job is kept ("28 Sep at 07:00"). A day no year has never comes.
        day != null && month != null && dow == "*" -> if (day > MONTH_DAYS[month - 1]) "Never runs" else "$day ${MONTHS[month - 1]} $at"
        else -> CUSTOM
    }
}
