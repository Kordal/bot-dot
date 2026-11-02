package dev.botdot.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.currentBackStackEntryAsState
import android.view.KeyEvent
import dev.botdot.app.ui.CompanyScreen
import dev.botdot.app.ui.CompanyWays
import dev.botdot.app.ui.SpaceRail
import dev.botdot.app.ui.SpaceWays
import dev.botdot.app.data.Spaces
import dev.botdot.app.ui.HomePanes
import dev.botdot.app.ui.KeyRelay
import dev.botdot.app.ui.Keypad
import dev.botdot.app.ui.openBeside
import dev.botdot.app.ui.LocalListToggle
import dev.botdot.app.ui.ListGrip
import dev.botdot.app.ui.ListWidth
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.core.content.IntentCompat
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dev.botdot.app.data.BotFiles
import dev.botdot.app.data.BrowserSignIn
import dev.botdot.app.data.Handoff
import dev.botdot.app.data.ProjectChats
import dev.botdot.app.data.UploadedFiles
import dev.botdot.app.data.groupKey
import dev.botdot.app.data.groupOfChat
import dev.botdot.app.data.tr
import dev.botdot.app.feed.FeedService
import dev.botdot.app.feed.Notifier
import dev.botdot.app.ui.BoatScreen
import dev.botdot.app.ui.BotChatScreen
import dev.botdot.app.ui.BotSettingsScreen
import dev.botdot.app.ui.GroupChatScreen
import dev.botdot.app.ui.ProjectChatSheet
import dev.botdot.app.ui.GroupSettingsScreen
import dev.botdot.app.ui.ChiefSettingsScreen
import dev.botdot.app.ui.ConnectorsScreen
import dev.botdot.app.ui.DashboardScreen
import dev.botdot.app.ui.FilesScreen
import dev.botdot.app.ui.LiveScreen
import dev.botdot.app.ui.SettingsScreen
import dev.botdot.app.ui.SkillsScreen
import dev.botdot.app.ui.PagesScreen
import dev.botdot.app.ui.BotDotTheme
import dev.botdot.app.ui.DocumentViewerHost
import dev.botdot.app.ui.ChiefScreen
import dev.botdot.app.ui.ConnectScreen
import dev.botdot.app.ui.HomeScreen
import dev.botdot.app.ui.ChiefNameQuestion
import dev.botdot.app.ui.LocalChiefName
import dev.botdot.app.ui.JobsScreen
import dev.botdot.app.ui.NeedsYouScreen
import dev.botdot.app.ui.LocalChatCovered
import dev.botdot.app.ui.LocalPanelClose
import dev.botdot.app.ui.LocalPaper
import dev.botdot.app.ui.Motion
import dev.botdot.app.ui.Panel
import dev.botdot.app.ui.SettingsPanel
import dev.botdot.app.ui.RoomChatScreen
import dev.botdot.app.ui.RoomSettingsScreen
import dev.botdot.app.ui.RoomsScreen
import dev.botdot.app.ui.ScreenMotion
import dev.botdot.app.ui.ShareScreen
import dev.botdot.app.ui.PausedScreen
import dev.botdot.app.ui.SignInScreen
import dev.botdot.app.ui.VaultScreen
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    /** Where a tapped notification wants to go ("bot:<id>" | "chief:<chatId>" | "group:<id>" | "room:<id>"). */
    private val openTarget = mutableStateOf<String?>(null)
    /** Files shared from another app (Share → botdot), waiting for you to pick who gets them. */
    private val sharedUris = mutableStateOf<List<Uri>>(emptyList())
    private val sharedText = mutableStateOf("")
    /** The presses of a hardware keyboard, for the keypad while it is on screen. */
    private val keys = KeyRelay()
    /** The keys whose press the keypad used: their release is its too, so nothing else acts on half a press. */
    private val keysUsed = mutableSetOf<Int>()

    override fun onCreate(savedInstanceState: Bundle?) {
        // Dark only (#14): light icons on the bars, whatever the system says.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        // Only the first time: when the phone turns, the same intent would share its files (or open its chat) again.
        if (savedInstanceState == null) handle(intent)
        else {
            // Shared, but no chat picked yet when it turned: still waiting to be picked.
            sharedUris.value = androidx.core.os.BundleCompat.getParcelableArrayList(savedInstanceState, SHARED_URIS, Uri::class.java).orEmpty()
            sharedText.value = savedInstanceState.getString(SHARED_TEXT).orEmpty()
        }
        val app = BotDotApp.of(this)

        setContent {
            BotDotTheme {
                DocumentViewerHost() // a file opened in the app (#251), over whatever is on screen
                val server by app.settings.server.collectAsState(initial = "…")
                val nav = rememberNavController()
                val scope = rememberCoroutineScope()
                val askNotify = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { FeedService.start(this) }

                // Once connected: notifications permission, then the background connection.
                LaunchedEffect(server) {
                    val s = server
                    if (s == null) { nav.navigate("connect") { popUpTo(nav.graph.id) { inclusive = true } } }
                    else if (s != "…") {
                        if (Build.VERSION.SDK_INT >= 33) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS) else FeedService.start(this@MainActivity)
                    }
                }
                // A tapped notification opens a chat: a panel that covers the chat makes way for it (set below, with the panel).
                val panelOff = remember { mutableStateOf({}) }
                val target by openTarget
                LaunchedEffect(target, server) {
                    val t = target ?: return@LaunchedEffect
                    if (server == null || server == "…") return@LaunchedEffect
                    openTarget.value = null
                    if (t.startsWith("bot:") || t.startsWith("chief:") || t.startsWith("group:") || t.startsWith("room:") || t == "needs") panelOff.value()
                    when {
                        t.startsWith("bot:") -> nav.navigate("bot/${t.removePrefix("bot:")}") { launchSingleTop = true }
                        // A card or a question asked in a group: its notification opens the group.
                        t.startsWith("group:") -> nav.navigate("group/${t.removePrefix("group:")}") { launchSingleTop = true }
                        t.startsWith("chief:") -> nav.navigate("chief/${t.removePrefix("chief:").ifBlank { "latest" }}") { launchSingleTop = true }
                        t == "needs" -> nav.navigate("needs") { launchSingleTop = true }
                        // A new message in a shared room (room_notice): its notification opens the room.
                        t.startsWith("room:") -> nav.navigate("room/${t.removePrefix("room:")}") { launchSingleTop = true }
                        // A notification for a reply with one file (the morning paper): open the file itself.
                        t.startsWith(BotFiles.PREFIX) -> app.api.value?.let { api ->
                            scope.launch {
                                runCatching { BotFiles.open(this@MainActivity, api, t.removePrefix(BotFiles.PREFIX)) }
                                    .onFailure { android.widget.Toast.makeText(this@MainActivity, it.message ?: tr("Couldn't open the file"), android.widget.Toast.LENGTH_LONG).show() }
                            }
                        }
                    }
                }
                val shared by sharedUris
                val sharedWords by sharedText
                LaunchedEffect(shared, sharedWords, server) {
                    if ((shared.isNotEmpty() || sharedWords.isNotBlank()) && server != null && server != "…") nav.navigate("share") { launchSingleTop = true }
                }

                // A screen wide enough for both (an unfolded phone, a tablet): the list stands beside the chat, and the
                // chat's first button hides or shows it. On a phone: the list first, then the chat.
                val p = LocalPaper.current
                val width = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() }
                val wide = width >= 600.dp
                var listShown by rememberSaveable { mutableStateOf(true) }
                val toggleList = remember { { listShown = !listShown } }
                val entry by nav.currentBackStackEntryAsState()
                val route = entry?.destination?.route
                val panes = wide && route != null && route != "connect" && route != "sign-in" && route != "share" && route != "paused"
                // What stands left of the chat: from 840 dp the keypad in place of the list (Keypad.home).
                val home = if (panes) Keypad.home(width.value.toInt()) else Keypad.Home.PHONE
                val keypad = home == Keypad.Home.KEYPAD
                // The front door asks this botdot's sign-in (none yet, or signed out everywhere): its screen, in place of
                // all, also after a visit to the address (the same one, given again).
                val signInFor by app.session.signInNeeded.collectAsState()
                LaunchedEffect(signInFor, server, route) {
                    if (signInFor == null || signInFor != server || route == null || route == "sign-in" || route == "connect") return@LaunchedEffect
                    panelOff.value()
                    nav.navigate("sign-in") { popUpTo(nav.graph.id) { inclusive = true } }
                }
                // The admin paused the account (#466): its screen in place of all, with the way to another account, until
                // botdot answers again; signed out from there, the sign-in above takes over.
                val pausedFor by app.session.paused.collectAsState()
                LaunchedEffect(pausedFor, signInFor, server, route) {
                    if (route == null || route == "sign-in" || route == "connect") return@LaunchedEffect
                    if (pausedFor != null && pausedFor == server && route != "paused") {
                        panelOff.value()
                        nav.navigate("paused") { popUpTo(nav.graph.id) { inclusive = true } }
                    } else if (route == "paused" && pausedFor != server && signInFor != server) nav.navigate("home") { popUpTo(nav.graph.id) { inclusive = true } }
                }
                // Back from the sign-in in the browser: signed in, the home screen; not, the sign-in screen says why.
                val browser by app.browserSignIn.state.collectAsState()
                LaunchedEffect(browser, route) {
                    when (browser) {
                        is BrowserSignIn.State.Done -> {
                            app.signedIn()
                            app.browserSignIn.seen()
                            nav.navigate("home") { popUpTo(nav.graph.id) { inclusive = true } }
                        }
                        is BrowserSignIn.State.Failed ->
                            if (route != null && route != "sign-in" && route != "connect") nav.navigate("sign-in") { popUpTo(nav.graph.id) { inclusive = true } }
                        else -> {}
                    }
                }
                // The settings panel (a bot's settings, its jobs, the Chief's settings, a group's) belongs to the chat on screen.
                // With room it stands right of that chat, which stays in use; without, it covers the chat.
                var panelKept by rememberSaveable(stateSaver = SettingsPanel.Saver) { mutableStateOf<Panel?>(null) }
                // The chat open in the sheet over a project's page, while the sheet is up: its panel is that chat's.
                var dockedChat by remember { mutableStateOf<String?>(null) }
                val chat = SettingsPanel.chatOf(route, entry?.arguments?.getString("id"), wide, dockedChat)
                // The list's width, which the owner drags (ListGrip); kept on this device.
                var listWanted by rememberSaveable { mutableStateOf<Int?>(null) }
                LaunchedEffect(Unit) { listWanted = app.settings.listWidthNow() }
                val listWidth = ListWidth.fitting(listWanted, width.value.toInt())
                // Beside the keypad the panel takes the chat's column, as it does where there is no room beside a chat.
                val room = wide && !keypad && SettingsPanel.room(width.value.toInt(), listShown = panes && listShown, list = listWidth)
                val panel = SettingsPanel.follow(panelKept, chat, room)
                LaunchedEffect(panel) { panelKept = panel }
                panelOff.value = { panelKept = SettingsPanel.chosen(panelKept, room) }
                val shown = panel.takeIf { chat != null } // a screen that is no chat (its computer, Needs you) keeps it for the way back
                // The panel last shown, for the moment it takes to leave.
                val lastPanel = remember { mutableStateOf<Panel?>(null) }
                SideEffect { if (shown != null) lastPanel.value = shown }
                // A group made from a bot's chat: its chat takes the place of the bot's, and the panel makes way.
                val openGroup = remember { { id: String -> panelKept = null; nav.navigate("group/$id") { popUpTo("home"); launchSingleTop = true } } }
                // One content for both places, so that room coming or going moves the panel with what is typed in it.
                val panelContent = remember {
                    movableContentOf { pn: Panel ->
                        key(pn.chat, pn.jobs) {
                            val back = { panelKept = SettingsPanel.back(pn) }
                            when {
                                // An earlier chat takes the place of the one on screen; a panel that covers the chat makes way for it.
                                pn.chat == SettingsPanel.CHIEF -> ChiefSettingsScreen(app, onChat = { panelOff.value(); nav.navigate("chief/$it") { popUpTo("home"); launchSingleTop = true } }, onFiles = { nav.navigate("files/${UploadedFiles.CHIEF}") }, onBack = back)
                                pn.jobs -> JobsScreen(app, pn.chat, onNeedsYou = { nav.navigate("needs") }, onBack = back)
                                // A group's settings; a deleted group has no chat to go back to.
                                groupOfChat(pn.chat) != null -> GroupSettingsScreen(app, groupOfChat(pn.chat).orEmpty(), onDeleted = { panelKept = null; nav.popBackStack("home", inclusive = false) }, onBack = back)
                                else -> BotSettingsScreen(app, pn.chat, focusSkill = pn.skill, onScreen = { nav.navigate("screen/${pn.chat}") }, onJobs = { panelKept = SettingsPanel.jobs(pn, pn.chat) }, onFiles = { nav.navigate("files/${pn.chat}") },
                                    onDeleted = { panelKept = null; nav.popBackStack("home", inclusive = false) },
                                    onCopied = { panelKept = null; nav.navigate("bot/$it") { popUpTo("home"); launchSingleTop = true } }, onBack = back)
                            }
                        }
                    }
                }
                // Spaces (#836, #840), in place of "Bots | Projects": Home and each open project. From 840 dp the rail picks
                // one and the project's page takes the keypad's place, its default chat beside it; on a phone and beside
                // the list the title picks one and the project opens as the Projects screen did. Kept on this device.
                val features = app.store.version.value.collectAsState().value?.features
                val projectList by app.store.projectList.collectAsState()
                val companyHeld by app.store.company.value.collectAsState() // also what reads the projects in
                val waitingNow by app.store.waiting.collectAsState(initial = emptyList())
                val botsNow by app.store.bots.value.collectAsState()
                val groupsNow by app.store.groups.value.collectAsState()
                val chiefNow by app.store.chief.value.collectAsState()
                val projects = Spaces.projects(features, projectList, companyHeld?.company)
                val projectIds = projects.map { it.id }
                val spaceList = remember(projects, botsNow, waitingNow) { Spaces.list(projects, botsNow.orEmpty(), waitingNow) }
                var space by rememberSaveable { mutableStateOf(Spaces.HOME) }
                var newSpace by rememberSaveable { mutableStateOf(false) } // "New project": the start screen, no project yet
                var searchAsk by rememberSaveable { mutableStateOf(0) }
                fun goSpace(id: String, keep: Boolean = true) {
                    space = id
                    newSpace = false
                    panelKept = null
                    if (keep) scope.launch { app.settings.setSpace(id) }
                    if (id == Spaces.HOME) {
                        // Back to the Chief's chat, from the project or a chat opened on it (#757).
                        if (keypad || route == "company" || runCatching { nav.getBackStackEntry("company") }.isSuccess) nav.popBackStack("home", inclusive = false)
                        return
                    }
                    app.store.showProject(id)
                    scope.launch { app.settings.setProject(id) }
                    if (keypad) {
                        val to = Spaces.defaultChat(projects.firstOrNull { it.id == id }, groupsNow.orEmpty(), features)
                        if (to == Spaces.CHIEF) nav.popBackStack("home", inclusive = false) else nav.openBeside(to)
                    } else if (wide) nav.openBeside("company") else nav.navigate("company") { launchSingleTop = true }
                }
                fun startProject() {
                    app.store.newProject()
                    newSpace = true
                    panelKept = null
                    if (keypad) nav.popBackStack("home", inclusive = false) else if (wide) nav.openBeside("company") else nav.navigate("company") { launchSingleTop = true }
                }
                // Beside the list, one chat takes the other's place; the Chief's is the one below them all.
                fun open(to: String) { panelKept = SettingsPanel.chosen(panelKept, room); if (wide) nav.openBeside(to) else nav.navigate(to) { launchSingleTop = true } }
                // "+" New bot: Home, and a new chat with the Chief, who makes bots, its box started (#853).
                fun startBot() { goSpace(Spaces.HOME); app.chiefWords = tr("A new bot that "); open("chief/new") }
                // From a botdot with projects the spaces are there before the first one: it starts from them (#853).
                val spaceWays = SpaceWays(spaceList, if (newSpace) "" else space, pick = { goSpace(it) }, new = { startProject() }, on = dev.botdot.app.data.CompanySetup.shows(features), newBot = { startBot() })
                val railed = keypad && spaceWays.shown
                // A device that was in a project opens in it again, once the projects are read; one that is gone is Home.
                var placeKept by rememberSaveable { mutableStateOf(false) }
                LaunchedEffect(features, route, companyHeld) {
                    if (placeKept || route != "home" || !dev.botdot.app.data.CompanySetup.shows(features)) return@LaunchedEffect
                    val saved = app.settings.spaceNow()
                    if (saved == null) { placeKept = true; return@LaunchedEffect }
                    if (companyHeld == null) return@LaunchedEffect // not read yet
                    placeKept = true
                    val id = Spaces.remembered(saved, projectIds, app.settings.projectNow())
                    if (id != saved) app.settings.setSpace(id)
                    if (id != Spaces.HOME) goSpace(id, keep = false)
                }
                // The project on screen was deleted or archived: Home.
                LaunchedEffect(projectIds, companyHeld) {
                    if (companyHeld != null && !newSpace && Spaces.still(space, projectIds) != space) goSpace(Spaces.HOME)
                }
                // A project just made from "New project" is the space.
                LaunchedEffect(companyHeld) {
                    val made = companyHeld?.company?.id
                    if (newSpace && made != null && made in projectIds) { newSpace = false; space = made; app.settings.setSpace(made) }
                }
                // Back from the project on a phone, or beside the list: Home again.
                var lastRoute by remember { mutableStateOf<String?>(null) }
                LaunchedEffect(route) {
                    if (!keypad && lastRoute == "company" && route == "home" && (space != Spaces.HOME || newSpace)) { space = Spaces.HOME; newSpace = false; app.settings.setSpace(Spaces.HOME) }
                    lastRoute = route
                }
                // The window grew past 840 dp with the project open beside the list: it moves left of the chat.
                LaunchedEffect(keypad, route) {
                    if (keypad && route == "company") nav.popBackStack("home", inclusive = false)
                    else if (!keypad && route == "home" && (space != Spaces.HOME || newSpace) && placeKept) { if (wide) nav.openBeside("company") else nav.navigate("company") { launchSingleTop = true } }
                }
                @Composable
                fun Home(modifier: Modifier) {
                    val id = entry?.arguments?.getString("id")
                    HomeScreen(
                        app, modifier,
                        active = when {
                            !panes -> null
                            route == "home" || route?.startsWith("chief") == true -> "chief"
                            route == "company" -> "company"
                            route.startsWith("group/") -> id?.let { groupKey(it) }
                            else -> id
                        },
                        onBot = { open("bot/$it") },
                        onGroup = { open("group/$it") },
                        onChief = {
                            // The Chief chat that has new replies; with none, the latest.
                            val fresh = app.store.chief.value.value?.chats?.firstOrNull { it.unread > 0 }?.id
                            if (fresh != null) open("chief/$fresh") else { panelKept = SettingsPanel.chosen(panelKept, room); if (wide) nav.popBackStack("home", inclusive = false) else nav.navigate("chief/latest") }
                        },
                        onNew = { open("chief/new") },
                        onDashboard = { open("dashboard") },
                        onHit = { h -> app.jump = h; if (h.chatId != null) open("chief/${h.chatId}") else h.bot?.let { open("bot/${it.id}") } },
                        onNeedsYou = { open("needs") },
                        onOpen = { open(it) },
                        // Beside the chat the list's width says what a row shows.
                        shows = if (panes && !keypad) ListWidth.shows(listWidth) else ListWidth.Shows.ALL,
                        keypad = keypad,
                        keys = keys.takeIf { keypad },
                        // A phone: the pages as sections of keys, and each chat full screen.
                        sections = home == Keypad.Home.PHONE,
                        spaces = spaceWays,
                        railed = railed,
                        searchAsk = searchAsk,
                    )
                }
                // A project's page left of the chat (from 840 dp): its chats open in the chat beside it.
                @Composable
                fun ProjectPane(modifier: Modifier) {
                    Box(modifier) {
                        CompanyScreen(app, wide = true, ways = CompanyWays(
                            onBot = { open("bot/$it") },
                            onBotSay = { bot, words -> app.botWords = bot to words; open("bot/$bot") },
                            onChief = { panelKept = SettingsPanel.chosen(panelKept, room); nav.popBackStack("home", inclusive = false) },
                            onNeeds = { open("needs") },
                            onChiefSay = { app.chiefWords = it; open("chief/new") },
                            onTeam = { open("group/$it") },
                            onFolder = { nav.navigate("files/${android.net.Uri.encode(dev.botdot.app.data.UploadedFiles.FOLDER + it)}") },
                            onGoalChat = { open("chief/$it") },
                        ), spaces = spaceWays, railed = railed, field = false)
                    }
                }

                // The name the owner gave the Chief (ChiefName), for every screen that shows it.
                val chiefName by app.store.chiefName.collectAsState()
                // Beside the keypad there is no list to hide.
                CompositionLocalProvider(LocalListToggle provides toggleList.takeIf { panes && !keypad }, LocalChiefName provides chiefName) {
                // The first-run question for that name, once the phone is in (not while it connects or signs in).
                if (route != null && route != "connect" && route != "sign-in" && route != "paused") ChiefNameQuestion(app)
                Row(Modifier.fillMaxSize().background(p.bg).then(if (wide) Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)) else Modifier)) {
                // The rail of spaces (#840), from 840 dp while there are projects.
                if (railed) SpaceRail(spaceWays, busy = chiefNow?.busy == true || botsNow.orEmpty().any { it.running },
                    onSearch = { if (space != Spaces.HOME || newSpace) goSpace(Spaces.HOME); searchAsk++ }, onSettings = { open("settings") })
                HomePanes(home, width.value.toInt(), listShown,
                    keypad = { m -> if (keypad && (space != Spaces.HOME || newSpace)) ProjectPane(m) else Home(m) },
                    list = {
                        Home(Modifier.width(listWidth.dp).fillMaxHeight())
                        // What is kept is the width the list ended at, not how far the finger went past its limits.
                        ListGrip(listWidth, onWidth = { listWanted = it?.let { w -> ListWidth.fitting(w, width.value.toInt()) } }, onKeep = { scope.launch { app.settings.setListWidth(listWanted) } })
                    },
                ) { chatPane ->
                Box(chatPane) {
                CompositionLocalProvider(LocalChatCovered provides (shown != null && !room)) {
                // Screens move as one system (#496), not with Navigation's 700 ms fade.
                NavHost(nav, startDestination = "home", modifier = Modifier.fillMaxSize(),
                    enterTransition = ScreenMotion.enter(wide), exitTransition = ScreenMotion.exit(wide),
                    popEnterTransition = ScreenMotion.popEnter(wide), popExitTransition = ScreenMotion.popExit(wide)) {
                    composable("connect") {
                        ConnectScreen(current = server?.takeIf { it != "…" }) { url ->
                            scope.launch { app.settings.setServer(url) }
                            nav.navigate("home") { popUpTo(nav.graph.id) { inclusive = true } }
                        }
                    }
                    composable("sign-in") {
                        SignInScreen(app, onChangeServer = { nav.navigate("connect") })
                    }
                    composable("paused") {
                        PausedScreen(app)
                    }
                    composable("home") {
                        if (wide) ChiefScreen(app, "latest", emptyList(), "", onSettings = { panelKept = SettingsPanel.toggle(panelKept, SettingsPanel.CHIEF) }, onNeeds = { nav.navigate("needs") },
                            onBot = { open("bot/$it") }, onScreen = { nav.navigate("screen/$it") }, onSkills = { nav.navigate("skills") }, onSignIn = { nav.navigate("settings") { launchSingleTop = true } }, onFiles = { nav.navigate("files/${UploadedFiles.CHIEF}") }) {}
                        else Home(Modifier.fillMaxSize())
                    }
                    val attachArg = listOf(navArgument("attach") { defaultValue = "0" })
                    composable("bot/{id}?attach={attach}", arguments = attachArg) { e ->
                        val (files, shared) = remember { takeShared(e.arguments?.getString("attach") == "1") }
                        val id = e.arguments?.getString("id") ?: ""
                        // Words the Projects floor started for this bot (a standup's Reply), else what was shared.
                        val text = remember { app.botWords?.takeIf { it.first == id }?.second?.also { app.botWords = null } ?: shared }
                        BotChatScreen(app, id, files, text, onJobs = { panelKept = SettingsPanel.jobs(panelKept, id) }, onSettings = { panelKept = SettingsPanel.toggle(panelKept, id) }, onNeeds = { nav.navigate("needs") }, onLearned = { panelKept = SettingsPanel.settings(id, it) },
                            // A group made from this bot's chat is in the list and open.
                            onSignIn = { nav.navigate("settings") { launchSingleTop = true } }, onGroup = { openGroup(it) }, onScreen = { nav.navigate("screen/$id") }, onFiles = { nav.navigate("files/$id") }) { nav.popBackStack() }
                    }
                    composable("chief/{id}?attach={attach}", arguments = attachArg) { e ->
                        val (files, text) = remember { takeShared(e.arguments?.getString("attach") == "1") }
                        // Words the Company's floor started for the owner (Change direction at a check-in), else what was shared.
                        val words = remember { app.chiefWords?.also { app.chiefWords = null } ?: text }
                        ChiefScreen(app, e.arguments?.getString("id") ?: "latest", files, words, onSettings = { panelKept = SettingsPanel.toggle(panelKept, SettingsPanel.CHIEF) }, onNeeds = { nav.navigate("needs") },
                            onBot = { nav.navigate("bot/$it") }, onScreen = { nav.navigate("screen/$it") }, onSkills = { nav.navigate("skills") }, onSignIn = { nav.navigate("settings") { launchSingleTop = true } }, onFiles = { nav.navigate("files/${UploadedFiles.CHIEF}") }) { nav.popBackStack() }
                    }
                    composable("group/{id}") { e ->
                        val id = e.arguments?.getString("id") ?: ""
                        // The chat leaves by itself when its group is gone: only while it is the screen in front. Deleted from
                        // its own panel, the way back to the list is taken already, and a second step back would leave the list.
                        GroupChatScreen(app, id, onSettings = { panelKept = SettingsPanel.toggle(panelKept, groupKey(id)) }, onNeeds = { nav.navigate("needs") },
                            onSignIn = { nav.navigate("settings") { launchSingleTop = true } }) { if (nav.currentBackStackEntry == e) nav.popBackStack() }
                    }
                    // Shared rooms (ADR 060): the list, a room's chat, its settings.
                    composable("rooms") {
                        RoomsScreen(app, onRoom = { nav.navigate("room/$it") { launchSingleTop = true } }, onMade = { nav.navigate("room/$it"); nav.navigate("room/$it/settings") }) { nav.popBackStack() }
                    }
                    composable("room/{id}") { e ->
                        val id = e.arguments?.getString("id") ?: ""
                        RoomChatScreen(app, id, onSettings = { nav.navigate("room/$id/settings") { launchSingleTop = true } }) { if (nav.currentBackStackEntry == e) nav.popBackStack() }
                    }
                    composable("room/{id}/settings") { e ->
                        val id = e.arguments?.getString("id") ?: ""
                        RoomSettingsScreen(app, id, onGone = { if (!nav.popBackStack("rooms", inclusive = false)) nav.popBackStack("home", inclusive = false) }) { nav.popBackStack() }
                    }
                    composable("company") {
                        // From the floor: a bot's, a team's or the Chief's chat as a sheet over it (#705, #820), Needs you, and a
                        // new Chief chat with the owner's words started.
                        var docked by rememberSaveable { mutableStateOf<String?>(null) }
                        var dockHeight by rememberSaveable { mutableStateOf(ProjectChats.Height.CLOSED) }
                        fun dock(o: ProjectChats.Open) { docked = o.key; dockHeight = ProjectChats.Height.HALF }
                        fun undock(then: () -> Unit = {}) { dockHeight = ProjectChats.Height.CLOSED; then() }
                        val dockedNow = docked.takeIf { dockHeight != ProjectChats.Height.CLOSED }
                        SideEffect { dockedChat = dockedNow }
                        DisposableEffect(Unit) { onDispose { dockedChat = null } }
                        Box(Modifier.fillMaxSize()) {
                            CompanyScreen(app, wide = wide, ways = dev.botdot.app.ui.CompanyWays(
                                onBot = { dock(ProjectChats.Open(ProjectChats.BOT, it)) },
                                onBotSay = { bot, words -> app.botWords = bot to words; dock(ProjectChats.Open(ProjectChats.BOT, bot)) },
                                onChief = { dock(ProjectChats.Open(ProjectChats.CHIEF, "latest")) },
                                onNeeds = { nav.navigate("needs") },
                                onChiefSay = { app.chiefWords = it; open("chief/new") },
                                onTeam = { dock(ProjectChats.Open(ProjectChats.TEAM, it)) },
                                onFolder = { nav.navigate("files/${android.net.Uri.encode(dev.botdot.app.data.UploadedFiles.FOLDER + it)}") },
                                onGoalChat = { dock(ProjectChats.Open(ProjectChats.CHIEF, it)) },
                            ), spaces = spaceWays)
                            ProjectChatSheet(ProjectChats.of(docked), dockHeight, onHeight = { dockHeight = it }) { o ->
                                androidx.compose.runtime.key(o.key) {
                                    if (o.kind == ProjectChats.CHIEF) ChiefScreen(app, o.id, emptyList(), "", onSettings = { panelKept = SettingsPanel.toggle(panelKept, SettingsPanel.CHIEF) },
                                        onNeeds = { undock { nav.navigate("needs") } }, onBot = { dock(ProjectChats.Open(ProjectChats.BOT, it)) }, onScreen = { undock { nav.navigate("screen/$it") } },
                                        onSkills = { undock { nav.navigate("skills") } }, onSignIn = { undock { nav.navigate("settings") { launchSingleTop = true } } },
                                        onFiles = { undock { nav.navigate("files/${UploadedFiles.CHIEF}") } }) { undock() }
                                    else if (o.kind == ProjectChats.TEAM) GroupChatScreen(app, o.id, onSettings = { panelKept = SettingsPanel.toggle(panelKept, groupKey(o.id)) }, onNeeds = { undock { nav.navigate("needs") } },
                                        onSignIn = { undock { nav.navigate("settings") { launchSingleTop = true } } }) { undock() }
                                    else {
                                        // Words the floor started for this bot (a standup's Reply).
                                        val text = remember { app.botWords?.takeIf { it.first == o.id }?.second?.also { app.botWords = null } ?: "" }
                                        BotChatScreen(app, o.id, emptyList(), text, onJobs = { panelKept = SettingsPanel.jobs(panelKept, o.id) }, onSettings = { panelKept = SettingsPanel.toggle(panelKept, o.id) },
                                            onNeeds = { undock { nav.navigate("needs") } }, onLearned = { panelKept = SettingsPanel.settings(o.id, it) },
                                            onSignIn = { undock { nav.navigate("settings") { launchSingleTop = true } } }, onGroup = { undock { openGroup(it) } },
                                            onScreen = { undock { nav.navigate("screen/${o.id}") } }, onFiles = { undock { nav.navigate("files/${o.id}") } }) { undock() }
                                    }
                                }
                            }
                        }
                    }
                    composable("dashboard") { DashboardScreen(app, onBot = { nav.navigate("bot/$it") }, onNeeds = { nav.navigate("needs") }) { nav.popBackStack() } }
                    composable("needs") { e -> NeedsYouScreen(app, onChat = { nav.navigate("chief/$it") }, onDone = { if (nav.currentBackStackEntry == e) nav.popBackStack() }) { nav.popBackStack() } }
                    // A bot's files, or the Chief's (#603), full screen.
                    composable("files/{id}") { e ->
                        FilesScreen(app, e.arguments?.getString("id") ?: "") { nav.popBackStack() }
                    }
                    composable("screen/{id}") { e ->
                        val id = e.arguments?.getString("id") ?: ""
                        val bots by app.store.bots.value.collectAsState()
                        val bot = bots?.firstOrNull { it.id == id }
                        val name = bot?.let { "${it.emoji} ${it.name}" }.orEmpty()
                        if (bot?.computer == "boat") BoatScreen(app, id, name) { nav.popBackStack() } else LiveScreen(app, id, name) { nav.popBackStack() }
                    }
                    composable("settings") {
                        SettingsScreen(app, onSkills = { nav.navigate("skills") }, onConnectors = { nav.navigate("connectors") }, onVault = { nav.navigate("vault") }, onPages = { nav.navigate("pages") },
                            onChangeServer = { nav.navigate("connect") }, onBattery = { askBackgroundOk() }) { nav.popBackStack() }
                    }
                    composable("skills") { SkillsScreen(app) { nav.popBackStack() } }
                    composable("pages") { PagesScreen(app) { nav.popBackStack() } }
                    composable("connectors") { ConnectorsScreen(app) { nav.popBackStack() } }
                    composable("vault") { VaultScreen(app) { nav.popBackStack() } }
                    composable("share") {
                        ShareScreen(app, count = shared.size, text = sharedWords,
                            onPick = { who ->
                                panelOff.value()
                                nav.navigate(if (who == "chief") "chief/new?attach=1" else "bot/$who?attach=1") { popUpTo("home") }
                            },
                            onCancel = { sharedUris.value = emptyList(); sharedText.value = ""; nav.popBackStack() })
                    }
                }
                }
                // The panel slides in from the right and fades out (#496). It shows the last panel while it leaves;
                // one that moves beside the chat leaves nothing behind, so its content lives in one place only.
                androidx.compose.animation.AnimatedVisibility(shown != null && !room, enter = Motion.panelIn, exit = Motion.panelOut) {
                    Box(Modifier.fillMaxSize().background(p.bg)) { if (shown == null) lastPanel.value?.let { panelContent(it) } else if (!room) panelContent(shown) }
                }
                }
                }
                // Beside the chat the chat narrows at once, and the panel slides into its place.
                AnimatedVisibility(shown != null && room, enter = Motion.panelIn, exit = Motion.panelOut) {
                    Row {
                        Box(Modifier.width(1.dp).fillMaxHeight().background(p.line))
                        Box(Modifier.width(SettingsPanel.WIDTH.dp).fillMaxHeight()) {
                            CompositionLocalProvider(LocalPanelClose provides { panelKept = null }) {
                                if (shown == null) lastPanel.value?.let { panelContent(it) } else if (room) panelContent(shown)
                            }
                        }
                    }
                }
                }
                // Back closes the panel, the jobs first where they were opened from the settings.
                BackHandler(shown != null) { panelKept = SettingsPanel.back(shown) }
                }
            }
        }
    }

    // In front: the chat on screen is being read. Paused (another app, the screen off): it is not, and the chat's
    // screen says so again when the app is back, after it has drawn its "New" line.
    override fun onResume() {
        super.onResume()
        BotDotApp.of(this).resumed.value = true
    }

    override fun onPause() {
        BotDotApp.of(this).let { it.resumed.value = false; it.reading.hide() }
        super.onPause()
    }

    /** Hands what was shared (files, text) to the chat that was picked, once. */
    private fun takeShared(wanted: Boolean): Pair<List<Uri>, String> {
        if (!wanted) return emptyList<Uri>() to ""
        val got = sharedUris.value to sharedText.value
        sharedUris.value = emptyList()
        sharedText.value = ""
        return got
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putParcelableArrayList(SHARED_URIS, ArrayList(sharedUris.value))
        outState.putString(SHARED_TEXT, sharedText.value)
    }

    // A hardware keyboard: the keypad on screen answers its digits, Esc and Ctrl+K before anything else does
    // (Keypad.action), and leaves a field that has focus everything else. RestrictedApi is suppressed because
    // androidx.core marks its own override of the platform's public Activity.dispatchKeyEvent as library-only.
    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_UP && keysUsed.remove(event.keyCode)) return true
        if (event.action == KeyEvent.ACTION_DOWN) {
            val press = pressOf(event)
            val typing = window.decorView.findFocus()?.onCheckIsTextEditor() == true
            if (press != null && keys.handler?.invoke(press, typing) == true) { keysUsed += event.keyCode; return true }
        }
        return super.dispatchKeyEvent(event)
    }

    /** A key the keypad knows, as [Keypad.Press] names it; null for any other. */
    private fun pressOf(event: KeyEvent): Keypad.Press? {
        val key = when (val code = event.keyCode) {
            in KeyEvent.KEYCODE_1..KeyEvent.KEYCODE_9 -> "${code - KeyEvent.KEYCODE_0}"
            in KeyEvent.KEYCODE_NUMPAD_1..KeyEvent.KEYCODE_NUMPAD_9 -> "${code - KeyEvent.KEYCODE_NUMPAD_0}"
            KeyEvent.KEYCODE_TAB -> "Tab"
            KeyEvent.KEYCODE_ESCAPE -> "Escape"
            KeyEvent.KEYCODE_K -> "K"
            else -> return null
        }
        return Keypad.Press(key, ctrl = event.isCtrlPressed, shift = event.isShiftPressed, alt = event.isAltPressed, meta = event.isMetaPressed)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        intent ?: return
        // The browser, back from the front door's sign-in page (botdot://signed-in?code=…).
        if (intent.action == Intent.ACTION_VIEW && Handoff.isReturn(intent.dataString)) {
            BotDotApp.of(this).backFromBrowser(intent.dataString)
            return
        }
        intent.getStringExtra(Notifier.EXTRA_OPEN)?.let { openTarget.value = it }
        when (intent.action) {
            Intent.ACTION_SEND -> {
                IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { sharedUris.value = listOf(it) }
                sharedText.value = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                sharedUris.value = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            }
        }
    }

    /** Lets the background connection keep going while the phone sleeps (Android's battery saver). */
    @SuppressLint("BatteryLife")
    private fun askBackgroundOk() {
        val pm = getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(packageName)) {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        } else {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }
    }

    private companion object {
        const val SHARED_URIS = "sharedUris"
        const val SHARED_TEXT = "sharedText"
    }
}
