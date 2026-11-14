package dev.botdot.app.data

/**
 * A reply as it is written (docs/api.md, "The reply draft"; ADR 042). From a server whose `features` name
 * `reply-draft`, a run's stream and a Chief chat's stream send `reply_draft` with the whole draft so far, and the chat
 * draws it in the place of the reply being written, the bubble its reply will have, growing in place. The run's end
 * takes it away: the reply is drawn as it always was. A server without it, or an app from before, draws the reply
 * when it is done. There is no animation: the text is drawn again as it comes. Shown nowhere but in the open chat.
 */
object ReplyDraft {
    const val FEATURE = "reply-draft"

    /** Whether the botdot this app talks to sends drafts. While its features are not known yet: no. */
    fun shows(features: Collection<String>?): Boolean = features != null && FEATURE in features

    /**
     * The drafts of a group's turns at work, by run, while its chat is open. A turn that ended keeps its draft until
     * its reply is among the chat's replies, so that no row goes blank between the two; a pass ([passed]) and a
     * chat that is left take it away. `drawGroupDrafts` in `public/groups.js` is the web page's side.
     */
    class Group {
        private val held = LinkedHashMap<String, Pair<GroupWorking, String>>()

        /** The draft of the turn [turn] is [text] now ("" for none). */
        fun say(turn: GroupWorking, text: String) { if (text.isEmpty()) held.remove(turn.runId) else held[turn.runId] = turn to text }

        /** The turn passed: nothing of it stays. */
        fun passed(runId: String) { held.remove(runId) }

        /** The drafts to draw, in the order their turns began to write: none of a turn whose reply is in [replies]. */
        fun shown(replies: Set<String>): List<Pair<GroupWorking, String>> {
            held.keys.removeAll { it in replies }
            return held.values.toList()
        }

        /** The chat was left. */
        fun clear() = held.clear()
    }
}
