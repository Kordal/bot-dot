package dev.botdot.app.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The card of a tool to install in the Android app (docs/api.md "A tool to install"): what `GET /api/asks` hands out
 * is read (a tool from the registry, one from a link, an ask without the card's fields, one with fields this app does
 * not know), which chats the card stands in, what Install and Decline send, and the line and the head it adds to what
 * waits. `test/tool-card-web.test.js` holds the web page's side.
 */
class ToolCardTest {
    private fun asks(json: String): List<Ask> = Api.JSON.decodeFromString(json)

    private val coder = """{"id":"coder","name":"Coder","color":"#7f77dd"}"""
    // As GET /api/asks hands them out.
    private val gh = """{"id":"a1","kind":"tool","botId":"coder","chatId":"c1","bot":$coder,"forBots":[],"reason":"Coder needs it to open the pull request.","at":"2026-10-03T09:00:00.000Z",
        "title":"Install gh for Coder?","meta":"asked by the Chief","body":"GitHub CLI.\n\nWhy: Coder needs it to open the pull request.",
        "facts":[{"label":"Version","value":"2.101.0"},{"label":"Source","value":"botdot's registry (conda-forge), checksum verified"},{"label":"Size","value":"14 MB"},{"label":"Runs as","value":"Coder only"},{"label":"Stays","value":"across botdot updates"}],
        "tool":{"name":"gh","version":"2.101.0","summary":"GitHub CLI.","source":{"type":"registry","registry":"conda-forge"},"platform":"linux-aarch64","size":14000000,"packages":3},"askedBy":"chief"}"""
    private val warning = "Not from botdot's registry: not checked."
    private val address = "github.com/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux_arm64.tar.gz"
    private val stripe = """{"id":"a2","kind":"tool","botId":"coder","bot":$coder,"forBots":[],"reason":"Coder needs it to replay test payments.","at":"2026-10-03T09:05:00.000Z",
        "title":"Install stripe for Coder?","meta":"from a link you gave · Coder asked the Chief","body":"Stripe CLI, as described on its page. botdot has not checked what this program does.\n\nWhy: Coder needs it to replay test payments.",
        "warning":"$warning",
        "facts":[{"label":"Version","value":"1.31.0"},{"label":"Source","value":"$address"},{"label":"File","value":"stripe_1.31.0_linux_arm64.tar.gz"},{"label":"Checksum","value":"sha256 3f9a…c2e1"},{"label":"Size","value":"12 MB"},{"label":"Runs as","value":"Coder only"}],
        "tool":{"name":"stripe","version":"1.31.0","summary":"Stripe CLI","source":{"type":"link","url":"https://$address","sha256":"3f9a0c5d1e7b4a6f8c2d9e0b1a3c5d7f9e1b3a5c7d9f0e2b4a6c8d0e2f4ac2e1","command":"stripe","from":"owner"},"platform":"linux-aarch64","size":12000000},"askedBy":{"bot":"coder","runId":"r1"}}"""

    @Test fun aToolFromTheRegistryIsReadAsTheServerWroteIt() {
        val a = asks("[$gh]").single()
        assertTrue(ToolCard.isTool(a))
        val t = ToolCard.parts(a)
        assertEquals("Install gh for Coder?", t.title)
        assertEquals("asked by the Chief", t.meta)
        assertEquals("GitHub CLI.\n\nWhy: Coder needs it to open the pull request.", t.body)
        assertEquals("no warning for a tool from the registry", "", t.warning)
        // The facts, in the server's order.
        assertEquals(
            listOf("Version" to "2.101.0", "Source" to "botdot's registry (conda-forge), checksum verified", "Size" to "14 MB", "Runs as" to "Coder only", "Stays" to "across botdot updates"),
            t.facts.map { it.label to it.value },
        )
        assertEquals("gh", ToolCard.name(a))
        assertEquals(BotRef(id = "coder", name = "Coder", color = "#7f77dd"), a.bot)
    }

    @Test fun aToolFromALinkHasItsWarningAndItsOwnFacts() {
        val t = ToolCard.parts(asks("[$stripe]").single())
        assertEquals("from a link you gave · Coder asked the Chief", t.meta)
        assertEquals("the server's text, with no sign of its own: the app puts one in front", warning, t.warning)
        assertEquals(listOf("Version", "Source", "File", "Checksum", "Size", "Runs as"), t.facts.map { it.label }) // no "Stays" row
        // The long values come whole: the card wraps them.
        assertEquals(listOf(address, "stripe_1.31.0_linux_arm64.tar.gz", "sha256 3f9a…c2e1"), t.facts.subList(1, 4).map { it.value })
    }

    @Test fun anAskWithoutFactsOrWarningOrAnyOfTheCardsFieldsIsDrawnWithoutThem() {
        val bare = ToolCard.parts(asks("""[{"id":"a3","kind":"tool"}]""").single())
        assertEquals(ToolCard.Parts("", "", "", "", emptyList()), bare)
        assertEquals("", ToolCard.name(asks("""[{"id":"a3","kind":"tool"}]""").single()))

        val some = ToolCard.parts(asks("""[{"id":"a4","kind":"tool","title":"Install jq for Coder?","body":"A JSON processor."}]""").single())
        assertEquals(ToolCard.Parts("Install jq for Coder?", "", "A JSON processor.", "", emptyList()), some)
    }

    @Test fun fieldsThisAppDoesNotKnowAreLeftOutAndTheRestIsDrawn() {
        // A later server: new keys on the ask, on `tool` and on a row; a label this app never saw; a number; and
        // values that are not text. The asks beside it are read as before.
        val later = """{"id":"a5","kind":"tool","bot":$coder,"title":"Install gh for Coder?","meta":"asked by the Chief","body":"GitHub CLI.","signature":{"by":"conda-forge"},"risk":3,
            "warning":["not","text"],
            "facts":[{"label":"Version","value":"2.101.0","since":"2.100.0"},{"label":"Licence","value":"MIT"},{"label":"Packages","value":3},{"label":"Only a label"},{"value":"only a value"},{"label":{"a":1},"value":null},"a row that is no row",{}],
            "tool":{"name":"gh","signed":true,"mirrors":["a","b"]}}"""
        val list = asks("""[{"id":"p1","kind":"permission","permission":"web","what":{"label":"browse the web","hint":"search, and read web pages"},"bot":$coder},$later,{"id":"s1","kind":"skill","url":"https://example.com/pdf","skill":{"name":"pdf"}}]""")
        assertEquals(listOf("permission", "tool", "skill"), list.map { it.kind })
        val t = ToolCard.parts(list[1])
        assertEquals(listOf("Install gh for Coder?", "asked by the Chief", "GitHub CLI.", ""), listOf(t.title, t.meta, t.body, t.warning))
        assertEquals(
            listOf("Version" to "2.101.0", "Licence" to "MIT", "Packages" to "3", "Only a label" to "", "" to "only a value"),
            t.facts.map { it.label to it.value },
        )
        assertEquals("gh", ToolCard.name(list[1]))
        assertEquals("pdf", list[2].skill?.name)
        assertNull(list[0].facts)

        // Facts that are no list at all, and a body that is a number: drawn from what is text.
        val odd = ToolCard.parts(asks("""[{"id":"a6","kind":"tool","title":"Install jq for Coder?","meta":null,"body":7,"facts":"none","tool":"jq"}]""").single())
        assertEquals(ToolCard.Parts("Install jq for Coder?", "", "7", "", emptyList()), odd)
    }

    @Test fun theAppsOwnWordsAreTheTwoButtonsAndTheAnsweredCard() {
        assertEquals("Install" to "Decline", ToolCard.INSTALL to ToolCard.DECLINE)
        // Install answers at once and the install goes on by itself: the card does not say "Installed".
        assertEquals("Installing", ToolCard.answered(true))
        assertEquals("Declined", ToolCard.answered(false))
    }

    @Test fun theCardStandsInItsBotsChatAndInTheChiefs() {
        val (tool, skill, permission) = asks("""[$gh,{"id":"s1","kind":"skill","url":"https://example.com/pdf"},{"id":"p1","kind":"permission","permission":"web","bot":$coder}]""")
        assertTrue(tool.standsInChat("coder"))
        assertTrue(tool.standsInChat("chief"))
        assertFalse("another bot's chat", tool.standsInChat("mail"))
        // The other asks stay where they were: the Chief's skill in the Chief's chat, a bot's permission in its own.
        assertEquals(listOf(true, false), listOf(skill.standsInChat("chief"), skill.standsInChat("coder")))
        assertEquals(listOf(false, true), listOf(permission.standsInChat("chief"), permission.standsInChat("coder")))
        // A tool whose bot is gone has no bot's chat left.
        val gone = asks("""[{"id":"a7","kind":"tool","bot":null,"title":"Install gh for Coder?"}]""").single()
        assertEquals(listOf(true, false), listOf(gone.standsInChat("chief"), gone.standsInChat("coder")))
    }

    @Test fun installAndDeclineSendTheAsksAnswer() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = Api(server.url("/").toString().trimEnd('/'))
            val json = { code: Int, body: String -> MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build() }
            // Install: the server answers at once, the install goes on by itself.
            server.enqueue(json(200, """{"ok":true,"installing":true}"""))
            api.answerAsk("a1", true)
            val install = server.takeRequest()
            assertEquals("POST" to "/api/asks/a1", install.method to install.target)
            assertEquals("""{"yes":true,"always":false}""", install.body!!.utf8())

            server.enqueue(json(200, """{"ok":true,"declined":true}"""))
            api.answerAsk("a1", false)
            assertEquals("""{"yes":false,"always":false}""", server.takeRequest().body!!.utf8())

            // Refused: the call fails with the server's words, which the screen shows; the card stays.
            server.enqueue(json(404, """{"error":"That request was already answered."}"""))
            val refused = runCatching { api.answerAsk("a1", true) }.exceptionOrNull() as ApiException
            assertEquals("That request was already answered." to 404, refused.message to refused.status)
        } finally {
            server.close()
        }
    }

    @Test fun aToolCountsAmongWhatWaitsUnderItsBotsHead() {
        val cap = kotlinx.serialization.json.Json.parseToJsonElement("""{"hat":"cap"}""")
        val bots = listOf(Bot(id = "coder", name = "Coder", color = "#378add", outfit = cap))
        val waiting = waitingOf(bots, null, Needs(asks = asks("[$gh,$stripe]")), null)
        // One thing each, in the words of its notification ("Asks to install gh" under the bot's name).
        assertEquals(listOf("Coder asks to install gh", "Coder asks to install stripe"), waiting.map { it.text })
        assertTrue(waiting.none { "skill" in it.text })
        // Its small head is the bot's, as the bot looks now.
        assertEquals(listOf("#378add", "#378add"), waiting.map { it.color })
        assertEquals(listOf(cap, cap), waiting.map { it.outfit })

        // A bot that is gone: the Chief's head. An ask that does not name its tool: the server's title; one with
        // neither is still a tool, never a skill.
        val others = waitingOf(bots, null, Needs(asks = asks("""[{"id":"a7","kind":"tool","bot":null,"tool":{"name":"gh"}},{"id":"a8","kind":"tool","bot":$coder,"title":"Install jq for Coder?"},{"id":"a9","kind":"tool","bot":$coder}]""")), null)
        assertEquals(listOf("The Chief asks to install gh", "Coder: Install jq for Coder?", "Coder asks to install a tool"), others.map { it.text })
        assertEquals(listOf(null, "#378add", "#378add"), others.map { it.color })
    }
}
