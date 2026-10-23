package dev.botdot.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** The Mention rules, from the table every app is checked against (test/fixtures/mentions.json; see its "about"). */
class MentionsTest {
    @Serializable
    data class Library(val name: String, val description: String = "")

    @Serializable
    data class World(val bots: List<Bot>, val library: List<Library>, val all: Boolean = false, val account: List<Library> = emptyList())

    @Serializable
    data class Match(val kind: String, val text: String, val bot: String? = null, val job: String? = null, val skill: String? = null)

    @Serializable
    data class Case(val name: String, val world: String, val chat: String, val text: String? = null, val matches: List<Match>? = null,
                    val typed: String? = null, val suggestions: List<String>? = null)

    @Serializable
    data class Pick(val name: String, val world: String, val chat: String, val before: String, val pick: String, val after: String, val jobsNext: Boolean)

    @Serializable
    data class Command(val skill: String, val args: String)

    @Serializable
    data class CommandCase(val name: String, val world: String, val chat: String, val text: String, val command: Command? = null)

    @Serializable
    data class MarkWant(val kind: String, val skill: String? = null, val text: String, val start: Int, val end: Int)

    @Serializable
    data class MarkCase(val name: String, val world: String, val chat: String, val text: String, val mark: MarkWant? = null)

    @Serializable
    data class Table(val maxRows: Int, val shortNames: List<List<String>>, val worlds: Map<String, World>, val cases: List<Case>,
                     val picks: List<Pick>, val commands: List<CommandCase> = emptyList(), val marks: List<MarkCase> = emptyList(), val about: JsonElement? = null)

    private val table: Table = Json { ignoreUnknownKeys = true }.decodeFromString(
        Table.serializer(),
        File(System.getProperty("mentionsTable") ?: "../../test/fixtures/mentions.json").readText(),
    )

    private fun world(name: String, chat: String) = table.worlds.getValue(name).let {
        Mentions.World(chat, it.bots, it.library.map { k -> k.name }, all = it.all,
            about = it.account.associate { k -> k.name to k.description } + it.library.associate { k -> k.name to k.description }, account = it.account.map { k -> k.name })
    }
    private fun world(c: Case) = world(c.world, c.chat)

    @Test fun maxRows() = assertEquals(table.maxRows, Mentions.MAX_ROWS)

    @Test fun shortNames() = table.shortNames.forEach { (name, short) -> assertEquals(name, short, Mentions.shortName(name)) }

    @Test fun matches() {
        val cases = table.cases.filter { it.text != null }
        assert(cases.isNotEmpty())
        cases.forEach { c ->
            val found = Mentions.find(c.text!!, world(c)).map { Match(it.kind.name.lowercase(), it.text, it.bot, it.job, it.skill) }
            assertEquals(c.name, c.matches, found)
            // Where each one is: its text, at its place in the message.
            Mentions.find(c.text, world(c)).forEach { assertEquals(c.name, it.text, c.text.substring(it.start, it.end)) }
        }
    }

    @Test fun suggestions() {
        val cases = table.cases.filter { it.typed != null }
        assert(cases.isNotEmpty())
        cases.forEach { c -> assertEquals(c.name, c.suggestions, Mentions.suggest(c.typed!!, world(c)).map { it.text }) }
    }

    @Test fun picks() {
        assert(table.picks.isNotEmpty())
        table.picks.forEach { c ->
            val text = c.before.replace("|", "")
            val at = c.before.indexOf('|')
            val row = Mentions.suggest(text.substring(0, at), world(c.world, c.chat)).firstOrNull { it.text == c.pick }
            assertNotNull("${c.name}: ${c.pick} is offered", row)
            val done = Mentions.pick(text, at, row!!)!!
            assertEquals(c.name, c.after, done.text.substring(0, done.cursor) + "|" + done.text.substring(done.cursor))
            assertEquals(c.name, c.jobsNext, done.jobsNext)
        }
    }

    @Test fun commands() {
        assert(table.commands.isNotEmpty())
        table.commands.forEach { c ->
            assertEquals(c.name, c.command, Mentions.command(c.text, world(c.world, c.chat))?.let { Command(it.skill, it.args) })
        }
    }

    @Test fun marks() {
        assert(table.marks.isNotEmpty())
        table.marks.forEach { c ->
            val got = Mentions.mark(c.text, world(c.world, c.chat))?.let { MarkWant(if (it.skill != null) "skill" else "btw", it.skill, it.text, it.start, it.end) }
            assertEquals(c.name, c.mark, got)
        }
    }

    @Test fun aSkillToRunShowsItsDescription() =
        assertEquals("Write a short digest.", Mentions.suggest("/dig", world("team", "fleet")).single().about)

    @Test fun nothingBeingTypedNothingPicked() =
        assertNull(Mentions.pick("no mention here", 4, Mentions.Row(Mentions.Kind.BOT, "@FleetDoctor", "Fleet Doctor")))
}
