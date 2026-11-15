package dev.botdot.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Skills for both phones (SkillsDesk, SkillWords): the library read, and each skill's words as Android says them. */
class SkillsDeskTest {
    private fun skill(json: String) = Api.JSON.decodeFromString(Skill.serializer(), json)

    @Test fun aSkillSaysWhoUsesItAndWhoMadeIt() {
        val names = mapOf("b1" to "Ada", "b2" to "Bo")
        val both = skill("""{"name":"deploy","usedBy":["chief","b1","b2"],"createdBy":"bot:b1"}""")
        assertEquals("Used by the Chief and 2 bots", SkillWords.usedLine(both))
        assertEquals("Used by the Chief, Ada, Bo", SkillWords.users(both, names))
        assertEquals("Made by Ada", SkillWords.madeBy(both, names))
        val none = skill("""{"name":"review","createdBy":"chief"}""")
        assertEquals("Not used yet", SkillWords.usedLine(none))
        assertEquals("No bot uses it yet. Turn it on in a bot's settings.", SkillWords.users(none, names))
        assertEquals("Made by the Chief", SkillWords.madeBy(none, names))
        assertEquals("Made by you", SkillWords.madeBy(skill("""{"name":"x","createdBy":"you"}"""), names))
        assertNull(SkillWords.madeBy(skill("""{"name":"y"}"""), names))
    }

    @Test fun theLibraryIsReadAndAFailedReadSaysWhy() = runTest {
        val store = Store(backgroundScope, MutableStateFlow(null))
        val ok = SkillsDesk(backgroundScope, FakeServer { 200 to """{"library":[{"name":"deploy"}],"builtin":[{"name":"pdf"}]}""" }.api, store)
        ok.load()
        assertEquals(listOf("deploy"), ok.state.value.library.map { it.name })
        assertEquals(listOf("pdf"), ok.state.value.builtin.map { it.name })
        val down = SkillsDesk(backgroundScope, FakeServer { 503 to """{"error":"botdot is restarting"}""" }.api, store)
        down.load()
        assertEquals("botdot is restarting", down.state.value.error)
    }
}
