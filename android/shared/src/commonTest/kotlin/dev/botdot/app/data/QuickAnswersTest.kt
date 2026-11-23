package dev.botdot.app.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/** The small × after a reply's quick answers (`choices-dismiss`): what the phones read and send. */
class QuickAnswersTest {
    @Test fun theCrossIsOfferedOnlyByAServerThatAnnouncesIt() {
        assertTrue(hasChoicesDismiss(listOf("chief", "choices-dismiss")))
        assertFalse(hasChoicesDismiss(listOf("chief")))
        assertFalse(hasChoicesDismiss(null))
    }

    @Test fun whatTheOwnerChoseHereWinsOverAListTheServerHasNotChangedYet() {
        assertTrue(QuickAnswers.away(emptyMap(), "r1", true)) // the server says it is away
        assertFalse(QuickAnswers.away(emptyMap(), "r1", false))
        assertTrue(QuickAnswers.away(mapOf("r1" to true), "r1", false)) // dismissed here, the list is older
        assertFalse(QuickAnswers.away(mapOf("r1" to false), "r1", true)) // Undo here, the list is older
        assertFalse(QuickAnswers.away(mapOf("r2" to true), "r1", false)) // another reply's choice
        assertEquals("chief:c1:7", QuickAnswers.chiefKey("c1", 7))
    }

    @Test fun aReplyAndAChiefMessageReadTheFlagAndAnOlderServerLeavesItOut() {
        val run = Api.JSON.decodeFromString(Run.serializer(), """{"id":"r1","botId":"b","choices":["Yes","No"],"yes":0,"choicesDismissed":true}""")
        assertTrue(run.choicesDismissed)
        assertFalse(Api.JSON.decodeFromString(Run.serializer(), """{"id":"r2","botId":"b","choices":["Yes","No"]}""").choicesDismissed)
        val chat = Api.JSON.decodeFromString(ChiefChat.serializer(), """{"id":"c1","messages":[{"role":"chief","text":"Send it?","choices":["Yes","No"],"choicesDismissed":true},{"role":"chief","text":"Hi"}]}""")
        assertEquals(listOf(true, false), chat.messages.map { it.choicesDismissed })
    }

    @Test fun puttingAwayAndUndoSendTheFlagToTheReplyAndNothingElse() = runTest {
        val seen = mutableListOf<Triple<String, String, String>>()
        val api = Api("https://botdot.test", MockEngine { req ->
            seen += Triple(req.method.value, req.url.encodedPath.removePrefix("/api"), (req.body as? TextContent)?.text.orEmpty())
            respond("""{"ok":true}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))
        })
        api.dismissChoices("r 1", true)
        api.dismissChoices("r 1", false)
        api.dismissChiefChoices("c1", 7, true)
        assertEquals(
            listOf(
                Triple("PUT", "/runs/r%201/choices-dismissed", """{"dismissed":true}"""),
                Triple("PUT", "/runs/r%201/choices-dismissed", """{"dismissed":false}"""),
                Triple("PUT", "/chief/chats/c1/messages/7/choices-dismissed", """{"dismissed":true}"""),
            ),
            seen,
        )
    }
}
