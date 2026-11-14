package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
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
        desk.edit(desk.state.value.draft.copy(name = "Po"))
        desk.edit(desk.state.value.draft.copy(name = "Post"))
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
        desk.edit(desk.state.value.draft.copy(name = "Ops"))
        advanceTimeBy(BotSettings.SAVE_MS + 1)
        settle { desk.state.value.error != null }
        assertEquals("That name is taken.", desk.state.value.error)
        advanceTimeBy(BotSettings.SAVE_MS * 3)
        settle { false }
        assertEquals(1, botdot.changes().size, "said once")
        desk.edit(desk.state.value.draft.copy(name = "Ops 2"))
        advanceTimeBy(BotSettings.SAVE_MS + 1)
        settle { botdot.changes().size == 2 }
        assertEquals(2, botdot.changes().size, "changed again: sent")
    }

    @Test fun aBlankNameIsNotSaved() = runTest {
        val botdot = MockBotdot { r -> if (r.method == "GET" && r.path == "/bots") 200 to "[$mail]" else 404 to "{}" }
        val desk = BotSettingsDesk(botdot.api, "mail", store(), backgroundScope)
        desk.load()
        desk.edit(desk.state.value.draft.copy(name = " "))
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
}
