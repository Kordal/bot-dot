package dev.botdot.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Needs you on a project's overview (2026-11-15): a waiting question stands there, not under Blockers, and nothing shows when nothing waits. */
class ProjectOverviewNeedsYouTest {
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
    private fun ask(json: String): Ask = Api.JSON.decodeFromString(Ask.serializer(), json)

    @Test
    fun needsYouHoldsTheQuestionsTheChiefChatsCardsAndWhatWaitsOrNothing() {
        val c = CompanySetup.of("""{"id":"p1","chiefChat":"c1","teams":[{"id":"t1","name":"Crew","bots":["b1"]}]}""")
        val chief = OverviewEntry(id = "chief", chatId = "c1", name = "Chief", state = "asks")
        val card = ask("""{"id":"a1","title":"Approve the team?","chatId":"c1"}""")
        val teamCard = ask("""{"id":"a2","title":"Use the card?","chatId":"c1","bot":{"id":"b1","name":"Ada"}}""")
        val n = Overviews.needsYou(c, emptyList(), Needs(asks = listOf(card, teamCard)), listOf(question, chief))!!
        assertEquals(listOf("r1"), n.questions.map { it.id }, "the Chief's question is its card's")
        assertEquals(listOf("a1"), n.asks.map { it.id }, "a team bot's card waits under its team, not here")
        assertEquals("Approve the team?", Overviews.askText(n.asks.single()))
        assertEquals(null, Overviews.needsYou(c, emptyList(), Needs(), emptyList()), "nothing waits: no Needs you")
        val waiting = Waiting(color = null, text = "Ada asks", bot = "b1")
        assertEquals(listOf(waiting), Overviews.needsYou(c, listOf(waiting), null, emptyList())?.waiting)
    }

    @Test
    fun theOverviewIsAPageOnlyWithoutOverviewBoard() {
        assertTrue(Overviews.page(listOf(ProjectOverview.FEATURE)))
        assertFalse(Overviews.page(listOf(ProjectOverview.FEATURE, ProjectOverview.BOARD)), "the board is the page")
        assertFalse(Overviews.page(null))
    }
}
