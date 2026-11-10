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

    @Test fun homesNeedsYouListsAllAndAProjectOnlyItsOwn() {
        val waiting = listOf(Waiting("#fff", "Allow?", bot = "b2"), Waiting("#fff", "Allow?", bot = "home"), Waiting(null, "Chief's"))
        assertEquals(listOf("b2"), Spaces.needsIn(shop, waiting).map { it.bot })
        assertEquals(emptyList<Waiting>(), Spaces.needsIn(gym, waiting))
        val marks = Spaces.spaceOfBot(listOf(shop, gym))
        assertEquals("Shop", marks["b2"]?.name)
        assertEquals(null, marks["home"])
    }

    @Test fun aProjectAlsoListsWhatWasAskedInItsTeamChatsAndNothingOfOtherBots() {
        val chats = listOf(Group(id = "g1", team = "t1"), Group(id = "g2"))
        val waiting = listOf(
            Waiting(null, "Chief in the team chat", group = "g1"),
            Waiting("#fff", "Cook in the team chat", bot = "home", group = "g1"),
            Waiting(null, "Chief's own chat"),
            Waiting("#fff", "Cook in a group of no team", bot = "home", group = "g2"),
            Waiting("#fff", "Writer", bot = "b2"),
        )
        assertEquals(listOf("Chief in the team chat", "Cook in the team chat", "Writer"), Spaces.needsIn(shop, waiting, chats).map { it.text })
        assertEquals(emptyList<Waiting>(), Spaces.needsIn(gym, waiting, chats))
        assertEquals(5, waiting.size) // Home lists all of it
    }

    @Test fun aProjectsQuestionsAreItsTeamBotsOnly() {
        assertEquals(listOf("b1"), Spaces.askingIn(shop, bots) { it.asks != null }.map { it.id })
        assertEquals(emptyList<Bot>(), Spaces.askingIn(gym, bots) { it.asks != null })
    }

    @Test fun aMembersAskIsDrawnUnderItsLeadInTheProject() {
        assertEquals("b2", Spaces.leadOf(shop, "b1"))
        assertEquals(null, Spaces.leadOf(shop, "b2"))
        assertEquals(null, Spaces.leadOf(shop, "home"))
        assertEquals(null, Spaces.leadOf(shop, null))
        val team = listOf(Bot(id = "b1", name = "Scout", color = "#111111"), Bot(id = "b2", name = "Writer", color = "#ff9500"))
        val shown = Spaces.underLeads(shop, listOf(Waiting("#111111", "Scout asks to browse the web", bot = "b1", permission = "a1"), Waiting("#222222", "Lead's own", bot = "b2")), team)
        assertEquals("#ff9500", shown[0].color)
        assertEquals("b1", shown[0].bot) // its chat and its card stay the member's
        assertEquals("a1", shown[0].permission)
        assertEquals("Scout asks to browse the web", shown[0].text)
        assertEquals("#222222", shown[1].color)
    }

    @Test fun aTeamsWaitsNameItsBotsAndItsChatAndABotOnItsHomeTeamOnly() {
        val dev = CompanyTeam(id = "dev", name = "Dev", bots = listOf("coder", "qa", "mgr"), lead = "mgr")
        val test = CompanyTeam(id = "test", name = "Testing", bots = listOf("load", "qa"), lead = "qa")
        val project = Company(id = "p", name = "Qwotz", teams = listOf(dev, test))
        val groups = listOf(Group(id = "g-dev", team = "dev"), Group(id = "g-test", team = "test"), Group(id = "g-other"))
        val waiting = listOf(
            Waiting(null, "", bot = "coder"),
            Waiting(null, "", bot = "load", group = "g-test"), // asked in the team chat
            Waiting(null, "", bot = "qa"),
            Waiting(null, "", bot = "outsider"),
        )
        assertEquals(
            mapOf("dev" to Spaces.TeamWait(listOf("coder", "mgr"), 0), "test" to Spaces.TeamWait(listOf("qa"), 1)),
            Spaces.teamWaits(project, waiting, groups, asking = listOf("mgr")),
        )
        assertEquals("test", Spaces.homeTeam(project, "qa")) // it leads Testing
        assertEquals(null, Spaces.homeTeam(project, "outsider"))
    }
}
