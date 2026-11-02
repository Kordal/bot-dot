package dev.botdot.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Spaces (#840): which projects are spaces, their counts, the space a device opens again (a gone project is Home,
 * the old "company" place is the project it showed), and the chat a space opens with.
 */
class SpacesTest {
    private val features = listOf(CompanySetup.FEATURE, CompanySetup.MANY, Groups.TEAM_CHATS)
    private val growth = CompanyTeam(id = "t1", name = "Growth", bots = listOf("b1", "b2"), lead = "b2")
    private val shop = Company(id = "p1", name = "Shop", color = "#34c759", teams = listOf(growth))
    private val gym = Company(id = "p2", name = "Gym")
    private val old = Company(id = "p3", name = "Old", archived = true)
    private val asking = JsonObject(mapOf("text" to JsonPrimitive("Which day?")))
    private val bots = listOf(
        Bot(id = "b1", name = "Scout", asksValue = asking),
        Bot(id = "b2", name = "Writer"),
        Bot(id = "home", name = "Cook", asksValue = asking),
    )

    @Test fun theOpenProjectsAreSpacesInTheirOrder() {
        assertEquals(listOf("p1", "p2"), Spaces.projects(features, listOf(shop, gym, old), null).map { it.id })
        assertEquals(emptyList<Company>(), Spaces.projects(listOf("other"), listOf(shop), null))
        // An older botdot with one company: that one.
        assertEquals(listOf("p1"), Spaces.projects(listOf(CompanySetup.FEATURE), emptyList(), shop).map { it.id })
        assertEquals(emptyList<Company>(), Spaces.projects(listOf(CompanySetup.FEATURE), emptyList(), null))
    }

    @Test fun aSpaceCountsWhatItsBotsAsk() {
        val waiting = listOf(Waiting("#fff", "Allow?", bot = "b2"), Waiting("#fff", "Allow?", bot = "home"), Waiting(null, "Chief's"))
        val list = Spaces.list(listOf(shop, gym), bots, waiting)
        assertEquals(listOf(Spaces.Space("p1", "Shop", "#34c759", 2), Spaces.Space("p2", "Gym", ManyProjects.DEFAULT_COLOR, 0)), list)
    }

    @Test fun aWorkingBotsQuestionIsNotCountedYet() {
        val working = listOf(Bot(id = "b1", name = "Scout", running = true, asksValue = asking))
        assertEquals(0, Spaces.asksOf(working, emptyList())("b1"))
    }

    @Test fun theDeviceOpensTheSpaceItWasIn() {
        val ids = listOf("p1", "p2")
        assertEquals("p2", Spaces.remembered("p2", ids, null))
        assertEquals(Spaces.HOME, Spaces.remembered("gone", ids, "p2"))
        assertEquals(Spaces.HOME, Spaces.remembered(null, ids, "p2"))
        // The switch was on Projects before spaces: the project it showed, else the first, else Home.
        assertEquals("p2", Spaces.remembered(Spaces.LEGACY_PROJECTS, ids, "p2"))
        assertEquals("p1", Spaces.remembered(Spaces.LEGACY_PROJECTS, ids, "gone"))
        assertEquals(Spaces.HOME, Spaces.remembered(Spaces.LEGACY_PROJECTS, emptyList(), null))
    }

    @Test fun aGoneProjectFallsBackToHome() {
        assertEquals("p1", Spaces.still("p1", listOf("p1")))
        assertEquals(Spaces.HOME, Spaces.still("p1", listOf("p2")))
        assertEquals(Spaces.HOME, Spaces.still(Spaces.HOME, emptyList()))
    }

    @Test fun aProjectOpensItsTeamChatElseTheChief() {
        val chat = Group(id = "g7", name = "Growth", team = "t1")
        assertEquals("group/g7", Spaces.defaultChat(shop, listOf(chat), features))
        assertEquals(Spaces.CHIEF, Spaces.defaultChat(gym, listOf(chat), features)) // no team
        assertEquals(Spaces.CHIEF, Spaces.defaultChat(shop, emptyList(), features)) // its chat not there
        assertEquals(Spaces.CHIEF, Spaces.defaultChat(shop, listOf(chat), listOf(CompanySetup.FEATURE))) // no team chats
        assertEquals(Spaces.CHIEF, Spaces.defaultChat(null, listOf(chat), features)) // Home
    }

    // ---------- each bot in one space (#841) ----------

    @Test fun teamBotsAndTheirChatsLeaveHome() {
        val chat = Group(id = "g7", name = "Growth", team = "t1")
        val mine = Group(id = "g1", name = "Kitchen")
        assertEquals(listOf("home"), Spaces.homeBots(bots, listOf(shop, gym)).map { it.id })
        assertEquals(listOf("g1"), Spaces.homeGroups(listOf(chat, mine), listOf(shop, gym)).map { it.id })
        // Without projects, everything is Home's, as before.
        assertEquals(bots, Spaces.homeBots(bots, emptyList()))
        assertEquals(listOf("g7", "g1"), Spaces.homeGroups(listOf(chat, mine), emptyList()).map { it.id })
    }

    @Test fun homesFilterOnAllKeepsTeamBotsAndChats() {
        val chat = Group(id = "g7", name = "Growth", team = "t1")
        assertEquals(bots, Spaces.homeBots(bots, listOf(shop, gym), all = true))
        assertEquals(listOf("g7"), Spaces.homeGroups(listOf(chat), listOf(shop, gym), all = true).map { it.id })
    }

    @Test fun aBotThatLeavesItsTeamIsBackOnHome() {
        val left = shop.copy(teams = listOf(growth.copy(bots = listOf("b2"))))
        assertEquals(listOf("b1", "home"), Spaces.homeBots(bots, listOf(left)).map { it.id })
    }

    @Test fun homesNeedsYouListsAllAndAProjectOnlyItsOwn() {
        val waiting = listOf(Waiting("#fff", "Allow?", bot = "b2"), Waiting("#fff", "Allow?", bot = "home"), Waiting(null, "Chief's"))
        assertEquals(listOf("b2"), Spaces.needsIn(shop, waiting).map { it.bot })
        assertEquals(emptyList<Waiting>(), Spaces.needsIn(gym, waiting))
        val marks = Spaces.spaceOfBot(listOf(shop, gym))
        assertEquals("Shop", marks["b2"]?.name)
        assertEquals(null, marks["home"])
    }
}
