package dev.botdot.app.ui

import dev.botdot.app.ui.ScreenMotion.Kind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** How screens take each other's place (#496). */
class ScreenMotionTest {
    @Test fun aPhonePushesAChatInAndBackOut() {
        assertEquals(Kind.PUSH, ScreenMotion.kind("home", "bot/{id}?attach={attach}", wide = false, back = false))
        assertEquals(Kind.PUSH, ScreenMotion.kind("bot/{id}?attach={attach}", "home", wide = false, back = true))
    }

    @Test fun besideTheListAChatFades() {
        assertEquals(Kind.FADE, ScreenMotion.kind("home", "bot/{id}?attach={attach}", wide = true, back = false))
    }

    @Test fun theBoardGrowsInAndShrinksBackOnBothSizes() {
        for (wide in listOf(false, true)) {
            assertEquals(Kind.BOARD, ScreenMotion.kind("home", "dashboard", wide, back = false))
            assertEquals(Kind.BOARD, ScreenMotion.kind("dashboard", "home", wide, back = true))
        }
    }

    @Test fun aBotOpenedFromTheBoardIsAPush() {
        assertEquals(Kind.PUSH, ScreenMotion.kind("dashboard", "bot/{id}?attach={attach}", wide = false, back = false))
        assertEquals(Kind.PUSH, ScreenMotion.kind("bot/{id}?attach={attach}", "dashboard", wide = false, back = true))
    }

    @Test fun signingInAndAPausedAccountFade() {
        assertEquals(Kind.FADE, ScreenMotion.kind("sign-in", "home", wide = false, back = false))
        assertEquals(Kind.FADE, ScreenMotion.kind("home", "paused", wide = false, back = false))
        assertEquals(Kind.FADE, ScreenMotion.kind(null, "home", wide = false, back = false))
    }

    @Test fun theDurationsAreTheMockupsAndAnExitIsShorter() {
        assertEquals(listOf(120, 200, 260), listOf(Motion.FAST, Motion.BASE, Motion.SLOW))
        assertTrue(Motion.FAST < Motion.BASE && Motion.BASE < Motion.SLOW)
    }
}
