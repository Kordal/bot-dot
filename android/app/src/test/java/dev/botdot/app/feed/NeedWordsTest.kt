package dev.botdot.app.feed

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * What the notification of something that waits says and which buttons it has (docs/api.md): the server's `text`
 * for an ask of every kind, a job and a tile, a yes only where the entry does not say `yesOn: "card"`, and the
 * app's own words for a server that sends no `text`.
 */
class NeedWordsTest {
    private fun obj(json: String) = Json.parseToJsonElement(json).jsonObject
    private fun said(w: AskWords) = w.text to answerButtons(w.yes, w.decline).map { it.first }
    private fun ask(json: String) = said(askWords(obj(json)))
    private fun job(json: String) = said(jobWords(obj(json)))
    private fun tile(json: String) = said(tileWords(obj(json)))

    @Test fun anAskOfEveryKindSaysTheServersText() {
        assertEquals("Asks to browse the web" to listOf("Decline", "Allow"), ask("""{"id":"p1","kind":"permission","what":"browse the web","text":"Asks to browse the web"}"""))
        // The server's line, not the app's "Asks to <what>".
        assertEquals("Wants to read your mail" to listOf("Decline", "Allow"), ask("""{"id":"p1","kind":"permission","what":"mail","text":"Wants to read your mail"}"""))
        assertEquals("Asks to install the skill pdf" to listOf("Decline", "Install"), ask("""{"id":"s1","kind":"skill","skill":"pdf","text":"Asks to install the skill pdf"}"""))
        assertEquals("Asks to install gh" to listOf("Decline", "Install"), ask("""{"id":"t1","kind":"tool","tool":"gh","text":"Asks to install gh"}"""))
        // Kinds the notifier had no words for: the server's, with a yes of their own.
        assertEquals("Asks to change Coder's instructions" to listOf("Decline", "Approve"), ask("""{"id":"c1","kind":"bot-change","text":"Asks to change Coder's instructions"}"""))
        assertEquals("Asks to send an email with Gmail" to listOf("Decline", "Approve"), ask("""{"id":"c2","kind":"connector-action","text":" Asks to send an email with Gmail "}"""))
    }

    @Test fun withYesOnCardAnAskHasDeclineAndNoYes() {
        for (kind in listOf("permission", "skill", "tool", "bot-change", "connector-action", "something-new")) {
            assertEquals(kind, "Needs a look" to listOf("Decline"), ask("""{"id":"a1","kind":"$kind","text":"Needs a look","yesOn":"card"}"""))
        }
        // Decline answers no, and nothing there answers yes.
        assertEquals(listOf("Decline" to false), askWords(obj("""{"id":"a1","kind":"bot-change","text":"Needs a look","yesOn":"card"}""")).let { answerButtons(it.yes, it.decline) })
    }

    @Test fun anAskWithoutTextFromAnOlderServer() {
        // A permission that names what: as before.
        assertEquals("Asks to browse the web" to listOf("Decline", "Allow"), ask("""{"id":"p1","kind":"permission","what":"browse the web","skill":null}"""))
        assertEquals("Asks to browse the web" to listOf("Decline", "Allow"), ask("""{"id":"p1","what":"browse the web"}"""))
        // A skill and a tool: as before.
        assertEquals("Asks to install the skill “pdf”" to listOf("Decline", "Install"), ask("""{"id":"s1","kind":"skill","what":null,"skill":"pdf"}"""))
        assertEquals("" to emptyList<String>(), ask("""{"id":"t1","kind":"tool","tool":"gh"}"""))
        // Any other kind, and a permission that names nothing: "Needs your OK", no yes and no Decline.
        for (odd in listOf(
            """{"id":"c1","kind":"bot-change","what":null,"skill":null}""",
            """{"id":"c2","kind":"connector-action"}""",
            """{"id":"x1","kind":"something-new","what":"do a thing"}""",
            """{"id":"p1","kind":"permission","what":null}""",
            """{"id":"p1","kind":"permission","what":"  "}""",
            """{"id":"p1","kind":"permission","what":{"label":"browse"}}""",
            """{"id":"c1","kind":"bot-change","yesOn":"card"}""",
            """{"id":"c1","kind":"bot-change","text":"  "}""",
            """{"id":"c1","kind":"bot-change","text":["Asks"]}""",
        )) assertEquals(odd, "Needs your OK" to emptyList<String>(), ask(odd))
    }

    @Test fun noNotificationReadsAsksToWithNothingAfterIt() {
        val kinds = listOf("permission", "skill", "tool", "bot-change", "connector-action", "", "new")
        val whats = listOf("", ""","what":null""", ""","what":"" """, ""","what":"run commands" """, ""","text":"Asks to do it" """)
        for (kind in kinds) for (what in whats) {
            val text = askWords(obj("""{"id":"a1","kind":"$kind"$what}""")).text
            assertFalse("$kind $what: $text", text.trim() == "Asks to")
        }
    }

    @Test fun aWaitingJobSaysTheServersText() {
        // A script: its yes is on the card, where the script shows.
        val script = """{"botId":"b1","botName":"Coder","jobId":"j1","jobName":"Nightly","kind":"script","when":"Every day at 07:00","text":"Nightly: a script, every day at 07:00","yesOn":"card"}"""
        assertEquals("Nightly: a script, every day at 07:00" to listOf("Decline"), job(script))
        // A job that uses AI keeps Approve.
        val ai = """{"botId":"b1","botName":"Coder","jobId":"j2","jobName":"Morning paper","kind":"prompt","when":"Every day at 07:00","text":"Morning paper: every day at 07:00"}"""
        assertEquals("Morning paper: every day at 07:00" to listOf("Decline", "Approve"), job(ai))
        // An older server: as before.
        assertEquals("Waiting for your OK: Nightly" to listOf("Decline", "Approve"), job("""{"botId":"b1","botName":"Coder","jobId":"j1","jobName":"Nightly"}"""))
        assertEquals("Waiting for your OK: Nightly" to listOf("Decline", "Approve"), job("""{"botId":"b1","jobId":"j1","jobName":"Nightly","text":" ","yesOn":"app"}"""))
    }

    @Test fun aWaitingTileSaysTheServersText() {
        val now = """{"tileId":"t1","title":"Lights","botId":"b1","text":"“Lights” on your Board: a script","yesOn":"card"}"""
        assertEquals("“Lights” on your Board: a script" to listOf("Decline"), tile(now))
        // An older server: as before.
        assertEquals(tileWaits("Lights") to listOf("Decline", "Approve"), tile("""{"tileId":"t1","title":"Lights","botId":"b1"}"""))
    }

    @Test fun theYesButtonsRule() {
        assertEquals("Approve", yesButton("Approve", obj("""{}""")))
        assertEquals(null, yesButton("Approve", obj("""{"yesOn":"card"}""")))
        assertEquals(null, yesButton("Approve", obj("""{"yesOn":" card "}""")))
        assertEquals(null, yesButton(null, obj("""{}""")))
        for (odd in listOf("\"app\"", "\"\"", "null", "true", "[\"card\"]")) assertEquals(odd, "Allow", yesButton("Allow", obj("""{"yesOn":$odd}""")))
    }

    @Test fun aFailedChiefReplysNotificationShowsTheError() {
        // Its feed status is "error": the problem, not the half-written text.
        assertEquals("Claude stopped answering.", chiefReplyText("error", "Here is the first half of", "Claude stopped answering."))
        assertEquals("Claude stopped answering.", chiefReplyText("error", "", "Claude stopped answering."))
        // A reply that went well, and one that was stopped: its text.
        assertEquals("All done.", chiefReplyText("success", "All done.", ""))
        assertEquals("Half a reply", chiefReplyText("stopped", "Half a reply", "Stopped."))
        // An older server names a failed reply without text only: its error, as before.
        assertEquals("Claude stopped answering.", chiefReplyText("", "", "Claude stopped answering."))
        assertEquals("Replied.", chiefReplyText("success", "", ""))
        assertEquals("Half", chiefReplyText("error", "Half", ""))
    }

    // ---------- Milestone 8: the server's words for the no, a change, and a bot that asks ----------

    private fun buttons(w: AskWords) = answerButtons(w.yes, w.decline, w.no)

    @Test fun aJobAndATileBeforeTheirFirstOkHaveTheServersNo() {
        val job = jobWords(obj("""{"botId":"b1","jobId":"j1","jobName":"Morning news","kind":"ai","text":"Wants to add a job: Morning news, daily at 08:00","no":"Decline and remove"}"""))
        assertEquals(listOf("Decline and remove" to false, "Approve" to true), buttons(job))
        val script = jobWords(obj("""{"botId":"b1","jobId":"j2","jobName":"Disk check","kind":"script","text":"Wants to add a job: Disk check, a script","no":"Decline and remove","yesOn":"card"}"""))
        assertEquals(listOf("Decline and remove" to false), buttons(script))
        val tile = tileWords(obj("""{"tileId":"t1","title":"Lights","text":"Wants a tile: Lights","no":" Decline and remove ","yesOn":"card"}"""))
        assertEquals(listOf("Decline and remove" to false), buttons(tile))
    }

    @Test fun againstAServerWithoutDeclineWordsTheButtonsAreAsBefore() {
        assertEquals(listOf("Decline" to false, "Approve" to true), buttons(jobWords(obj("""{"botId":"b1","jobId":"j1","jobName":"Morning news","text":"Wants to add a job"}"""))))
        assertEquals(listOf("Decline" to false), buttons(tileWords(obj("""{"tileId":"t1","title":"Lights","yesOn":"card"}"""))))
        for (odd in listOf("\"\"", "null", "[]", "{}")) assertEquals(odd, listOf("Decline" to false, "Approve" to true), buttons(jobWords(obj("""{"jobName":"Morning news","no":$odd,"yes":$odd}"""))))
    }

    @Test fun aChangeSaysTheServersTextAndKeepsTheJobOnItsNo() {
        val change = jobWords(obj("""{"botId":"b1","jobId":"j1","jobName":"Morning news","change":true,"text":"Wants to change a job: Morning news, daily at 07:00","no":"Keep as it is","yes":"Approve the change"}"""))
        assertEquals("Wants to change a job: Morning news, daily at 07:00", change.text)
        assertEquals(listOf("Keep as it is" to false, "Approve the change" to true), buttons(change))
        // An entry that says it is a change and names no buttons: never "Decline", which would read as removing the job.
        assertEquals(listOf("Keep as it is" to false, "Approve the change" to true), buttons(jobWords(obj("""{"jobName":"Morning news","change":true,"text":"Wants to change a job: Morning news"}"""))))
    }

    @Test fun aChangeThatTouchesAScriptHasNoYes() {
        val change = jobWords(obj("""{"botId":"b1","jobId":"j2","jobName":"Disk check","change":true,"text":"Wants to change a job: Disk check, a script","no":"Keep as it is","yes":"Approve the change","yesOn":"card"}"""))
        assertEquals(listOf("Keep as it is" to false), buttons(change))
        assertEquals(listOf("Keep as it is" to false), buttons(tileWords(obj("""{"tileId":"t1","title":"Lights","change":true,"yesOn":"card"}"""))))
    }

    @Test fun aRunThatAsksNotifiesWithTheServersTitleAndTheQuestion() {
        val q = "Two mailboxes have unread invoices. Which one shall I sort first?"
        val notice = asksNotice(asks = true, title = "Mail Sorter asks", bot = "Mail Sorter", result = q)!!
        assertEquals("Mail Sorter asks" to q, notice.title to notice.body)
        // The title is the server's; where it sends none, "<Bot> asks".
        assertEquals("Mail Sorter wants to know", asksNotice(true, " Mail Sorter wants to know ", "Mail Sorter", q)!!.title)
        for (none in listOf(null, "", "  ")) assertEquals("Mail Sorter asks", asksNotice(true, none, "Mail Sorter", q)!!.title)
    }

    @Test fun aLongReplyThatEndsInAQuestionNotifiesWithTheQuestion() {
        // The event's `result` is the reply's first 300 characters: the question is not in it. `question` says it.
        val opening = "I went through both mailboxes. ".repeat(10).take(300) + "…"
        val q = "Which one shall I sort first?"
        val notice = asksNotice(asks = true, title = "Mail Sorter asks", bot = "Mail Sorter", result = opening, question = q)!!
        assertEquals("Mail Sorter asks" to q, notice.title to notice.body)
        assertEquals("a reply that is only its buttons: the question alone", q, asksNotice(true, null, "Mail Sorter", "", " $q ")!!.body)
        // A server that sends no `question`, or an empty one: the reply's text, as before.
        for (none in listOf(null, "", "  ")) assertEquals(opening, asksNotice(true, "Mail Sorter asks", "Mail Sorter", opening, none)!!.body)
        assertEquals("a question alone asks nothing", null, asksNotice(false, "Mail Sorter asks", "Mail Sorter", opening, q))
    }

    @Test fun againstAServerWithoutAsksYouARunNotifiesAsToday() {
        assertEquals(null, asksNotice(asks = false, title = "", bot = "Mail Sorter", result = "Sorted 12 mails."))
        assertEquals("a title alone asks nothing", null, asksNotice(false, "Mail Sorter asks", "Mail Sorter", "Sorted 12 mails."))
        // A run that asks without its question in the event: a reply like any other.
        for (none in listOf(null, "", " ")) assertEquals(null, asksNotice(true, "Mail Sorter asks", "Mail Sorter", none))
    }
}
