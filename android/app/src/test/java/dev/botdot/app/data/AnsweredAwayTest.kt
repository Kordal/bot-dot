package dev.botdot.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * An approval request answered on the Needs you screen, in the chat it stood in (issue #29): the chat of the bot
 * that asked says what the owner answered, once, when it is drawn next. `test/chat-approvals-web.test.js` holds the
 * web page's side.
 */
class AnsweredAwayTest {
    private val mail = """{"id":"mail","name":"Mail Writer","color":"#9b59d0"}"""
    private val coder = """{"id":"coder","name":"Coder","color":"#7f77dd"}"""
    private val issue = """{"id":"k1","kind":"connector-action","botId":"mail","runId":"r1","bot":$mail,"title":"Create issue with GitHub?",
        "rows":[{"label":"Owner","value":"Kordal"},{"label":"Repo","value":"bot-dot"},{"label":"Title","value":"Show approval requests in the chat window"}],"held":true}"""
    private val tool = """{"id":"a1","kind":"tool","botId":"coder","bot":$coder,"title":"Install gh for Coder?","meta":"asked by the Chief","facts":[]}"""
    private fun ask(json: String) = Ask.list("[$json]").single()

    @Test fun anAsksCardStandsInTheChatOfItsBotAndWhereverElseItIsDrawn() {
        assertEquals(setOf("mail"), AnsweredAway.chatsOf(ask(issue)))
        assertEquals(setOf("coder", "chief"), AnsweredAway.chatsOf(ask(tool))) // a tool the Chief asks for: in both chats
        assertEquals(setOf("group:g1"), AnsweredAway.chatsOf(ask(issue.replace("\"held\":true", "\"held\":true,\"groupId\":\"g1\",\"groupName\":\"Dev\""))))
    }

    @Test fun theChatItStoodInTakesTheAnswerOnceAndAnotherChatKeepsItsOwn() {
        val away = AnsweredAway()
        away.add(ask(issue), "Create issue with GitHub?", "Allowed · it carries on")
        assertEquals(emptyList<AnsweredAsk>(), away.take("coder"))
        assertEquals(listOf(AnsweredAsk("a:k1", setOf("mail"), "Create issue with GitHub?", "Allowed · it carries on")), away.take("mail"))
        assertEquals("taken: the chat keeps it as a line answered there", emptyList<AnsweredAsk>(), away.take("mail"))
        assertTrue(away.value.value.isEmpty())
        // A card in two chats: each takes it once.
        away.add(ask(tool), "Install gh for Coder?", "Declined")
        assertEquals(1, away.take("chief").size)
        assertEquals(listOf(AnsweredAsk("a:a1", setOf("coder"), "Install gh for Coder?", "Declined")), away.value.value)
        assertEquals(1, away.take("coder").size)
        assertTrue(away.value.value.isEmpty())
    }

    @Test fun aSecondAnswerOfTheSameCardReplacesTheFirstAndAnotherBotdotForgetsThem() {
        val away = AnsweredAway()
        away.add(ask(issue), "Create issue with GitHub?", "Declined")
        away.add(ask(issue), "Create issue with GitHub?", "Always approved")
        assertEquals(listOf("Always approved"), away.value.value.map { it.label })
        away.clear()
        assertTrue(away.value.value.isEmpty())
    }
}
