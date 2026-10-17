package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The settings panel: when there is room for it beside the chat, and what each tap leads to. */
class SettingsPanelTest {
    @Test fun roomIsTheChatAndThePanelSideBySide() {
        assertFalse(SettingsPanel.room(719, listShown = false))
        assertTrue(SettingsPanel.room(720, listShown = false))
        assertFalse(SettingsPanel.room(840, listShown = true)) // a tablet with the list beside the chat
        assertTrue(SettingsPanel.room(840, listShown = false))
        assertTrue(SettingsPanel.room(1021, listShown = true))
        assertFalse(SettingsPanel.room(1020, listShown = true))
        assertFalse(SettingsPanel.room(411, listShown = false)) // a phone
    }

    @Test fun theChatARouteShows() {
        assertEquals("b1", SettingsPanel.chatOf("bot/{id}?attach={attach}", "b1", wide = false))
        assertEquals("chief", SettingsPanel.chatOf("chief/{id}?attach={attach}", "latest", wide = false))
        assertEquals("chief", SettingsPanel.chatOf("home", null, wide = true))
        assertNull(SettingsPanel.chatOf("home", null, wide = false)) // a phone's list
        assertNull(SettingsPanel.chatOf("screen/{id}", "b1", wide = true))
        assertNull(SettingsPanel.chatOf("needs", null, wide = true))
        assertNull(SettingsPanel.chatOf(null, null, wide = true))
    }

    @Test fun theFigureAndNameOpenAndCloseIt() {
        assertEquals(Panel("b1"), SettingsPanel.toggle(null, "b1"))
        assertNull(SettingsPanel.toggle(Panel("b1"), "b1"))
        assertNull(SettingsPanel.toggle(Panel("b1", jobs = true), "b1"))
        assertEquals(Panel("chief"), SettingsPanel.toggle(null, "chief"))
    }

    @Test fun backFromTheJobsReturnsToTheSettingsTheyWereOpenedFrom() {
        val fromSettings = SettingsPanel.jobs(Panel("b1"), "b1")
        assertEquals(Panel("b1", jobs = true, fromSettings = true), fromSettings)
        assertEquals(Panel("b1"), SettingsPanel.back(fromSettings))
        assertEquals(fromSettings, SettingsPanel.jobs(fromSettings, "b1")) // asked for again, they keep where they came from
        val fromChat = SettingsPanel.jobs(null, "b1")
        assertNull(SettingsPanel.back(fromChat)) // opened from the chat: back to the chat, as before
        assertNull(SettingsPanel.back(Panel("b1")))
        assertNull(SettingsPanel.back(null))
    }

    @Test fun besideTheChatAnotherChatKeepsItOnThatChatsSettings() {
        assertEquals(Panel("b2"), SettingsPanel.follow(Panel("b1"), "b2", room = true))
        assertEquals(Panel("b2"), SettingsPanel.follow(Panel("b1", jobs = true, fromSettings = true), "b2", room = true))
        assertEquals(Panel("chief"), SettingsPanel.follow(Panel("b1"), "chief", room = true))
        assertNull(SettingsPanel.follow(null, "b2", room = true)) // a closed panel stays closed
    }

    @Test fun coveringTheChatItMakesWayForAChosenChat() {
        assertNull(SettingsPanel.follow(Panel("b1"), "b2", room = false))
        assertNull(SettingsPanel.follow(Panel("chief"), "b2", room = false))
    }

    @Test fun coveringItsOwnChatItMakesWayWhenThatChatIsChosen() {
        assertNull(SettingsPanel.chosen(Panel("b1"), room = false)) // its row in the list, a tapped notification
        assertEquals(Panel("b1"), SettingsPanel.chosen(Panel("b1"), room = true)) // beside the chat it stays
        assertNull(SettingsPanel.chosen(null, room = true))
    }

    @Test fun aLinkInTheChatOpensTheSettingsAlsoOverTheJobs() {
        assertEquals(Panel("b1"), SettingsPanel.settings("b1"))
    }

    @Test fun roomThatComesOrGoesKeepsIt() {
        val jobs = Panel("b1", jobs = true, fromSettings = true)
        assertEquals(jobs, SettingsPanel.follow(jobs, "b1", room = false))
        assertEquals(jobs, SettingsPanel.follow(jobs, "b1", room = true))
        assertEquals(jobs, SettingsPanel.follow(jobs, null, room = false)) // its computer, Needs you: kept for the way back
    }

    @Test fun thePanelSurvivesATurnOfTheScreen() {
        val saver = SettingsPanel.Saver
        for (p in listOf(null, Panel("b1"), Panel("b1", jobs = true, fromSettings = true), Panel("chief"))) {
            val saved = with(saver) { androidx.compose.runtime.saveable.SaverScope { true }.save(p) }!!
            assertEquals(p, saver.restore(saved))
        }
    }

    /** Under the panel the chat is not on screen, so it reads nothing (ADR 005). */
    @Test fun aCoveredChatDoesNotSayItIsOnScreen() {
        val src = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "src/main/java/dev/botdot/app") }.first { it.exists() }
        assertTrue(File(src, "ui/Components.kt").readText().contains("val chat = chat.takeIf { !LocalChatCovered.current }"))
        assertTrue(File(src, "MainActivity.kt").readText().contains("LocalChatCovered provides (shown != null && !room)"))
    }

    /** The three screens are drawn by the panel alone: as destinations of their own they would take the chat's place again. */
    @Test fun theThreeScreensAreNoDestinations() {
        val main = generateSequence(File("").absoluteFile) { it.parentFile }
            .map { File(it, "src/main/java/dev/botdot/app/MainActivity.kt") }.first { it.exists() }.readText()
        for (route in listOf("botsettings", "chiefsettings", "jobs/")) assertFalse(route, main.contains("\"$route"))
    }
}
