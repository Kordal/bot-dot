package dev.botdot.app.data

/**
 * The button to a chat's newest message (#1120), as on the web page (public/to-latest.js): a newer message that
 * arrives while the owner reads back up shows one round button with its writer's head; reaching the end hides it.
 * The chats' lists are upside down (reverseLayout): item 0, what waits at the foot of the chat, is the end.
 */
object ToLatest {
    /** How near the end still reads as at the end, in dp, as on the web page. */
    const val NEAR_DP = 160

    /** Shown next: never at the end; once what is newest changed while the owner reads back up; else as it was. */
    fun next(shown: Boolean, was: Any?, now: Any?, atEnd: Boolean): Boolean = if (atEnd) false else shown || (was != null && now != was)

    /** At the end: the foot of the chat in sight, or the newest message scrolled less than [nearPx] past it. */
    fun atEnd(firstIndex: Int, firstOffsetPx: Int, nearPx: Int): Boolean = firstIndex == 0 || (firstIndex == 1 && firstOffsetPx < nearPx)
}
