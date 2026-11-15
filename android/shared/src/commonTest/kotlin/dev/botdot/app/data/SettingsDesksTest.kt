package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A bot's settings, the app's Settings and Apps as the iPhone draws them (#1370): Android's rules, moved to the shared
 * layer, against a fake botdot (Ktor's MockEngine under the shared Api), on Android's host and in the iOS simulator.
 */
class SettingsDesksTest {
    private data class Sent(val method: String, val path: String, val body: String)

    /** A fake botdot: [answer] gives each request its status and body; [sent] holds what came, in order. */
    private class MockBotdot(answer: suspend (Sent) -> Pair<Int, String>) {
        private val lock = Mutex()
        private val took = mutableListOf<Sent>()
        val api = Api("https://botdot.test", MockEngine { req ->
            val sent = Sent(req.method.value, req.url.encodedPath.removePrefix("/api") + (req.url.encodedQuery.takeIf { it.isNotEmpty() }?.let { "?$it" } ?: ""),
                (req.body as? TextContent)?.text.orEmpty())
            lock.withLock { took += sent }
            val (status, body) = answer(sent)
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        suspend fun sent(): List<Sent> = lock.withLock { took.toList() }
        suspend fun changes(): List<Sent> = sent().filter { it.method != "GET" }
    }

    /** Runs what is due, and gives the fake botdot's answers, which may come on another thread, a moment to land. */
    private suspend fun TestScope.settle(until: suspend () -> Boolean) {
        repeat(200) {
            runCurrent()
            if (until()) return
            withContext(Dispatchers.Default) { delay(5) }
        }
        runCurrent()
    }

    private fun bot(json: String): Bot = Api.JSON.decodeFromString(Bot.serializer(), json)

    private fun TestScope.store(features: List<String> = listOf("everything-allowed")): Store =
        Store(backgroundScope, MutableStateFlow(null)).also { it.version.set(VersionInfo(features = features)) }

    @AfterTest fun advancedAsBefore() = Advanced.take(null, null)

    // ---------- a bot's settings ----------

    private val mail = """{"id":"mail","name":"Mail","color":"#1d9e75","description":"Sorts mail","group":"Home","prompt":"Sort the mail","outfit":{"hat":"cap","icon":"mail"},"hotkey":0}"""

    @Test fun aBotsSettingsStartAsItsOwnAndSendNothingUnchanged() {
        val b = bot(mail)
        val d = BotSettings.draft(b, emptyList())
        assertEquals("#1d9e75", d.color)
        assertEquals("mail", d.icon)
        assertEquals("Sort the mail", d.task)
        assertTrue(BotSettings.changes(b, d, listOf("everything-allowed"), emptyList()).isEmpty())
    }

    @Test fun aNewIconKeepsItsHatAndANewColourIsSentAlone() {
        val b = bot(mail)
        val d = BotSettings.draft(b, emptyList()).copy(icon = "star", color = "#378add")
        val sent = BotSettings.changes(b, d, listOf("everything-allowed"), emptyList())
        assertEquals("""{"color":"#378add","outfit":{"icon":"star"}}""", sent.toString())
        assertEquals("""{"hat":"cap","icon":"star"}""", withIcon(b.outfit, "star").toString(), "the preview wears both")
        assertEquals(8, BotColors.size)
    }

    @Test fun aServerBeforeEveryoneMayMessageGetsWhoItMay() {
        val b = bot("""{"id":"a","name":"A","mayMessage":[]}""")
        val others = listOf(bot("""{"id":"b","name":"B"}"""), bot("""{"id":"c","name":"C"}"""))
        val d = BotSettings.draft(b, others).copy(mayMessage = setOf("b"))
        assertEquals("""{"mayMessage":["b"]}""", BotSettings.changes(b, d, emptyList(), others).toString())
        assertTrue(BotSettings.changes(b, d, listOf("everything-allowed"), others).isEmpty(), "ADR 192: every bot may")
    }

    @Test fun itsComputerSkillsAskingAndRoomsAreSentAsChanged() {
        val b = bot("""{"id":"a","name":"A","computer":"none","useSkills":true,"skills":["notes"],"othersMayAsk":true,"rooms":{"allowRooms":false,"whoMayMention":"owner"}}""")
        val d = BotSettings.draft(b, emptyList()).withComputer(on = true).withSkill(name = "mail", on = true).withSkill(name = "notes", on = false)
            .withOthersMayAsk(on = false).withAllowRooms(on = true).withWhoMayMention(who = BotRooms.MEMBERS)
        val sent = BotSettings.changes(b, d, emptyList(), emptyList())
        assertEquals("linux", sent["computer"]?.jsonPrimitive?.content, "its own computer, on this machine")
        assertEquals("""["mail"]""", sent["skills"].toString())
        assertEquals("false", sent["othersMayAsk"].toString())
        assertTrue(sent.containsKey("rooms"), sent.toString())
        assertFalse(BotSettings.draft(b, emptyList()).withUseSkills(on = false).useSkills)
    }

    @Test fun whatShowsDependsOnWhatTheServerKeeps() {
        val mate = listOf(bot("""{"id":"b","name":"B"}"""))
        val old = BotSettingsState(bot = bot("""{"id":"a","name":"A","othersMayAsk":true,"rooms":{"allowRooms":true}}"""), others = mate, features = listOf(BotRooms.FEATURE))
        assertTrue(old.showsOthersMayAsk && old.showsRooms)
        assertFalse(BotSettingsState(bot = old.bot, others = mate, features = listOf("everything-allowed")).showsOthersMayAsk, "ADR 192: every bot may")
        assertFalse(BotSettingsState(bot = old.bot, features = emptyList()).showsOthersMayAsk, "no other bot to ask it")
        assertTrue(old.showsBrowser, "a server from before every bot has a computer")
        val unknown = BotSettingsState(bot = old.bot, others = mate)
        assertFalse(unknown.showsBrowser || unknown.showsOthersMayAsk || unknown.showsRooms, "the server's features not known yet: none of them")
        assertFalse(BotSettingsState(bot = old.bot, features = listOf("everything-allowed")).showsBrowser)
        val plain = BotSettingsState(bot = bot("""{"id":"a","name":"A"}"""))
        assertFalse(plain.showsOthersMayAsk || plain.showsRooms || plain.undoes)
        assertTrue(BotSettingsState(bot = bot("""{"id":"a","name":"A","undo":"c1"}""")).undoes)
        assertEquals(listOf(BotRooms.OWNER, BotRooms.MEMBERS), plain.whoMayMention.map { it.id })
    }

    @Test fun undoUndoesTheCardsChangeAndReadsTheBotAgain() = runTest {
        val botdot = MockBotdot { s ->
            when {
                s.method == "POST" && s.path == "/bots/a/learning/undo" -> 200 to "{}"
                s.path == "/bots/a" -> 200 to """{"id":"a","name":"A","prompt":"As it was"}"""
                s.path == "/bots" -> 200 to """[{"id":"a","name":"A","prompt":"Changed","undo":"c1"}]"""
                else -> 200 to "{}"
            }
        }
        val desk = BotSettingsDesk(botdot.api, "a", store(), backgroundScope)
        desk.load()
        assertTrue(desk.state.value.undoes)
        assertNull(desk.undo())
        assertTrue(botdot.changes().any { it.path == "/bots/a/learning/undo" && "\"c1\"" in it.body })
        assertEquals("As it was", desk.state.value.draft.task)
        assertFalse(desk.state.value.undoes)
    }

    @Test fun reasoningShowsForAModelThatThinks() {
        val models = listOf(ModelChoice("fast", effort = false), ModelChoice("deep"))
        assertFalse(BotSettings.canThink(models, "fast"))
        assertTrue(BotSettings.canThink(models, "deep"))
        assertTrue(BotSettings.canThink(models, "unknown"), "one botdot does not list takes one")
    }

    @Test fun theKeypadKeySaysWhichBotHoldsADigit() {
        val others = listOf(bot("""{"id":"b","name":"Bea","hotkey":3}"""))
        val keys = BotSettings.hotkeys(others)
        assertEquals(10, keys.size)
        assertEquals("By its place", keys[0].label)
        assertEquals("3 · Now Bea's", keys[3].label)
        assertEquals("4", keys[4].label)
    }

    @Test fun aChangeIsSavedByItselfAMomentAfterTheLastOne() = runTest {
        val botdot = MockBotdot { r ->
            when {
                r.method == "GET" && r.path == "/bots" -> 200 to "[$mail]"
                r.method == "PUT" && r.path == "/bots/mail" -> 200 to mail.replace("\"Mail\"", "\"Post\"")
                r.path == "/settings" -> 200 to """{"settings":{"advanced":true},"models":[{"id":"fast","effort":false}],"efforts":[]}"""
                else -> 404 to "{}"
            }
        }
        val desk = BotSettingsDesk(botdot.api, "mail", store(listOf("everything-allowed", Advanced.FEATURE)), backgroundScope)
        desk.load()
        assertEquals("Mail", desk.state.value.bot?.name)
        assertTrue(desk.state.value.advanced)
        desk.edit { it.copy(name = "Po") }
        desk.edit { it.copy(name = "Post") }
        advanceTimeBy(BotSettings.SAVE_MS - 100)
        runCurrent()
        assertTrue(botdot.changes().isEmpty(), "not before the moment has passed")
        advanceTimeBy(200)
        settle { desk.state.value.savedAt > 0 }
        assertEquals(listOf(Sent("PUT", "/bots/mail", """{"name":"Post"}""")), botdot.changes(), "one save, of the last change")
        assertEquals("Post", desk.state.value.bot?.name)
        assertEquals(1, desk.state.value.savedAt)
    }

    @Test fun aRefusedChangeIsSaidAndNotSentAgainUntilChanged() = runTest {
        val botdot = MockBotdot { r ->
            when {
                r.method == "GET" && r.path == "/bots" -> 200 to "[$mail]"
                r.method == "PUT" -> 400 to """{"error":"That name is taken."}"""
                else -> 404 to "{}"
            }
        }
        val desk = BotSettingsDesk(botdot.api, "mail", store(), backgroundScope)
        desk.load()
        desk.edit { it.copy(name = "Ops") }
        advanceTimeBy(BotSettings.SAVE_MS + 1)
        settle { desk.state.value.error != null }
        assertEquals("That name is taken.", desk.state.value.error)
        advanceTimeBy(BotSettings.SAVE_MS * 3)
        settle { false }
        assertEquals(1, botdot.changes().size, "said once")
        desk.edit { it.copy(name = "Ops 2") }
        advanceTimeBy(BotSettings.SAVE_MS + 1)
        settle { botdot.changes().size == 2 }
        assertEquals(2, botdot.changes().size, "changed again: sent")
    }

    @Test fun twoChangesInOneMomentAreBothSent() = runTest {
        val botdot = MockBotdot { r -> if (r.method == "GET" && r.path == "/bots") 200 to "[$mail]" else 200 to mail }
        val desk = BotSettingsDesk(botdot.api, "mail", store(), backgroundScope)
        desk.load()
        desk.edit { it.withName("Post") }
        desk.edit { it.withColor("#378add") }
        advanceTimeBy(BotSettings.SAVE_MS + 1)
        settle { botdot.changes().isNotEmpty() }
        assertEquals("""{"color":"#378add","name":"Post"}""", botdot.changes().single().body)
    }

    @Test fun aBlankNameIsNotSaved() = runTest {
        val botdot = MockBotdot { r -> if (r.method == "GET" && r.path == "/bots") 200 to "[$mail]" else 404 to "{}" }
        val desk = BotSettingsDesk(botdot.api, "mail", store(), backgroundScope)
        desk.load()
        desk.edit { it.copy(name = " ") }
        advanceTimeBy(BotSettings.SAVE_MS * 2)
        settle { false }
        assertTrue(botdot.changes().isEmpty())
    }

    @Test fun deleteSendsItAndTheScreenLeaves() = runTest {
        val botdot = MockBotdot { r -> if (r.method == "GET" && r.path == "/bots") 200 to "[$mail]" else 200 to "{}" }
        val desk = BotSettingsDesk(botdot.api, "mail", store(), backgroundScope)
        desk.load()
        assertEquals("Its settings and jobs go, and so do the skills it wrote itself. Its past runs stay.", desk.deleteText())
        desk.delete()
        assertEquals(listOf("DELETE /bots/mail"), botdot.changes().map { "${it.method} ${it.path}" })
        assertTrue(desk.state.value.deleted)
    }

    // ---------- the app's Settings ----------

    private fun settingsBotdot(session: String, saves: Int = 200) = MockBotdot { r ->
        when {
            r.method == "PUT" && r.path == "/settings" -> saves to (if (saves == 200) """{"settings":{"defaultModel":"deep"},"models":[{"id":"deep"}]}""" else """{"error":"No such model."}""")
            r.path == "/settings" -> 200 to """{"settings":{"advanced":false},"models":[{"id":"deep","label":"Deep"}],"efforts":[{"id":"high","label":"High"}]}"""
            r.path.startsWith("/setup") -> 200 to """{"claude":{"loggedIn":true,"email":"me@example.com"}}"""
            r.path == "/version" -> 200 to """{"features":["accounts","advanced","token-usage","language"]}"""
            r.path == "/front-door/session" -> 200 to session
            r.path == "/usage" -> 200 to """{"from":"2026-11-14","to":"2026-11-14","today":"2026-11-14","bots":[]}"""
            r.path.startsWith("/usage?") -> 200 to """{"from":"2026-11-08","to":"2026-11-14","today":"2026-11-14","bots":[{"name":"Mail","totalTokens":300},{"name":"Old","gone":true,"totalTokens":100}]}"""
            else -> 404 to "{}"
        }
    }

    @Test fun settingsShowTheSubscriptionOfAManagedAccountAndUsageWithoutTokens() = runTest {
        val botdot = settingsBotdot("""{"subscriptionPage":"https://botdot.app/billing"}""")
        val desk = AppSettingsDesk(botdot.api, store())
        desk.load()
        val s = desk.state.value
        assertEquals("https://botdot.app/billing", s.subscription)
        assertEquals("me@example.com", s.claude)
        assertEquals("botdot.test", s.address)
        assertFalse(s.advanced, "Advanced off: no models")
        assertTrue(s.showsAdvanced)
        assertTrue(s.showsLanguage)
        assertEquals(listOf("Claude Code's default", "Deep"), s.models.map { it.label })
        assertEquals("8 Nov to 14 Nov", s.usageRange)
        assertEquals(listOf("Mail" to "75%", "Old (deleted)" to "25%"), s.usageRows.map { it.name to it.amount })
        assertNull(s.usageNone)
        assertNull(s.update, "the front door does not say this account chooses")
    }

    @Test fun noSubscriptionRowOutsideAManagedAccountOrForAPlainAddress() = runTest {
        assertNull(AppSettingsDesk(settingsBotdot("{}").api, store()).also { it.load() }.state.value.subscription)
        assertNull(AppSettingsDesk(settingsBotdot("""{"subscriptionPage":"http://botdot.app/billing"}""").api, store()).also { it.load() }.state.value.subscription)
    }

    @Test fun aModelThatDoesNotSaveSaysWhyAndStaysAsItWas() = runTest {
        val desk = AppSettingsDesk(settingsBotdot("{}", saves = 400).api, store())
        desk.load()
        desk.setModel("other")
        assertEquals("No such model.", desk.state.value.error)
        assertEquals("", desk.state.value.info.settings.defaultModel)
        assertEquals(0, desk.state.value.savedAt)
    }

    @Test fun aSavedModelIsBotdotsAnswer() = runTest {
        val botdot = settingsBotdot("{}")
        val desk = AppSettingsDesk(botdot.api, store())
        desk.load()
        desk.setModel("deep")
        val body = Api.JSON.parseToJsonElement(botdot.changes().single().body).jsonObject
        assertEquals("deep", body["defaultModel"]?.jsonPrimitive?.content)
        assertEquals("deep", desk.state.value.info.settings.defaultModel)
        assertEquals(1, desk.state.value.savedAt)
    }

    // ---------- Apps ----------

    private fun connection(json: String) = Api.JSON.decodeFromString(Connection.serializer(), json)

    @Test fun anAppEveryBotUsesSaysAllBotsElseHowMany() {
        val bots = listOf(bot("""{"id":"a","name":"A"}"""), bot("""{"id":"b","name":"B"}"""), bot("""{"id":"c","name":"C"}"""))
        assertEquals("Active · used by all bots", Apps.line(connection("""{"id":"1","status":"ACTIVE","usedBy":["a","b","c"]}"""), bots))
        assertEquals("Active · used by 2 bots", Apps.line(connection("""{"id":"1","status":"ACTIVE","usedBy":["a","b"]}"""), bots))
        assertEquals("Expired · no bot uses it yet", Apps.line(connection("""{"id":"1","status":"EXPIRED"}"""), bots))
        assertEquals("Active · used by 1 bot", Apps.line(connection("""{"id":"1","status":"ACTIVE","usedBy":["a"]}"""), bots.take(1)), "one bot is not all bots")
    }

    @Test fun anotherAccountIsAddedOnTheNewestWorkingOne() {
        val old = connection("""{"id":"1","toolkit":"gmail","status":"ACTIVE","createdAt":"2026-01-01"}""")
        val new = connection("""{"id":"2","toolkit":"gmail","status":"ACTIVE","createdAt":"2026-02-01"}""")
        assertFalse(Apps.addsAccount(old, listOf(old, new)))
        assertTrue(Apps.addsAccount(new, listOf(old, new)))
    }

    @Test fun theKeysSectionSaysWhyAKeyIsNeeded() {
        assertEquals("Add your Composio key", Apps.keyTitle(ConnectorsInfo()))
        assertNull(Apps.keyTitle(ConnectorsInfo(configured = true)))
        assertEquals("Composio no longer accepts your key …abcd", Apps.keyTitle(ConnectorsInfo(configured = true, keyRejected = true, account = "own", keyHint = "…abcd")))
        assertFalse(Apps.keyChanges(ConnectorsInfo(configured = true, machine = true), advanced = false))
    }

    @Test fun connectHandsBackTheSignInPageAndAnAppWithoutOneIsConnected() = runTest {
        val botdot = MockBotdot { r ->
            when {
                r.path == "/connectors" -> 200 to """{"configured":true,"connections":[]}"""
                r.path == "/connectors/connect" && r.body.contains("gmail") -> 200 to """{"redirectUrl":"https://connect.example/gmail"}"""
                r.path == "/connectors/connect" -> 200 to """{"noAuth":true}"""
                r.path == "/bots" -> 200 to "[]"
                else -> 404 to "{}"
            }
        }
        val desk = AppsDesk(botdot.api, store())
        desk.load()
        assertEquals("https://connect.example/gmail", desk.connect("gmail"))
        assertEquals("""{"app":"gmail"}""", botdot.changes().first().body)
        assertNull(desk.connect("weather", another = true))
        assertEquals("Connected", desk.state.value.notice)
        assertEquals("weather", Api.JSON.parseToJsonElement(botdot.changes().last().body).jsonObject["app"]?.jsonPrimitive?.content)
    }

    @Test fun aSearchShowsAtMostThirtyApps() = runTest {
        val items = (1..40).joinToString(",") { """{"slug":"app$it"}""" }
        val botdot = MockBotdot { r -> if (r.path.startsWith("/connectors/catalog")) 200 to """{"items":[$items]}""" else 404 to "{}" }
        val desk = AppsDesk(botdot.api, store())
        desk.search("mail")
        assertEquals(30, desk.state.value.found.size)
        assertEquals("/connectors/catalog?search=mail", botdot.sent().single().path)
    }

    // ---------- the status keypad ----------

    @Test fun aKeysPillIsWhatItsRowSays() {
        assertEquals(Keypad.StatusKind.NEEDS, Keypad.botStatus(bot("""{"id":"a","name":"A"}"""), null, waiting = true).kind)
        assertEquals("Working ×2", Keypad.botStatus(bot("""{"id":"a","name":"A","running":true,"runningCount":2}"""), null, false).text)
        assertEquals("Watching", Keypad.botStatus(bot("""{"id":"a","name":"A","nextRunAt":"2026-11-15T07:00:00Z"}"""), null, false).text)
        val done = Api.JSON.decodeFromString(Run.serializer(), """{"id":"r","botId":"a","status":"success","endedAt":"2026-11-14T10:00:00Z"}""")
        assertEquals("Done", Keypad.botStatus(bot("""{"id":"a","name":"A"}"""), done, false).text)
        assertEquals("Idle", Keypad.botStatus(bot("""{"id":"a","name":"A","readAt":"2026-11-14T11:00:00Z"}"""), done, false).text, "read since: seen")
    }

    @Test fun thePagesAreTheListsOrderAndTheDigitsGoInReadingOrder() {
        val bots = listOf(
            bot("""{"id":"p","name":"P","pinned":1}"""), bot("""{"id":"w","name":"W","group":"Work","order":1}"""),
            bot("""{"id":"o","name":"O"}"""), bot("""{"id":"h","name":"H","group":"Work","order":2,"hotkey":1}"""),
        )
        val pages = Keypad.pages(bots, emptyList())
        assertEquals(listOf("Pinned", "Work", "Other"), pages.map { it.name })
        val digits = Keypad.digits(pages, Keypad.shownKeys(pages, emptySet()))
        assertEquals(listOf(1, 2, 3, 4), digits.keys.toList())
        assertEquals(listOf("h", "p", "w", "o"), digits.values.map { it.id })
    }
    @Test fun aBotsAppsAndPagesAreReadWithItsSettings() = runTest {
        val botdot = MockBotdot { s ->
            when {
                s.path == "/bots" -> 200 to """[{"id":"a","name":"A","connectors":["gmail"]}]"""
                s.path == "/connectors" -> 200 to """{"connections":[{"id":"c1","toolkit":"gmail","status":"ACTIVE","app":{"name":"Gmail"}},{"id":"c2","toolkit":"notion","status":"ACTIVE","app":{"name":"Notion"}}]}"""
                s.path == "/bots/a/pages" -> 200 to """{"pages":[{"slug":"menu","title":"Menu"}]}"""
                else -> 200 to "{}"
            }
        }
        val desk = BotSettingsDesk(botdot.api, "a", store(listOf(Pages.FEATURE, DocumentView.FEATURE)), backgroundScope)
        desk.load()
        with(desk.state.value) {
            assertEquals(listOf("Gmail", "Notion"), apps.map { appName(it) })
            assertEquals(listOf(true, false), apps.map { hasApp(it) })
            assertEquals("Gmail", appsLine)
            assertEquals(listOf("Menu"), pages?.map { it.title })
        }
        val none = BotSettingsDesk(botdot.api, "a", store(), backgroundScope)
        none.load()
        assertNull(none.state.value.pages, "a botdot without pages: no section")
    }
    @Test fun aRevokedGrantGoesByItsActionFromTheBotAsItIsThen() = runTest {
        // The one rule for both phones: the step applies to the bot as botdot answered, and every grant of that action
        // goes, though the bot was read again meanwhile with another label for it.
        val botdot = MockBotdot { 200 to "{}" }
        val r = BotSettings.revokeGrant(botdot.api, "a", "send")
        assertEquals(BotSettings.REVOKED, r.say)
        val now = Bot(id = "a", name = "A", alwaysAllowed = listOf(AlwaysAllowed("send", "Send mail (new)"), AlwaysAllowed("post", "")))
        assertEquals(listOf("post"), r.step(now).alwaysAllowed.map { it.action })
        assertEquals("DELETE", botdot.sent().single().method)
    }
    @Test fun aChangeThatLandsWhileARevokeIsAnsweredStays() = runTest {
        // botdot answers the revoke late; meanwhile the bot is read again, renamed elsewhere. Both stay.
        val held = kotlinx.coroutines.CompletableDeferred<Unit>()
        var name = "A"
        val botdot = MockBotdot { s ->
            when {
                s.path == "/bots" -> 200 to """[{"id":"a","name":"$name","alwaysAllowed":[{"action":"send"},{"action":"post"}]}]"""
                s.method == "DELETE" -> { held.await(); 200 to "{}" }
                else -> 200 to "{}"
            }
        }
        val desk = BotSettingsDesk(botdot.api, "a", store(), backgroundScope)
        desk.load()
        val revoking = async { desk.revokeGrant("send") }
        runCurrent()
        name = "Renamed"
        desk.load()
        assertEquals("Renamed", desk.state.value.bot?.name)
        held.complete(Unit)
        assertEquals(BotSettings.REVOKED, revoking.await())
        assertEquals("Renamed", desk.state.value.bot?.name, "the bot read meanwhile stays")
        assertEquals(listOf("post"), desk.state.value.grants.map { it.action }, "and the revoke is applied to it")
    }
    @Test fun alwaysApprovedAndTheRulesLiftedAreRevokedOneByOneOrSayWhyNot() = runTest {
        var fail = false
        val botdot = MockBotdot { s ->
            when {
                s.path == "/bots" -> 200 to """[{"id":"a","name":"A","jobs":[{"id":"j1","name":"Digest","cron":"0 7 * * *","alwaysApprove":true,"kind":"script"},{"id":"j2","name":"Other","cron":"0 8 * * *"}],
                    "alwaysAllowed":[{"action":"send","label":"Send mail"},{"action":"post"}],"overrides":[{"id":"o1","rule":"ask before deleting","action":"delete"}]}]"""
                fail && s.method != "GET" -> 500 to """{"error":"Not now"}"""
                s.method == "PUT" && s.path == "/bots/a/jobs/j1" -> 200 to """{"id":"j1","name":"Digest","cron":"0 7 * * *","alwaysApprove":false}"""
                s.method == "DELETE" && s.path == "/bots/a/overrides/o1" -> 200 to """{"id":"a","name":"A","overrides":[]}"""
                else -> 200 to "{}"
            }
        }
        val desk = BotSettingsDesk(botdot.api, "a", store(), backgroundScope)
        desk.load()
        with(desk.state.value) {
            assertEquals(listOf("Digest"), trusted.map { it.name })
            assertTrue(trustedLine(trusted.single()).endsWith("a script, no AI"))
            assertEquals(listOf("Send mail", "post"), grants.map { grantName(it) })
            assertEquals("Digest, Send mail, post", bot?.let(BotSettings::alwaysLine))
            assertEquals("Its rule: ask before deleting", overrideLine(overrides.single()))
        }
        fail = true
        assertEquals("Not now", desk.revokeGrant("send"))
        assertEquals(2, desk.state.value.grants.size, "refused: it stays")
        fail = false
        assertEquals(BotSettings.JOB_REVOKED, desk.revokeJob("j1"))
        assertTrue(desk.state.value.trusted.isEmpty())
        assertEquals(BotSettings.REVOKED, desk.revokeGrant("send"))
        assertEquals(listOf("post"), desk.state.value.grants.map { it.action })
        assertEquals(BotSettings.REVOKED, desk.revokeOverride("o1"))
        assertTrue(desk.state.value.overrides.isEmpty())
    }
}
