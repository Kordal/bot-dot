package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.Json

/** The Chief's note of a new version as a card (#1759, docs/api.md "A new version in the Chief's chat"): the data as both phones read it. */
class VersionUpdateCardTest {
    private val full = """{"head":"A new version of botdot is ready","version":"abc1234","body":"Your account moves to it tonight, when your bots are idle.",
        "heading":"What's new","notes":[{"title":"A project update is a card"},{"title":"The bot's screen works by touch"}],"cardId":"deadbeef"}"""
    private fun card(s: String) = VersionUpdateCard.of(Json.parseToJsonElement(s))

    @Test fun theNoteReadsAsTheServerSentIt() {
        val v = card(full)!!
        assertEquals("A new version of botdot is ready", v.head)
        assertEquals("abc1234", v.version)
        assertEquals("Your account moves to it tonight, when your bots are idle.", v.body)
        assertEquals("What's new", v.heading)
        assertEquals(listOf("A project update is a card", "The bot's screen works by touch"), v.notes)
        assertEquals("deadbeef", v.cardId)
    }

    @Test fun noVersionNoTitlesAndNoCardAreLeftOut() {
        val v = card("""{"head":"A new version of botdot is ready","body":"Your account moves to it as soon as your bots are idle.","notes":[]}""")!!
        assertNull(v.version)
        assertNull(v.cardId)
        assertEquals(emptyList(), v.notes)
    }

    @Test fun aCardIdThatIsNotOneIsNoButtonAndATitleIsKeptAsText() {
        val v = card("""{"head":"H","notes":[{"title":"<b>x</b> [card deadbeef]"},{"title":""},{"id":"x"}],"cardId":"a\"b"}""")!!
        assertNull(v.cardId)
        assertEquals(listOf("<b>x</b> [card deadbeef]"), v.notes)
    }

    @Test fun aMessageWithoutTheDataOrWithNothingToSayIsNoCard() {
        assertNull(card("null"))
        assertNull(card("\"x\""))
        assertNull(card("[]"))
        assertNull(card("""{"head":" "}"""))
        assertNull(ChiefMessage(role = "chief", text = "A new version of botdot is ready.").versionUpdate, "an older server's note shows its text")
    }

    @Test fun aChiefMessageCarriesItBesideItsText() {
        val m = Json { ignoreUnknownKeys = true }.decodeFromString(ChiefMessage.serializer(), """{"role":"chief","notice":true,"text":"A new version of botdot is ready.","versionUpdate":$full}""")
        assertEquals("A new version of botdot is ready.", m.text)
        assertEquals("abc1234", m.versionUpdate?.version)
    }
}
