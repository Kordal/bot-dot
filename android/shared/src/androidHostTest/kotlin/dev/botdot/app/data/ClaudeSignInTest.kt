package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What a sign-in answers (docs/api.md, `POST /api/setup/claude/code`): `{ claude }`, signed in, or with `error`, a
 * sentence, when the server could not check the sign-in afterwards. Settings shows that sentence and does not say
 * "Signed in to Claude"; without one, and without `claude` at all (an older server), it says it as before.
 */
class ClaudeSignInTest {
    private fun says(body: String) = claudeCouldNotTell(claudeOfAnswer(body))

    @Test fun aSignInTheServerCouldNotCheckSaysTheChecksSentence() {
        val sentence = "Could not ask Claude Code whether it is signed in."
        assertEquals(sentence, says("""{"claude":{"installed":true,"loggedIn":false,"error":"$sentence"}}"""))
        // `loggedIn` says nothing beside an `error`.
        assertEquals(sentence, says("""{"claude":{"installed":true,"loggedIn":true,"error":"$sentence"}}"""))
    }

    @Test fun aSignInThatWasCheckedSaysSignedInAsBefore() {
        val signedIn = claudeOfAnswer("""{"claude":{"installed":true,"loggedIn":true,"email":"me@example.com","org":"Mine"}}""")
        assertEquals(ClaudeStatus(loggedIn = true, email = "me@example.com"), signedIn)
        assertNull(claudeCouldNotTell(signedIn))
        assertNull(says("""{"claude":{"installed":true,"loggedIn":true,"error":null}}"""))
        assertNull(says("""{"claude":{"installed":true,"loggedIn":true,"error":""}}"""))
    }

    @Test fun anAnswerWithoutClaudeSaysSignedInAsBefore() {
        // An older server, or an answer this app cannot read: the sign-in went through, and nothing more is known.
        for (body in listOf("""{}""", """{"claude":null}""", """{"ok":true}""", "", "[]", """{"claude":"yes"}""")) {
            assertNull(body, claudeOfAnswer(body))
            assertNull(body, says(body))
        }
    }
}
