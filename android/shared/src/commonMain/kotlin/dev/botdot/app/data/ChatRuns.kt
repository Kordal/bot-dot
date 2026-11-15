package dev.botdot.app.data

/** The feature of a botdot that keeps who ended a run and words the sentence from it (docs/api.md). */
const val ENDED_BY = "ended-by"

/** What the bubble of a run that did not finish says: the app's own muted "Stopped.", or a problem in the problem bubble. */
sealed interface Ended {
    val text: String
    data class Stopped(override val text: String = tr("Stopped.")) : Ended
    data class Problem(override val text: String) : Ended
}

/**
 * How a run that ended without a reply is drawn. A botdot with [ENDED_BY] keeps who ended a run (the owner, the
 * Chief, a sign-out, the time limit) and says it in the run's `problem`: that sentence is drawn, as every problem
 * is, and the app's own "Stopped." stands only for a stopped run without one. Against a botdot from before, a
 * stopped run reads "Stopped." as it did. Any other end: the problem, the raw error, or its status.
 */
fun endedWords(r: Run, features: Collection<String>?): Ended {
    val problem = r.problem?.trim()?.ifEmpty { null }
    if (r.status == "stopped") return if (problem != null && features != null && ENDED_BY in features) Ended.Problem(problem) else Ended.Stopped()
    return Ended.Problem(problem ?: r.error?.ifBlank { null } ?: tr("It didn't finish ({status}).", "status" to r.status))
}

/**
 * A reply's text as its bubble draws it. A reply that asked several questions at once had them taken off its text for
 * its card ([Run.questions]); once that card is closed (answered, or ended by another message) the questions stand at
 * the end of the text as a list, so what the bot asked never goes from the chat. [open]: its card stands under it.
 * The web page's replyText has the same rule.
 */
fun replyText(r: Run, open: Boolean): String = withAsked(r.result.orEmpty(), r.questions, open)

/** A Chief message's text as its bubble draws it, by the same rule as [replyText]: its card stands only under the newest. */
fun chiefText(m: ChiefMessage, open: Boolean): String = withAsked(m.text, m.questions, open)

/**
 * Where the Chief's card of questions stands in [messages] (oldest first): the newest message past the project updates
 * after it, when it is a finished reply of the Chief's. null for none. Every other reply's card is closed.
 */
fun chiefCardAt(messages: List<ChiefMessage>): Int? =
    messages.indexOfLast { it.projectUpdate == null }.takeIf { i -> i >= 0 && messages[i].role == "chief" && !messages[i].pending }

/** [messages] as the chat draws them: a reply whose card is closed has its questions at the end of its text ([chiefText]). */
fun withClosedCards(messages: List<ChiefMessage>): List<ChiefMessage> {
    val open = chiefCardAt(messages)
    return messages.mapIndexed { i, m -> if (i == open || m.questions.isNullOrEmpty()) m else m.copy(text = chiefText(m, open = false)) }
}

private fun withAsked(text: String, questions: List<String>?, open: Boolean): String {
    val asked = questions.orEmpty().filter { it.isNotBlank() }
    if (open || asked.isEmpty()) return text
    return (text.trimEnd() + "\n\n" + asked.joinToString("\n") { "- $it" }).trim()
}
