package dev.botdot.app.ui

import dev.botdot.app.data.connectorLine
import dev.botdot.app.data.jobKey
import dev.botdot.app.data.tileKey
import dev.botdot.app.data.jobsLeft
import dev.botdot.app.data.tilesLeft
import dev.botdot.app.data.answeredLabel
import dev.botdot.app.data.answeredWord
import dev.botdot.app.data.ALWAYS_ALLOW_QUESTION
import dev.botdot.app.data.alwaysAllowChief
import dev.botdot.app.data.approveAll
import dev.botdot.app.data.SEE_FULL_CHANGE
import dev.botdot.app.data.showsFull
import dev.botdot.app.data.jobCard
import dev.botdot.app.data.tileCard
import dev.botdot.app.data.connectorTooLong
import dev.botdot.app.data.TOO_LONG
import dev.botdot.app.data.connectorAlways
import dev.botdot.app.data.connectorOnce
import dev.botdot.app.data.connectorDetails
import dev.botdot.app.data.skillTitle
import dev.botdot.app.data.changeYes
import dev.botdot.app.data.busyWord
import dev.botdot.app.data.partGroups
import dev.botdot.app.data.batchOwnLine
import dev.botdot.app.data.askTitle
import dev.botdot.app.data.NeedsLeave
import dev.botdot.app.data.PLAN_APPROVAL
import dev.botdot.app.data.scriptWarningText
import dev.botdot.app.data.without
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
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.botdot.app.BotDotApp
import dev.botdot.app.data.Answered
import dev.botdot.app.data.Api
import dev.botdot.app.data.Ask
import dev.botdot.app.data.EveryBot
import dev.botdot.app.data.SecretWords
import dev.botdot.app.data.AskCard
import dev.botdot.app.data.askCards
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
import dev.botdot.app.data.AskAct
import dev.botdot.app.data.actLabel
import dev.botdot.app.data.asksBeforeNow
import dev.botdot.app.data.updateButtons
import dev.botdot.app.data.VaultTypes
import dev.botdot.app.data.tr
import dev.botdot.app.data.trn
import kotlinx.coroutines.CoroutineScope
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
    Secure()

    // After you answered something, or pulled to refresh: all of it again, at once.
    suspend fun load() = coroutineScope { listOf(store.needs, store.bots, store.chief, store.dashboard).forEach { launch { it.refresh() } } }
    LaunchedEffect(needsError) { needsError?.let { tell(it) } }
    var fresh by remember { mutableStateOf(false) } // the lists were read from the server since the screen opened
    LaunchedEffect(unlocking) { if (!unlocking) { load(); fresh = true } }
    fun act(done: String, block: suspend () -> Unit) = scope.launch {
        val r = runCatching { block() }
        load()
        answered()
        tell(r.fold({ done }, { it.message ?: tr("That didn't work") }))
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
    // Why a card's answer did not go (#1071), by its key: in the card itself, until the next Approve or Decline on it.
    var failures by remember { mutableStateOf(mapOf<String, String>()) }
    suspend fun answer(key: String, who: Named?, title: String, yes: Boolean, label: String? = null, ask: Ask? = null, block: suspend () -> Answered?) {
        failures = failures - key
        runCatching { block() }
            .onSuccess { said ->
                val d = Decided(key, who, title, answeredLabel(answeredWord(label, said, yes), said?.carriesOn.takeIf { yes }))
                decided = decided + d
                ask?.let { store.answeredAway.add(it, d.title, d.label) } // the chat the card stood in says what you answered
            }
            .onError { failures = failures + (key to (it.message ?: tr("That didn't work"))) }
    }
    fun decide(key: String, who: Named?, title: String, yes: Boolean, label: String? = null, ask: Ask? = null, block: suspend () -> Answered?) = scope.launch {
        answer(key, who, title, yes, label, ask, block)
        load()
        answered()
    }
    val jobWho = { b: Bot, j: Job -> inGroup(b.named(), cardGroups[CardGroups.jobKey(b.id, j.id)]) }
    val chiefWho = chiefNamed()
    val askWho = { a: Ask -> inGroup(a.bot?.let { whoOf(it.id, it.name) } ?: chiefWho, a.group) }
    val memWho = { m: MemoryChange -> inGroup(whoOf(m.botId, bots.firstOrNull { it.id == m.botId }?.name ?: m.bot?.name ?: tr("A bot")), m.group) }
    // What one tap may approve: what a card shows in words. A script is answered on its own card.
    val all = approveAll(
        jobsLeft(waitingJobs, decided.map { it.key }),
        memory.filter { m -> decided.none { it.key == "m:${m.id}" } },
        tilesLeft(tiles, decided.map { it.key }),
    )
    // "Always approve" a job: approve it and trust its later changes. Scripts only after the warning.
    var scriptWarning by remember { mutableStateOf<Pair<Bot, Job>?>(null) }
    fun alwaysJob(b: Bot, j: Job) = decide(jobKey(b, j), jobWho(b, j), jobCard(j).title, true, tr("Always approved")) { api!!.approveJob(b.id, j.id, true, always = true) }
    scriptWarning?.let { (b, j) ->
        AlertDialog(
            onDismissRequest = { scriptWarning = null },
            title = { Text(tr("Always approve \"{name}\"?", "name" to j.name)) },
            text = { Text(scriptWarningText(b.name)) },
            confirmButton = { TextButton(onClick = { scriptWarning = null; alwaysJob(b, j) }) { Text(tr("Always approve"), color = p.err) } },
            dismissButton = { TextButton(onClick = { scriptWarning = null }) { Text(tr("Cancel"), color = p.text) } },
        )
    }

    Scaffold(
        containerColor = p.bg,
        snackbarHost = { BotSnackbarHost(snack) },
        topBar = {
            TopAppBar(navigationIcon = { BackButton(onBack) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = p.bg),
                title = { Text(tr("Needs you"), style = MaterialTheme.typography.titleMedium) },
                actions = {
                    // AI jobs and memory changes need only a yes; a script, logins, payments and Bitwarden need you to look.
                    all.label?.let { label ->
                        // Every answer at once, then the lists once (#1112): not a read of four lists after each.
                        Button(onClick = {
                            scope.launch {
                                coroutineScope {
                                    all.jobs.forEach { (b, j) -> launch { answer(jobKey(b, j), jobWho(b, j), jobCard(j).title, true) { api!!.approveJob(b.id, j.id, true) } } }
                                    all.memory.forEach { m -> launch { answer("m:${m.id}", memWho(m), memoryCard(m, features).title, true) { api!!.settleMemoryChange(m.id, true) } } }
                                }
                                load()
                                answered()
                            }
                        }, colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText), modifier = Modifier.padding(end = Space.s8)) { Text(label) }
                    }
                })
        },
    ) { pad ->
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, modifier = Modifier.padding(pad).fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(Space.s16), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
                if (loaded && requests.isEmpty() && !locked && waitingJobs.isEmpty() && memory.isEmpty() && plans.isEmpty() && asks.isEmpty() && tiles.isEmpty()) item {
                    Text(tr("All done."), color = p.muted, modifier = Modifier.padding(Space.s12))
                }
                // What the button above leaves for its own card, in one line.
                all.line?.let { line -> item(key = "left") { Text(line, color = p.muted, fontSize = Type.s12, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth()) } }
                if (locked) item {
                    if (unlocking) Busy(tr("Unlocking Password Manager…"))
                    else BitwardenCard(bw, bw.wantedBy?.let { w -> whoOf(w.id, w.name) }, unlockError) { pw -> api?.let { app.unlockBitwarden(it, pw) } }
                }
                items(requests, key = { "r:${it.id}" }) { r -> Moves {
                    val who = inGroup(if (r.bot == null && r.from == "chief") chiefNamed() else whoOf(r.bot?.id, r.bot?.name ?: tr("A bot")), r.group)
                    if (r.kind == "card") CardRequest(r, who,
                        onAllow = { act(tr("Allowed for this task")) { api!!.answerRequest(r.id, buildJsonObject { put("action", "approve") }) } },
                        onDecline = { act(tr("Declined")) { api!!.answerRequest(r.id, buildJsonObject { put("action", "decline") }) } })
                    else if (r.id in saving) Busy(tr("Saving login…"))
                    else LoginRequestCard(r, who, bitwardenLocked = locked, features = features,
                        type = chosenType[r.id] ?: VaultTypes.of(r.type).id, onType = { chosenType[r.id] = it },
                        user = typedUser[r.id] ?: r.username, onUser = { typedUser[r.id] = it },
                        onUse = { loginId -> act(tr("{name} can use it now", "name" to (r.bot?.name ?: tr("The bot")))) { api!!.answerRequest(r.id, buildJsonObject { put("action", "allow"); put("loginId", loginId) }) } },
                        // A login of another website, after the second question. A refusal (the login has 20
                        // additional hosts already) is the server's sentence, told like every other error; the request stays.
                        // The card waits for the answer (answered), so that it is asked once.
                        onUseOther = { loginId, answered -> act(tr("{name} can use it on {site} now", "name" to (r.bot?.name ?: tr("The bot")), "site" to r.site)) { api!!.answerRequest(r.id, buildJsonObject { put("action", "allow"); put("loginId", loginId) }) }.invokeOnCompletion { answered() } },
                        onSave = { sent, pw, master ->
                            api?.let { a ->
                                app.saveLogin(a, r.id, VaultTypes.requestSave(sent, pw, master), r.bot?.name ?: tr("The bot"))
                            }
                        },
                        onDecline = { act(tr("Declined")) { api!!.answerRequest(r.id, buildJsonObject { put("action", "decline") }) } })
                } }
                items(jobsLeft(waitingJobs, decided.map { it.key }), key = { (b, j) -> jobKey(b, j) }) { (b, j) -> Moves { Failing(failures[jobKey(b, j)]) {
                    JobApproval(jobWho(b, j), j,
                        onAlways = { if (j.touchesScript) scriptWarning = b to j else alwaysJob(b, j) },
                        onApprove = { decide(jobKey(b, j), jobWho(b, j), jobCard(j).title, true) { api!!.approveJob(b.id, j.id, true) } },
                        onDecline = { decide(jobKey(b, j), jobWho(b, j), jobCard(j).title, false) { api!!.approveJob(b.id, j.id, false) } })
                } } }
                items(memory.filter { m -> decided.none { it.key == "m:${m.id}" } }, key = { "m:${it.id}" }) { m -> Moves { Failing(failures["m:${m.id}"]) {
                    val card = memoryCard(m, features)
                    MemoryApproval(card, memWho(m),
                        onApprove = { decide("m:${m.id}", memWho(m), card.title, true) { api!!.settleMemoryChange(m.id, true) } },
                        onDecline = { decide("m:${m.id}", memWho(m), card.title, false) { api!!.settleMemoryChange(m.id, false) } })
                } } }
                // A tile of the Board with a script, or a change to one: it runs on your botdot, so it waits for you.
                items(tilesLeft(tiles, decided.map { it.key }), key = { tileKey(it) }) { t -> Moves { Failing(failures[tileKey(t)]) {
                    val b = bots.firstOrNull { it.id == t.bot }
                    val who = inGroup(b?.named() ?: chiefNamed(), cardGroups[CardGroups.tileKey(t.id)])
                    TileApproval(who, t,
                        onApprove = { decide(tileKey(t), who, tileCard(t).title, true) { api!!.approveTile(t.id, true) } },
                        onDecline = { decide(tileKey(t), who, tileCard(t).title, false) { api!!.approveTile(t.id, false) } })
                } } }
                // A permission or a skill a bot (or the Chief) asked for, and a tool the Chief asks to install for a bot.
                // What one run waits on is one card (#277): Allow all and Decline all above each ask's own card.
                items(askCards(asks.filter { a -> decided.none { it.key == "a:${a.id}" } }), key = { it.key }) { card -> Moves {
                    when (card) {
                        is AskCard.One -> {
                            val a = card.ask
                            val who = askWho(a)
                            Failing(failures["a:${a.id}"]) { AskApproval(a, who, reveal = { api!!.askSecret(a.id) }) { title, yes, label, always, all -> decide("a:${a.id}", who, title, yes, label, ask = a) { api!!.answerAsk(a.id, yes, always, all) } } }
                        }
                        is AskCard.Several -> AskBatchCard(card, askWho(card.asks.first()), failures[card.key],
                            onAll = { yes ->
                                failures = failures - card.key
                                answerAll(scope, api!!, card, yes, { failures = failures + (card.key to it) }, after = { load(); answered() }) { a, label ->
                                    val done = Decided("a:${a.id}", askWho(a), askTitle(a), label)
                                    decided = decided + done
                                    store.answeredAway.add(a, done.title, done.label)
                                }
                            }) { a ->
                            val who = askWho(a)
                            Failing(failures["a:${a.id}"]) { AskApproval(a, who, reveal = { api!!.askSecret(a.id) }) { title, yes, label, always, all -> decide("a:${a.id}", who, title, yes, label, ask = a) { api!!.answerAsk(a.id, yes, always, all) } } }
                        }
                    }
                } }
                // A bot's plan for the Chief: nothing happens until you approve it, here or in its chat.
                items(plans.filter { c -> decided.none { it.key == "p:${c.id}" } }, key = { "p:${it.id}" }) { c -> Moves { Failing(failures["p:${c.id}"]) {
                    val from = c.waiting!!.from
                    val who = whoOf(from.id, from.name)
                    val title = tr("A plan for the Chief: {title}", "title" to c.title)
                    Card(who, title, expandable = true) {
                        Body(c.waiting!!.text.replace("**", "").replace(Regex("""(?m)^\s*[-*#]+\s+"""), ""))
                        Text(tr("Open chat"), color = p.muted, fontSize = Type.s14, modifier = Modifier.clip(Radius.small).clickable { onChat(c.id) }.padding(Space.s8))
                        Buttons(tr("Approve"), { decide("p:${c.id}", who, title, true, tr("Approved · the Chief is on it")) { api!!.sendToChief(c.id, PLAN_APPROVAL, emptyList()); null } },
                            tr("Decline"), { decide("p:${c.id}", who, title, false) { api!!.dismissSuggestion(c.id); null } })
                    }
                } } }
                items(decided, key = { "d:${it.key}" }) { d -> Moves {
                    Card(d.who, d.title, done = true) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { Muted(d.label) } }
                } }
            }
        }
    }
}

// ---------- in the chat ----------

/** The cards a message names (`cards`, ADR 252), drawn right under it while they wait; [scope] is its chat's. */
@Composable
fun NamedCards(app: BotDotApp, scope: String, ids: List<String>?) {
    val set = ids.orEmpty().filter { NAMED_CARD.matches(it) }.toSet()
    if (set.isNotEmpty()) Box(Modifier.fillMaxWidth().padding(top = Space.s8)) { ChatNeeds(app, scope, only = set) }
}

/**
 * Which cards each message of a chat shows, by its key: a card named by several messages stands under the newest
 * alone, as on the web page (ADR 252). [named]: each message's key and `cards`, oldest first.
 */
fun newestNames(named: List<Pair<String, List<String>?>>): Map<String, List<String>> {
    val seen = mutableSetOf<String>()
    return named.asReversed().associate { (k, ids) -> k to ids.orEmpty().filter { NAMED_CARD.matches(it) && seen.add(it) } }
}

/** The ids of the cards that the messages of a chat name: at its end these cards are left out, as they stand under their message. */
fun namedCards(lists: List<List<String>?>): Set<String> = lists.flatMap { it.orEmpty() }.filter { NAMED_CARD.matches(it) }.toSet()

private val NAMED_CARD = Regex("^[0-9a-fA-F]{8}$")

/**
 * What waits for your OK, at the bottom of the chat it belongs to: in a bot's chat, the jobs it set up,
 * the permissions and skills it asked for, its memory changes and its logins; in the Chief's
 * (scope "chief"), the jobs the Chief set up, the skills and logins it asked for. A tool to install is in both:
 * the Chief asked for it, and it is installed for that bot; so is a bot change the Chief asked for. A login and a
 * payment are answered in their card here, as on Needs you, and a locked Bitwarden in the chat of the bot that
 * waits for it (#1186).
 * In a group's chat (scope "group:<id>"): the cards asked in that group, each with its bot's name. Such a card
 * stands in no bot's own chat and not in the Chief's ([chatCards]).
 */
@Composable
fun ChatNeeds(app: BotDotApp, scope: String, only: Set<String>? = null, except: Set<String> = emptySet()) {
    val p = LocalPaper.current
    val api by app.api.collectAsState()
    val cs = rememberCoroutineScope()
    // What waits, as the app keeps it (Store), kept up to date from the live feed.
    val store = app.store
    val needsNow by store.needs.value.collectAsState()
    val botsNow by store.bots.value.collectAsState()
    val dashNow by store.dashboard.value.collectAsState()
    val cardGroups by store.cardGroups.value.collectAsState() // the group a waiting job or tile was asked in
    val server by store.version.value.collectAsState() // its features: whether it writes a memory card's words
    val features = server?.features
    val requests = needsNow?.requests.orEmpty()
    val bots = botsNow.orEmpty()
    val memory = needsNow?.memory.orEmpty()
    val asks = needsNow?.asks.orEmpty()
    val tiles = dashNow?.waiting.orEmpty()
    val suggestions = dashNow?.suggestions.orEmpty()
    val bw = needsNow?.bitwarden
    val unlocking by app.bwUnlocking.collectAsState()
    val unlockError by app.bwUnlockError.collectAsState()
    val saving by app.savingLogins.collectAsState()
    // What the owner chose and typed on a login's card, by request, so that a save that failed brings it back.
    val chosenType = remember { mutableStateMapOf<String, String>() }
    val typedUser = remember { mutableStateMapOf<String, String>() }
    var error by remember { mutableStateOf<String?>(null) }
    // Decided here: a faded line each, until you leave the chat.
    var decided by remember(scope) { mutableStateOf(listOf<Decided>()) }
    // And what was answered on the Needs you screen for this chat: the same line, taken once (AnsweredAway).
    val answeredAway by store.answeredAway.value.collectAsState()
    LaunchedEffect(scope, answeredAway) {
        if (only != null) return@LaunchedEffect // what was answered on Needs you is said at the end of the chat
        val mine = store.answeredAway.take(scope).filter { a -> decided.none { it.key == a.key } }
        if (mine.isNotEmpty()) decided = decided + mine.map { Decided(it.key, null, it.title, it.label) }
    }

    suspend fun load() = coroutineScope { listOf(store.needs, store.bots, store.dashboard).forEach { launch { it.refresh() } } }
    // [block] sends the answer and returns what the server says of it, if anything: the label says it too.
    fun decide(key: String, title: String, yes: Boolean, label: String? = null, block: suspend () -> Answered?) = cs.launch {
        runCatching { block() }
            .onSuccess { said -> decided = decided + Decided(key, null, title, answeredLabel(answeredWord(label, said, yes), said?.carriesOn.takeIf { yes })); error = null }
            .onError { error = it.message ?: tr("That didn't work") }
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
    val jobs = if (only != null) emptyList() else jobsLeft(bots.flatMap { b -> b.jobs.filter { it.waits }.map { b to it } }
        .filter { (b, j) -> here(cardGroups[CardGroups.jobKey(b.id, j.id)]) && (group != null || if (chief) j.askedBy == "chief" else b.id == scope && j.askedBy != "chief") }, decided.map { it.key })
    val mems = if (chief || only != null) emptyList() else memory.filter { here(it.group) && (group != null || it.botId == scope) && decided.none { d -> d.key == "m:${it.id}" } }
    // Under a message that names cards (`only`, ADR 252): those cards alone, wherever they stand. At the end of the
    // chat: none of the cards a message of it names (`except`), which stand under that message.
    val myAsks = asks.filter { a -> (if (only != null) a.id in only else a.standsInChat(scope) && a.id !in except) && decided.none { it.key == "a:${a.id}" } }
    val reqs = requests.filter { r -> (if (only != null) r.id in only else here(r.group) && (group != null || if (chief) r.from == "chief" else r.bot?.id == scope && r.from != "chief") && r.id !in except) && decided.none { it.key == "r:${r.id}" } }
    // A locked Bitwarden stands in the chat of the bot that waits for it, where it is unlocked.
    val locked = bw?.configured == true && bw.unlocked == false
    val bwHere = locked && only == null && !chief && group == null && bw?.wantedBy?.id == scope
    // A login's or a payment's answer, said in a faded line as the other cards' are.
    fun answerRequest(r: LoginRequest, done: String, block: suspend () -> Unit) = cs.launch {
        runCatching { block() }
            .onSuccess { decided = decided + Decided("r:${r.id}", null, if (r.kind == "card") tr("Pay on {site}", "site" to r.site) else tr("A login for {site}", "site" to r.site), done); error = null }
            .onError { error = it.message ?: tr("That didn't work") }
        load()
        answered()
    }
    val mySuggestions = if (only != null || chief || group != null) emptyList() else suggestions.filter { x -> x.bot == scope && decided.none { it.key == "s:${x.id}" } }
    val myTiles = if (only != null) emptyList() else tilesLeft(tiles.filter { t -> here(cardGroups[CardGroups.tileKey(t.id)]) && (group != null || if (chief) t.askedBy != "bot" else t.bot == scope && t.askedBy == "bot") }, decided.map { it.key })
    var scriptWarning by remember { mutableStateOf<Pair<Bot, Job>?>(null) }
    fun alwaysJob(b: Bot, j: Job) = decide(jobKey(b, j), jobCard(j).title, true, tr("Always approved")) { api!!.approveJob(b.id, j.id, true, always = true) }
    scriptWarning?.let { (b, j) ->
        AlertDialog(
            onDismissRequest = { scriptWarning = null },
            title = { Text(tr("Always approve \"{name}\"?", "name" to j.name)) },
            text = { Text(scriptWarningText(b.name)) },
            confirmButton = { TextButton(onClick = { scriptWarning = null; alwaysJob(b, j) }) { Text(tr("Always approve"), color = p.err) } },
            dismissButton = { TextButton(onClick = { scriptWarning = null }) { Text(tr("Cancel"), color = p.text) } },
        )
    }
    if (decided.isEmpty() && jobs.isEmpty() && mems.isEmpty() && myAsks.isEmpty() && reqs.isEmpty() && !bwHere && myTiles.isEmpty() && mySuggestions.isEmpty()) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s12)) {
        decided.forEach { Text("${it.title} · ${it.label}", color = p.muted, fontSize = Type.s12) }
        if (error != null) Text(error!!, color = p.err, fontSize = Type.s12)
        // A login, a payment and a locked Bitwarden are answered in their card here, as on Needs you: the password
        // is typed in the chat, which is kept out of screenshots while one of them stands in it.
        if (bwHere || reqs.any { it.kind != "card" }) Secure()
        if (bwHere && bw != null) {
            if (unlocking) Busy(tr("Unlocking Password Manager…"))
            else BitwardenCard(bw, null, unlockError) { pw -> api?.let { app.unlockBitwarden(it, pw) } }
        }
        reqs.forEach { r ->
            val shown = chief || group != null
            val who = if (r.bot == null && r.from == "chief") chiefNamed() else named(bots.firstOrNull { it.id == r.bot?.id }, r.bot?.name ?: tr("A bot"), null)
            val botName = r.bot?.name ?: tr("The bot")
            if (r.kind == "card") CardRequest(r, who.takeIf { shown },
                onAllow = { answerRequest(r, tr("Allowed for this task")) { api!!.answerRequest(r.id, buildJsonObject { put("action", "approve") }) } },
                onDecline = { answerRequest(r, tr("Declined")) { api!!.answerRequest(r.id, buildJsonObject { put("action", "decline") }) } })
            else if (r.id in saving) Busy(tr("Saving login…"))
            else LoginRequestCard(r, who, named = shown, bitwardenLocked = locked, features = features,
                type = chosenType[r.id] ?: VaultTypes.of(r.type).id, onType = { chosenType[r.id] = it },
                user = typedUser[r.id] ?: r.username, onUser = { typedUser[r.id] = it },
                onUse = { loginId -> answerRequest(r, tr("{name} can use it now", "name" to botName)) { api!!.answerRequest(r.id, buildJsonObject { put("action", "allow"); put("loginId", loginId) }) } },
                onUseOther = { loginId, answeredIt -> answerRequest(r, tr("{name} can use it on {site} now", "name" to botName, "site" to r.site)) { api!!.answerRequest(r.id, buildJsonObject { put("action", "allow"); put("loginId", loginId) }) }.invokeOnCompletion { answeredIt() } },
                onSave = { sent, pw, master -> api?.let { a -> app.saveLogin(a, r.id, VaultTypes.requestSave(sent, pw, master), botName) } },
                onDecline = { answerRequest(r, tr("Declined")) { api!!.answerRequest(r.id, buildJsonObject { put("action", "decline") }) } })
        }
        jobs.forEach { (b, j) ->
            JobApproval(whoOf(b), j,
                onAlways = { if (j.touchesScript) scriptWarning = b to j else alwaysJob(b, j) },
                onApprove = { decide(jobKey(b, j), jobCard(j).title, true) { api!!.approveJob(b.id, j.id, true) } },
                onDecline = { decide(jobKey(b, j), jobCard(j).title, false) { api!!.approveJob(b.id, j.id, false) } })
        }
        mems.forEach { m ->
            val card = memoryCard(m, features)
            MemoryApproval(card, if (group != null) whoOf(bots.firstOrNull { it.id == m.botId }) else null,
                onApprove = { decide("m:${m.id}", card.title, true) { api!!.settleMemoryChange(m.id, true) } },
                onDecline = { decide("m:${m.id}", card.title, false) { api!!.settleMemoryChange(m.id, false) } })
        }
        // In the Chief's chat the card of a tool, and of a changed bot, says which bot it is for, as it looks now.
        val askWho = { a: Ask -> if (chief || group != null) a.bot?.let { named(bots.firstOrNull { b -> b.id == it.id }, it.name, it.color) } else null }
        val oneAsk: @Composable (Ask) -> Unit = { a ->
            AskApproval(a, askWho(a), reveal = { api!!.askSecret(a.id) }) { title, yes, label, always, all -> decide("a:${a.id}", title, yes, label) { api!!.answerAsk(a.id, yes, always, all) } }
        }
        // What one run waits on is one card here too (#277).
        askCards(myAsks).forEach { card ->
            when (card) {
                is AskCard.One -> oneAsk(card.ask)
                is AskCard.Several -> AskBatchCard(card, askWho(card.asks.first()), failed = null,
                    onAll = { yes ->
                        answerAll(cs, api!!, card, yes, { error = it }, after = { load(); answered() }) { a, label ->
                            decided = decided + Decided("a:${a.id}", null, askTitle(a), label)
                            error = null
                        }
                    }, each = oneAsk)
            }
        }
        // A tile this bot suggested for the Board.
        mySuggestions.forEach { x ->
            Card(null, tr("Put “{title}” on your Board?", "title" to x.tile.title), x.reason, expandable = x.tile.scripts.isNotEmpty()) {
                x.tile.scripts.forEach { Body(it, mono = true) }
                Buttons(tr("Add"), { decide("s:${x.id}", x.tile.title, true, tr("On your Board")) { api!!.answerSuggestion(x.id, true) } },
                    tr("No"), { decide("s:${x.id}", x.tile.title, false, tr("Not added")) { api!!.answerSuggestion(x.id, false) } })
            }
        }
        myTiles.forEach { t ->
            TileApproval(whoOf(bots.firstOrNull { it.id == t.bot }), t,
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
 * The line under the title of an action in a connected app ([connectorLine]), with the app's short [time]: that [bot]
 * waits for the answer inside its run, or when it stopped waiting. null when the server says neither.
 */
internal fun connectorState(bot: String, held: Boolean?, stoppedAt: String?, time: (String) -> String = ::shortTime): String? = connectorLine(bot, held, stoppedAt, time)

/** Whether the card around it is open: closed, cards show a few lines of each text (like the web page). */
private val LocalCardOpen = staticCompositionLocalOf { true }

/** Why the answer on the card drawn inside did not go (#1071): the card says it under its buttons. Null: nothing. */
private val LocalCardFailure = compositionLocalOf<String?> { null }

/** [content]'s card says [failed], read out when it comes. Cards drawn inside it ask for their own. */
@Composable
private fun Failing(failed: String?, content: @Composable () -> Unit) = CompositionLocalProvider(LocalCardFailure provides failed, content = content)

// How many places on screen take a password now (Needs you, a login's card in a chat): the window stays out of
// screenshots and the app switcher's preview until the last of them goes.
private var secureHolds = 0

/** While it is on screen, the window is kept out of screenshots and the app switcher's preview. */
@Composable
private fun Secure() {
    val window = androidx.activity.compose.LocalActivity.current?.window
    DisposableEffect(window) {
        if (secureHolds++ == 0) window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { if (--secureHolds == 0) window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

/** expandable: closed until tapped, then everything shows (not for cards you type into). */
@Composable
private fun Card(who: Named?, title: String, meta: String? = null, done: Boolean = false, expandable: Boolean = false, content: @Composable () -> Unit) {
    val p = LocalPaper.current
    var open by remember { mutableStateOf(!expandable) }
    Column(
        Modifier.fillMaxWidth().alpha(if (done) 0.4f else 1f).raised(Radius.card)
            .then(if (expandable) Modifier.clickable(onClickLabel = if (open) tr("Show less") else tr("Show all")) { open = !open } else Modifier).padding(Space.s16),
        verticalArrangement = Arrangement.spacedBy(Space.s8),
    ) {
        if (who != null) Row(verticalAlignment = Alignment.CenterVertically) {
            SmallFigure(who.color, who.outfit, 16.dp)
            Text(" ${who.name}", color = p.muted, fontSize = Type.s12)
        }
        Text(title, style = MaterialTheme.typography.titleMedium, color = p.text, maxLines = if (open) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)
        if (!meta.isNullOrBlank()) Text(meta, color = p.muted, fontSize = Type.s12, maxLines = if (open) Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis)
        val failed = LocalCardFailure.current
        CompositionLocalProvider(LocalCardOpen provides open, LocalCardFailure provides null) { content() }
        if (failed != null) Text(failed, color = p.err, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
    }
}

/** A grey box for what it will do: the task, the script, the note. */
@Composable
private fun Body(text: String, mono: Boolean = false) {
    val p = LocalPaper.current
    Text(text, color = p.text, fontSize = Type.s14, fontFamily = if (mono) GeistMono else null,
        maxLines = if (LocalCardOpen.current) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth().background(p.sunk, Radius.small).then(if (mono) Modifier.horizontalScroll(rememberScrollState()) else Modifier).padding(Space.s12))
}

// Each answer sent from a card, once the server said yes or no and the cards are loaded again: a card still there
// (the answer failed) can be pressed again (#129).
private val answers = mutableIntStateOf(0)
private fun answered() { answers.intValue++ }

/**
 * Decline on the left, the yes on the right, at the card's right edge ("Always approve" between them, wrapping if needed).
 * A press says so on its button ([busyWord]) and leaves none of them to press again until the answer came back: a slow
 * save to Bitwarden made a call key for each press (#129).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Buttons(primary: String, onPrimary: () -> Unit, secondary: String, onSecondary: () -> Unit, enabled: Boolean = true, onAlways: (() -> Unit)? = null, connects: Boolean = false, alwaysLabel: String = tr("Always approve")) {
    val p = LocalPaper.current
    var pressed by remember { mutableStateOf<String?>(null) }
    val sent = answers.intValue
    LaunchedEffect(sent) { pressed = null }
    val press = { label: String, action: () -> Unit -> { if (pressed == null) { pressed = label; action() } } }
    // A yes of a card that turns on a call or a notify address ([connects]) turns a spinner in its button while it says so.
    val spins = { label: String -> connects && pressed == label && label != secondary }
    val word = { label: String -> if (pressed == label) busyWord(label, spins(label)) else label }
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s8, Alignment.End)) {
        SecondaryButton(onClick = press(secondary, onSecondary), enabled = pressed == null) { Text(word(secondary), color = p.text) }
        if (onAlways != null) SecondaryButton(onClick = press(alwaysLabel, onAlways), enabled = pressed == null) {
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
    Spacer(Modifier.width(Space.s8))
}

@Composable
private fun Muted(text: String) = Text(text, color = LocalPaper.current.muted, style = MaterialTheme.typography.bodyMedium)

/** One muted line under the card's body, also on a closed card. Nothing without one. */
@Composable
private fun MutedLine(text: String?) {
    if (!text.isNullOrBlank()) Text(text, color = LocalPaper.current.muted, fontSize = Type.s12)
}

/** The secret a yes saves (`vault-save`, ADR 153): dots until Show reads it from the server; Hide forgets it. */
@Composable
private fun SecretRow(words: SecretWords, reveal: suspend () -> String) {
    val p = LocalPaper.current
    val scope = rememberCoroutineScope()
    var value by remember { mutableStateOf<String?>(null) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s8)) {
        Text(words.label, color = p.muted, fontSize = Type.s12)
        Text(value ?: "••••••••", color = p.text, fontSize = Type.s14, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
        TextButton(onClick = { if (value != null) value = null else scope.launch { value = runCatching { reveal() }.getOrNull() } }) {
            Text(if (value == null) words.show else words.hide)
        }
    }
}

/** Show or Hide at the end of a secret the owner types: they see what they typed. */
@Composable
private fun RevealToggle(shown: Boolean, onToggle: () -> Unit) {
    TextButton(onClick = onToggle) { Text(if (shown) tr("Hide") else tr("Show")) }
}

@Composable
internal fun PasswordField(value: String, onChange: (String) -> Unit, label: String) {
    var shown by remember { mutableStateOf(false) }
    Field(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true,
        trailingIcon = { RevealToggle(shown) { shown = !shown } },
        visualTransformation = if (shown) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Password },
    )
}

/** A secret of several lines (a private key, #155): masked as a password is, its line breaks kept. */
@Composable
internal fun SecretBox(value: String, onChange: (String) -> Unit, label: String) {
    var shown by remember { mutableStateOf(false) }
    Field(
        value = value, onValueChange = onChange, label = { Text(label) }, minLines = 3, maxLines = 6,
        trailingIcon = { RevealToggle(shown) { shown = !shown } },
        visualTransformation = if (shown) VisualTransformation.None else PasswordVisualTransformation(),
        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun BitwardenCard(bw: BitwardenStatus, who: Named?, error: String?, onUnlock: (String) -> Unit) {
    var pw by remember { mutableStateOf("") }
    Card(who, tr("Bitwarden is locked")) {
        Muted(bw.wantedBy?.let { tr("{name} needs a saved login. Unlock Bitwarden so bots can use your logins.", "name" to it.name) }
            ?: tr("Bots can't use your saved logins until you unlock it. The master password is only kept in botdot's memory, never saved."))
        if (error != null) Text(error, color = LocalPaper.current.err, style = MaterialTheme.typography.bodyMedium)
        PasswordField(pw, { pw = it }, tr("Master password"))
        val p = LocalPaper.current
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Button(onClick = { onUnlock(pw); pw = "" }, enabled = pw.isNotEmpty(), colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(tr("Unlock")) }
        }
    }
}

/** Bitwarden unlocking, or a login being saved, in the background: one line with a pulsing dot. */
@Composable
private fun Busy(text: String) {
    val p = LocalPaper.current
    val a by rememberInfiniteTransition(label = "unlocking").animateFloat(1f, 0.35f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "a")
    Row(Modifier.padding(horizontal = Space.s8, vertical = Space.s4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s12)) {
        Box(Modifier.size(9.dp).alpha(a).clip(CircleShape).background(p.dot))
        Text(text, color = p.muted, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun LoginRequestCard(r: LoginRequest, who: Named, named: Boolean = true, bitwardenLocked: Boolean, features: Collection<String>?, type: String, onType: (String) -> Unit, user: String, onUser: (String) -> Unit, onUse: (String) -> Unit, onUseOther: (String, () -> Unit) -> Unit, onSave: (VaultTypes.Sent, String, String) -> Unit, onDecline: () -> Unit) {
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
    Card(who.takeIf { named }, tr("A login for {site}", "site" to r.site)) {
        if (confirming != null) OtherLoginConfirm(OtherLogins.confirm(r, confirming, who.name), onBack = { picked = null }, onYes = { picked = null; sending = true; onUseOther(confirming.id) { sending = false } })
        else {
            if (r.reason.isNotBlank()) Muted("“${r.reason}”")
            val usable = r.existing.filter { !it.allowed }
            if (usable.isNotEmpty()) {
                Muted(tr("Let it use a login you already saved:"))
                usable.forEach { e ->
                    SecondaryButton(onClick = { onUse(e.id) }, modifier = Modifier.fillMaxWidth()) {
                        Text(tr("Use {name}", "name" to e.name + (if (e.username.isNotBlank()) " (${e.username})" else "")), color = p.text)
                    }
                }
            }
            if (sending) Busy(OtherLogins.SENDING)
            else if (others.isNotEmpty()) {
                Text(OtherLogins.OPEN, color = p.muted, fontSize = Type.s14,
                    modifier = Modifier.clip(Radius.small).clickable(onClickLabel = if (othersOpen) tr("Hide the list") else tr("Show the list")) { othersOpen = !othersOpen }.padding(Space.s8))
                if (othersOpen) OtherLoginsList(others, typed, { typed = it }) { picked = it.id }
            }
            if (usable.isNotEmpty()) Muted(tr("Or save a new one:"))
            else Muted(tr("It goes straight into your vault{where}. The bot never sees the password.", "where" to if (bitwardenLocked) " (Bitwarden)" else ""))
            if (VaultTypes.shows(features)) Choice(VaultTypes.CONTROL, type, VaultTypes.options(features, r.type), onType)
            fields.username?.let { label ->
                Field(user, onUser, label = { Text(label) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Username })
            }
            if (fields.multiline) {
                SecretBox(pw, { pw = it }, fields.secret)
                TextButton(onClick = pick) { Text(tr("Pick its file"), color = p.text) }
                fileError?.let { Text(it, color = p.err, style = MaterialTheme.typography.bodyMedium) }
            } else PasswordField(pw, { pw = it }, fields.secret)
            if (bitwardenLocked) PasswordField(master, { master = it }, tr("Bitwarden master password (it's locked)"))
            Buttons(tr("Save"), { onSave(VaultTypes.sent(type, user, features), pw, master); pw = ""; master = "" }, tr("Decline"), onDecline, enabled = pw.isNotEmpty())
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
    if (long) Field(typed, onTyped, label = { Text(OtherLogins.SEARCH) }, singleLine = true,
        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
    if (rows.isEmpty()) Muted(OtherLogins.NO_MATCH)
    else Column(
        Modifier.fillMaxWidth().then(if (long) Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState()) else Modifier),
        verticalArrangement = Arrangement.spacedBy(Space.s8),
    ) {
        rows.forEach { e ->
            Column(Modifier.fillMaxWidth().raised(Radius.small).clickable(onClickLabel = OtherLogins.USE) { onPick(e) }.padding(horizontal = Space.s12, vertical = Space.s8)) {
                Text(OtherLogins.label(e), color = p.text, fontSize = Type.s14, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (e.site.isNotBlank()) Text(e.site, color = p.muted, fontSize = Type.s12, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
private fun CardRequest(r: LoginRequest, who: Named?, onAllow: () -> Unit, onDecline: () -> Unit) {
    val card = r.card?.let { "${it.name}${it.last4?.let { l -> " ••$l" } ?: ""}" } ?: tr("a saved card")
    Card(who, tr("Pay on {site}", "site" to r.site)) {
        Muted(tr("With {card}{amount}.", "card" to card, "amount" to if (r.amount.isNotBlank()) ", ${r.amount}" else ""))
        if (r.reason.isNotBlank()) Muted("“${r.reason}”")
        Muted(tr("Your OK covers this task, this card and this site for 15 minutes. The bot never sees the card number."))
        Buttons(tr("Allow"), onAllow, tr("Decline"), onDecline)
    }
}

@Composable
private fun JobApproval(who: Named?, j: Job, onAlways: () -> Unit, onApprove: () -> Unit, onDecline: () -> Unit) {
    val card = jobCard(j)
    val script = card.script != null
    Card(who, card.title, card.meta, expandable = true) {
        val open = LocalCardOpen.current
        // The change in its proposer's sentence: closed, it stands for what goes and what comes.
        card.summary?.let { summary ->
            Text(summary, color = LocalPaper.current.text, fontSize = Type.s14)
            if (!open) Faint(SEE_FULL_CHANGE)
        }
        if (showsFull(card, open)) {
            // Where the script changes: the approved one and the new one, each under what it is.
            card.scriptWas?.let { was -> Faint(tr("Approved script")); Body(was.ifBlank { tr("(empty)") }, mono = true); if (script) Faint(tr("New script")) }
            card.script?.let { Body(it.ifBlank { tr("(empty)") }, mono = true) }
            val asked = { text: String -> if (script) tr("Then the AI is asked: {text}", "text" to text) else text }
            val promptWas = card.promptWas
            if (promptWas != null) WasNow(asked(promptWas), card.prompt.takeIf { it.isNotBlank() }?.let(asked).orEmpty())
            else if (card.prompt.isNotBlank() && (open || !script)) Body(asked(card.prompt))
            card.also.forEach { Faint(it) }
        }
        if (j.assessment.isNotBlank() && open) Muted(j.assessment)
        MutedLine(card.line)
        Buttons(card.yes, onApprove, card.no, onDecline, onAlways = onAlways, connects = j.createsConnection)
    }
}

/** A faint label above a box: which of two scripts it is. */
@Composable
private fun Faint(text: String) = Text(text, color = LocalPaper.current.faint, fontSize = Type.s12)

/** A text that changes, in one box: what goes, struck, above what comes (as a changed text of a bot change is drawn). */
@Composable
private fun WasNow(was: String, now: String) {
    val p = LocalPaper.current
    val open = LocalCardOpen.current
    Column(Modifier.fillMaxWidth().background(p.sunk, Radius.small).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Text(was, color = p.muted, fontSize = Type.s14, textDecoration = TextDecoration.LineThrough, maxLines = if (open) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)
        if (now.isNotEmpty()) Text(now, color = p.text, fontSize = Type.s14, maxLines = if (open) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
    }
}

/** A tile of the Board whose script, or a change to it, waits for your OK: the scripts, in full when opened. */
@Composable
private fun TileApproval(who: Named?, t: Tile, onApprove: () -> Unit, onDecline: () -> Unit) {
    val card = tileCard(t)
    Card(who, card.title, card.meta, expandable = true) {
        if (card.scriptsWas.isNotEmpty()) {
            Faint(if (card.scriptsWas.size == 1) tr("Approved script") else tr("Approved scripts"))
            card.scriptsWas.forEach { Body(it.ifBlank { tr("(empty)") }, mono = true) }
            if (card.scripts.isNotEmpty()) Faint(if (card.scripts.size == 1) tr("New script") else tr("New scripts"))
        }
        card.scripts.forEach { Body(it.ifBlank { tr("(empty)") }, mono = true) }
        MutedLine(card.line)
        Buttons(card.yes, onApprove, card.no, onDecline)
    }
}

/**
 * A memory change that waits: its words are [memoryCard]'s, the botdot server's where it writes them. A change is one
 * block, what goes above what comes, so that a closed card shows the start of both.
 */
@Composable
private fun MemoryApproval(card: MemoryCard, who: Named?, onApprove: () -> Unit, onDecline: () -> Unit) {
    Card(who, card.title, card.meta, expandable = true) {
        if (card.was != null && card.now.isNotEmpty() && card.oneBlock) WasNow(card.was!!, card.now)
        else {
            if (card.was != null) Body(card.was!!)
            if (card.now.isNotEmpty()) Body(card.now)
        }
        Buttons(card.yes, onApprove, card.no, onDecline)
    }
}

/** The question before a second yes that lasts (#280): [text] in the server's words, answered with [label] or Cancel. */
@Composable
private fun AlwaysQuestion(text: String, label: String, done: (Boolean) -> Unit) = AlertDialog(
    onDismissRequest = { done(false) },
    text = { Text(text) },
    confirmButton = { TextButton(onClick = { done(true) }) { Text(label, color = LocalPaper.current.text) } },
    dismissButton = { TextButton(onClick = { done(false) }) { Text(tr("Cancel"), color = LocalPaper.current.text) } },
)

/** "Always allow" for one bot or all bots (ADR 201): the server's question and note, Cancel, `all` and `only`. done(true) for all bots, done(false) for this bot only, done(null) for Cancel. */
@Composable
private fun WhomQuestion(e: EveryBot, done: (Boolean?) -> Unit) = AlertDialog(
    onDismissRequest = { done(null) },
    title = { Text(e.question) },
    text = { Text(e.note) },
    confirmButton = {
        Row {
            TextButton(onClick = { done(true) }) { Text(e.all, color = LocalPaper.current.text) }
            TextButton(onClick = { done(false) }) { Text(e.only, color = LocalPaper.current.text) }
        }
    },
    dismissButton = { TextButton(onClick = { done(null) }) { Text(tr("Cancel"), color = LocalPaper.current.text) } },
)

/** A warning, set apart in amber: that of a tool from a link, and that of a login used on another website; the app puts the sign in front. Closed, it keeps two lines in sight. */
@Composable
private fun Warning(text: String) {
    val p = LocalPaper.current
    Text("⚠️ $text", color = p.text, fontSize = Type.s14, maxLines = if (LocalCardOpen.current) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth().background(p.sunk, Radius.small).border(1.dp, p.warnLine, Radius.small).padding(Space.s12))
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
                Text(f.label, color = p.faint, fontSize = Type.s14, maxLines = lines, overflow = TextOverflow.Ellipsis)
                Text(f.value, color = p.text, fontSize = Type.s14, maxLines = lines, overflow = TextOverflow.Ellipsis)
            }
        },
        modifier = Modifier.fillMaxWidth().background(p.sunk, Radius.small).padding(Space.s12),
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
        else Column(Modifier.fillMaxWidth().background(p.sunk, Radius.small).padding(Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) {
            if (parts.size > 1) Text(t.label, color = p.faint, fontSize = Type.s12)
            if (!t.was.isNullOrEmpty()) Text(t.was!!, color = p.muted, fontSize = Type.s14, textDecoration = TextDecoration.LineThrough,
                maxLines = if (open) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)
            if (t.now.isNotEmpty()) Text(t.now, color = p.text, fontSize = Type.s14, maxLines = if (open) Int.MAX_VALUE else 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * The card of everything one run waits on (#277): whose, the server's title, a line for each ask whose yes "Allow all"
 * leaves to its own buttons, Allow all and Decline all, and each ask's own card under it, with its own buttons.
 */
@Composable
private fun AskBatchCard(card: AskCard.Several, who: Named?, failed: String?, onAll: (Boolean) -> kotlinx.coroutines.Job, each: @Composable (Ask) -> Unit) {
    // Busy while the answer goes: a second tap sends nothing.
    var busy by remember(card.id) { mutableStateOf(false) }
    val all = { yes: Boolean -> if (!busy) { busy = true; onAll(yes).invokeOnCompletion { busy = false } } }
    Column(verticalArrangement = Arrangement.spacedBy(Space.s8)) {
        Failing(failed) { Card(who, card.title.ifBlank { trn(card.asks.size, "{n} thing waits for your OK", "{n} things wait for your OK") }) {
            batchOwnLine(card.asks)?.let { Muted(it) }
            if (card.asks.any { it.batch?.own != true && !it.rowsCut }) Buttons(tr("Allow all"), { all(true) }, tr("Decline all"), { all(false) }, enabled = !busy)
            else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                SecondaryButton(onClick = { all(false) }, enabled = !busy) { Text(tr("Decline all"), color = LocalPaper.current.text) }
            }
        } }
        Column(Modifier.padding(start = Space.s12), verticalArrangement = Arrangement.spacedBy(Space.s8)) { card.asks.forEach { each(it) } }
    }
}

/**
 * "Allow all" or "Decline all" (`POST /api/asks/batch/:id`, with the ids the card shows): [record] gets each ask the
 * server answered with its card's label; one it could not answer keeps its card, and [tell] says why.
 */
private fun answerAll(scope: CoroutineScope, api: Api, card: AskCard.Several, yes: Boolean, tell: (String) -> Unit, after: suspend () -> Unit, record: (Ask, String) -> Unit): kotlinx.coroutines.Job = scope.launch {
    runCatching { api.answerAskBatch(card.id, yes, card.asks.map { it.id }) }
        .onSuccess { r ->
            for (d in r.done) {
                val a = card.asks.firstOrNull { it.id == d.id } ?: continue
                if (d.error != null) tell(d.error!!) else record(a, answeredLabel(answeredWord(null, d.answered, yes), d.answered?.carriesOn.takeIf { yes }))
            }
        }
        .onError { tell(it.message ?: tr("That didn't work")) }
    after()
}

/**
 * A permission or a skill a bot (or the Chief) asked for, a tool the Chief asks to install for a bot, a changed bot,
 * an action in a connected app, or a switch of a saved login. answer(title, yes, label, always).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AskApproval(a: Ask, who: Named?, reveal: suspend () -> String = { "" }, answer: (String, Boolean, String?, Boolean, Boolean) -> Unit) {
    val decide: (String, Boolean, String?) -> Unit = { title, yes, label -> answer(title, yes, label, false, false) }
    if (a.kind == "update") {
        // A new version that waits for the account (`update`, #1690, ADR 271): the server's title, when it moves, and its
        // buttons by verb, no Not now. Both go to the front door's own routes, never the account's botdot server; Now asks
        // first only when the card says the account is busy. A card this app has no verb of is not drawn.
        if (a.act?.verb !in AskAct.UPDATE_VERBS) return
        val app = BotDotApp.of(LocalContext.current)
        val scope = rememberCoroutineScope()
        val p = LocalPaper.current
        var going by remember(a.id) { mutableStateOf(false) }
        var failed by remember(a.id) { mutableStateOf<String?>(null) }
        var asking by remember(a.id) { mutableStateOf(false) }
        val go: (String) -> Unit = { verb ->
            going = true
            failed = null
            scope.launch {
                runCatching {
                    val api = app.api.value ?: throw dev.botdot.app.data.ApiException(tr("Can't reach botdot."))
                    if (verb == AskAct.UPDATE_NOW) api.updateNow() else api.updateTonight()
                }.onSuccess { app.store.needs.refresh() }.onFailure { failed = it.message ?: tr("That didn't work") }
                going = false
            }
        }
        Failing(failed) {
            Card(who, a.title, ToolCard.text(a.body).takeIf { it.isNotEmpty() }) {
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s8, Alignment.End)) {
                    a.updateButtons.forEachIndexed { i, b ->
                        val press: () -> Unit = { if (b.verb == AskAct.UPDATE_NOW && a.asksBeforeNow) asking = true else go(b.verb) }
                        if (i == 0) Button(onClick = press, enabled = !going,
                            colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.inkText)) { Text(b.label.orEmpty()) }
                        else SecondaryButton(onClick = press, enabled = !going) { Text(b.label.orEmpty(), color = p.text) }
                    }
                }
            }
        }
        if (asking) AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text(tr("Update now?")) },
            text = { Text(tr("Your account moves to the new version: your bots restart, and work still running stops.")) },
            confirmButton = { TextButton(onClick = { asking = false; go(AskAct.UPDATE_NOW) }) { Text(tr("Update now"), color = p.text) } },
            dismissButton = { TextButton(onClick = { asking = false }) { Text(tr("Cancel"), color = p.text) } },
        )
    } else if (a.act != null) {
        // A card whose main button the server names by a verb (`act`, docs/api.md "A missing connected app"): its
        // title, in setup what is wrong, Not now and that button, no more. Connect opens the app's sign-in page and
        // says where that is (ConnectAsks); Open Connectors opens that screen. A verb this app does not know draws no card.
        val label = a.actLabel ?: return
        val context = LocalContext.current
        val app = BotDotApp.of(context)
        val openConnectors = LocalOpenConnectors.current
        val scope = rememberCoroutineScope()
        val step = ConnectAsks.at[a.id]?.step
        val no = a.no ?: tr("Not now")
        Failing(ConnectAsks.error(a)) {
            Card(who, a.title, ConnectAsks.line(a)) {
                ToolCard.text(a.body).takeIf { it.isNotEmpty() }?.let { Body(it) }
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.s8, Alignment.End)) {
                    SecondaryButton(onClick = { decide(a.title, false, no) }, enabled = step != ConnectAsks.Step.Opening) { Text(no, color = LocalPaper.current.text) }
                    Button(onClick = { ConnectAsks.press(scope, app, context, a, openConnectors) }, enabled = step != ConnectAsks.Step.Opening,
                        colors = ButtonDefaults.buttonColors(containerColor = LocalPaper.current.ink, contentColor = LocalPaper.current.inkText)) { Text(ConnectAsks.button(a, label)) }
                }
            }
        }
    } else if (a.kind == "connector-action") {
        // The server's title and the action's fields as rows, drawn as a tool's facts are: every row, and every value
        // in full on an opened card; under the title, whether its run still waits. From a server that sends neither:
        // the line and the text the card has today. Rows that were cut short (the feed's entry) are not all a yes
        // approves: the card then shows `details` under them and offers Decline alone, until the whole rows are there.
        // An action too long to show in full has the rows that fit and one line that says so: it cannot be allowed
        // once, so Decline and "Always allow" are left.
        val rows = a.rows
        // "Always allow" (the server's `always`) grants the action with any arguments: it asks first with the server's
        // `warning`, which names the bot and the action (#474), as on the web page.
        val always = a.always?.takeIf { it.isNotBlank() } ?: tr("Always allow")
        var asking by remember(a.id) { mutableStateOf(false) }
        // An action every bot may be allowed (ADR 201): the question is whom, this bot only or all bots, as on the web page.
        val everyBot = a.everyBot
        if (asking && everyBot != null) WhomQuestion(everyBot) { pick ->
            asking = false
            if (pick != null) answer(a.title, true, if (pick) tr("Always allowed for all bots") else tr("Always allowed"), true, pick)
        } else if (asking) AlwaysQuestion(ToolCard.text(a.warning).ifEmpty { if (a.chiefsAction) alwaysAllowChief(who?.name ?: tr("the Chief")) else ALWAYS_ALLOW_QUESTION }, always) {
            asking = false
            if (it) answer(a.title, true, tr("Always allowed"), true, false)
        }
        Card(who, a.title, connectorState(who?.name ?: a.bot?.name?.ifBlank { null } ?: tr("The bot"), a.held, a.stoppedAt) ?: a.reason, expandable = true) {
            if (rows.isNotEmpty()) Facts(rows, whole = LocalCardOpen.current)
            if (connectorDetails(a)) Body(a.details)
            if (connectorTooLong(a)) Text(TOO_LONG, color = LocalPaper.current.muted, fontSize = Type.s12)
            if (connectorAlways(a)) TextButton(onClick = { asking = true }) { Text(always) }
            if (connectorOnce(a)) Buttons(tr("Allow once"), { decide(a.title, true, tr("Approved")) }, tr("Decline"), { decide(a.title, false, null) })
            else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                SecondaryButton(onClick = { decide(a.title, false, null) }) { Text(tr("Decline"), color = LocalPaper.current.text) }
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
        if (asking && always != null) AlwaysQuestion(ToolCard.text(a.warning).ifEmpty { "$always?" }, always) { asking = false; if (it) answer(a.title, true, tr("Always allowed"), true, false) }
        Card(who, a.title, a.chiefActionLine, expandable = true) {
            if (a.rows.isNotEmpty()) Facts(a.rows, whole = LocalCardOpen.current)
            if (a.tooLong) Text(TOO_LONG, color = LocalPaper.current.muted, fontSize = Type.s12)
            if (a.chiefActionYes) Buttons(tr("Approve"), { decide(a.title, true, tr("Approved")) }, tr("Decline"), { decide(a.title, false, null) },
                onAlways = always?.let { { asking = true } }, alwaysLabel = always ?: tr("Always approve"))
            else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                SecondaryButton(onClick = { decide(a.title, false, null) }) { Text(tr("Decline"), color = LocalPaper.current.text) }
            }
        }
    } else if (a.isRoomCard) {
        // A shared room's card: a tool a run from a room wants to use, or what would go to a room (ADR 067). The
        // server's title, line, rows and yes word. Each yes is for that one thing; a card that cannot show all of it
        // offers Decline alone.
        Card(who, a.title, a.roomLine, expandable = true) {
            if (a.rows.isNotEmpty()) Facts(a.rows, whole = LocalCardOpen.current)
            if (a.tooLong) Text(TOO_LONG, color = LocalPaper.current.muted, fontSize = Type.s12)
            if (a.roomYes) Buttons(a.yes ?: tr("Allow"), { decide(a.title, true, tr("Allowed")) }, tr("Decline"), { decide(a.title, false, null) })
            else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                SecondaryButton(onClick = { decide(a.title, false, null) }) { Text(tr("Decline"), color = LocalPaper.current.text) }
            }
        }
    } else if (a.kind == "bot-change") {
        val parts = a.parts
        Card(who, a.title, a.reason, expandable = true) {
            if (parts.isNotEmpty()) ChangedParts(parts) else Body(a.details)
            Buttons(changeYes(a), { decide(a.title, true, tr("Approved")) }, tr("Decline"), { decide(a.title, false, null) })
        }
    } else if (ToolCard.isTool(a)) {
        // The server's own fields, no wording from here: what the tool is and why, the warning of a tool from a
        // link, then the facts. Closed, the card shows the start of the body and of the warning; the facts open with it.
        val t = ToolCard.parts(a)
        Card(who, t.title, t.meta, expandable = true) {
            if (t.body.isNotEmpty()) Body(t.body)
            if (t.warning.isNotEmpty()) Warning(t.warning)
            if (t.facts.isNotEmpty() && LocalCardOpen.current) Facts(t.facts)
            Buttons(ToolCard.INSTALL, { decide(t.title, true, ToolCard.answered(true)) }, ToolCard.DECLINE, { decide(t.title, false, ToolCard.answered(false)) })
        }
    } else if (a.kind == "vault-switch" || a.kind == "vault-remove" || a.kind == "vault-save" || a.kind == "vault-file" || a.kind == "override" || a.kind == "computer-step") {
        // A switch of a saved login a bot asks for: the server's title, the bot's reason, the login and the switch as
        // rows, the warning of "Usable in its computer", and the server's word on the yes. As on the web page. A Vault
        // entry a bot asks to remove is drawn the same way: its rows name the entry, the bot and Bitwarden's Trash. So
        // are secrets a bot asks to keep in a file (#253): the secrets, the file, and who can read it there. And an
        // irreversible step on a bot's computer (ADR 107): the site, the control and what the page says of it.
        val warning = ToolCard.text(a.warning)
        Card(who, a.title, a.reason, expandable = true) {
            if (a.parts.isNotEmpty()) ChangedParts(a.parts)
            // A secret a bot asks to save (ADR 153): hidden until the owner's Show, as on the web page.
            a.secret?.let { SecretRow(it, reveal) }
            if (warning.isNotEmpty()) Warning(warning)
            // A rule a bot asks to lift (#253) has the server's second yes, `always`: "Allow always for this bot".
            val always = if (a.kind == "override") a.always?.takeIf { it.isNotBlank() } else null
            Buttons(a.yes ?: tr("Allow"), { decide(a.title, true, tr("Allowed")) }, tr("Decline"), { decide(a.title, false, null) },
                onAlways = always?.let { { answer(a.title, true, tr("Always allowed"), true, false) } }, alwaysLabel = always ?: tr("Always approve"))
        }
    } else if (a.kind == "permission") {
        val title = tr("Let it {what}?", "what" to (a.what?.label ?: a.permission))
        Card(who, title, a.reason, expandable = true) {
            Body(tr("{hint}. It can't until you allow it; you can change this in its settings.", "hint" to (a.what?.hint ?: "").replaceFirstChar { it.uppercase() }))
            Buttons(tr("Allow"), { decide(title, true, tr("Allowed")) }, tr("Decline"), { decide(title, false, null) })
        }
    } else if (a.written) {
        // A skill the bot wrote after it read content from others: the server's line as the title, and the whole
        // text a yes would save, as on the web page. Closed, the card shows its start; opened, all of it.
        val title = skillTitle(a)
        Card(who, title, a.reason, expandable = true) {
            Body(a.skill?.instructions.orEmpty().ifBlank { tr("(empty)") })
            Buttons(tr("Approve"), { decide(title, true, tr("Approved")) }, tr("Decline"), { decide(title, false, null) })
        }
    } else {
        val k = a.skill ?: AskSkill()
        val title = tr("Install the skill \"{name}\"?", "name" to k.name)
        val forWhom = if (a.forBots.isNotEmpty()) " · " + tr("for {names}", "names" to a.forBots.joinToString(", ") { it.name }) else ""
        Card(who, title, a.url.removePrefix("https://").removePrefix("www.") + forWhom, expandable = true) {
            Body(k.description.ifBlank { tr("No description.") } + (if (k.files > 1) " " + trn(k.files, "({n} file)", "({n} files)") else "") + (if (k.exists) " " + tr("It replaces your skill of the same name.") else "") + (if (a.reason.isNotBlank()) "\n\n" + tr("Why: {reason}", "reason" to a.reason) else ""))
            Buttons(tr("Install"), { decide(title, true, tr("Installed")) }, tr("Decline"), { decide(title, false, null) })
        }
    }
}

/** A card of the list that fades in, fades away once decided, and lets the cards below move up into its place (#496). */
@Composable
private fun LazyItemScope.Moves(content: @Composable () -> Unit) =
    Box(Modifier.animateItem(fadeInSpec = Motion.enter(), placementSpec = Motion.enter(), fadeOutSpec = Motion.exit())) { content() }
