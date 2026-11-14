package dev.botdot.app.data

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** What a phone asks once it is in (#1372): What's new after an update, and the Chief's name on the first run. */
class FirstRunTest {
    @Test fun whatsNewIsAskedOnlyOfAServerThatAnnouncesIt() = runTest {
        val f = FakeServer { 200 to """{"entries":[{"id":"n2","title":"Board on iPhone","points":["Tiles"]},{"id":"","title":"no id"}]}""" }
        assertTrue(WhatsNew.unseen(f.api, listOf("accounts")).isEmpty())
        assertTrue(f.sent().isEmpty())
        val notes = WhatsNew.unseen(f.api, listOf(WhatsNew.FEATURE))
        assertEquals(listOf("n2"), notes.map { it.id })
        assertEquals("/api/whats-new", f.sent().single().path)
    }

    @Test fun whatsNewNotReachedIsNothingAndClosingSendsTheNewestSeen() = runTest {
        assertTrue(WhatsNew.unseen(FakeServer { 502 to "" }.api, listOf(WhatsNew.FEATURE)).isEmpty())
        val f = FakeServer { 200 to "{}" }
        WhatsNew.seen(f.api, listOf(WhatsNew.Entry("n3", "C"), WhatsNew.Entry("n2", "B")))
        val sent = f.posts().single()
        assertEquals("/api/whats-new/seen", sent.path)
        assertEquals("""{"id":"n3"}""", sent.body)
        WhatsNew.seen(FakeServer { 502 to "" }.api, listOf(WhatsNew.Entry("n3", "C"))) // let be: it shows again
    }

    @Test fun theFirstRunGivesTheBotdotThisDevicesZoneAndAsksTheName() = runTest {
        val f = FakeServer { t -> if (t.method == "GET") 200 to """{"done":false,"chiefNameAsked":false}""" else 200 to "{}" }
        assertTrue(ChiefName.firstRun(f.api, listOf(ChiefName.FEATURE), "Europe/Warsaw"))
        val put = f.posts().single()
        assertEquals("/api/setup", put.path)
        assertEquals("""{"deviceTimezone":"Europe/Warsaw"}""", put.body)
    }

    @Test fun aBotdotWithItsZoneOrAnAnswerIsNotAskedAgain() = runTest {
        val f = FakeServer { 200 to """{"done":false,"chiefNameAsked":true,"savedTimezone":"UTC"}""" }
        assertFalse(ChiefName.firstRun(f.api, listOf(ChiefName.FEATURE), "Europe/Warsaw"))
        assertTrue(f.posts().isEmpty())
        val old = FakeServer { 200 to "{}" }
        assertFalse(ChiefName.firstRun(old.api, listOf("accounts"), "Europe/Warsaw"))
        assertTrue(old.sent().isEmpty())
    }

    @Test fun aNameBotdotRefusesKeepsTheQuestionWithItsSentence() = runTest {
        val ok = FakeServer { 200 to """{"chiefName":"Ada"}""" }
        assertNull(ChiefName.answer(ok.api, "Ada"))
        assertEquals("""{"chiefName":"Ada"}""", ok.posts().single().body)
        val no = FakeServer { 400 to """{"error":"Ops is a bot's name."}""" }
        assertEquals("Ops is a bot's name.", ChiefName.answer(no.api, "Ops"))
    }
}
