package dev.botdot.app.data

import dev.botdot.app.answerview.AnswerViews

/**
 * The catalog of answer views (#1626, ADR 264) the phone reads fences by: asked from a server whose features name
 * `ui-catalog`, kept for as long as that botdot runs the revision it was asked of, and read by the shared validator.
 * An older server has none, and its replies show a `ui` fence as code.
 */
object AnswerViewShelf {
    const val FEATURE = "ui-catalog"

    /** The newest catalog version this app draws: a component that came in a later one is one quiet line. */
    const val KNOWN = 2

    fun shows(features: List<String>?) = features?.contains(FEATURE) == true

    private class Kept(val from: String, val views: AnswerViews)
    private var kept: Kept? = null

    /** What is kept for this botdot at this revision, or null. */
    fun cached(baseUrl: String?, revision: String?): AnswerViews? = kept?.takeIf { it.from == key(baseUrl, revision) }?.views

    /** The catalog of [api]'s botdot, asked once per revision; null when it can't be asked or read (asked again at the next screen). */
    suspend fun load(api: Api, revision: String?): AnswerViews? {
        cached(api.baseUrl, revision)?.let { return it }
        val views = runCatching { AnswerViews.of(api.uiCatalog(), KNOWN) }.getOrNull() ?: return null
        kept = Kept(key(api.baseUrl, revision), views)
        return views
    }

    private fun key(baseUrl: String?, revision: String?) = "$baseUrl $revision"
}
