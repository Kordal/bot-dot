package dev.botdot.app.data

/** The feature of a botdot server that keeps a reply's quick answers put away with the small × (docs/api.md). */
const val CHOICES_DISMISS = "choices-dismiss"

/** Whether the × is offered: the server announces it. While its features are not known yet: no. */
fun hasChoicesDismiss(features: Collection<String>?): Boolean = features != null && CHOICES_DISMISS in features

/**
 * Quick answers the owner put away, written once for Android and iOS. The × hides the whole row at once, "Answers
 * hidden · Undo" stands in its place for [UNDO_MS], and the choice is kept with the reply on the server
 * (`choicesDismissed`), so a redraw, a reload and another device agree; the bot is told nothing.
 */
object QuickAnswers {
    /** How long "Answers hidden · Undo" stands where the row was. */
    const val UNDO_MS = 5000L

    /**
     * Whether the row of the reply at [key] is away: what the owner chose here ([put], by reply) wins over [flag], the
     * reply as the server's last list had it, which a tap may be ahead of.
     */
    fun away(put: Map<String, Boolean>, key: String, flag: Boolean): Boolean = put[key] ?: flag

    /** The key of the Chief's message at [index] of the whole chat; a bot's or a group's reply is kept by its run id. */
    fun chiefKey(chatId: String, index: Int): String = "chief:$chatId:$index"
}
