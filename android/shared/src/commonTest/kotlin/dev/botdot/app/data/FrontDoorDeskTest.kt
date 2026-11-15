package dev.botdot.app.data

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The front door's parts of an account on a phone (FrontDoorDesk, #1372): deleting the account and Feedback, with the
 * Android app's Settings rules, against a fake front door.
 */
class FrontDoorDeskTest {
    private fun door(session: String, answer: (Took) -> Pair<Int, String> = { 200 to "{}" }) = FakeServer { t ->
        if (t.path == "/front-door/session") 200 to session else answer(t)
    }

    @Test fun noFrontDoorOffersNothingAndAsksNothing() = runTest {
        val f = door("""{"deleteAccount":true,"feedback":true}""")
        assertEquals(FrontDoorOffers(), FrontDoorDesk(f.api).read(listOf("whats-new")))
        assertTrue(f.sent().isEmpty())
    }

    @Test fun anAccountThatMayBeDeletedIsOfferedDeleteWithItsName() = runTest {
        val f = door("""{"account":"ann","deleteAccount":true,"feedback":true,"feedbackScreenshots":true}""")
        val o = FrontDoorDesk(f.api).read(listOf("accounts"))!!
        assertEquals(AccountDeletion.Offer.Delete("ann", "This deletes at once, for good: the account, its bots, chats, files, notes, Board, containers, passkeys, sessions and feedback."), o.deletion)
        assertTrue(o.feedback)
        assertTrue(o.shots)
    }

    @Test fun aManagedMachineAsksForTheDeletionAndSaysSo() = runTest {
        val f = door("""{"account":"ann","deleteAccount":true,"deletionRequest":true}""")
        val o = FrontDoorDesk(f.api).read(listOf("accounts"))!!.deletion as AccountDeletion.Offer.Delete
        assertTrue(o.warning.startsWith("Your account is paused and you are signed out at once."))
    }

    @Test fun aPageOfBotdotAppOrTheAdminsNote() = runTest {
        val page = FrontDoorDesk(door("""{"deleteAccountPage":"https://botdot.app/delete"}""").api).read(listOf("accounts"))!!.deletion
        assertEquals(AccountDeletion.Offer.Page("https://botdot.app/delete"), page)
        val plain = FrontDoorDesk(door("""{"deleteAccountPage":"http://botdot.app/delete"}""").api).read(listOf("accounts"))!!.deletion
        assertNull(plain, "only an https page")
        val admin = FrontDoorDesk(door("""{"admin":true,"deleteAccount":false}""").api).read(listOf("accounts"))!!.deletion
        assertEquals(AccountDeletion.Offer.AdminNote, admin)
        assertTrue(AccountDeletion.Offer.AdminNote.text.startsWith("This is the admin's account"))
    }

    @Test fun aFrontDoorNotReachedIsAskedAgainAndThenOffersWhatItHas() = runTest {
        var reached = false
        val f = FakeServer { t ->
            when {
                t.path != "/front-door/session" -> 404 to "{}"
                reached -> 200 to """{"account":"ann","deleteAccount":true,"feedback":true}"""
                else -> 502 to ""
            }
        }
        val desk = FrontDoorDesk(f.api)
        assertNull(desk.read(listOf("accounts")), "not read: unknown, not \"nothing offered\"")
        reached = true
        val o = desk.read(listOf("accounts"))
        assertTrue(o?.feedback == true, "read again once it answers")
        assertTrue(o?.deletion is AccountDeletion.Offer.Delete)
    }

    @Test fun deleteSendsNothingUntilTheNameIsTypedExactly() = runTest {
        val f = door("{}")
        val d = FrontDoorDesk(f.api).delete("ann", "Ann")
        assertFalse(d.done)
        assertTrue(f.posts().isEmpty())
    }

    @Test fun deleteSendsTheNameAndSaysItIsDeleted() = runTest {
        val f = door("{}") { 200 to """{"ok":true}""" }
        assertEquals(FrontDoorDesk.Deleted("Your account is deleted.", true), FrontDoorDesk(f.api).delete("ann", "ann"))
        val sent = f.posts().single()
        assertEquals("/front-door/delete-account", sent.path)
        assertEquals("""{"name":"ann"}""", sent.body)
        val asked = door("{}") { 200 to """{"requested":true}""" }
        assertEquals("Your account is being deleted.", FrontDoorDesk(asked.api).delete("ann", "ann").words)
    }

    @Test fun aRefusedDeleteSaysTheFrontDoorsSentence() = runTest {
        val f = door("{}") { 403 to """{"error":"Not this account."}""" }
        assertEquals(FrontDoorDesk.Deleted("Not this account.", false), FrontDoorDesk(f.api).delete("ann", "ann"))
    }

    @Test fun feedbackGoesToTheFrontDoorAndAFailureKeepsTheText() = runTest {
        val f = door("{}") { 200 to "{}" }
        assertNull(FrontDoorDesk(f.api).sendFeedback(Feedback.Kind.FEATURE, "Dark mode"))
        val sent = f.posts().single()
        assertEquals("/front-door/feedback", sent.path)
        assertEquals("""{"kind":"feature","text":"Dark mode"}""", sent.body)
        val refused = door("{}") { 429 to """{"error":"Too many reports today."}""" }
        assertEquals("Too many reports today.", FrontDoorDesk(refused.api).sendFeedback(Feedback.Kind.BUG, "It broke"))
        val away = door("{}") { 502 to "" }
        assertTrue(FrontDoorDesk(away.api).sendFeedback(Feedback.Kind.BUG, "It broke")!!.endsWith("Your text is still here."))
    }
}
