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
fun replyText(r: Run, open: Boolean): String {
    val text = r.result.orEmpty()
    val asked = r.questions.orEmpty().filter { it.isNotBlank() }
    if (open || asked.isEmpty()) return text
    return (text.trimEnd() + "\n\n" + asked.joinToString("\n") { "- $it" }).trim()
}
