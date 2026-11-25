package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.TimeZone
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Needs you as the iPhone draws it (NeedsDesk, #1363): the Android app's cards, words and buttons, from the shared Store.
 *
 * What a tap sends and what the card says after it go to a fake botdot ([FakeBotdot]): Ktor's MockEngine under the
 * shared Api (its internal engine constructor), so these run on Android's host and in the iOS simulator alike, with no
 * server and no socket.
 */
class NeedsDeskTest {
    // No botdot is reached: the Store has no Api, and the parts are set as the server would send them.
    private val api = Api("https://botdot.invalid")

    /** One request the fake botdot took: its method, its path under /api, and its JSON body. */
    private data class Sent(val method: String, val path: String, val body: String)

    /** A fake botdot: [answer] says what it answers each request with (a status and a body); [sent] holds what came. */
    private class FakeBotdot(answer: suspend (Sent) -> Pair<Int, String>) {
        private val lock = Mutex()
        private val took = mutableListOf<Sent>()
        val api = Api("https://botdot.test", MockEngine { req ->
            val sent = Sent(req.method.value, req.url.encodedPath.removePrefix("/api"), (req.body as? TextContent)?.text.orEmpty())
            lock.withLock { took += sent }
            val (status, body) = answer(sent)
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        suspend fun sent(): List<Sent> = lock.withLock { took.toList() }
        suspend fun posts(): List<Sent> = sent().filter { it.method == "POST" }
    }

    private fun TestScope.desk(on: Api = api): Pair<Store, NeedsDesk> {
        val store = Store(backgroundScope, MutableStateFlow(null))
        val desk = NeedsDesk(store, on, backgroundScope) { "13:52" }
        store.version.set(VersionInfo(features = listOf(VaultTypes.FEATURE)))
        store.chief.set(ChiefOverview())
        store.dashboard.set(Dashboard())
        return store to desk
    }

    private fun bot(json: String): Bot = Api.JSON.decodeFromString(Bot.serializer(), json)
    private fun ask(json: String): Ask = Api.JSON.decodeFromString(Ask.serializer(), json)

    @Test fun nothingWaitingIsAllDone() = runTest {
        val (store, desk) = desk()
        store.bots.set(emptyList())
        store.needs.set(Needs())
        runCurrent()
        assertEquals("All done.", desk.state.value.allDone)
        assertTrue(desk.state.value.cards.isEmpty())
    }

    @Test fun aJobBeforeItsFirstOkHasDeclineAlwaysAndApprove() = runTest {
        val (store, desk) = desk()
        store.bots.set(listOf(bot("""{"id":"ops","name":"Ops","color":"#336699","jobs":[{"id":"j1","name":"Disk check","kind":"script","cron":"0 9 * * *","approved":false,"script":"df -h"}]}""")))
        store.needs.set(Needs())
        runCurrent()
        val card = desk.state.value.cards.single()
        assertEquals("j:ops:j1", card.key)
        assertEquals("Disk check", card.title)
        assertEquals("Ops", card.who?.name)
        assertEquals(NeedsBlock(NeedsLook.CODE, "df -h"), card.blocks.first())
        assertEquals(listOf("Decline", "Always approve", "Approve"), card.buttons.map { it.label })
        // A script is approved for good only after the warning.
        assertEquals("Always approve \"Disk check\"?", card.buttons[1].ask?.title)
        assertNull(desk.state.value.allDone)
    }

    @Test fun approveAllApprovesOnlyWhatACardShowsInWords() = runTest {
        val (store, desk) = desk()
        store.bots.set(listOf(bot("""{"id":"b","name":"B","jobs":[
            {"id":"1","name":"Digest","approved":false,"prompt":"Sum up the news"},
            {"id":"2","name":"Summary","approved":false,"prompt":"Sum up the mail"},
            {"id":"3","name":"Disk check","kind":"script","approved":false,"script":"df -h"}]}""")))
        store.needs.set(Needs())
        runCurrent()
        assertEquals("Approve 2", desk.state.value.approveAll)
        assertEquals("Disk check runs a script: approve it on its card.", desk.state.value.approveAllLine)
    }

    @Test fun aCardWithdrawnByItsBotGoes() = runTest {
        val (store, desk) = desk()
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(ask("""{"id":"a1","kind":"permission","permission":"web","bot":{"id":"b","name":"B"},"what":{"label":"search the web","hint":"it reads pages"}}"""))))
        runCurrent()
        val card = desk.state.value.cards.single()
        assertEquals("Let it search the web?", card.title)
        assertEquals(listOf("Decline", "Allow"), card.buttons.map { it.label })
        store.needs.set(Needs())
        runCurrent()
        assertTrue(desk.state.value.cards.isEmpty())
        assertEquals("All done.", desk.state.value.allDone)
    }

    @Test fun aPaymentAndALoginAreAnsweredOnTheirCards() = runTest {
        val (store, desk) = desk()
        store.bots.set(emptyList())
        store.needs.set(Needs(requests = listOf(
            Api.JSON.decodeFromString(LoginRequest.serializer(), """{"id":"r1","kind":"card","site":"shop.example","amount":"12 EUR","bot":{"id":"b","name":"B"}}"""),
            Api.JSON.decodeFromString(LoginRequest.serializer(), """{"id":"r2","type":"api-token","site":"api.example","bot":{"id":"b","name":"B"},"existing":[{"id":"l1","name":"Work","username":"me"}]}"""),
        )))
        runCurrent()
        val (pay, login) = desk.state.value.cards
        assertEquals("Pay on shop.example", pay.title)
        assertEquals(listOf("Decline", "Allow"), pay.buttons.map { it.label })
        assertEquals("A login for api.example", login.title)
        assertEquals(listOf("Use Work (me)"), login.buttons.map { it.label })
        val form = assertNotNull(login.login)
        assertEquals("api-token", form.type)
        assertEquals("Token", form.secret)
        assertEquals("Token ID (optional)", form.username)
        assertNull(form.master)
        // Another type: its fields.
        desk.choose(login.key, "other")
        runCurrent()
        val other = assertNotNull(desk.state.value.cards[1].login)
        assertNull(other.username)
        assertTrue(other.multiline)
    }

    @Test fun whatOneRunWaitsOnIsOneCardWithEachAskUnderIt() = runTest {
        val (store, desk) = desk()
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(
            ask("""{"id":"a1","kind":"permission","permission":"web","bot":{"id":"b","name":"B"},"batch":{"id":"run1","title":"B waits for 2 things"}}"""),
            ask("""{"id":"a2","kind":"permission","permission":"mail","bot":{"id":"b","name":"B"},"batch":{"id":"run1","title":"B waits for 2 things"}}"""),
        )))
        runCurrent()
        val cards = desk.state.value.cards
        assertEquals(listOf("b:run1", "a:a1", "a:a2"), cards.map { it.key })
        assertEquals(listOf("Decline all", "Allow all"), cards[0].buttons.map { it.label })
        assertEquals(listOf(false, true, true), cards.map { it.inner })
    }

    @Test fun aConnectCardHasNotNowAndConnect() = runTest {
        val (store, desk) = desk()
        store.version.set(VersionInfo(features = listOf(CONNECT_CARDS)))
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(ask("""{"id":"c1","kind":"connect-app","title":"Connect Gmail","app":"gmail","name":"Gmail","mode":"connect","act":{"verb":"connect"},"bot":{"id":"b","name":"B"}}"""))))
        runCurrent()
        val card = desk.state.value.cards.single()
        assertEquals("Connect Gmail", card.title)
        assertEquals(listOf("Not now", "Connect"), card.buttons.map { it.label })
    }

    @Test fun aBotsQuestionIsOneCardWhereItIsAnswered() = runTest {
        val (store, desk) = desk()
        store.bots.set(listOf(bot("""{"id":"b","name":"Mail Sorter","asks":{"text":"Archive the old mail?","runId":"r9","at":"2026-11-14T10:00:00Z","open":[{"text":"Archive the old mail?","runId":"r9"}]}}""")))
        store.needs.set(Needs())
        runCurrent()
        val card = desk.state.value.cards.single()
        assertEquals("q:b:r9", card.key)
        assertEquals("Archive the old mail?", card.title)
        // Its run's answer buttons are not read (no botdot here): a box for the answer.
        assertEquals(true, card.answer?.reply)
    }

    @Test fun aChangedConnectedAppActionAsksBeforeAlwaysAllow() = runTest {
        val (store, desk) = desk()
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(ask("""{"id":"x","kind":"connector-action","title":"Send an email","bot":{"id":"b","name":"Mail Writer"},"rows":[{"label":"To","value":"a@b.c"}],"held":true}"""))))
        runCurrent()
        val card = desk.state.value.cards.single()
        assertEquals("Mail Writer waits for your answer", card.meta)
        assertEquals(NeedsLook.FACTS, card.blocks.first().look)
        assertEquals(listOf("Always allow", "Decline", "Allow once"), card.buttons.map { it.label })
        assertEquals(ALWAYS_ALLOW_QUESTION, card.buttons[0].ask?.text)
    }

    @Test fun severalQuestionsAreOneMessage() =
        assertEquals("Which day?\n→ Monday\n\nWhat time?\n→ –", questionsAnswer(listOf("Which day?", "What time?"), listOf(" Monday ", "")))

    @Test fun aQuestionCardKeepsWhatWasTypedUntilItIsSent() {
        val drafts = CardDrafts()
        val qs = listOf("Which day?", "What time?")
        val key = drafts.key("r1", qs)
        assertEquals(listOf("", ""), drafts.of(key, 2), "a card nobody typed on starts empty")
        drafts.put(key, listOf("Monday", ""))
        assertEquals(listOf("Monday", ""), drafts.of(drafts.key("r1", qs), 2), "the card drawn again has what was typed")
        assertEquals(listOf("", ""), drafts.of(drafts.key("r2", qs), 2), "another reply's card is its own")
        drafts.put(key, listOf("", ""))
        assertEquals(listOf("", ""), drafts.of(key, 2), "emptied boxes keep nothing")
        drafts.put(key, listOf("Monday", "9"))
        drafts.drop(key)
        assertEquals(listOf("", ""), drafts.of(key, 2), "sent: gone")
        val few = CardDrafts(most = 2)
        listOf("a", "b", "c").forEach { few.put(few.key(it, qs), listOf("x", "")) }
        assertEquals(listOf("", ""), few.of(few.key("a", qs), 2), "the oldest goes first")
        assertEquals(listOf("x", ""), few.of(few.key("c", qs), 2))
    }

    @Test fun aMomentIsTheClockTodayAndTheDayBefore() {
        val now = Instant.parse("2026-10-05T15:00:00Z")
        assertEquals("13:52", shortClock("2026-10-05T13:52:00Z", TimeZone.UTC, now))
        assertEquals("4 Oct, 13:52", shortClock("2026-10-04T13:52:00Z", TimeZone.UTC, now))
        assertEquals("", shortClock("ten minutes ago", TimeZone.UTC, now))
    }

    @Test fun aCardAskedInAGroupNamesItsBotAndTheGroup() {
        assertEquals("Coder in Dev", nameInGroup("Coder", "Dev"))
        assertEquals("Coder", nameInGroup("Coder", null))
    }

    @Test fun aBotThatAsksOpensNeedsYouFromHome() {
        val asks = bot("""{"id":"b","name":"B","asks":{"text":"Archive?","runId":"r9"}}""")
        assertTrue(needsYouOpens(emptyList(), listOf(asks)))
        assertTrue(!needsYouOpens(emptyList(), listOf(bot("""{"id":"c","name":"C"}"""))))
        assertTrue(needsYouOpens(listOf(Waiting(null, "Bitwarden is locked")), null))
    }

    @Test fun aMessageKeyIsNewEachTime() {
        val a = newMessageKey()
        assertEquals(32, a.length)
        assertTrue(a != newMessageKey())
    }

    // ---------- what a tap sends, to a fake botdot ----------

    private val permission = """{"id":"a1","kind":"permission","permission":"web","bot":{"id":"b","name":"B"},"what":{"label":"search the web","hint":"it reads pages"}}"""

    @Test fun anAnswerSentAgainAfterAFailedSendKeepsItsKey() = runTest {
        var tries = 0
        val botdot = FakeBotdot { r ->
            when {
                r.path == "/bots/b/run" -> if (++tries == 1) 500 to """{"error":"botdot is busy"}""" else 200 to """{"id":"run2"}"""
                else -> 404 to "{}"
            }
        }
        val (store, desk) = desk(botdot.api)
        store.bots.set(listOf(bot("""{"id":"b","name":"Mail Sorter","asks":{"text":"Archive the old mail?","runId":"r9"}}""")))
        store.needs.set(Needs())
        runCurrent()
        desk.answer("q:b:r9", listOf("Yes, all of it"))
        runCurrent()
        assertEquals("botdot is busy", desk.state.value.cards.single().failed)
        desk.answer("q:b:r9", listOf("Yes, all of it"))
        runCurrent()
        val sends = botdot.posts().filter { it.path == "/bots/b/run" }
        assertEquals(2, sends.size)
        val keys = sends.map { Api.JSON.parseToJsonElement(it.body).jsonObject["key"]?.jsonPrimitive?.content }
        assertNotNull(keys[0])
        assertEquals(keys[0], keys[1], "the second send is the same message, not a second one")
        assertEquals("r9", Api.JSON.parseToJsonElement(sends[1].body).jsonObject["answers"]?.jsonPrimitive?.content)
        assertTrue(desk.state.value.cards.single().done)
    }

    @Test fun aPressThatFailsSaysWhyOnItsCard() = runTest {
        val botdot = FakeBotdot { 409 to """{"error":"That bot is gone."}""" }
        val (store, desk) = desk(botdot.api)
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(ask(permission))))
        runCurrent()
        assertNull(desk.press("a:a1", NeedsDesk.YES))
        runCurrent()
        assertEquals(listOf(Sent("POST", "/asks/a1", """{"yes":true,"always":false}""")), botdot.posts())
        val card = desk.state.value.cards.single()
        assertEquals("That bot is gone.", card.failed)
        assertFalse(card.done)
        assertTrue(card.buttons.all { it.enabled }, "its buttons take a tap again")
    }

    @Test fun approveAllSendsOnlyTheCardsShownInWords() = runTest {
        val botdot = FakeBotdot { 200 to "{}" }
        val (store, desk) = desk(botdot.api)
        store.bots.set(listOf(bot("""{"id":"b","name":"B","jobs":[
            {"id":"1","name":"Digest","approved":false,"prompt":"Sum up the news"},
            {"id":"2","name":"Summary","approved":false,"prompt":"Sum up the mail"},
            {"id":"3","name":"Disk check","kind":"script","approved":false,"script":"df -h"}]}""")))
        store.needs.set(Needs())
        runCurrent()
        desk.approveAll()
        runCurrent()
        assertEquals(setOf("/bots/b/jobs/1/approve", "/bots/b/jobs/2/approve"), botdot.posts().map { it.path }.toSet())
        assertEquals(2, botdot.posts().size)
        val open = desk.state.value.cards.filter { !it.done }
        assertEquals(listOf("j:b:3"), open.map { it.key }, "the script waits on its own card")
    }

    private fun loginRequest() = Needs(requests = listOf(
        Api.JSON.decodeFromString(LoginRequest.serializer(), """{"id":"r2","site":"shop.example","bot":{"id":"b","name":"B"}}"""),
    ))

    @Test fun aSavedLoginSaysSo() = runTest {
        val botdot = FakeBotdot { 200 to "{}" }
        val (store, desk) = desk(botdot.api)
        store.bots.set(emptyList())
        store.needs.set(loginRequest())
        runCurrent()
        assertTrue(desk.saveLogin("r:r2", assertNotNull(desk.state.value.cards.single().login).type, "me", "hunter2", ""))
        runCurrent()
        assertEquals("/vault/requests/r2", botdot.posts().single().path)
        assertEquals("Saved. B will continue.", desk.state.value.notice)
    }

    @Test fun aLoginThatIsNotSavedComesBackWithWhy() = runTest {
        val botdot = FakeBotdot { 423 to """{"error":"locked"}""" }
        val (store, desk) = desk(botdot.api)
        store.bots.set(emptyList())
        store.needs.set(loginRequest())
        runCurrent()
        assertFalse(desk.saveLogin("r:r2", assertNotNull(desk.state.value.cards.single().login).type, "me", "hunter2", ""))
        runCurrent()
        assertEquals("Bitwarden is locked: enter your master password too.", desk.state.value.notice)
        val card = desk.state.value.cards.single()
        assertNull(card.busy)
        assertEquals("me", assertNotNull(card.login).typed, "the card is back as it was left")
    }

    private fun locked() = Needs(bitwarden = Api.JSON.decodeFromString(BitwardenStatus.serializer(), """{"configured":true,"unlocked":false}"""))

    @Test fun anUnlockedBitwardenSaysSo() = runTest {
        val botdot = FakeBotdot { 200 to "{}" }
        val (store, desk) = desk(botdot.api)
        store.bots.set(emptyList())
        store.needs.set(locked())
        runCurrent()
        assertTrue(desk.unlock("right one"))
        runCurrent()
        assertEquals(Sent("POST", "/vault/bitwarden/unlock", """{"password":"right one"}"""), botdot.posts().single())
        assertEquals("Bitwarden is unlocked", desk.state.value.notice)
        assertNull(desk.state.value.cards.single().failed)
    }

    @Test fun aWrongMasterPasswordSaysSoOnTheCard() = runTest {
        val botdot = FakeBotdot { 400 to """{"error":"The master password is not right."}""" }
        val (store, desk) = desk(botdot.api)
        store.bots.set(emptyList())
        store.needs.set(locked())
        runCurrent()
        assertFalse(desk.unlock("wrong one"))
        runCurrent()
        val card = desk.state.value.cards.single()
        assertEquals("Wrong master password", card.failed)
        assertNotNull(card.unlock, "its master password can be typed again")
    }

    @Test fun connectOpensTheSignInPageAndBackSettlesIt() = runTest {
        val botdot = FakeBotdot { r ->
            when (r.method) {
                "POST" -> 200 to """{"redirectUrl":"https://auth.example/sign-in"}"""
                else -> if (r.path == "/asks/c1/connect") 200 to """{"status":"ACTIVE"}""" else 404 to "{}"
            }
        }
        val (store, desk) = desk(botdot.api)
        store.version.set(VersionInfo(features = listOf(CONNECT_CARDS)))
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(ask("""{"id":"c1","kind":"connect-app","title":"Connect Gmail","app":"gmail","name":"Gmail","mode":"connect","act":{"verb":"connect"},"bot":{"id":"b","name":"B"}}"""))))
        runCurrent()
        assertEquals("https://auth.example/sign-in", desk.press("a:c1", NeedsDesk.YES))
        runCurrent()
        assertEquals("Waiting for sign-in", desk.state.value.cards.single().meta)
        desk.back()
        runCurrent()
        assertEquals(listOf("POST /asks/c1/connect", "GET /asks/c1/connect"), botdot.sent().map { "${it.method} ${it.path}" })
        assertNull(desk.state.value.cards.single().meta, "connected: it waits for no sign-in any more")
    }

    @Test fun theScreenLeavesAMomentAfterTheLastCardIsAnswered() = runTest {
        val botdot = FakeBotdot { 200 to "{}" }
        val (store, desk) = desk(botdot.api)
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(ask(permission))))
        runCurrent()
        assertEquals(1, desk.state.value.open)
        desk.press("a:a1", NeedsDesk.YES)
        runCurrent()
        assertEquals(0, desk.state.value.open)
        assertFalse(desk.state.value.leave, "the answer can be read first")
        advanceTimeBy(NeedsLeave.DELAY_MS + 1)
        runCurrent()
        assertTrue(desk.state.value.leave)
    }

    // ---------- a new version that waits (`update`, #1690, ADR 271) ----------

    private fun update(extra: String = "", acts: String = """[{"verb":"update-now","label":"Now"},{"verb":"update-tonight","label":"Tonight"}]""", act: String = """{"verb":"update-now","label":"Now"}""") =
        ask("""{"id":"u1","kind":"update","bot":null,"title":"A new version is ready","body":"Your account moves to it when you say, or by itself on 2 December.","act":$act,"acts":$acts$extra}""")

    @Test fun aNewVersionIsOneCardWithNowAndTonightAndNoNotNow() = runTest {
        val (store, desk) = desk()
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(update())))
        runCurrent()
        val card = desk.state.value.cards.single()
        assertEquals("A new version is ready", card.title)
        assertEquals("Your account moves to it when you say, or by itself on 2 December.", card.meta)
        assertEquals(listOf("Now", "Tonight"), card.buttons.map { it.label })
        assertEquals(listOf(NeedsButtonLook.PRIMARY, NeedsButtonLook.SECONDARY), card.buttons.map { it.look })
        assertEquals(listOf("update-now", "update-tonight"), card.buttons.map { it.id })
    }

    @Test fun tonightIsLeftOutWhereTheServerDoesNotOfferIt() = runTest {
        val (store, desk) = desk()
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(update(acts = """[{"verb":"update-now","label":"Now"}]"""))))
        runCurrent()
        assertEquals(listOf("Now"), desk.state.value.cards.single().buttons.map { it.label })
    }

    @Test fun aMovingVersionSaysSoWithNoButton() = runTest {
        val (store, desk) = desk()
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(update(acts = "[]", act = """{"verb":"update-moving"}"""))))
        runCurrent()
        val card = desk.state.value.cards.single()
        assertEquals("A new version is ready", card.title, "the server's words, whatever they are")
        assertEquals(emptyList(), card.buttons)
    }

    @Test fun nowAsksFirstOnlyWhenTheAccountIsBusy() = runTest {
        val (store, desk) = desk()
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(update(extra = ""","busy":true"""))))
        runCurrent()
        val now = desk.state.value.cards.single().buttons.first()
        assertEquals("Your account moves to the new version: your bots restart, and work still running stops.", now.ask?.text)
        assertNull(desk.state.value.cards.single().buttons[1].ask, "Tonight asks nothing")
        for (extra in listOf(""","busy":false""", "")) {
            store.needs.set(Needs(asks = listOf(update(extra = extra))))
            runCurrent()
            assertNull(desk.state.value.cards.single().buttons.first().ask, "idle, or not asked: no warning of work that stops")
        }
    }

    @Test fun nowAndTonightGoToTheFrontDoorsOwnRoutes() = runTest {
        val botdot = FakeBotdot { 200 to """{"asked":true}""" }
        val (store, desk) = desk(botdot.api)
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(update())))
        runCurrent()
        desk.press("a:u1", "update-tonight")
        runCurrent()
        desk.press("a:u1", "update-now")
        runCurrent()
        val sent = botdot.posts()
        assertEquals(listOf("/front-door/update", "/front-door/update/now"), sent.map { it.path })
        assertEquals("night", Api.JSON.parseToJsonElement(sent[0].body).jsonObject["plan"]!!.jsonPrimitive.content)
        assertTrue(sent.none { it.path.startsWith("/asks") }, "never the account's botdot server's answer on the card")
    }

    @Test fun aRefusedNowSaysWhyOnTheCard() = runTest {
        val botdot = FakeBotdot { 409 to """{"error":"There is no new version to switch to."}""" }
        val (store, desk) = desk(botdot.api)
        store.bots.set(emptyList())
        store.needs.set(Needs(asks = listOf(update())))
        runCurrent()
        desk.press("a:u1", "update-now")
        runCurrent()
        assertEquals("There is no new version to switch to.", desk.state.value.cards.single().failed)
    }

    @Test fun anAppThatDoesNotKnowTheVerbDrawsNoCard() {
        val list = Ask.list("""[{"id":"u1","kind":"update","title":"A new version is ready","act":{"verb":"update-sing"},"acts":[]},{"id":"u2","kind":"update","title":"A new version is ready","act":{"verb":"update-now","label":"Now"},"acts":[{"verb":"update-now","label":"Now"}],"busy":true}]""")
        assertEquals(listOf("u2"), list.map { it.id })
        assertEquals(true, list.single().busy)
        assertNull(list.single().actLabel, "its buttons are its own, not one main button")
    }
}
