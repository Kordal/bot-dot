package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/** Needs you as the iPhone draws it (NeedsDesk, #1363): the Android app's cards, words and buttons, from the shared Store. */
class NeedsDeskTest {
    // No botdot is reached: the Store has no Api, and the parts are set as the server would send them.
    private val api = Api("https://botdot.invalid")

    private fun TestScope.desk(): Pair<Store, NeedsDesk> {
        val store = Store(backgroundScope, MutableStateFlow(null))
        val desk = NeedsDesk(store, api, backgroundScope) { "13:52" }
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
}
