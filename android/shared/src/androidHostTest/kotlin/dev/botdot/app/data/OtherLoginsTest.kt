package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "Use another saved login" in the Android app's login request (docs/api.md "Login requests"): `others` is read
 * (there, missing, with a field this app does not know), what the card offers for each, which rows stay for what is
 * typed, and what the confirmation names. `test/login-request-web.test.js` holds the web page's side.
 */
class OtherLoginsTest {
    private fun requests(json: String): List<LoginRequest> = Api.JSON.decodeFromString(json)

    private val bot = """{"id":"coder","name":"Coder","color":"#7f77dd"}"""
    private fun request(others: String?) =
        """{"id":"r1","kind":"login","site":"git.example.org","name":"git.example.org","username":"","reason":"To push.","bot":$bot,"existing":[]${others?.let { ""","others":$it""" } ?: ""}}"""

    private fun logins(n: Int) = (1..n).map { OtherLogin(id = "l$it", name = "Login $it", username = "user$it@example.com", site = "site$it.example.com") }

    @Test fun othersAreReadAsTheServerSendsThem() {
        val r = requests("[${request("""[{"id":"l1","name":"Gitea","username":"bart","site":"gitea.example.com"},{"id":"l2","name":"Token","username":"","site":""}]""")}]").single()
        assertEquals(
            listOf(OtherLogin("l1", "Gitea", "bart", "gitea.example.com"), OtherLogin("l2", "Token", "", "")),
            OtherLogins.of(r),
        )
        assertFalse(OtherLogins.hasSearch(OtherLogins.of(r)))
    }

    @Test fun aServerThatSendsNoneGivesAnEmptyList() {
        val r = requests("[${request(null)}]").single()
        assertEquals(emptyList<OtherLogin>(), r.others)
        assertEquals("nothing to offer: the card is as before", emptyList<OtherLogin>(), OtherLogins.of(r))
    }

    @Test fun aRowWithAnUnknownFieldOrWithoutOneItKnowsIsStillRead() {
        val r = requests("[${request("""[{"id":"l1","name":"Gitea","site":"gitea.example.com","folder":"work","hosts":["a","b"]}]""")}]").single()
        assertEquals(listOf(OtherLogin("l1", "Gitea", "", "gitea.example.com")), r.others)
        assertEquals("no username, no dot after the name", "Gitea", OtherLogins.label(r.others.single()))
    }

    @Test fun aCardRequestOffersNoOtherLogin() {
        val r = LoginRequest(id = "r2", kind = "card", site = "shop.example.com", others = logins(2))
        assertEquals(emptyList<OtherLogin>(), OtherLogins.of(r))
    }

    @Test fun onlyAListLongerThanSixHasTheSearch() {
        assertEquals(6, OtherLogins.SEARCH_ABOVE)
        assertFalse(OtherLogins.hasSearch(emptyList()))
        assertFalse(OtherLogins.hasSearch(logins(6)))
        assertTrue(OtherLogins.hasSearch(logins(7)))
    }

    @Test fun aRowStaysWhenEveryTypedWordIsInItsNameUsernameOrWebsite() {
        val gitea = OtherLogin("l1", "Gitea", "bart@example.com", "gitea.example.com")
        val shop = OtherLogin("l2", "Book shop", "Bart.K", "books.example.org")
        val bare = OtherLogin("l3", "Token", "", "")
        val all = listOf(gitea, shop, bare)
        assertEquals("nothing typed keeps every row", all, OtherLogins.shown(all, ""))
        assertEquals(all, OtherLogins.shown(all, "   "))
        assertEquals("by name", listOf(shop), OtherLogins.shown(all, "book"))
        assertEquals("by username", listOf(gitea), OtherLogins.shown(all, "bart@"))
        assertEquals("by website", listOf(shop), OtherLogins.shown(all, "example.org"))
        assertEquals("whatever the case", listOf(gitea, shop), OtherLogins.shown(all, "BART"))
        assertEquals("two words, each in another value", listOf(shop), OtherLogins.shown(all, " shop  bart.k "))
        assertEquals("every word must be there", emptyList<OtherLogin>(), OtherLogins.shown(all, "gitea books"))
        assertEquals("the server's order is kept", listOf(gitea, shop), OtherLogins.shown(all, "example"))
        assertEquals("no match: the card says so", emptyList<OtherLogin>(), OtherLogins.shown(all, "nothing-like-it"))
        assertEquals("No saved login matches.", OtherLogins.NO_MATCH)
    }

    @Test fun aRowShowsTheNameAndTheUsername() {
        assertEquals("Gitea · bart", OtherLogins.label(OtherLogin("l1", "Gitea", "bart", "gitea.example.com")))
    }

    @Test fun theSecondQuestionIsOnlyAboutALoginPickedFromTheList() {
        val all = logins(3)
        assertEquals("nothing picked: no question, nothing to send", null, OtherLogins.picked(all, null))
        assertEquals(all[1], OtherLogins.picked(all, "l2"))
        assertEquals("a login the list no longer has", null, OtherLogins.picked(all.take(1), "l2"))
        assertEquals("an id from elsewhere", null, OtherLogins.picked(all, "nope"))
        assertTrue("the button waits before it takes a tap", OtherLogins.CONFIRM_AFTER_MS >= 500)
    }

    @Test fun theConfirmationNamesTheLoginItsWebsiteAndTheRequestedHost() {
        val r = requests("[${request("[]")}]").single()
        val c = OtherLogins.confirm(r, OtherLogin("l1", "Gitea", "bart", "gitea.example.com"), "Coder")
        assertEquals("Use the login", c.lead)
        assertEquals("Gitea", c.login)
        assertEquals("on", c.on)
        assertEquals("saved for gitea.example.com", c.savedFor)
        assertEquals("git.example.org", c.host)
        assertEquals(
            "Its password will also be used on git.example.org, by Coder. Only continue if git.example.org really takes this login: web pages can try to trick bots into asking.",
            c.warning,
        )
        assertEquals("Use it on git.example.org", c.yes)
        assertEquals("saved without a website", OtherLogins.confirm(r, OtherLogin("l2", "Token"), "Coder").savedFor)
    }
}
