package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
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
 * Several projects on Android (#703), against a stand-in botdot: the list is read once, every Company call names the
 * project shown as the web page does (`?project=<id>`), the feed's `project` event changes one, the tree's folds, and
 * the settings page's bodies (docs/api.md "The Company").
 */
class ProjectListTest {
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

    private fun project(id: String, name: String, archived: Boolean = false) =
        """{"id":"$id","name":"$name","kind":"idea","start":"$name idea","phase":"running","color":"#34c759","archived":$archived,
        "teams":[{"id":"t1","name":"Growth","color":"#1d9e75","bots":["b1","b2","gone"],"lead":"b2"}],
        "sources":[{"id":"s1","kind":"file","name":"plan.pdf","upload":{"name":"plan.pdf","file":"uploads/plan.pdf","size":10}}],
        "folder":{"name":"$name","path":"/workspace/projects/$name"}}"""

    @Test fun readsEveryProjectAndNamesTheOneShown() = runBlocking {
        server.enqueue(json("""{"projects":[${project("p1", "Botdot")},${project("p2", "Bakery", archived = true)}]}"""))
        val list = api.companyList()
        assertEquals("GET" to "/api/company/list", server.takeRequest().let { it.method to it.target })
        assertEquals(listOf("p1", "p2"), list.map { it.id })
        assertEquals("#34c759", list[0].color)
        assertEquals("/workspace/projects/Botdot", list[0].folder!!.path)
        assertEquals(listOf("p1"), ProjectList.open(list).map { it.id })
        assertEquals(listOf("p2"), ProjectList.archived(list).map { it.id })

        api.project = "p2"
        server.enqueue(json(project("p2", "Bakery")))
        api.patchCompany(CompanySetup.patchText("name", "Bakery"))
        assertEquals("PATCH" to "/api/company?project=p2", server.takeRequest().let { it.method to it.target })
        server.enqueue(json("""{"from":"2026-10-01","to":"2026-10-07","items":[]}"""))
        api.projectCalendar("2026-10-01", "2026-10-07")
        assertEquals("/api/company/calendar?from=2026-10-01&to=2026-10-07&project=p2", server.takeRequest().target)
        server.enqueue(json(project("p2", "Bakery")))
        api.editTeam("t1", ProjectList.teamBody(" Growth  team ", listOf("b1", "b2"), "b2")!!)
        val r = server.takeRequest()
        assertEquals("PUT" to "/api/company/teams/t1?project=p2", r.method to r.target)
        assertEquals("Growth team", Api.JSON.parseToJsonElement(r.body!!.utf8()).jsonObject["name"]!!.jsonPrimitive.content)
        server.enqueue(json("""{"ok":true}"""))
        api.deleteCompany(dropFolder = true)
        assertEquals("DELETE" to "/api/company?folder=delete&project=p2", server.takeRequest().let { it.method to it.target })

        // Without a project shown (an older botdot, or a new one being started): the first, as before.
        api.project = null
        server.enqueue(json(project("p3", "New"), 201))
        api.startCompany("New idea", emptyList())
        assertEquals("POST" to "/api/company", server.takeRequest().let { it.method to it.target })
    }

    @Test fun theOneShownIsTheOneChosenElseTheFirst() {
        val list = listOf(Company("p1"), Company("p2"))
        assertEquals("p2", ProjectList.shown(list, "p2", adding = false)!!.id)
        assertEquals("p1", ProjectList.shown(list, "gone", adding = false)!!.id)
        assertNull(ProjectList.shown(list, "p2", adding = true))
        assertNull(ProjectList.shown(emptyList(), null, adding = false))
    }

    @Test fun theFeedChangesOneProject() {
        val ev = FeedEvent("1", "project", Api.JSON.parseToJsonElement("""{"id":"p2","project":${project("p2", "Bakery")}}""").jsonObject)
        val (id, c) = ProjectList.event(ev)!!
        assertEquals("p2", id)
        assertEquals("Bakery", c!!.name)
        val gone = ProjectList.event(FeedEvent("2", "project", Api.JSON.parseToJsonElement("""{"id":"p1","project":null}""").jsonObject))!!
        assertNull(gone.second)
        assertNull(ProjectList.event(FeedEvent("3", "company", JsonObject(emptyMap()))))

        val list = listOf(Company("p1", name = "A"), Company("p2", name = "B"))
        assertEquals(listOf("A", "B2"), ProjectList.changed(list, "p2", Company("p2", name = "B2")).map { it.name })
        assertEquals(listOf("p1", "p2", "p3"), ProjectList.changed(list, "p3", Company("p3")).map { it.id })
        assertEquals(listOf("p2"), ProjectList.changed(list, "p1", null).map { it.id })
    }

    @Test fun pathsNameTheProject() {
        assertEquals("/company", ProjectList.at("/company", null))
        assertEquals("/company?project=p%201", ProjectList.at("/company", "p 1"))
        assertEquals("/company/calendar?from=x&project=p1", ProjectList.at("/company/calendar?from=x", "p1"))
    }

    @Test fun theTreeHasTeamsWithTheirBotsLeadFirstAndFolds() {
        val c = Api.JSON.decodeFromString(Company.serializer(), project("p1", "Botdot"))
        val bots = listOf(Bot(id = "b1", name = "One"), Bot(id = "b2", name = "Two"))
        val branches = ProjectList.branches(c, bots)
        assertEquals(listOf("b2", "b1"), branches.single().bots.map { it.id })
        assertEquals(3, ProjectList.waits(c, bots) { if (it == "b1") 2 else 1 })
        assertTrue(ProjectList.branches(c.copy(teams = c.teams.map { it.copy(bots = listOf("gone")) }), bots).isEmpty())

        // A project is open while shown, a team always; a turn is kept the other way.
        assertTrue(ProjectList.isOpen(emptyMap(), "p1", shown = "p1"))
        assertFalse(ProjectList.isOpen(emptyMap(), "p2", shown = "p1"))
        assertTrue(ProjectList.isOpen(emptyMap(), "p2:t1", shown = "p1"))
        val folded = ProjectList.fold(emptyMap(), "p1", shown = "p1")
        assertFalse(ProjectList.isOpen(folded, "p1", shown = "p1"))
        assertTrue(ProjectList.isOpen(ProjectList.fold(folded, "p1", shown = "p1"), "p1", shown = "p1"))
        assertEquals("Botdot", ProjectList.nameOf(c))
        assertEquals("Botdot idea", ProjectList.nameOf(c.copy(name = "")))
    }

    @Test fun theSettingsPageSendsWhatTheWebSends() {
        assertNull(ProjectList.teamBody("  ", listOf("b1"), null))
        assertNull(ProjectList.teamBody("Growth", emptyList(), null))
        assertEquals("b1", ProjectList.teamBody("Growth", listOf("b1", "b2"), "gone")!!["lead"]!!.jsonPrimitive.content)
        assertEquals(listOf("b1"), ProjectList.toggle(listOf("b1", "b2"), "b2"))
        assertEquals(listOf("b1", "b2"), ProjectList.toggle(listOf("b1"), "b2"))

        val c = Api.JSON.decodeFromString(Company.serializer(), project("p1", "Botdot"))
        val kept = CompanySetup.patchSources(c.sources, listOfNotNull(CompanySetup.linkSource("https://fernhill.app")))["sources"]!!.jsonArray.map { it.jsonObject }
        assertEquals("uploads/plan.pdf", kept[0]["upload"]!!.jsonObject["file"]!!.jsonPrimitive.content)
        assertEquals("fernhill.app", kept[1]["name"]!!.jsonPrimitive.content)
        assertNull(CompanySetup.linkSource("  "))

        val objectives = listOf(Objective(id = "o1", name = "Users", target = 100.0), Objective(id = "o2", name = "Posts"))
        assertEquals(listOf(100.0 to 7.0), ProjectList.objectivesAfter(objectives, "o1", current = 7.0).filter { it.id == "o1" }.map { it.target to it.current })
        assertEquals(listOf("o2"), ProjectList.objectivesAfter(objectives, "o1", name = " ").map { it.id })
        assertEquals(12.5, ProjectList.number("12,5")!!, 0.0)
        assertNull(ProjectList.number("x"))
        assertEquals("12", ProjectList.shownNumber(12.0))
        assertEquals("2026-10-01", ProjectList.startDay(Company("p", startedAt = "2026-10-01T00:00:00.000Z")))
    }
}
