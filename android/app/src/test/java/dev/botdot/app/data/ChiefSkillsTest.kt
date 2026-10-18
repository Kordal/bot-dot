package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The owner's skills for the Chief in the Android app (docs/api.md, "Skills"): the list shows only against a server
 * with `chief-skills`, the Chief is named first among who uses a skill, ticking keeps the order, and a save sends the
 * list, even an empty one, but nothing to a server that never sent it. `test/chief-skills-web.test.js` holds the
 * web page's side.
 */
class ChiefSkillsTest {
    @Test fun `the list shows only against a server that keeps the Chief's skills`() {
        assertTrue(ChiefSkills.shows(listOf("unread", "chief-skills")))
        assertFalse(ChiefSkills.shows(listOf("unread", "checkup")))
        assertFalse(ChiefSkills.shows(null))
    }

    @Test fun `who uses a skill names the Chief first and leaves out a deleted bot`() {
        val names = mapOf("b1" to "Report Bot", "b2" to "News Bot")
        assertEquals(listOf("the Chief", "Report Bot", "News Bot"), ChiefSkills.usedBy(listOf("b1", "chief", "b2", "gone"), names))
        assertEquals(listOf("Report Bot"), ChiefSkills.usedBy(listOf("b1"), names))
    }

    @Test fun `ticking adds once at the end and unticking takes it out`() {
        assertEquals(listOf("a", "b"), ChiefSkills.toggle(listOf("a"), "b", true))
        assertEquals(listOf("a"), ChiefSkills.toggle(listOf("a"), "a", true))
        assertEquals(listOf("b"), ChiefSkills.toggle(listOf("a", "b"), "a", false))
        assertEquals(listOf("a"), ChiefSkills.toggle(null, "a", true))
    }

    @Test fun `a save sends the list, also an empty one, and nothing where the server never sent it`() {
        val json = Api.JSON
        val read = json.decodeFromString<SettingsInfo>("""{"settings":{"chiefRules":"","chiefSkills":["house-style"]},"models":[],"efforts":[]}""")
        assertEquals(listOf("house-style"), read.settings.chiefSkills)
        val cleared = json.encodeToJsonElement(AppSettings.serializer(), read.settings.copy(chiefSkills = emptyList())) as JsonObject
        assertEquals(0, cleared["chiefSkills"]!!.jsonArray.size)
        val old = json.decodeFromString<SettingsInfo>("""{"settings":{"chiefRules":"x"}}""")
        assertNull(old.settings.chiefSkills)
        assertFalse((json.encodeToJsonElement(AppSettings.serializer(), old.settings) as JsonObject).containsKey("chiefSkills"))
    }
}
