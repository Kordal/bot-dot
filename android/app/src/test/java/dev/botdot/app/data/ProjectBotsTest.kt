package dev.botdot.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/** A project's own bots in no team (ADR 233): read from the server, offered by "Add bot", counted as the project's. */
class ProjectBotsTest {
    private val ops = CompanyTeam(id = "t1", name = "Ops", bots = listOf("a"), lead = "a")
    private val c = Company(id = "p1", name = "Botdot", teams = listOf(ops), bots = listOf("b"))
    private val bots = listOf(Bot(id = "a", name = "Infra"), Bot(id = "b", name = "Writer"), Bot(id = "c", name = "Seller"))

    @Test fun theProjectsOwnBotsAreRead() {
        val read = Json { ignoreUnknownKeys = true }.decodeFromString(Company.serializer(), """{"id":"p1","bots":["b"]}""")
        assertEquals(listOf("b"), read.bots)
        assertEquals(emptyList<String>(), Json { ignoreUnknownKeys = true }.decodeFromString(Company.serializer(), """{"id":"p1"}""").bots)
    }

    @Test fun addBotOffersOnlyBotsNotInTheProject() {
        assertEquals(listOf("c"), ProjectBots.addable(c, bots).map { it.id })
    }

    @Test fun aBotInNoTeamIsTheProjects() {
        assertEquals(setOf("a", "b"), Spaces.teamBots(listOf(c)))
        assertEquals("p1", Spaces.spaceOfBot(listOf(c))["b"]?.id)
    }
}
