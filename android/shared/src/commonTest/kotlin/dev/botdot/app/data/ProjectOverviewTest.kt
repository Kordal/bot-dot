package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Needs you on a project's overview (2026-11-15): a waiting question stands there, not under Blockers, and nothing shows when nothing waits. */
class ProjectOverviewTest {
    private val question = OverviewEntry(id = "r1", botId = "b1", name = "Issue Reviewer", state = "asks", text = "Go ahead with the fix?")
    private val failure = OverviewEntry(id = "r2", botId = "b2", name = "Coder", state = "failed", text = "Build broke")

    @Test
    fun aQuestionGoesToNeedsYouAndFailuresStayInBlockers() {
        val d = ProjectOverview(projectId = "p1", at = "x", blockers = listOf(question, failure))
        assertEquals(listOf("r1"), d.questions().map { it.id })
        assertEquals(listOf("r2"), d.failures().map { it.id })
    }

    @Test
    fun needsYouShowsOnlyWhenSomethingWaits() {
        assertFalse(ProjectOverview.needsYouShows(cards = 0, questions = 0))
        assertTrue(ProjectOverview.needsYouShows(cards = 0, questions = 1))
        assertTrue(ProjectOverview.needsYouShows(cards = 2, questions = 0))
    }

    @Test
    fun aChiefQuestionWithACardInItsChatShowsOnce() {
        val chief = OverviewEntry(id = "chief", chatId = "c1", name = "Chief", state = "asks", text = "Approve the team?")
        assertEquals(listOf("r1"), ProjectOverview.withoutCarded(listOf(question, chief), setOf("c1")).map { it.id })
        assertEquals(listOf("r1", "chief"), ProjectOverview.withoutCarded(listOf(question, chief), emptySet()).map { it.id })
    }
}
