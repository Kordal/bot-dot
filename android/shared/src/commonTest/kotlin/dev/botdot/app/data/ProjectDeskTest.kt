package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.io.Buffer
import kotlinx.io.writeString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * A project's page as both phones draw it (ProjectDesk, #1366): the Android app's Company rules, from the shared Store,
 * and what each tap sends to a fake botdot (Ktor's MockEngine, as NeedsDeskTest), on Android's host and in the iOS
 * simulator alike.
 */
class ProjectDeskTest {
    private data class Asked(val method: String, val path: String, val query: String, val body: String)

    private class FakeBotdot(answer: suspend (Asked) -> Pair<Int, String>) {
        private val lock = Mutex()
        private val took = mutableListOf<Asked>()
        val api = Api("https://botdot.test", MockEngine { req ->
            val asked = Asked(req.method.value, req.url.encodedPath.removePrefix("/api"), req.url.encodedQuery, (req.body as? TextContent)?.text.orEmpty())
            lock.withLock { took += asked }
            val (status, body) = answer(asked)
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        suspend fun asked(): List<Asked> = lock.withLock { took.toList() }
    }

    private val all = listOf(CompanySetup.FEATURE, ManyProjects.SETTINGS, ManyProjects.TIDY, ManyProjects.CHIEF, ManyProjects.MANAGER_BOT,
        ProjectBots.FEATURE, ProjectCards.FEATURE, ProjectFiles.FEATURE, Groups.TEAM_CHATS)

    private fun bot(json: String): Bot = Api.JSON.decodeFromString(Bot.serializer(), json)
    private fun company(json: String): Company = CompanySetup.of(json)

    private val kitchen = """{"id":"p1","name":"Kitchen","phase":"running","day":12,"color":"#34c759","folder":{"name":"kitchen","path":"/home/projects/kitchen"},
        "teams":[{"id":"t1","name":"Crew","bots":["b1","b2"],"lead":"b2"}],"bots":["b3"],"cards":[{"id":"k1","ask":"Quotes","state":"ready"}]}"""

    private fun TestScope.desk(fake: FakeBotdot, features: List<String> = all, c: String = kitchen): Pair<Store, ProjectDesk> {
        val store = Store(backgroundScope, MutableStateFlow(null))
        store.version.set(VersionInfo(features = features))
        store.bots.set(listOf(
            bot("""{"id":"b1","name":"Ada","description":"Plans"}"""),
            bot("""{"id":"b2","name":"Bo","running":true}"""),
            bot("""{"id":"b3","name":"Cy","asks":{"text":"Which tiles?"}}"""),
            bot("""{"id":"b4","name":"Di"}"""),
        ))
        store.groups.set(listOf(Api.JSON.decodeFromString(Group.serializer(), """{"id":"g1","name":"Crew","team":"t1"}""")))
        store.chief.set(ChiefOverview())
        store.needs.set(Needs())
        store.dashboard.set(Dashboard())
        store.company.set(CompanyHeld(company(c)))
        return store to ProjectDesk(store, fake.api, backgroundScope)
    }

    private suspend fun TestScope.until(what: String, done: suspend () -> Boolean) {
        repeat(400) {
            if (done()) return
            advanceTimeBy(50)
            runCurrent()
            withContext(Dispatchers.Default) { delay(5) }
        }
        fail("never: $what")
    }

    @Test fun theProjectIsOneSpaceWithWhatWaitsInIt() = runTest {
        val (_, desk) = desk(FakeBotdot { 200 to "{}" })
        runCurrent()
        val s = desk.state.value
        assertTrue(s.shows)
        assertEquals(listOf("Kitchen"), s.spaces.map { it.name })
        assertEquals(1, s.spaces.single().asks) // Cy's question
        assertEquals("Kitchen", s.name)
        assertEquals(12, s.day)
    }

    @Test fun theToDoAddsTicksAndFiltersItsItems() = runTest {
        val fake = FakeBotdot { a -> if (a.method == "GET") 200 to "{}" else 200 to kitchen }
        val (_, desk) = desk(fake, all + ProjectTodo.FEATURE)
        until("the To-do") { desk.state.value.todo != null }
        assertEquals("To-do", desk.state.value.todo!!.title)
        assertTrue(desk.addTodo("@Ada plan the menu", null, "2026-12-01", Repeat("week", days = listOf(1))))
        val added = fake.asked().last { it.path == "/company/todos" }
        assertEquals("POST", added.method)
        assertTrue(added.body.contains("\"text\":\"plan the menu\"") && added.body.contains("\"bot\":\"b1\""), added.body)
        assertTrue(added.body.contains("\"due\":\"2026-12-01\"") && added.body.contains("\"every\":\"week\""), added.body)
        assertFalse(desk.addTodo("   ", null, null, null), "nothing typed: nothing sent")
        desk.tickTodo("k9", true)
        assertEquals("PUT", fake.asked().last { it.path == "/company/todos/k9" }.method)
        desk.todoFilter("bots")
        until("the filter") { desk.state.value.todo?.filter == "bots" }
        desk.todoFilter("nonsense")
        runCurrent()
        assertEquals("bots", desk.state.value.todo?.filter, "only the four filters")
    }

    @Test fun aBoardTheOwnerArrangedReadsInItsCanvasOrderOnAPhone() = runTest {
        // Files under the days line, the card at the top: a phone's column reads them from the top (ADR 147).
        val arranged = kitchen.dropLast(1) + ""","layout":{"card:k1":[0,0,392,220],"days":[0,236,1200,140],"files":[0,392,392,260]}}"""
        val (store, desk) = desk(FakeBotdot { 200 to "{}" }, all + BoardCanvas.FEATURE + ProjectFiles.FEATURE, arranged)
        until("the project") { desk.state.value.project != null }
        val order = desk.state.value.order!!
        assertEquals(listOf("card:k1", "days", "files"), order.filter { it in setOf("card:k1", "days", "files") })
        assertTrue("new-card" in order, "a tile with no place takes a free spot: " + order)
        store.version.set(VersionInfo(features = all + ProjectFiles.FEATURE))
        until("without project-layout, the usual flow") { desk.state.value.order == null }
        store.company.set(CompanyHeld(company(kitchen)))
        store.version.set(VersionInfo(features = all + BoardCanvas.FEATURE))
        until("never arranged: the usual flow") { desk.state.value.project != null && desk.state.value.order == null }
    }

    @Test fun itsOverviewShowsOnceTheFeaturesSaySo() = runTest {
        val (store, desk) = desk(FakeBotdot { 200 to "{}" })
        until("the project") { desk.state.value.project != null }
        assertFalse(desk.state.value.overview, "a botdot without project-overview")
        store.version.set(VersionInfo(features = all + ProjectOverview.FEATURE))
        until("drawn again with the features") { desk.state.value.overview }
    }

    @Test fun aTeamsLeadComesFirstWithTheCrownAndItsChat() = runTest {
        val (_, desk) = desk(FakeBotdot { 200 to "{}" })
        runCurrent()
        val t = desk.state.value.teams.single()
        assertEquals(listOf("Bo", "Ada"), t.keys.map { it.bot.name })
        assertEquals(listOf(true, false), t.keys.map { it.lead })
        assertEquals(listOf(true, false), t.keys.map { it.crown })
        assertEquals("g1", t.chat)
        assertEquals("1 working", t.word)
        assertEquals("Plans", t.keys[1].line)
    }

    @Test fun withNoLeadSetTheFirstMemberLeadsWithoutTheCrownWhenAlone() = runTest {
        val (_, desk) = desk(FakeBotdot { 200 to "{}" }, c = kitchen.replace(",\"lead\":\"b2\"", "").replace("[\"b1\",\"b2\"]", "[\"b1\"]"))
        runCurrent()
        val k = desk.state.value.teams.single().keys.single()
        assertTrue(k.lead)
        assertFalse(k.crown)
    }

    @Test fun aSecondTapWhileTheChiefChatIsMadeAsksNothing() = runTest {
        val gate = CompletableDeferred<Unit>()
        val fake = FakeBotdot { a -> if (a.path == "/company/chief-chat") { gate.await(); 200 to """{"chatId":"c7"}""" } else 200 to "{}" }
        val (_, desk) = desk(fake)
        runCurrent()
        val first = async(Dispatchers.Default) { desk.chiefChat() }
        until("the first is asked") { fake.asked().any { it.path == "/company/chief-chat" } }
        assertEquals("", desk.chiefChat())
        gate.complete(Unit)
        assertEquals("c7", first.await())
        assertEquals(1, fake.asked().count { it.path == "/company/chief-chat" })
    }

    @Test fun theProjectsOwnBotsAreKeysAndAddBotOffersTheOthers() = runTest {
        val (_, desk) = desk(FakeBotdot { 200 to "{}" })
        runCurrent()
        val s = desk.state.value
        assertEquals(listOf("Cy"), s.own.map { it.bot.name })
        assertTrue(s.own.single().asks)
        assertEquals("Which tiles?", s.own.single().line)
        assertEquals(listOf("Di"), s.addable.map { it.name })
    }

    @Test fun withoutTheirFeaturesThereIsNoGearNoTidyNoCardsAndNoFilesTile() = runTest {
        val (_, desk) = desk(FakeBotdot { 200 to "{}" }, features = listOf(CompanySetup.FEATURE))
        runCurrent()
        val s = desk.state.value
        assertFalse(s.settings)
        assertFalse(s.tidy)
        assertNull(s.cards)
        assertFalse(s.filesTile)
        assertFalse(s.ownBots)
        assertNull(s.teams.single().chat)
    }

    @Test fun theProjectManagerIsTheDefaultChat() = runTest {
        val (_, desk) = desk(FakeBotdot { 200 to "{}" }, c = kitchen.replace("\"day\":12", "\"day\":12,\"lead\":\"b1\""))
        runCurrent()
        val chat = assertNotNull(desk.state.value.chat)
        assertEquals("bot/b1", chat.route)
        assertEquals("Ada", chat.bot?.name)
        assertEquals("Ada", desk.state.value.manager?.name)
    }

    @Test fun withoutAManagerTheDefaultChatIsTheProjectsChiefChat() = runTest {
        val (store, desk) = desk(FakeBotdot { 200 to "{}" }, c = kitchen.replace("\"day\":12", "\"day\":12,\"chiefChat\":\"c9\""))
        store.chief.set(ChiefOverview(chats = listOf(ChiefChatSummary("c9", unread = 2))))
        runCurrent()
        val chat = assertNotNull(desk.state.value.chat)
        assertEquals("chief/c9", chat.route)
        assertNull(chat.bot)
        assertEquals(2, chat.waiting)
        assertEquals(2, desk.state.value.chiefWaiting)
    }

    @Test fun theProjectsChiefChatIsMadeOnTheFirstTap() = runTest {
        val fake = FakeBotdot { a -> if (a.path == "/company/chief-chat") 200 to """{"chatId":"c7"}""" else 200 to "{}" }
        val (_, desk) = desk(fake)
        runCurrent()
        assertEquals("c7", desk.chiefChat())
        assertEquals(1, fake.asked().count { it.path == "/company/chief-chat" && it.method == "POST" })
    }

    @Test fun oneChangeOfTheOwnBotsAtATime() = runTest {
        val gate = CompletableDeferred<Unit>()
        val fake = FakeBotdot { a ->
            if (a.path == "/company/bots") { gate.await(); 200 to kitchen.replace("\"bots\":[\"b3\"]", "\"bots\":[\"b3\",\"b4\"]") } else 200 to "{}"
        }
        val (store, desk) = desk(fake)
        runCurrent()
        val first = async(Dispatchers.Default) { desk.addOwn(listOf("b4")) }
        until("the first is on its way") { desk.state.value.ownSaving }
        assertFalse(desk.removeOwn("b3")) // the second waits for nothing: it is not sent
        gate.complete(Unit)
        assertTrue(first.await())
        until("the answer is taken") { store.company.value.value?.company?.bots == listOf("b3", "b4") }
        val sent = fake.asked().filter { it.path == "/company/bots" }
        assertEquals(1, sent.size)
        assertEquals("""{"bots":["b3","b4"]}""", sent.single().body)
        until("the next change is let in") { !desk.state.value.ownSaving }
    }

    @Test fun aRefusedNewCardOpensAgainWithItsWordsAndSaysWhy() = runTest {
        val fake = FakeBotdot { a -> if (a.path == "/company/cards") 400 to """{"error":"Too many cards"}""" else 200 to "{\"company\":null}" }
        val (_, desk) = desk(fake)
        runCurrent()
        desk.openCard(ProjectCards.NEW)
        runCurrent()
        assertTrue(desk.state.value.cards!!.last() is ProjectCards.Slot.Ask)
        desk.ask("Open quotes")
        runCurrent()
        val s = desk.state.value
        assertEquals("Open quotes", s.refused)
        assertTrue(s.cards!!.last() is ProjectCards.Slot.Ask)
        assertEquals("Too many cards", s.notice)
        assertEquals(1, s.noticeCount)
    }

    @Test fun aRemovedCardLeavesTheRowBeforeBotdotAnswers() = runTest {
        val gate = CompletableDeferred<Unit>()
        val fake = FakeBotdot { a -> if (a.method == "DELETE") { gate.await(); 200 to kitchen.replace(""","cards":[{"id":"k1","ask":"Quotes","state":"ready"}]""", "") } else 200 to "{}" }
        val (_, desk) = desk(fake)
        runCurrent()
        assertEquals(2, desk.state.value.cards!!.size) // the card and New card
        val removing = async(Dispatchers.Default) { desk.removeCard("k1") }
        until("off the row") { desk.state.value.cards!!.size == 1 }
        gate.complete(Unit)
        removing.await()
        until("New card alone") { desk.state.value.cards == listOf(ProjectCards.Slot.New) }
    }

    @Test fun aCardsAnswerSaysWhetherBotdotTookItSoTheButtonsWorkAgain() = runTest {
        var refuse = true
        val fake = FakeBotdot { a ->
            if (a.method == "POST" && a.path.endsWith("/cards/k1/answer")) { if (refuse) 500 to """{"error":"The Chief is busy."}""" else 200 to kitchen } else 200 to "{}"
        }
        val (_, desk) = desk(fake)
        runCurrent()
        assertFalse(desk.answer("k1", "Weekly"), "refused: the card's choices and Send work again")
        until("the refusal is said") { desk.state.value.notice == "The Chief is busy." }
        refuse = false
        assertTrue(desk.answer("k1", " Weekly "))
        assertFalse(desk.answer("k1", "  "), "nothing typed: nothing sent")
        assertEquals(2, fake.asked().count { it.path.endsWith("/cards/k1/answer") })
    }

    @Test fun aBotTheInfoSaysIsWorkingCountsAlsoWhileNotRunning() {
        val idle = bot("""{"id":"a","name":"Ada"}""")
        val running = bot("""{"id":"b","name":"Bo","running":true}""")
        val info = CompanyFloor.Info(asks = { 0 }, working = { it == "a" })
        assertTrue(ProjectRules.working(info, idle), "the page knows it works (a turn at work) though running is false")
        assertTrue(ProjectRules.working(info, running))
        assertEquals(2, ProjectRules.workingCount(info, listOf(idle, running)))
        assertEquals(1, ProjectRules.workingCount(CompanyFloor.Info(asks = { 0 }, working = { false }), listOf(idle, running)))
    }

    /**
     * Two taps at once, on two threads, [rounds] times: [tap] answers whether it went, and botdot is asked [path] once a
     * round, held until both taps are in.
     */
    private fun twoTapsAtOnce(path: String, answer: String, tap: suspend (ProjectDesk) -> Boolean) = runTest {
        repeat(20) { round ->
            val held = CompletableDeferred<Unit>()
            val fake = FakeBotdot { a -> if (a.method != "GET" && a.path.endsWith(path)) { held.await(); 200 to answer } else 200 to "{}" }
            val (_, desk) = desk(fake)
            runCurrent()
            val taps = List(2) { async(Dispatchers.Default) { tap(desk) } }
            withContext(Dispatchers.Default) { while (fake.asked().none { it.path.endsWith(path) }) delay(1) }
            withContext(Dispatchers.Default) { delay(20) } // the other tap has had its go
            held.complete(Unit)
            assertEquals(1, taps.awaitAll().count { it }, "round $round: one tap goes")
            assertEquals(1, fake.asked().count { it.method != "GET" && it.path.endsWith(path) }, "round $round: botdot is asked once")
        }
    }

    @Test fun twoTidyTapsAtOnceAskOnce() = twoTapsAtOnce("/company/layout/tidy", """{"chatId":"c1"}""") { it.tidy().isNotEmpty() }

    @Test fun twoChiefChatTapsAtOnceMakeOneChat() = twoTapsAtOnce("/company/chief-chat", """{"chatId":"c1"}""") { it.chiefChat().isNotEmpty() }

    @Test fun twoOwnBotsChangesAtOnceSendOneList() = twoTapsAtOnce("/company/bots", kitchen) { it.setOwnBots(listOf("b3", "b4")) }

    /** What the settings and the team panel sent, as botdot got it: method, path, body. */
    private suspend fun FakeBotdot.changes(): List<Triple<String, String, String>> = asked().filter { it.method != "GET" }.map { Triple(it.method, it.path, it.body) }

    @Test fun theSettingsSendNothingThatChangesNothing() = runTest {
        val fake = FakeBotdot { 200 to kitchen }
        val (_, desk) = desk(fake)
        runCurrent()
        assertFalse(desk.rename(" Kitchen "), "the same name")
        assertFalse(desk.rename("   "), "no name")
        assertFalse(desk.setColor("#34C759"), "the same colour, in capitals")
        assertFalse(desk.setLead(null), "the Chief is the Project Manager already")
        assertTrue(fake.changes().isEmpty())
        assertTrue(desk.rename("  Big kitchen "))
        assertTrue(desk.setColor("#ff9500"))
        assertEquals(listOf(
            Triple("PATCH", "/company", """{"name":"Big kitchen"}"""),
            Triple("PATCH", "/company", """{"color":"#ff9500"}"""),
        ), fake.changes())
    }

    @Test fun theProjectManagerGoesBackToTheChiefAsJsonNull() = runTest {
        val fake = FakeBotdot { 200 to kitchen }
        val (_, desk) = desk(fake, c = kitchen.replace("\"color\":\"#34c759\"", "\"color\":\"#34c759\",\"lead\":\"b3\""))
        runCurrent()
        assertTrue(desk.setLead(null))
        assertEquals(Triple("PATCH", "/company", """{"lead":null}"""), fake.changes().single())
    }

    @Test fun aTeamsPlusSendsItsBotsAndOnlyTheNewOnes() = runTest {
        val fake = FakeBotdot { 200 to kitchen }
        val (_, desk) = desk(fake)
        runCurrent()
        assertTrue(desk.addToTeam("t1", listOf("b2", "b4")))
        assertEquals(Triple("PUT", "/company/teams/t1", """{"bots":["b1","b2","b4"]}"""), fake.changes().single())
        assertFalse(desk.addToTeam("gone", listOf("b4")), "a team that isn't there: nothing sent")
        assertEquals(1, fake.changes().size)
    }

    @Test fun makeLeadArchiveAndABoardPieceSendWhatTheySay() = runTest {
        val fake = FakeBotdot { 200 to kitchen }
        val (_, desk) = desk(fake)
        runCurrent()
        assertTrue(desk.makeLead("t1", "b1"))
        assertTrue(desk.setArchived(true))
        desk.putPiece("calendar") // on the board: tapped, it goes
        val c = fake.changes()
        assertEquals(Triple("PUT", "/company/teams/t1", """{"lead":"b1"}"""), c[0])
        assertEquals(Triple("PATCH", "/company", """{"archived":true}"""), c[1])
        assertEquals(Triple("PATCH", "/company", """{"board":["days","goals","teams","todo","files"]}"""), c[2])
    }

    @Test fun aTeamsChatIsOnlyOnABotdotWithTeamChats() {
        val groups = listOf(Api.JSON.decodeFromString(Group.serializer(), """{"id":"g1","name":"Crew","team":"t1"}"""))
        assertEquals("g1", ProjectRules.teamChat(listOf(Groups.TEAM_CHATS), groups, "t1"))
        assertNull(ProjectRules.teamChat(listOf("groups"), groups, "t1"), "without team-chats its name opens its panel")
        assertNull(ProjectRules.teamChat(null, groups, "t1"))
        assertNull(ProjectRules.teamChat(listOf(Groups.TEAM_CHATS), groups, "t2"))
    }

    @Test fun theFilesTileAsksForTheNewestFilesWhileFollowed() = runTest {
        val fake = FakeBotdot { a -> if (a.path == "/company/files") 200 to """{"state":"on","files":[{"name":"plan.md","path":"plan.md","at":1}]}""" else 200 to "{}" }
        val (_, desk) = desk(fake)
        runCurrent()
        assertTrue(desk.state.value.filesTile)
        desk.follow(true)
        until("the files") { desk.state.value.files.map { it.name } == listOf("plan.md") }
        assertEquals("project=p1", fake.asked().first { it.path == "/company/files" }.query)
        desk.follow(false)
    }

    @Test fun aTeamsWordNamesWhoWaitsThenHowManyWork() {
        val bots = listOf(bot("""{"id":"a","name":"Ada"}"""), bot("""{"id":"b","name":"Bo"}"""), bot("""{"id":"c","name":"Cy"}"""))
        assertEquals(ProjectRules.TeamWord("Needs you: Ada, Bo +2", true), ProjectRules.teamWord(Spaces.TeamWait(listOf("a", "b", "c"), chat = 1), bots, 0))
        assertEquals(ProjectRules.TeamWord("Needs you: Team chat", true), ProjectRules.teamWord(Spaces.TeamWait(chat = 1), bots, 2))
        assertEquals(ProjectRules.TeamWord("2 working", false), ProjectRules.teamWord(Spaces.TeamWait(), bots, 2))
        assertEquals(ProjectRules.TeamWord("", false), ProjectRules.teamWord(Spaces.TeamWait(), bots, 0))
    }

    @Test fun aNewBotsWordsNameTheProjectAndTheTeam() {
        val c = company(kitchen)
        assertEquals("A new bot for Kitchen: ", ProjectRules.newBotWords(c))
        assertEquals("A new bot for the Crew team in Kitchen: ", ProjectRules.newBotWords(c, c.teams.single()))
    }

    @Test fun aBotInAnotherTeamIsOfferedLastSayingWhichTeam() {
        val c = company("""{"id":"p","teams":[{"id":"t1","name":"Crew","bots":["a"]},{"id":"t2","name":"Shop","bots":["b"]}]}""")
        val bots = listOf(bot("""{"id":"a","name":"Ada"}"""), bot("""{"id":"b","name":"Bo"}"""), bot("""{"id":"c","name":"Cy","description":"Free"}"""))
        assertEquals(listOf("Cy" to "Free", "Bo" to "In Shop"), ProjectRules.offered(c, c.teams[0], bots).map { it.name to it.description })
    }
    @Test fun theReportsRowsFollowTheFeatures() = runTest {
        val (_, a) = desk(FakeBotdot { 200 to kitchen }, all + listOf(ProjectUpdates.FEATURE, CompanyFloor.LEADS, ProjectStandup.FEATURE))
        runCurrent()
        with(a.state.value) { assertTrue(updates); assertFalse(rhythms, "project updates replace each lead's rhythm"); assertFalse(standup) }
        val (_, b) = desk(FakeBotdot { 200 to kitchen }, all + listOf(CompanyFloor.LEADS, ProjectStandup.FEATURE))
        runCurrent()
        with(b.state.value) { assertFalse(updates); assertTrue(rhythms); assertTrue(standup) }
    }

    @Test fun theGeneralAndRulesSettingsSendWhatTheySayAndNothingEmpty() = runTest {
        val fake = FakeBotdot { 200 to kitchen }
        val (_, desk) = desk(fake)
        runCurrent()
        assertFalse(desk.setStart("   "), "no site or idea")
        assertFalse(desk.addNever("  "), "no rule")
        assertFalse(desk.removeNever(3), "no rule there")
        assertFalse(desk.setTime(""), "the same time")
        assertFalse(desk.setStandupTime("9:00"), "not HH:MM")
        assertFalse(desk.addLink("  "), "no link")
        assertTrue(fake.changes().isEmpty())
        assertTrue(desk.setStart(" A cafe "))
        assertTrue(desk.addNever(" Spend money "))
        assertTrue(desk.setTime("2 hours a week"))
        assertTrue(desk.setStandupTime("09:30"))
        assertTrue(desk.setStandupOn(false))
        assertTrue(desk.setUpdates("weekly"))
        assertTrue(desk.setReportRhythm("t1", "daily"))
        assertEquals(listOf(
            Triple("PATCH", "/company", """{"start":"A cafe"}"""),
            Triple("PATCH", "/company", """{"never":["Spend money"]}"""),
            Triple("PATCH", "/company", """{"time":"2 hours a week"}"""),
            Triple("PUT", "/company/standup", """{"time":"09:30"}"""),
            Triple("PUT", "/company/standup", """{"on":false}"""),
            Triple("PUT", "/company/updates", """{"every":"weekly"}"""),
            Triple("PUT", "/company/teams/t1", """{"report":"daily"}"""),
        ), fake.changes())
    }

    @Test fun aLinkIsAddedToTheSourcesKeptAndOneIsTakenOff() = runTest {
        val fake = FakeBotdot { 200 to kitchen }
        val (_, desk) = desk(fake, c = kitchen.replace("\"bots\":[\"b3\"]", "\"bots\":[\"b3\"],\"sources\":[{\"id\":\"s1\",\"kind\":\"link\",\"url\":\"https://a.test\",\"name\":\"a.test\"}]"))
        runCurrent()
        assertTrue(desk.addLink("menu.test/today"))
        assertTrue(desk.removeSource("s1"))
        val (added, gone) = fake.changes().map { it.third }
        assertTrue("\"id\":\"s1\"" in added && "menu.test/today" in added, added)
        assertEquals("""{"sources":[]}""", gone)
    }

    @Test fun deleteForgetsTheProjectAndARefusalSaysWhy() = runTest {
        var status = 500
        val fake = FakeBotdot { status to """{"error":"Busy"}""" }
        val (store, desk) = desk(fake)
        runCurrent()
        assertFalse(desk.delete(dropFolder = true))
        runCurrent()
        assertEquals("Busy", desk.state.value.notice)
        assertNotNull(store.company.value.value?.company, "a refused delete keeps the project")
        status = 200
        assertTrue(desk.delete(dropFolder = false))
        assertEquals(listOf("DELETE" to "/company", "DELETE" to "/company"), fake.changes().map { it.first to it.second })
        assertEquals("folder=delete&project=p1", fake.asked().first { it.method == "DELETE" }.query, "this project, with its folder")
        assertNull(store.company.value.value?.company, "one project's botdot: no project left")
    }

    @Test fun theSettingsWordsAreAndroids() {
        assertEquals(listOf("Off", "Daily", "Twice a week", "Weekly"), ProjectSettingWords.rhythms.map { it.label })
        assertTrue(ProjectSettingWords.isTime("23:59"))
        assertFalse(ProjectSettingWords.isTime("24:00"))
        assertEquals("Delete the project Kitchen? Its bots stay.", ProjectSettingWords.deleteQuestion(company(kitchen)))
    }

    @Test fun withOverviewBoardTheOverviewIsTheBoardsTilesReadWhileFollowed() = runTest {
        val snapshot = """{"projectId":"p1","at":"2026-11-15T09:00:00Z","work":[{"id":"w1","botId":"b1","name":"Ada","state":"working"}],
            "blockers":[{"id":"q1","botId":"b1","name":"Ada","state":"asks","text":"Which tiles?"}],"replies":[]}"""
        val fake = FakeBotdot { a -> if (a.path == "/company/overview") 200 to snapshot else 200 to "{}" }
        val (_, desk) = desk(fake, all + listOf(ProjectOverview.FEATURE, ProjectOverview.BOARD))
        runCurrent()
        with(desk.state.value) {
            assertTrue(board)
            assertFalse(overview, "no Overview page: the board is it")
            assertFalse(teamsOnBoard, "the teams are under Team")
            assertTrue(teamEntry, "and Team opens them")
            assertEquals(listOf("work", "blockers"), overviewTop)
            assertTrue(replies)
            assertNull(needsYou, "nothing read yet, nothing waits")
        }
        desk.follow(true)
        until("the recorded work") { desk.state.value.recorded.snapshot?.work?.size == 1 }
        assertEquals(listOf("q1"), desk.state.value.needsYou?.questions?.map { it.id }, "the question stands in Needs you")
        desk.follow(false)
        val (_, page) = desk(FakeBotdot { 200 to "{}" }, all + ProjectOverview.FEATURE)
        runCurrent()
        with(page.state.value) { assertTrue(overview); assertFalse(board); assertTrue(teamsOnBoard); assertFalse(teamEntry); assertTrue(overviewTop.isEmpty()); assertFalse(replies) }
    }

    @Test fun aTeamIsSavedNewOrAsItIsAndDeletedAndNothingWithoutANameOrABot() = runTest {
        val fake = FakeBotdot { 200 to kitchen }
        val (_, desk) = desk(fake)
        runCurrent()
        assertFalse(desk.saveTeam(null, "  ", listOf("b1"), null), "no name")
        assertFalse(desk.saveTeam("t1", "Crew", emptyList(), null), "no bot")
        assertFalse(ManyProjects.canSaveTeam(" ", listOf("b1")) || ManyProjects.canSaveTeam("Crew", emptyList()), "Save waits for both")
        assertTrue(fake.changes().isEmpty())
        assertTrue(desk.saveTeam(null, "  New   crew ", listOf("b1", "b4"), "b4"))
        assertTrue(desk.saveTeam("t1", "Crew", listOf("b1"), "b2"))
        assertTrue(desk.deleteTeam("t1"))
        assertEquals(listOf(
            Triple("POST", "/company/teams", """{"name":"New crew","bots":["b1","b4"],"lead":"b4"}"""),
            Triple("PUT", "/company/teams/t1", """{"name":"Crew","bots":["b1"],"lead":"b1"}"""),
            Triple("DELETE", "/company/teams/t1", "{}"),
        ), fake.changes())
        assertEquals("Delete the team Crew? Its bots stay.", ProjectSettingWords.deleteTeamQuestion(company(kitchen).teams[0]))
    }

    @Test fun theVaultsLoginsAreOfferedOnceAndAnUnreadVaultSaysWhy() = runTest {
        var vault = 200
        val fake = FakeBotdot { a ->
            if (a.path == "/vault") vault to (if (vault == 200) """[{"id":"v1","name":"Shop","kind":"login"},{"id":"v2","name":"Card","kind":"card"},{"id":"v3","name":"Mail","kind":"login"}]""" else """{"error":"Locked"}""")
            else 200 to kitchen
        }
        val (_, desk) = desk(fake, all + ProjectLogins.FEATURE, kitchen.replace("\"bots\":[\"b3\"]", "\"bots\":[\"b3\"],\"logins\":[{\"id\":\"v3\",\"name\":\"Mail\"}]"))
        runCurrent()
        assertTrue(desk.state.value.logins)
        assertEquals(listOf("v1"), desk.addableLogins()?.map { it.id }, "a login not the project's yet")
        assertFalse(desk.addLogin("v3"), "already the project's")
        assertTrue(desk.addLogin("v1"))
        assertTrue(desk.removeLogin("v3"))
        assertEquals(listOf("""{"logins":["v3","v1"]}""", """{"logins":[]}"""), fake.changes().map { it.third })
        vault = 500
        assertNull(desk.addableLogins())
        runCurrent()
        assertEquals("Locked", desk.state.value.notice)
        val (_, without) = desk(FakeBotdot { 200 to kitchen })
        runCurrent()
        assertFalse(without.state.value.logins)
    }

    @Test fun filesAreUploadedAsSourcesAndOneTooBigOrUnreadIsSaid() = runTest {
        val fake = FakeBotdot { a -> if (a.path == "/uploads") 200 to """{"name":"menu.pdf","file":"u1","size":4}""" else 200 to kitchen }
        val (_, desk) = desk(fake)
        runCurrent()
        val menu = OutgoingFile("menu.pdf", 4) { Buffer().apply { writeString("menu") } }
        val big = OutgoingFile("big.mov", CompanySetup.MAX_FILE + 1) { null }
        assertTrue(desk.addFiles(listOf(big, menu), listOf("lost.txt")))
        runCurrent()
        assertEquals("lost.txt: Couldn't read that file.\nbig.mov is over 25 MB.", desk.state.value.notice)
        val sent = fake.asked().filter { it.method != "GET" }
        assertEquals(listOf("/uploads", "/company"), sent.map { it.path }, "one upload, then the sources")
        assertEquals("to=chief", sent[0].query.substringBefore('&'))
        assertTrue("\"kind\":\"file\"" in sent[1].body && "\"file\":\"u1\"" in sent[1].body, sent[1].body)
        assertFalse(desk.addFiles(emptyList(), emptyList()), "nothing picked: nothing sent")
    }
}
