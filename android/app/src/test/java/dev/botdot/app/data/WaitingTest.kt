package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class WaitingTest {
    private val cap = kotlinx.serialization.json.Json.parseToJsonElement("""{"hat":"cap"}""")
    private val coder = Bot(id = "b1", name = "Coder", color = "#378add", outfit = cap, jobs = listOf(Job(id = "j1", name = "Nightly", approved = false)))

    @Test fun everythingThatWaitsInOneList() {
        val waiting = waitingOf(
            bots = listOf(coder),
            chief = ChiefOverview(chats = listOf(ChiefChatSummary(id = "c1", title = "Mail", waiting = WaitingPlan(from = BotRef(id = "b1", name = "Coder"))))),
            needs = Needs(
                requests = listOf(LoginRequest(id = "r1", site = "github.com", bot = BotRef(id = "b1", name = "Coder"))),
                bitwarden = BitwardenStatus(configured = true, unlocked = false),
                memory = listOf(MemoryChange(id = "m1", botId = "b1")),
                asks = listOf(Ask(id = "a1", kind = "skill", skill = AskSkill(name = "pdf"))),
            ),
            dash = Dashboard(pending = listOf(Tile(id = "t1", title = "Lights", bot = "b1"))),
        )
        assertEquals(
            listOf(
                "Coder needs a login for github.com",
                "Bitwarden is locked",
                "Coder: a job waits for your OK",
                "Coder wants to change the shared memory",
                "Coder sent the Chief a plan: Mail",
                "The Chief asks to install the skill pdf",
                "Coder: “Lights” on the Board waits for your OK",
            ),
            waiting.map { it.text },
        )
        // In the colour of the bot it's about; the Chief's (null) otherwise.
        assertEquals(listOf("#378add", null, "#378add", "#378add", "#378add", null, "#378add"), waiting.map { it.color })
        // And with that bot's hat, for its small head.
        assertEquals(listOf(cap, null, cap, cap, cap, null, cap), waiting.map { it.outfit })
    }

    @Test fun aBotThatIsGoneKeepsTheColourTheServerSentAndBitwardenIsItsBots() {
        val waiting = waitingOf(
            bots = listOf(coder),
            chief = null,
            needs = Needs(
                requests = listOf(LoginRequest(id = "r1", site = "github.com", bot = BotRef(id = "gone", name = "Old Bot", color = "#e24b4a")), LoginRequest(id = "r2", site = "x.com", bot = BotRef(id = "gone2", name = "Older Bot"))),
                bitwarden = BitwardenStatus(configured = true, unlocked = false, wantedBy = BotRef(id = "b1", name = "Coder")),
            ),
            dash = Dashboard(pending = listOf(Tile(id = "t1", title = "Lights", bot = "gone"))),
        )
        // A tile of a bot that is gone is the Chief's (no colour), as on the web page; a bot without a colour is grey.
        assertEquals(listOf("#e24b4a", "#888780", "#378add", "#378add", null), waiting.map { it.color }) // two logins, Bitwarden, Coder's job, the tile
        assertEquals(listOf(null, null, cap, cap, null), waiting.map { it.outfit })
    }

    @Test fun nothingLoadedYetIsNothingWaiting() {
        assertEquals(emptyList<Waiting>(), waitingOf(emptyList(), null, null, null))
    }
}
