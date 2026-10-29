package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
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
 * The Company's home on Android (#675): the floor's rules as the web page has them (public/company-floor.js), a
 * running company as the server sends it, and the floor's calls on the same routes and bodies as the web page
 * (docs/api.md "The Company").
 */
class CompanyFloorTest {
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

    private val running = """{"id":"c1","name":"Fernhill","kind":"site","start":"fernhill.app","phase":"running","day":31,"createdAt":"2026-09-01T00:00:00Z",
        "objectives":[{"id":"o1","name":"Paying teams","target":50,"current":23,"color":"#45C78E"},{"id":"o2","name":"First support reply","target":4,"current":6.1,"color":"#E07A4F"}],
        "teams":[{"id":"t1","name":"Sales","color":"#45c78e","bots":["a","b","c","d"],"lead":"b"},{"id":"t2","name":"Gone","color":"#E07A4F","bots":["zz"],"lead":"zz"}],
        "todos":[{"id":"x1","text":"Review notes","done":false,"at":"2026-10-01T00:00:00Z"},{"id":"x2","text":"Call","bot":"a","done":true,"at":"2026-10-02T00:00:00Z"}],
        "plan":{"items":[{"text":"Ship the trial","objective":"o1"},{"text":"Write the FAQ"}],"approved":false,"week":"2026-10-26","at":"2026-10-26T08:00:00Z"},
        "checkins":[],"checkin":{"day":30,"objectives":[{"id":"o1","name":"Paying teams","current":23,"target":50,"color":"#45C78E","onTrack":true}]},
        "suggestion":{"name":"Churn Watcher","description":"Watches cancellations","prompt":"…","why":"Three teams left last week","team":"t1","at":"2026-10-28T00:00:00Z"},
        "dismissed":[],"proposal":null,"about":[],"sources":[]}"""

    private fun bot(id: String, name: String = id.uppercase(), running: Boolean = false) = Bot(id, name, running = running)

    @Test fun readsARunningCompany() {
        val c = CompanySetup.of(running)
        assertTrue(c.running)
        assertEquals(31, c.day)
        assertEquals(23.0, c.objectives[0].current, 0.0)
        assertEquals("6.1", CompanyFloor.num(c.objectives[1].current))
        assertEquals("50", CompanyFloor.num(c.objectives[0].target))
        assertEquals(30, c.checkin!!.day)
        assertTrue(c.checkin!!.objectives[0].onTrack)
        assertEquals("o1", c.plan!!.items[0].objective)
        assertFalse(c.plan!!.approved)
        assertEquals("Churn Watcher", c.suggestion!!.name)
        assertEquals("a", c.todos[1].bot)
        // A company from a server before #673: none of it.
        val older = CompanySetup.of("""{"id":"c1","phase":"running","day":2}""")
        assertNull(older.checkin); assertNull(older.plan); assertNull(older.suggestion)
    }

    @Test fun aRoomHasItsLeadDesksForWhoWorksOrAsksAndABench() {
        val c = CompanySetup.of(running)
        val bots = listOf(bot("a"), bot("b"), bot("c", running = true), bot("d"), bot("e"))
        val asks = mapOf("d" to 1, "b" to 2)
        val info = CompanyFloor.Info({ asks[it] ?: 0 }, { id -> bots.first { it.id == id }.running })
        val f = CompanyFloor.floor(c, bots, info)
        assertEquals(1, f.rooms.size) // a team whose bots are all gone has no room
        val r = f.rooms[0]
        assertEquals("b", r.lead.bot.id)
        assertEquals(3, r.count) // the team's asks, all on the lead
        assertEquals(listOf("d", "c"), r.desks.map { it.bot.id }) // asks first, then working
        assertEquals(listOf("a"), r.bench.map { it.bot.id })
        assertEquals(4, r.size)
        assertFalse(r.solo)
        assertEquals(listOf("e"), f.loose.map { it.bot.id })
    }

    @Test fun aLeadThatLeftIsTheFirstBotAndATeamOfOneHasNoCrown() {
        val idle = CompanyFloor.Info({ 0 }, { false })
        val r = CompanyFloor.room(CompanyTeam("t", "T", bots = listOf("a", "b"), lead = "gone"), listOf(bot("a"), bot("b")), idle)!!
        assertEquals("a", r.lead.bot.id)
        assertTrue(CompanyFloor.room(CompanyTeam("t", "T", bots = listOf("a")), listOf(bot("a")), idle)!!.solo)
    }

    @Test fun aTeamsObjectiveIsTheOneOfItsColour() {
        val c = CompanySetup.of(running)
        assertEquals("o1", CompanyFloor.objectiveOf(c.teams[0], c.objectives)!!.id) // any case
        assertNull(CompanyFloor.objectiveOf(CompanyTeam("t", "T", color = "#000000"), c.objectives))
        assertNull(CompanyFloor.objectiveOf(CompanyTeam("t", "T"), c.objectives))
        assertEquals(0.46f, CompanyFloor.ratio(c.objectives[0]), 0.001f)
        assertEquals(1f, CompanyFloor.ratio(c.objectives[1]), 0f)
    }

    @Test fun atBotGivesThatBotTheTask() {
        val bots = listOf(bot("s", "Sales"), bot("sf", "Sales Follow-up"))
        assertEquals(CompanyFloor.Task("send the deck", "sf"), CompanyFloor.task("@sales follow-up send the deck", bots))
        assertEquals(CompanyFloor.Task("call", "s"), CompanyFloor.task(" @Sales call ", bots))
        assertEquals(CompanyFloor.Task("@Sales", null), CompanyFloor.task("@Sales", bots))
        assertEquals(CompanyFloor.Task("@Salesy call", null), CompanyFloor.task("@Salesy call", bots))
        assertEquals(CompanyFloor.Task("Review notes", null), CompanyFloor.task("Review notes", bots))
    }

    @Test fun youListsTasksNotDoneThenTheLastFiveDone() {
        val all = (1..8).map { Todo("d$it", done = true) } + Todo("open")
        assertEquals(listOf("open", "d4", "d5", "d6", "d7", "d8"), CompanyFloor.todos(all).map { it.id })
    }

    @Test fun theLineIsFilledUpToToday() {
        assertEquals(0f, CompanyFloor.gone(1), 0f)
        assertEquals(30f / 90, CompanyFloor.gone(31), 0.0001f)
        assertEquals(1f, CompanyFloor.gone(200), 0f)
    }

    @Test fun theFloorsCallsGoWhereTheWebSendsThem() = runBlocking {
        repeat(9) { server.enqueue(json(running)) }
        server.enqueue(json("""{"company":$running,"paused":3}"""))
        api.newCompanyTeam("Support", listOf("a", "b"))
        api.makeLead("t 1", "b")
        api.addTodo("Review notes", null)
        api.addTodo("send the deck", "a")
        api.tickTodo("x1", true)
        api.approvePlan()
        api.changePlan("Less outreach")
        api.addSuggested()
        api.dismissSuggested()
        val answer = api.answerCheckin(30, "stop")
        assertEquals(3, answer.paused)
        assertEquals("c1", answer.company.id)
        val sent = (1..10).map { server.takeRequest().let { r -> Triple(r.method, r.target, r.body?.utf8().orEmpty()) } }
        assertEquals(Triple("POST", "/api/company/teams", """{"name":"Support","bots":["a","b"]}"""), sent[0])
        assertEquals(Triple("PUT", "/api/company/teams/t%201", """{"lead":"b"}"""), sent[1])
        assertEquals(Triple("POST", "/api/company/todos", """{"text":"Review notes"}"""), sent[2])
        assertEquals(Triple("POST", "/api/company/todos", """{"text":"send the deck","bot":"a"}"""), sent[3])
        assertEquals(Triple("PUT", "/api/company/todos/x1", """{"done":true}"""), sent[4])
        assertEquals("POST" to "/api/company/plan/approve", sent[5].first to sent[5].second)
        assertEquals(Triple("POST", "/api/company/plan/change", """{"text":"Less outreach"}"""), sent[6])
        assertEquals("POST" to "/api/company/suggestion/add", sent[7].first to sent[7].second)
        assertEquals("DELETE" to "/api/company/suggestion", sent[8].first to sent[8].second)
        val checkin = Api.JSON.parseToJsonElement(sent[9].third).jsonObject
        assertEquals("/api/company/checkins", sent[9].second)
        assertEquals("30", checkin["day"]!!.jsonPrimitive.content)
        assertEquals("stop", checkin["decision"]!!.jsonPrimitive.content)
    }
}
