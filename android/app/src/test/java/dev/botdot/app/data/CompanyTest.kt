package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
 * The Company's setup on Android (#674), against a stand-in botdot: the same routes and bodies as the web page
 * (docs/api.md "The Company"), and the setup's rules (where an idea starts, the first three stories Start, a
 * proposal changed keeps what the app does not draw).
 */
class CompanyTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun start() {
        server = MockWebServer()
        server.start()
        api = Api(server.url("/").toString().trimEnd('/'))
    }

    @After fun stop() = server.close()

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    private val idea = """{"id":"c1","name":"Mealmate","kind":"idea","start":"A meal-planning app for busy parents","phase":"setup","day":null,
        "sources":[],"about":[{"key":"who","question":"Who is it for?","answer":"Parents","chips":["Parents"]},{"key":"today","question":"What do they do today?","answer":"","open":true,"chips":["Lists"]}],
        "stories":[],"swot":null,"goal":"","never":[],"time":"","suggestions":null,"objectives":[],
        "proposal":[{"key":"k1","name":"Planner","description":"Plans meals","prompt":"Plan meals.","tools":["WebSearch"],"cron":"0 8 * * 1","owns":["Menus"],"connects":["gmail"],"routines":"Mondays","routinesOn":true,"asksFirst":"rules","preview":"3 menus","team":"Food","color":"#1d9e75"}],
        "teams":[],"todos":[],"plan":null,"checkins":[],"teamChat":[{"who":"you","text":"Add a cook"},{"who":"chief","text":"Added one.","undo":true}],"canUndo":true,"facts":2}"""

    @Test fun showsOnlyOnAServerThatHasIt() {
        assertTrue(CompanySetup.shows(listOf("company")))
        assertFalse(CompanySetup.shows(listOf("groups")))
        assertFalse(CompanySetup.shows(null))
    }

    @Test fun readsTheCompanyAndNone() = runBlocking {
        server.enqueue(json("""{"company":$idea}"""))
        val c = api.company().company!!
        assertEquals("GET" to "/api/company", server.takeRequest().let { it.method to it.target })
        assertEquals("Mealmate", c.name)
        assertEquals(listOf("Planner"), c.proposed()!!.map { it.name })
        assertTrue(c.teamChat[1].undo)
        server.enqueue(json("""{"company":null}"""))
        assertNull(api.company().company)
    }

    @Test fun theFeedSaysTheCompanyAsItIs() {
        val ev = FeedEvent("1", "company", Api.JSON.parseToJsonElement("""{"company":$idea}""").jsonObject)
        assertEquals("c1", CompanySetup.event(ev)!!.company!!.id)
        assertNull(CompanySetup.event(FeedEvent("2", "company", Api.JSON.parseToJsonElement("""{"company":null}""").jsonObject))!!.company)
        assertNull(CompanySetup.event(FeedEvent("3", "bots", JsonObject(emptyMap()))))
    }

    @Test fun startsWithTheSourcesThatAreReady() = runBlocking {
        server.enqueue(json(idea, 201))
        val sources = listOf(
            CompanySetup.link("a", "https://fernhill.app/about")!!,
            SourceDraft("b", "file", "plan.pdf", upload = Attachment("plan.pdf", "uploads/plan.pdf", 1200)),
            SourceDraft("c", "file", "big.mov"), // still on its way
        )
        api.startCompany("  A meal-planning app for busy parents ", sources)
        val r = server.takeRequest()
        assertEquals("POST" to "/api/company", r.method to r.target)
        val body = Api.JSON.parseToJsonElement(r.body!!.utf8()).jsonObject
        assertEquals("A meal-planning app for busy parents", body["start"]!!.jsonPrimitive.content)
        val sent = body["sources"]!!.jsonArray.map { it.jsonObject }
        assertEquals(2, sent.size)
        assertEquals("fernhill.app/about", sent[0]["name"]!!.jsonPrimitive.content)
        assertEquals("https://fernhill.app/about", sent[0]["url"]!!.jsonPrimitive.content)
        assertEquals("uploads/plan.pdf", sent[1]["upload"]!!.jsonObject["file"]!!.jsonPrimitive.content)
        assertNull(CompanySetup.link("x", "   "))
    }

    @Test fun startsAnEmptyProjectWithItsName() = runBlocking {
        server.enqueue(json("""{"id":"c2","name":"Nowy projekt","kind":"idea","start":"","phase":"running","board":[],"teams":[]}""", 201))
        val c = api.startEmptyProject("Nowy projekt")
        val r = server.takeRequest()
        assertEquals("POST" to "/api/company", r.method to r.target)
        val body = Api.JSON.parseToJsonElement(r.body!!.utf8()).jsonObject
        assertEquals("true", body["empty"]!!.jsonPrimitive.content)
        assertEquals("Nowy projekt", body["name"]!!.jsonPrimitive.content)
        assertNull(body["start"])
        assertTrue(c.running)
        assertEquals("project-empty", CompanySetup.EMPTY)
    }

    @Test fun theChiefsCallsGoWhereTheWebSendsThem() = runBlocking {
        repeat(8) { server.enqueue(json(idea)) }
        api.readCompany(); api.suggestForCompany("goal"); api.companySwot(); api.proposeTeam()
        api.changeTeam("Add a cook"); api.duplicateIntoTeam("b7"); api.undoTeam(); api.createTeam()
        val sent = (1..8).map { server.takeRequest().let { r -> r.target to r.body!!.utf8() } }
        assertEquals(listOf("/api/company/read", "/api/company/suggest", "/api/company/swot", "/api/company/proposal", "/api/company/proposal/chat",
            "/api/company/proposal/duplicate", "/api/company/proposal/undo", "/api/company/start"), sent.map { it.first })
        assertEquals("goal", Api.JSON.parseToJsonElement(sent[1].second).jsonObject["key"]!!.jsonPrimitive.content)
        assertEquals("Add a cook", Api.JSON.parseToJsonElement(sent[4].second).jsonObject["text"]!!.jsonPrimitive.content)
        assertEquals("b7", Api.JSON.parseToJsonElement(sent[5].second).jsonObject["bot"]!!.jsonPrimitive.content)
        server.enqueue(json("""{"stories":["Plan a week"],"group":"partners"}"""))
        val ideas = api.storyIdeas("users")
        assertEquals("/api/company/stories/suggest", server.takeRequest().target)
        assertEquals("partners", ideas.group)
    }

    @Test fun anIdeaStartsAtItsFirstOpenQuestionThenTheStoriesThenTheReview() {
        val c = CompanySetup.of(idea)
        assertEquals(AboutScreen.Question(1), CompanySetup.startScreen(c))
        val answered = c.copy(about = c.about.map { it.copy(open = false) })
        assertEquals(AboutScreen.Stories, CompanySetup.startScreen(answered))
        assertEquals(AboutScreen.Review, CompanySetup.startScreen(answered.copy(swot = Swot(firstTest = "Ask 5 parents"))))
        assertEquals(AboutScreen.Review, CompanySetup.startScreen(c.copy(kind = "site")))
    }

    @Test fun theStepIsStartOnceItRuns() {
        val c = CompanySetup.of(idea)
        assertEquals("about", CompanySetup.stepOf(c, null))
        assertEquals("team", CompanySetup.stepOf(c, "team"))
        assertEquals("about", CompanySetup.stepOf(c, "home"))
        assertEquals("start", CompanySetup.stepOf(c.copy(phase = "running"), "team"))
    }

    @Test fun anAnswerClosesItsCardAndIsSentWhole() {
        val c = CompanySetup.of(idea)
        val next = CompanySetup.answered(c.about, "today", "Lists; Apps", "What do they do today?")
        assertEquals("Lists; Apps", next[1].answer)
        assertFalse(next[1].open)
        assertEquals(listOf("Lists", "Apps"), CompanySetup.split(next[1].answer))
        val skipped = CompanySetup.answered(next, "why", "", "Why you?")
        assertEquals(3, skipped.size)
        val patch = CompanySetup.patchAbout(skipped)["about"]!!.jsonArray.map { it.jsonObject }
        assertEquals("", patch[2]["answer"]!!.jsonPrimitive.content)
        assertFalse(patch[2]["open"]!!.jsonPrimitive.boolean)
    }

    @Test fun picksOneOrSeveral() {
        assertEquals(listOf("b"), CompanySetup.pick(listOf("a"), "b", multi = false))
        assertEquals(listOf("a", "b"), CompanySetup.pick(listOf("a"), "b", multi = true))
        assertEquals(emptyList<String>(), CompanySetup.pick(listOf("a"), "a", multi = true))
        assertEquals(listOf("x", "y", "z"), CompanySetup.chips(listOf("x", "y"), listOf("y", "z"), listOf("z")))
    }

    @Test fun theFirstThreeStoriesOfAGroupStart() {
        var g: List<StoryGroup> = emptyList()
        listOf("Plan a week", "Shop once", "Cook fast", "Share lists").forEach { g = CompanySetup.addStory(g, "users", it)!! }
        assertEquals(listOf(true, true, true, false), g[0].items.map { it.start })
        assertNull(CompanySetup.addStory(g, "users", " plan  a WEEK "))
        assertNull(CompanySetup.addStory(g, "users", "  "))
        g = CompanySetup.addStory(g, "partners", "Sell boxes")!!
        assertEquals(listOf("users", "partners"), g.map { it.who })
        assertFalse(CompanySetup.flipStart(g, 0, 0)[0].items[0].start)
        assertEquals(listOf("users"), CompanySetup.dropStory(g, 1, 0).map { it.who })
        assertEquals(listOf("Fresh idea"), CompanySetup.ideas(listOf("Shop once", "Fresh idea"), g, "users"))
    }

    @Test fun theWhoChooserOffersTheMissingGroupFirst() {
        val g = listOf(StoryGroup("users", listOf(Story("x"))), StoryGroup("customers", listOf(Story("y"))))
        val words = CompanySetup.whoWords(g, "users", "parents")
        assertEquals("parents", words.first())
        assertFalse("users" in words)
        assertFalse("customers" in words)
        assertTrue("partners" in words)
    }

    @Test fun aChangedProposalKeepsWhatTheAppDoesNotDraw() {
        val c = CompanySetup.of(idea)
        val next = CompanySetup.edited(c.proposal!!, "k1", mapOf("name" to JsonPrimitive("Chef"), "asksFirst" to JsonPrimitive("every")))
        val sent = CompanySetup.patch(next)["proposal"]!!.jsonArray[0].jsonObject
        assertEquals("Chef", sent["name"]!!.jsonPrimitive.content)
        assertEquals("every", sent["asksFirst"]!!.jsonPrimitive.content)
        assertEquals("Plan meals.", sent["prompt"]!!.jsonPrimitive.content)
        assertEquals("0 8 * * 1", sent["cron"]!!.jsonPrimitive.content)
        assertEquals(0, CompanySetup.removed(next, "k1").size)
    }

    @Test fun aBotNeedsTheAppsNotConnected() {
        val b = CompanySetup.of(idea).proposed()!![0]
        assertEquals(emptyList<String>(), CompanySetup.missing(b, null))
        assertEquals(listOf("gmail"), CompanySetup.missing(b, setOf("github")))
        assertEquals(emptyList<String>(), CompanySetup.missing(b, setOf("gmail")))
        assertEquals("Gmail", CompanySetup.appName("gmail"))
        assertEquals("Trello", CompanySetup.appName("trello"))
    }

    @Test fun addExistingBotListsTheAccountsBotsAndSaysAdded() {
        val proposed = listOf(Proposed("k1", "Copy", from = "b1"), Proposed("k2", "Made", bot = "b3"))
        val bots = listOf(Bot("b1", "Scout"), Bot("b2", "Coder"), Bot("b3", "Made"))
        assertEquals(listOf("b1", "b2"), CompanySetup.existing(bots, proposed).map { it.id })
        assertTrue(CompanySetup.added(proposed, "b1"))
        assertFalse(CompanySetup.added(proposed, "b2"))
    }
}
