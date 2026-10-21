package dev.botdot.app.ui

/**
 * Needs you returns the owner to where they came from (#264): once the last open card is answered on the screen,
 * it waits a moment, so that the answer can be read, and goes back. A screen that opens with nothing waiting stays.
 * The web page decides the same in public/needs-return.js.
 */
object NeedsLeave {
    /** How long the answered cards stay readable before the screen leaves (docs/DECISIONS.md). */
    const val DELAY_MS = 1200L

    /** After one look at the screen: whether a card stood open during this visit, and whether to leave now. */
    data class Step(val seen: Boolean, val leave: Boolean)

    /**
     * [seen]: a card stood open during this visit; [open]: how many stand open now; [answered]: the owner answered a
     * card on the screen during this visit. It never leaves for cards all answered elsewhere while the owner reads.
     */
    fun step(seen: Boolean, open: Int, answered: Boolean): Step =
        if (open > 0) Step(seen = true, leave = false) else Step(seen = false, leave = seen && answered)
}
