package dev.botdot.app.ui

import dev.botdot.app.data.Ask
import dev.botdot.app.data.ToolCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The card of an action in a connected app (docs/api.md): the server's title, the action's fields as rows, drawn as
 * a tool's facts are, and under the title whether its run still waits for the answer. From a server that sends none
 * of it the card is today's. `test/connector-card-web.test.js` holds the web page's side.
 */
class ConnectorCardTest {
    private fun ask(more: String) = Ask.list("""[{"id":"a1","kind":"connector-action","bot":{"id":"mail","name":"Mail Writer","color":"#9b59d0"},
        "title":"Send email with Gmail?","details":"Allow once applies only while this run is active.\n\n{\n  \"recipient_email\": \"anna@example.com\"\n}"$more}]""").single()
    private val rows = """"rows":[{"label":"To","value":"anna@example.com"},{"label":"Subject","value":"Running 20 minutes late"},{"label":"Text","value":"Hi Anna, I'll be about 20 minutes late for our 14:00 call."}]"""
    private val clock: (String) -> String = { it.substring(11, 16) } // the app's short time, without the phone's time zone

    @Test fun theCardShowsTheServersTitleAndTheRows() {
        val a = ask(",$rows,\"held\":true")
        assertEquals("Send email with Gmail?", a.title)
        assertEquals(
            listOf(ToolCard.Fact("To", "anna@example.com"), ToolCard.Fact("Subject", "Running 20 minutes late"), ToolCard.Fact("Text", "Hi Anna, I'll be about 20 minutes late for our 14:00 call.")),
            a.rows,
        )
    }

    @Test fun anOpenedCardHasEveryRowAndEveryValueInFull() {
        // The list hands out every argument and every value whole (OK-007): the app reads them all and cuts none.
        val text = "Thank you for your letter. ".repeat(300) + "Wire the money to account 12345 today."
        val many = (0 until 40).joinToString(",") { "{\"label\":\"Extra $it\",\"value\":\"value $it\"}" }
        val a = ask(",\"rows\":[{\"label\":\"To\",\"value\":\"anna@example.com\"},{\"label\":\"Text\",\"value\":\"$text\"},$many],\"held\":true")
        assertEquals(42, a.rows.size)
        assertEquals(ToolCard.Fact("Text", text), a.rows[1])
        assertEquals(ToolCard.Fact("Extra 39", "value 39"), a.rows.last())
        assertFalse(a.rowsCut)
        assertFalse(a.tooLong)
        assertTrue("all the yes sends is on the card", connectorOnce(a) && connectorAlways(a))
        assertFalse("and no `details` beside the rows", connectorDetails(a))
        assertFalse(connectorTooLong(a))
    }

    @Test fun aCardFromAClippedEntryShowsDetailsUnderItsRowsAndTakesNoYes() {
        // The feed's entry is the short form: `more` on a row whose value was clipped, and beside the rows when some
        // were left out. A card drawn from a clipped value would show less than "Allow once" sends.
        val clippedRows = "\"rows\":[{\"label\":\"To\",\"value\":\"anna@example.com\"},{\"label\":\"Text\",\"value\":\"A long letter…\",\"more\":true}]"
        val clipped = ask(",$clippedRows,\"held\":true")
        val leftOutToo = ask(",$clippedRows,\"more\":true,\"held\":false,\"stoppedAt\":\"2026-10-05T13:52:00.000Z\"")
        for (a in listOf(clipped, leftOutToo)) {
            assertTrue(a.rowsCut)
            assertTrue("the rows it has are drawn", a.rows.isNotEmpty())
            assertFalse("no Allow once", connectorOnce(a))
            assertFalse("and no Always allow this action", connectorAlways(a))
            assertTrue("`details`, the arguments as they were sent, under the rows", connectorDetails(a))
            assertFalse(connectorTooLong(a))
        }
        assertEquals(listOf("To", "Text"), clipped.rows.map { it.label })
        // The feed's entry has no `details`: the rows alone, and still no yes.
        val bare = Ask.list("""[{"id":"a1","kind":"connector-action","title":"Send email with Gmail?",$clippedRows}]""").single()
        assertFalse(connectorOnce(bare) || connectorAlways(bare))
        assertFalse(connectorDetails(bare))
        // Only `true` is a cut: a whole ask, and a `more` of another kind, keep their yes.
        for (more in listOf("false", "null", "\"true\"", "1", "0", "{}", "[]")) {
            val whole = ask(",$rows,\"more\":$more")
            assertFalse(more, whole.rowsCut || whole.tooLong)
            assertTrue(more, connectorOnce(whole) && connectorAlways(whole))
            val row = ask(",\"rows\":[{\"label\":\"To\",\"value\":\"anna@example.com\",\"more\":$more}]")
            assertFalse(more, row.rowsCut)
            assertEquals(more, 1, row.rows.size)
        }
        assertTrue(connectorOnce(ask(",$rows,\"held\":true")))
        // From a server that sends no rows the card is today's: `details`, with its yes.
        val old = ask("")
        assertTrue(connectorOnce(old) && connectorAlways(old))
        assertTrue(connectorDetails(old))
        // Rows this app cannot read are not drawn, so `details` is all the card shows: whole, with its yes.
        val odd = ask(",\"rows\":[{\"label\":\"To\",\"value\":[\"a\"]}]")
        assertEquals(emptyList<ToolCard.Fact>(), odd.rows)
        assertTrue(connectorOnce(odd) && connectorAlways(odd))
        assertTrue(connectorDetails(odd))
    }

    @Test fun anActionTooLongToShowInFullHasItsRowsTheLineDeclineAndAlwaysAllow() {
        // An ask of the list with `more: true` beside its rows (OK-008): more than 200 arguments, or more than
        // 100,000 characters. The rows are the first that fit, each whole; "Allow once" would send the rest unseen.
        val many = (0 until 200).joinToString(",") { "{\"label\":\"Field $it\",\"value\":\"value $it\"}" }
        for (state in listOf("\"held\":true", "\"held\":false,\"stoppedAt\":\"2026-10-05T13:52:00.000Z\",\"then\":{\"who\":\"bot\",\"text\":\"It carries on when you allow it.\"}")) {
            val a = ask(",\"rows\":[$many],\"more\":true,$state")
            assertTrue(a.tooLong)
            assertFalse("no row of the list is clipped", a.rowsCut)
            assertEquals(200, a.rows.size)
            assertEquals(ToolCard.Fact("Field 199", "value 199"), a.rows.last())
            assertTrue("the line that says so", connectorTooLong(a))
            assertFalse("no Allow once", connectorOnce(a))
            assertTrue("Always allow this action stays", connectorAlways(a))
            assertFalse("`details` is as long as the action: not drawn", connectorDetails(a))
        }
        assertEquals("Too long to show in full.", TOO_LONG)
        // One value longer than a card, or rows this app cannot read: no row, the line, and still no `details`.
        for (none in listOf("\"rows\":[]", "\"rows\":[{\"label\":\"To\",\"value\":[\"a\"]}]", "\"held\":true")) {
            val a = ask(",$none,\"more\":true")
            assertEquals(none, emptyList<ToolCard.Fact>(), a.rows)
            assertEquals(none, listOf(true, false, true, false), listOf(connectorTooLong(a), connectorOnce(a), connectorAlways(a), connectorDetails(a)))
        }
        // Only `true` says it.
        for (more in listOf("false", "null", "\"true\"", "1", "0", "{}", "[]")) {
            val a = ask(",\"rows\":[$many],\"more\":$more")
            assertEquals(more, listOf(false, true, true, false), listOf(connectorTooLong(a), connectorOnce(a), connectorAlways(a), connectorDetails(a)))
        }
        // A row that was clipped as well takes every yes away, as before.
        val both = ask(",\"rows\":[{\"label\":\"Text\",\"value\":\"A long letter…\",\"more\":true}],\"more\":true")
        assertEquals(listOf(false, false, false, true), listOf(connectorTooLong(both), connectorOnce(both), connectorAlways(both), connectorDetails(both)))
    }

    @Test fun withoutRowsItShowsDetails() {
        val a = ask("")
        assertEquals(emptyList<ToolCard.Fact>(), a.rows)
        assertEquals("Allow once applies only while this run is active.\n\n{\n  \"recipient_email\": \"anna@example.com\"\n}", a.details)
        assertEquals(emptyList<ToolCard.Fact>(), ask(",\"rows\":[]").rows)
    }

    @Test fun aRunThatWaitsSaysSoUnderTheTitle() {
        val a = ask(",$rows,\"held\":true")
        assertEquals("Mail Writer waits for your answer", connectorState("Mail Writer", a.held, a.stoppedAt, clock))
        // Held, whatever else the ask says.
        assertEquals("Mail Writer waits for your answer", connectorState("Mail Writer", true, "2026-10-05T13:52:00.000Z", clock))
    }

    @Test fun oneThatStoppedWaitingSaysWhen() {
        val a = ask(",$rows,\"held\":false,\"stoppedAt\":\"2026-10-05T13:52:00.000Z\",\"then\":{\"who\":\"bot\",\"text\":\"It carries on when you allow it.\"}")
        assertEquals("Mail Writer stopped waiting at 13:52", connectorState("Mail Writer", a.held, a.stoppedAt, clock))
        assertEquals("It carries on when you allow it.", a.then?.line())
    }

    @Test fun withoutTheStateTheLineIsTodays() {
        // An older server; not held but no time; a time this app cannot read.
        val old = ask("")
        assertNull(connectorState("Mail Writer", old.held, old.stoppedAt, clock))
        assertNull(connectorState("Mail Writer", false, null, clock))
        assertNull(connectorState("Mail Writer", null, "2026-10-05T13:52:00.000Z", clock))
        assertNull(connectorState("Mail Writer", false, "ten minutes ago")) // the app's own short time reads no such time
        val odd = ask(",\"held\":\"false\",\"stoppedAt\":7")
        assertNull(connectorState("Mail Writer", odd.held, odd.stoppedAt, clock))
    }

    @Test fun theAppsShortTimeIsUsed() {
        // The same words as the times beside the chat's messages, in the phone's time zone.
        val at = "2020-03-04T13:52:00.000Z"
        assertEquals("Mail Writer stopped waiting at ${shortTime(at)}", connectorState("Mail Writer", false, at))
    }
}
