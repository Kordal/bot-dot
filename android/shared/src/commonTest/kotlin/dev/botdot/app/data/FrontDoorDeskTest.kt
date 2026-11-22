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

    @Test fun aFrontDoorThatSendsFeedbackToTheDevelopersSaysSoAndAnOlderOneDoesNot() = runTest {
        val dev = FrontDoorDesk(door("""{"feedback":true,"feedbackTo":"developers"}""").api).read(listOf("accounts"))!!
        assertTrue(dev.feedback)
        assertTrue(dev.developers)
        val admin = FrontDoorDesk(door("""{"feedback":true,"feedbackTo":"admin"}""").api).read(listOf("accounts"))!!
        assertTrue(admin.feedback)
        assertFalse(admin.developers)
        assertFalse(FrontDoorDesk(door("""{"feedback":true}""").api).read(listOf("accounts"))!!.developers, "an older front door")
    }

    @Test fun aFrontDoorThatListsTheOwnersReportsOffersMyReportsAndAnOlderOneDoesNot() = runTest {
        assertTrue(FrontDoorDesk(door("""{"feedback":true,"feedbackTo":"developers","feedbackReports":true}""").api).read(listOf("accounts"))!!.reports)
        assertFalse(FrontDoorDesk(door("""{"feedback":true,"feedbackReports":false}""").api).read(listOf("accounts"))!!.reports)
        assertFalse(FrontDoorDesk(door("""{"feedback":true,"feedbackTo":"developers"}""").api).read(listOf("accounts"))!!.reports, "an older front door")
        assertFalse(FrontDoorDesk(door("""{"feedbackReports":"true"}""").api).read(listOf("accounts"))!!.reports, "not a boolean")
    }

    @Test fun myReportsAreTheFrontDoorsListWithTheStatusInPlainWordsAndTheIssueOnlyForBotdotsOwn() = runTest {
        val f = door("{}") { t ->
            if (t.path == "/front-door/feedback") 200 to """{"reports":[
                {"id":"a","created":"2026-11-03T10:00:00.000Z","kind":"bug","text":"Approve does nothing","status":"fixed","fixedIn":"2026-11-25-the-fix","issue":"https://github.com/Kordal/bot-dot/issues/1600","note":" Thanks <b>so</b> much "},
                {"id":"b","created":"2026-11-01T10:00:00.000Z","kind":"feature","text":"A dark theme","status":"sent"},
                {"id":"c","created":"2026-10-30T10:00:00.000Z","kind":"bug","text":"Seen one","status":"seen","issue":"https://evil.example/Kordal/bot-dot/issues/1"},
                {"id":"d","created":"2026-10-29T10:00:00.000Z","kind":"bug","text":"No","status":"wontfix","note":"Not for us","issue":"https://github.com/Kordal/bot-dot/issues/12/../x"},
                {"id":"e","created":"2026-10-28T10:00:00.000Z","kind":"bug","text":"Odd word","status":"done"},
                {"kind":"bug","text":"no id"},
                {"id":"g","kind":"praise","text":"no such kind"}
            ]}""" else 404 to "{}"
        }
        val mine = FrontDoorDesk(f.api).myReports()
        assertNull(mine.said)
        assertEquals("GET /front-door/feedback", f.sent().single().let { "${it.method} ${it.path}" })
        assertEquals(listOf("a", "b", "c", "d", "e"), mine.reports.map { it.id }, "newest first as the front door sent it; a report without an id or a known kind is left out")
        assertEquals(listOf("Fixed", "Sent", "Seen", "Won't fix", "Sent"), mine.reports.map { it.status.label }, "an unknown word is Sent")
        val fixed = mine.reports[0]
        assertEquals("https://github.com/Kordal/bot-dot/issues/1600", fixed.issueLink)
        assertEquals("Public issue #1600", fixed.issueLabel)
        assertEquals("Thanks <b>so</b> much", fixed.note, "the developers' words, as text")
        assertTrue(fixed.sub.startsWith("Bug · ") && fixed.sub.contains("3"), fixed.sub)
        assertNull(mine.reports[2].issueLink, "another site's address is no link")
        assertNull(mine.reports[3].issueLink, "an address with more than a number is no link")
        assertEquals("Not for us", mine.reports[3].note)
    }

    @Test fun myReportsSaysWhyTheyCouldNotBeLoaded() = runTest {
        val refused = FrontDoorDesk(door("{}") { 404 to """{"error":"Not found"}""" }.api).myReports()
        assertEquals("Not found", refused.said)
        assertTrue(refused.reports.isEmpty())
        val odd = FrontDoorDesk(door("{}") { 502 to "" }.api).myReports()
        assertTrue(odd.said.orEmpty().startsWith("Couldn't load your reports: "), odd.said)
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

    @Test fun aPickedScreenshotIsNumberedByItsPlaceAmongThosePickedTogether() {
        // Two picked at once with none before: the first is taken, the second is too big.
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        assertNull(Feedback.refusal(Feedback.shotName(existing = 0, index = 0), png))
        val big = png + ByteArray(Feedback.SHOT_BYTES.toInt())
        assertEquals("Screenshot 2 is 5.0 MB: each screenshot can be at most 5 MB.", Feedback.refusal(Feedback.shotName(existing = 0, index = 1), big))
        assertEquals("Screenshot 4", Feedback.shotName(existing = 2, index = 1), "after two held before")
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

    @Test fun theReviewDemoIsNotDeletedAndStaysSignedIn() = runTest {
        val f = door("{}") { 200 to """{"ok":true,"demo":true,"said":"This is a demo account: it is not deleted."}""" }
        assertEquals(FrontDoorDesk.Deleted("This is a demo account: it is not deleted.", false), FrontDoorDesk(f.api).delete("demo", "demo"))
        assertEquals(1, f.posts().size)
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
