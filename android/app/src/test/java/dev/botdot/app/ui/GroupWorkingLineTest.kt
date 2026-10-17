package dev.botdot.app.ui

import dev.botdot.app.data.Bot
import dev.botdot.app.data.FeedEvent
import dev.botdot.app.data.Group
import dev.botdot.app.data.GroupChatPage
import dev.botdot.app.data.GroupWorking
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.TurnLine
import dev.botdot.app.data.TurnLines
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A member's line in a group follows its turn's work (docs/api.md, "The working line", a turn in a group): with
 * `working-line` in the server's `features` the line under the group's chat and in its row is the turn's working
 * line, from the feed's `group_working_line` and from `workingLine` in the chat's `working`. Until a turn has one,
 * and against a server that sends a turn none, it is the opening line as before.
 * `test/groups-web.test.js` says the same of the web page.
 */
class GroupWorkingLineTest {
    private val with = listOf("opening-line", "working-line", "groups")
    private val without = listOf("opening-line", "groups")
    private val bots = listOf(Bot(id = "coder", name = "Coder", color = "#3b82f6"), Bot(id = "reviewer", name = "Reviewer", color = "#22c55e"))
    private fun event(type: String, data: String) = FeedEvent("boot.9", type, Json.parseToJsonElement(data).jsonObject)
    private fun said(type: String, text: String, runId: String = "r1", botId: String = "coder") =
        event(type, """{"chat":"group:g1","groupId":"g1","botId":"$botId","runId":"$runId","text":"$text"}""")
    private fun working(json: String) = GroupChatPage.of("""{"items":[],"working":$json}""").working
    private fun on(features: List<String>?) = TurnLines { features }

    /** The line under the chat, and the group's row, as the screens word them. */
    private fun TurnLines.under(w: GroupWorking, features: List<String>? = with) =
        workingWords(memberName(bots, w.botId), value.value[w.runId], OpeningLine.ofRun(w.workingLine, w.openingLine, features))
    private fun TurnLines.row(at: String) =
        groupLine(Group.list("""[{"id":"g1","name":"Dev","members":["coder","reviewer"],"working":["$at"]}]""").single(), bots, value.value)
    private val coder = GroupWorking("coder", "r1")
    private val reviewer = GroupWorking("reviewer", "r2")

    @Test fun aMembersLineFollowsItsTurnsWork() {
        val l = on(with)
        assertEquals("Coder · Working…", l.under(coder))
        l.handle(said("group_opening_line", "Reading the issue"))
        assertEquals("its opening line, until the turn has a working line", "Coder · Reading the issue…", l.under(coder))
        l.handle(said("group_working_line", "Reading the issue"))
        l.handle(said("group_working_line", " Reading nytimes.com "))
        assertEquals("Coder · Reading nytimes.com…", l.under(coder))
        assertEquals(GroupLine("Coder", "Reading nytimes.com…", working = true, color = "#3b82f6"), l.row("coder"))
        l.handle(said("group_working_line", "Running a command"))
        assertEquals("each text takes the place of the last", "Coder · Running a command…", l.under(coder))
        assertEquals("Running a command…", l.row("coder").text)
    }

    @Test fun twoMembersOneAfterAnotherEachReadItsOwnWords() {
        val l = on(with)
        l.handle(event("group_run_started", """{"id":"r1","groupId":"g1","botId":"coder"}"""))
        l.handle(said("group_working_line", "Reading the issue"))
        l.handle(event("group_run_finished", """{"id":"r1","groupId":"g1","botId":"coder","status":"success"}"""))
        assertNull("the line goes with its turn", l.value.value["r1"])
        l.handle(event("group_run_started", """{"id":"r2","groupId":"g1","botId":"reviewer"}"""))
        assertEquals("never the first member's last words", "Reviewer · Working…", l.under(reviewer))
        assertEquals("Working…", l.row("reviewer").text)
        l.handle(said("group_working_line", "Reading the diff", "r2", "reviewer"))
        assertEquals("Reviewer · Reading the diff…", l.under(reviewer))
        assertEquals(GroupLine("Reviewer", "Reading the diff…", working = true, color = "#3b82f6"), l.row("reviewer"))
        // "Stop all", a failure: any end takes the line.
        l.handle(event("group_run_finished", """{"id":"r2","groupId":"g1","botId":"reviewer","status":"stopped"}"""))
        assertEquals(emptyMap<String, TurnLine>(), l.value.value)
    }

    @Test fun onceATurnHasAWorkingLineItsOpeningLineIsNotDrawnInItsPlace() {
        val l = on(with)
        l.handle(said("group_working_line", "Reading nytimes.com"))
        l.handle(said("group_opening_line", "Checking the news")) // sent as before, for an app that knows no working line
        assertEquals("Coder · Reading nytimes.com…", l.under(coder))
        l.read("g1", working("""[{"botId":"coder","runId":"r1","openingLine":"Checking the news"}]"""))
        assertEquals("nor when the chat is read", "Coder · Reading nytimes.com…", l.under(coder))
        // Another turn has none yet: its opening line.
        l.handle(said("group_opening_line", "Reading the diff", "r2", "reviewer"))
        assertEquals("Reviewer · Reading the diff…", l.under(reviewer))
    }

    @Test fun aLineSaysNothingWithoutItsRunOrItsWords() {
        val l = on(with)
        l.handle(said("group_working_line", "  "))
        l.handle(said("group_working_line", "Reading", runId = ""))
        l.handle(event("working_line", """{"chat":"bot:coder","botId":"coder","runId":"r1","text":"A bot's own line is not a group's"}"""))
        assertEquals(emptyMap<String, TurnLine>(), l.value.value)
    }

    @Test fun aChatThatIsReadBringsEachMembersLineAsItReadsNow() {
        val page = working("""[{"botId":"coder","runId":"r1","messageId":"m1","startedAt":"2026-10-09T09:00:00Z","openingLine":"Checking the news","workingLine":"Reading nytimes.com"},
            {"botId":"reviewer","runId":"r2","openingLine":"Reading the diff"},{"botId":"writer","runId":"r3","workingLine":7}]""")
        assertEquals(GroupWorking("coder", "r1", "m1", "2026-10-09T09:00:00Z", "Checking the news", "Reading nytimes.com"), page[0])
        assertNull("a turn that has no line yet has no such field", page[1].workingLine)
        assertNull("what is no text is none", page[2].workingLine)
        // Left and opened again, a reconnect: the line is back as it was, and goes on changing.
        val l = on(with)
        l.read("g1", page)
        assertEquals("Coder · Reading nytimes.com…", l.under(page[0]))
        assertEquals("a turn without a working line: its opening line", "Reviewer · Reading the diff…", l.under(page[1]))
        assertEquals("Reading nytimes.com…", l.row("coder").text)
        l.handle(said("group_working_line", "Running a command"))
        assertEquals("Coder · Running a command…", l.under(page[0]))
        l.read("g1", page)
        assertEquals("the chat as it is read is the line now", "Coder · Reading nytimes.com…", l.under(page[0]))
        // Before the feed or the chat said anything, the screen draws the entry itself the same way.
        assertEquals("Coder · Reading nytimes.com…", on(with).under(page[0]))
    }

    @Test fun waitingForYourOkTakesTheLinesPlaceAndGivesItBack() {
        val l = on(with)
        l.handle(said("group_working_line", "Writing the email"))
        l.handle(event("group_run_waits", """{"chat":"group:g1","groupId":"g1","botId":"coder","runId":"r1","waitingFor":"ok"}"""))
        assertEquals("Coder · Waiting for your OK", l.under(coder))
        l.handle(event("group_run_waits", """{"chat":"group:g1","groupId":"g1","botId":"coder","runId":"r1"}"""))
        assertEquals("Coder · Writing the email…", l.under(coder))
    }

    @Test fun againstAServerWithoutTheWorkingLineAMembersLineIsItsOpeningLineAsBefore() {
        for (features in listOf(without, null)) {
            val l = on(features)
            l.handle(said("group_opening_line", "Checking the news"))
            l.handle(said("group_working_line", "Reading nytimes.com")) // nothing such a server sends; not drawn if it did
            assertEquals("Coder · Checking the news…", l.under(coder, features))
            assertEquals(TurnLine("g1", "coder", "Checking the news"), l.value.value["r1"])
            val page = working("""[{"botId":"coder","runId":"r1","openingLine":"Checking the news","workingLine":"Reading nytimes.com"}]""")
            l.read("g1", page)
            assertEquals("Coder · Checking the news…", l.under(page[0], features))
            assertEquals("Coder · Checking the news…", on(features).under(page[0], features))
            assertEquals("Checking the news…", l.row("coder").text)
        }
        // A server that has the working line for a bot's own run only sends a turn none: its opening line, all the turn.
        val l = on(listOf("opening-line", "working-line"))
        l.handle(said("group_opening_line", "Checking the news"))
        l.read("g1", working("""[{"botId":"coder","runId":"r1","openingLine":"Checking the news"}]"""))
        assertEquals("Coder · Checking the news…", l.under(coder))
    }
}
