package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Chief of Staff's name (#41, docs/api.md "The Chief's name"): shown as botdot says it, "Chief of Staff" from a
 * botdot that says none, and asked on the phone only once, by a botdot that knows the question and whose setup is
 * not done.
 */
class ChiefNameTest {
    private fun overview(body: String) = Api.JSON.decodeFromString<ChiefOverview>(body)
    private fun setup(body: String) = Api.JSON.decodeFromString<SetupInfo>(body)

    @Test fun theNameIsWhatBotdotSays() {
        assertEquals("Ada", ChiefName.of(overview("""{"chief":{"id":"chief","name":"Ada","emoji":"🧭"},"chats":[]}""")))
        assertEquals("Ada", ChiefName.named("  Ada "))
    }

    @Test fun withoutANameItIsChiefOfStaff() {
        assertEquals("Chief of Staff", ChiefName.of(overview("""{"chats":[]}""")))
        assertEquals("Chief of Staff", ChiefName.of(overview("""{"chief":{"id":"chief","name":""}}""")))
        assertEquals("Chief of Staff", ChiefName.of(null))
        assertEquals("Chief of Staff", ChiefName.named(null))
        assertEquals("Chief of Staff", ChiefName.named("   "))
    }

    @Test fun thePhoneAsksOnceWhileSetupIsNotDone() {
        val new = setup("""{"done":false,"chiefName":"Chief of Staff","chiefNameAsked":false}""")
        assertTrue(ChiefName.ask(listOf("chief", "chief-name"), new))
        assertFalse("answered or skipped in an app", ChiefName.ask(listOf("chief-name"), setup("""{"done":false,"chiefNameAsked":true}""")))
        assertFalse("setup done: the owner is not asked again", ChiefName.ask(listOf("chief-name"), setup("""{"done":true,"chiefNameAsked":false}""")))
        assertFalse("a botdot from before the name", ChiefName.ask(listOf("chief"), new))
        assertFalse("its setup without the field asks nothing", ChiefName.ask(listOf("chief-name"), setup("""{"done":false}""")))
        assertFalse(ChiefName.ask(null, new))
        assertFalse(ChiefName.ask(listOf("chief-name"), null))
    }
}
