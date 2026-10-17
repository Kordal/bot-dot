package dev.botdot.app.ui

import dev.botdot.app.data.Api
import dev.botdot.app.data.ChiefChat
import dev.botdot.app.data.OpeningLine
import dev.botdot.app.data.Run
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The working line that carries Stop, and what a run or a reply says once it was ended (`message-waits`, `ended-by`;
 * "The contract" of BUSY-003). The sentences are the server's: the app draws them.
 */
class StopLineTest {
    private fun run(json: String) = Api.JSON.decodeFromString(Run.serializer(), json)
    private val now = listOf("message-waits", "ended-by")
    private val before = listOf("message-key", "connector-waits") // Milestone 6

    @Test fun aBotsLineIsThereForEveryRunStopCanEnd() {
        val message = run("""{"id":"r1","botId":"doctor","status":"running"}""")
        val job = run("""{"id":"r2","botId":"doctor","status":"running","trigger":"schedule","jobName":"Morning news","kind":"ai"}""")
        val script = run("""{"id":"r3","botId":"doctor","status":"running","trigger":"schedule","jobName":"Disk check","kind":"script"}""")
        assertEquals("Reading last night's backup log…", OpeningLine.botLine("Reading last night's backup log", message))
        assertEquals("Working…", OpeningLine.botLine(null, message))
        assertEquals("Working…", OpeningLine.botLine(null, job))
        // A job's run reads as the server says: the app has no words of its own for it, as the web page has none.
        assertEquals("Running Morning news…", OpeningLine.botLine("Running Morning news", job))
        // A script job has no run while its script runs: none is at work, so no line and no Stop, as on the web page.
        assertEquals(message, OpeningLine.atWork(listOf(run("""{"id":"r0","botId":"doctor","status":"success"}"""), message)))
        assertEquals(job, OpeningLine.atWork(listOf(script, job)))
        assertNull(OpeningLine.atWork(listOf(script)))
        assertNull(OpeningLine.atWork(emptyList()))
        assertEquals("", OpeningLine.botLine(null, OpeningLine.atWork(listOf(script))))
        // While its run waits for the owner's OK the line says that; at rest there is none.
        assertEquals("Waiting for your OK", OpeningLine.botLine("Writing the email", message, waiting = true))
        assertEquals("", OpeningLine.botLine(null, null))
    }

    @Test fun theChiefsLineIsWhatItIsDoingElseItsOpeningLineElseThinking() {
        // The server's activity is the whole line: its opening line first, then the steps that follow.
        assertEquals("Looking at your bots…", OpeningLine.chiefLine("Looking at your bots", "Looking at your bots", busy = true))
        assertEquals("Waiting for Web Surfer…", OpeningLine.chiefLine("Looking at your bots", "Waiting for Web Surfer", busy = true))
        assertEquals("Thinking…", OpeningLine.chiefLine("Looking at your bots", "Thinking", busy = true))
        // No words in the activity (none came yet, or a server from before names the tool alone): the opening line stands.
        assertEquals("Looking at your bots…", OpeningLine.chiefLine("Looking at your bots", null, busy = true))
        assertEquals("Looking at your bots…", OpeningLine.chiefLine("Looking at your bots", OpeningLine.chiefActivity(dev.botdot.app.data.ChiefActivity("list_bots")), busy = true))
        assertEquals("Working…", OpeningLine.chiefLine(null, OpeningLine.chiefActivity(dev.botdot.app.data.ChiefActivity("list_bots")), busy = true))
        assertEquals("Waiting for Web Surfer…", OpeningLine.chiefLine(null, "Waiting for Web Surfer", busy = true))
        assertEquals("Thinking…", OpeningLine.chiefLine(null, null, busy = true))
        assertEquals("Thinking…", OpeningLine.chiefLine(" ", " ", busy = true))
        // Not replying: no line, whatever was said before.
        assertEquals("", OpeningLine.chiefLine("Looking at your bots", "Thinking", busy = false))
    }

    @Test fun anEndedRunDrawsTheServersSentenceForWhoEndedIt() {
        val sentences = mapOf(
            "owner" to ("stopped" to "You stopped this run before it finished."),
            "chief" to ("stopped" to "The Chief stopped this run before it finished."),
            "signout" to ("error" to "This run was stopped because Claude was signed out."),
            "limit" to ("error" to "I stopped after 60 minutes: this took too long. Send it again, or break it into smaller pieces."),
        )
        for ((by, said) in sentences) {
            val r = run("""{"id":"r1","status":"${said.first}","endedBy":"$by","problem":"${said.second}"}""")
            assertEquals(by, r.endedBy)
            assertEquals(by, Ended.Problem(said.second), endedWords(r, now))
        }
        // A run that ended by itself has none.
        assertNull(run("""{"id":"r1","status":"success","result":"Done."}""").endedBy)
        assertNull(run("""{"id":"r1","status":"stopped","endedBy":7}""").endedBy)
    }

    @Test fun theAppsOwnStoppedIsOnlyForAStoppedRunWithoutASentence() {
        assertEquals(Ended.Stopped("Stopped."), endedWords(run("""{"id":"r1","status":"stopped"}"""), now))
        assertEquals(Ended.Stopped("Stopped."), endedWords(run("""{"id":"r1","status":"stopped","problem":"  "}"""), now))
        // Against a server from Milestone 6 a stopped run reads as it did, also with its `problem`.
        val old = run("""{"id":"r1","status":"stopped","problem":"You stopped this run before it finished."}""")
        assertEquals(Ended.Stopped("Stopped."), endedWords(old, before))
        assertEquals(Ended.Stopped("Stopped."), endedWords(old, null))
        // A run that failed is drawn as before, with or without the feature.
        val failed = run("""{"id":"r1","status":"error","error":"boom","problem":"Something went wrong and I couldn't finish."}""")
        for (f in listOf(now, before, null)) assertEquals(Ended.Problem("Something went wrong and I couldn't finish."), endedWords(failed, f))
        assertEquals(Ended.Problem("boom"), endedWords(run("""{"id":"r1","status":"error","error":"boom"}"""), before))
        assertEquals(Ended.Problem("It didn't finish (interrupted)."), endedWords(run("""{"id":"r1","status":"interrupted"}"""), now))
    }

    @Test fun aStoppedChiefReplyDrawsTheServersSentenceAndALateResultItsChip() {
        val messages = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","messages":[
            {"role":"chief","text":"","error":"You stopped this reply. Web Surfer's run was stopped too.","stopped":[{"botId":"surf","name":"Web Surfer","runId":"r9"}]},
            {"role":"chief","text":"I had found two flights","error":"This reply was stopped because Claude was signed out."},
            {"role":"chief","text":"Web Surfer found it: TAP at 07:05.","actions":[{"kind":"from","text":"From Web Surfer","botId":"surf","runId":"r9"}],"files":[{"name":"flights.pdf","file":"r9/flights.pdf"}]}]}""").messages
        chiefReply(messages[0]).let { assertEquals(null to "You stopped this reply. Web Surfer's run was stopped too.", it.text to it.error) }
        chiefReply(messages[1]).let { assertEquals("I had found two flights" to "This reply was stopped because Claude was signed out.", it.text to it.error) }
        // A late result is a reply of the Chief like any other; its first chip says whose it is, and leads to that bot.
        val from = messages[2].actions.orEmpty().single()
        assertEquals("↩ From Web Surfer", chipWords(from, screen = false).text)
        assertEquals("surf" to "r9", from.botId to from.runId)
        assertEquals("Web Surfer found it: TAP at 07:05.", chiefReply(messages[2]).text)
    }
}
