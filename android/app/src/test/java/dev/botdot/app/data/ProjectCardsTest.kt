package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The cards made by Claude on a project's board on Android (#776), against a stand-in botdot: the routes and bodies of
 * docs/api.md "Cards made by Claude", the cards as the project carries them, and the row's rules (two to a line, a
 * table, a list, the ask field and the questions over two, New card gone at twelve).
 */
class ProjectCardsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private val project = """{"id":"c1","name":"Botdot","phase":"running","cards":[
        {"id":"k1","ask":"GitHub issues","title":"Open issues","state":"ready","at":"2026-10-29T10:00:00Z","answers":[],"apps":["github"],
         "body":{"show":"list","value":"23","sub":"+4 today","tone":"ok","list":[{"text":"Login loops","ref":"#412","tag":"bug","level":"err","url":"https://github.com/x/y/issues/412"}]},"how":"never sent"},
        {"id":"k2","ask":"Customer calls","title":"Customer calls","state":"building","answers":[],"apps":[],"step":{"kind":"search","what":"calls this week"},"steps":2},
        {"id":"k3","ask":"Tracker for GitHub issues","title":"GitHub issues","state":"asking","answers":[{"q":"Which repository?","a":"acme/web"}],"apps":[],
         "questions":[{"q":"Which repository?","choices":["acme/web"]},{"q":"Which issues?","choices":["Open","Open bugs"]},{"q":"How many?","choices":[]}]},
        {"id":"k4","ask":"Prices","state":"failed","answers":[],"apps":[],"error":"nothing to show","shiny":true}
    ]}"""

    @Test fun theProjectCarriesItsCards() {
        val c = CompanySetup.of(project)
        assertEquals(listOf("k1", "k2", "k3", "k4"), c.cards.map { it.id })
        val k1 = c.cards[0]
        assertEquals("Open issues", k1.name)
        assertEquals("list", k1.body?.show)
        assertEquals("#412", k1.body?.list?.single()?.ref)
        assertEquals("err", k1.body?.list?.single()?.level)
        assertTrue(c.cards[1].building)
        assertEquals("Which issues?", c.cards[2].next?.q)
        assertEquals("Prices", c.cards[3].name)
        assertTrue(c.cards[3].failed)
        assertNull(c.cards[3].body)
        // An older botdot sends none.
        assertEquals(emptyList<ProjectCard>(), CompanySetup.of("""{"id":"c1"}""").cards)
    }

    @Test fun onlyOnABotdotWithTheFeatureAndARunningProject() {
        val c = CompanySetup.of(project)
        assertTrue(ProjectCards.shows(listOf("company", "project-cards"), c))
        assertFalse(ProjectCards.shows(listOf("company"), c))
        assertFalse(ProjectCards.shows(listOf("project-cards"), c.copy(phase = "setup")))
        assertFalse(ProjectCards.shows(null, c))
    }

    @Test fun theRoutesAndBodiesAreTheWebPagesForTheProjectShown() = runBlocking {
        repeat(6) { server.enqueue(json(project)) }
        api.project = "c1"
        api.addCard("  Tracker for GitHub issues ")
        api.answerCard("k3", "Open bugs")
        api.changeCard("k1", "Open bugs only")
        api.cancelCard("k3")
        api.refreshCard("k1")
        val after = api.removeCard("k4")
        val sent = (1..6).map { server.takeRequest().let { r -> Triple(r.method, r.target, r.body?.utf8().orEmpty()) } }
        val base = ManyProjects.at("/company/cards", "c1").let { "/api$it" }
        assertEquals("POST" to base, sent[0].first to sent[0].second)
        assertEquals("""{"ask":"Tracker for GitHub issues"}""", sent[0].third)
        assertEquals("POST" to ManyProjects.at("/company/cards/k3/answer", "c1").let { "/api$it" }, sent[1].first to sent[1].second)
        assertEquals("""{"text":"Open bugs"}""", sent[1].third)
        assertEquals("PUT" to ManyProjects.at("/company/cards/k1", "c1").let { "/api$it" }, sent[2].first to sent[2].second)
        assertEquals("""{"ask":"Open bugs only"}""", sent[2].third)
        assertEquals("POST" to ManyProjects.at("/company/cards/k3/cancel", "c1").let { "/api$it" }, sent[3].first to sent[3].second)
        assertEquals("POST" to ManyProjects.at("/company/cards/k1/refresh", "c1").let { "/api$it" }, sent[4].first to sent[4].second)
        assertEquals("DELETE" to ManyProjects.at("/company/cards/k4", "c1").let { "/api$it" }, sent[5].first to sent[5].second)
        assertEquals(4, after.cards.size)
    }

    @Test fun theRowIsTwoToALineAndTheWideOnesTakeALineOfTheirOwn() {
        val c = CompanySetup.of(project)
        val slots = ProjectCards.slots(c.cards, open = null)
        // The list card (wide on a phone), the building card, the questions, the failed card, New card.
        assertEquals(listOf("Card", "Card", "Questions", "Card", "New"), slots.map { it::class.simpleName })
        val lines = ProjectCards.lines(slots)
        assertEquals(listOf(1, 1, 1, 2), lines.map { it.size })
        assertEquals(ProjectCards.Slot.New, lines.last().last())
    }

    @Test fun newCardTurnsIntoTheAskFieldAndChangeOpensItInTheCardsPlace() {
        val c = CompanySetup.of(project)
        assertEquals(ProjectCards.Slot.Ask(null), ProjectCards.slots(c.cards, ProjectCards.NEW).last())
        val changing = ProjectCards.slots(c.cards, "k2")
        assertEquals(ProjectCards.Slot.Ask(c.cards[1]), changing[1])
        assertEquals(ProjectCards.Slot.New, changing.last())
    }

    @Test fun twelveCardsHaveNoNewCard() {
        val twelve = (1..12).map { ProjectCard(id = "k$it", ask = "a", state = "ready", body = CardBody(value = "1")) }
        assertFalse(ProjectCards.slots(twelve, null).contains(ProjectCards.Slot.New))
        assertEquals(6, ProjectCards.lines(ProjectCards.slots(twelve, null)).size)
    }

    @Test fun aHalfCardLeftAloneKeepsItsHalf() {
        val half = ProjectCards.Slot.Card(ProjectCard(id = "a", body = CardBody(show = "number", value = "1")))
        val wide = ProjectCards.Slot.Card(ProjectCard(id = "b", body = CardBody(show = "table", value = "1")))
        assertEquals(listOf(listOf(half), listOf(wide), listOf(half, ProjectCards.Slot.New)), ProjectCards.lines(listOf(half, wide, half, ProjectCards.Slot.New)))
    }

    @Test fun theBuildingLineSaysWhatTheRunDoes() {
        assertEquals("Starting", ProjectCards.stepText(null))
        assertEquals("Searching calls this week", ProjectCards.stepText(CardStep("search", "calls this week")))
        assertEquals("Searching the web", ProjectCards.stepText(CardStep("search")))
        assertEquals("Reading acme/web", ProjectCards.stepText(CardStep("read", "acme/web")))
        assertEquals("Reading", ProjectCards.stepText(CardStep("read", "")))
        assertEquals(0.12f, ProjectCards.progress(0), 0.001f)
        assertEquals(0.40f, ProjectCards.progress(2), 0.001f)
        assertEquals(0.92f, ProjectCards.progress(40), 0.001f)
    }

    @Test fun theDashesSayHowFarTheQuestionsAre() {
        val k3 = CompanySetup.of(project).cards[2]
        assertEquals(listOf("done", "now", "next"), ProjectCards.dashes(k3))
        assertEquals(emptyList<String>(), ProjectCards.dashes(k3.copy(questions = k3.questions!!.take(1))))
        // While the Chief is asked there is no question yet.
        assertNull(k3.copy(questions = null).next)
    }

    @Test fun barsAreToTheHighestAndAZeroStillShows() {
        assertEquals(listOf(0.5f, 1f, 0.04f), ProjectCards.barHeights(listOf(CardBar("M", 5.0), CardBar("T", 10.0), CardBar("W", 0.0))))
        assertEquals(listOf(0.04f), ProjectCards.barHeights(listOf(CardBar("M", 0.0))))
    }

    @Test fun aCardBuiltAMomentAgoIsTheOneThatWasBuilding() {
        val building = ProjectCard(id = "a", state = "building")
        val ready = building.copy(state = "ready", body = CardBody(value = "3"))
        val other = ProjectCard(id = "b", state = "ready")
        assertEquals(setOf("a"), ProjectCards.justBuilt(listOf(building, other), listOf(ready, other)))
        assertEquals(emptySet<String>(), ProjectCards.justBuilt(listOf(ready, other), listOf(ready, other)))
        assertEquals(emptySet<String>(), ProjectCards.justBuilt(listOf(building), listOf(building.copy(state = "failed"))))
    }
}
