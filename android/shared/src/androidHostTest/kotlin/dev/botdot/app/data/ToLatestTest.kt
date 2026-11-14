package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The button to a chat's newest message (#1120). `test/to-latest-web.test.js` holds the web page's side. */
class ToLatestTest {
    @Test fun aNewerMessageWhileReadingBackUpShowsItAndTheEndHidesIt() {
        assertTrue("a newer message, read back up", ToLatest.next(false, "a", "b", atEnd = false))
        assertFalse("at the end the chat follows it", ToLatest.next(false, "a", "b", atEnd = true))
        assertTrue("it stays until the end", ToLatest.next(true, "b", "b", atEnd = false))
        assertFalse("reaching the end hides it", ToLatest.next(true, "b", "b", atEnd = true))
        assertFalse("nothing new: scrolling up shows nothing", ToLatest.next(false, "a", "a", atEnd = false))
        assertFalse("a chat's first draw is no arrival", ToLatest.next(false, null, "a", atEnd = false))
    }

    @Test fun theEndIsTheFootOfTheChatOrJustAboveIt() {
        assertTrue(ToLatest.atEnd(0, 0, 400))
        assertTrue(ToLatest.atEnd(0, 900, 400))
        assertTrue("the newest message, scrolled a little", ToLatest.atEnd(1, 120, 400))
        assertFalse("the newest message, scrolled far", ToLatest.atEnd(1, 600, 400))
        assertFalse("further up", ToLatest.atEnd(5, 0, 400))
        assertEquals("the same distance as on the web page", 160, ToLatest.NEAR_DP)
    }
}
