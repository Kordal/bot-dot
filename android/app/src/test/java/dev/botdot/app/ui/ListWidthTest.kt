package dev.botdot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The list beside the chat (#385): how wide the owner may drag it, and what that leaves the settings panel. */
class ListWidthTest {
    @Test fun theListIsNeverNarrowerThan72OrWiderThan480() {
        assertEquals(72, ListWidth.fitting(20, window = 1400))
        assertEquals(120, ListWidth.fitting(120, window = 1400))
        assertEquals(333, ListWidth.fitting(333, window = 1400))
        assertEquals(480, ListWidth.fitting(900, window = 1400))
    }

    @Test fun aListNobodyResizedIs300() {
        assertEquals(300, ListWidth.fitting(null, window = 1400))
        assertEquals(300, ListWidth.fitting(null, window = 600)) // the narrowest screen that shows both
    }

    @Test fun theChatKeeps280BesideTheListAndItsLine() {
        assertEquals(409, ListWidth.fitting(480, window = 690)) // an unfolded phone
        assertEquals(319, ListWidth.fitting(480, window = 600))
        assertEquals(72, ListWidth.fitting(300, window = 300)) // never under 72, whatever the window
    }

    @Test fun aNarrowListShowsNamesOnlyAndTheNarrowestFiguresOnly() {
        assertEquals(ListWidth.Shows.ALL, ListWidth.shows(300))
        assertEquals(ListWidth.Shows.ALL, ListWidth.shows(240))
        assertEquals(ListWidth.Shows.NAMES, ListWidth.shows(239))
        assertEquals(ListWidth.Shows.NAMES, ListWidth.shows(140))
        assertEquals(ListWidth.Shows.FIGURES, ListWidth.shows(139))
        assertEquals(ListWidth.Shows.FIGURES, ListWidth.shows(72))
    }

    @Test fun aWiderListLeavesThePanelLessRoom() {
        assertTrue(SettingsPanel.room(1021, listShown = true))
        assertTrue(SettingsPanel.room(1021, listShown = true, list = 300))
        assertFalse(SettingsPanel.room(1021, listShown = true, list = 301))
        assertTrue(SettingsPanel.room(921, listShown = true, list = 200))
        assertTrue(SettingsPanel.room(793, listShown = true, list = 72))
        assertTrue(SettingsPanel.room(720, listShown = false, list = 480)) // a hidden list takes nothing
    }
}
